//! Event mapper for transforming H2OS entities to AetherCore Canonical Events
//!
//! Maps H2OS event types and entities to the AetherCore event model,
//! injecting provenance metadata and federation identifiers.

use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

/// H2OS event types mapped to AetherCore EventType
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum H2OSEventType {
    /// PT100 temperature sensor reading
    PT100Temperature,
    /// PT110 temperature sensor reading
    PT110Temperature,
    /// PS110 pressure sensor reading
    PS110Pressure,
    /// H2Detect hydrogen detection sensor
    H2Detection,
    /// GPS position update
    GPSPosition,
    /// Fleet asset state change
    AssetStateChange,
    /// Dispatch lifecycle event
    DispatchEvent,
    /// Alarm/alert event
    AlarmEvent,
}

impl H2OSEventType {
    /// Convert to AetherCore canonical event type string
    pub fn to_canonical_type(&self) -> &'static str {
        match self {
            H2OSEventType::PT100Temperature => "TELEMETRY",
            H2OSEventType::PT110Temperature => "TELEMETRY",
            H2OSEventType::PS110Pressure => "TELEMETRY",
            H2OSEventType::H2Detection => "TELEMETRY",
            H2OSEventType::GPSPosition => "GPS",
            H2OSEventType::AssetStateChange => "FLEET",
            H2OSEventType::DispatchEvent => "MISSION",
            H2OSEventType::AlarmEvent => "ALERT",
        }
    }

    /// Get sensor type identifier for telemetry events
    pub fn sensor_type(&self) -> Option<&'static str> {
        match self {
            H2OSEventType::PT100Temperature => Some("PT100"),
            H2OSEventType::PT110Temperature => Some("PT110"),
            H2OSEventType::PS110Pressure => Some("PS110"),
            H2OSEventType::H2Detection => Some("H2Detect"),
            _ => None,
        }
    }
}

/// Event mapper for H2OS to AetherCore transformations
#[derive(Debug, Clone)]
pub struct EventMapper {
    /// Source system identifier
    source_system: String,
}

impl EventMapper {
    /// Create a new event mapper
    pub fn new() -> Self {
        Self {
            source_system: "h2os".to_string(),
        }
    }

    /// Create event mapper with custom source system identifier
    pub fn with_source(source_system: String) -> Self {
        Self { source_system }
    }

    /// Inject provenance metadata into event metadata
    pub fn inject_provenance(
        &self,
        metadata: &mut BTreeMap<String, serde_json::Value>,
        federation_id: &str,
        h2os_event_type: H2OSEventType,
    ) {
        metadata.insert(
            "source".to_string(),
            serde_json::Value::String(self.source_system.clone()),
        );
        metadata.insert(
            "federation_id".to_string(),
            serde_json::Value::String(federation_id.to_string()),
        );
        metadata.insert(
            "h2os_event_type".to_string(),
            serde_json::Value::String(format!("{:?}", h2os_event_type)),
        );
    }

    /// Map H2OS sensor reading to telemetry metadata
    pub fn map_sensor_metadata(
        &self,
        sensor_id: &str,
        device_id: &str,
        additional: Option<BTreeMap<String, serde_json::Value>>,
    ) -> BTreeMap<String, serde_json::Value> {
        let mut metadata = BTreeMap::new();
        metadata.insert(
            "sensor_id".to_string(),
            serde_json::Value::String(sensor_id.to_string()),
        );
        metadata.insert(
            "device_id".to_string(),
            serde_json::Value::String(device_id.to_string()),
        );

        if let Some(extra) = additional {
            metadata.extend(extra);
        }

        metadata
    }

    /// Replace H2OS "Previous" string pattern with BLAKE3 hash
    ///
    /// H2OS uses a "Previous: string" pattern for event chaining.
    /// This converts it to a BLAKE3 hash for cryptographic verification.
    pub fn compute_prev_hash(&self, previous_id: &str) -> Vec<u8> {
        if previous_id.is_empty() {
            // Genesis event - use zero hash
            vec![0u8; 32]
        } else {
            // Hash the previous ID to create chain link
            let hash = blake3::hash(previous_id.as_bytes());
            hash.as_bytes().to_vec()
        }
    }

    /// Detect replay attack via hash chain validation
    ///
    /// Validates that the provided prev_hash matches expectations
    pub fn validate_chain_link(
        &self,
        claimed_prev_hash: &[u8],
        actual_prev_id: &str,
    ) -> bool {
        let computed = self.compute_prev_hash(actual_prev_id);
        claimed_prev_hash == computed.as_slice()
    }

    /// Get the source system identifier
    pub fn source_system(&self) -> &str {
        &self.source_system
    }
}

impl Default for EventMapper {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_h2os_event_type_to_canonical() {
        assert_eq!(H2OSEventType::PT100Temperature.to_canonical_type(), "TELEMETRY");
        assert_eq!(H2OSEventType::GPSPosition.to_canonical_type(), "GPS");
        assert_eq!(H2OSEventType::AssetStateChange.to_canonical_type(), "FLEET");
        assert_eq!(H2OSEventType::DispatchEvent.to_canonical_type(), "MISSION");
        assert_eq!(H2OSEventType::AlarmEvent.to_canonical_type(), "ALERT");
    }

    #[test]
    fn test_h2os_event_type_sensor_type() {
        assert_eq!(H2OSEventType::PT100Temperature.sensor_type(), Some("PT100"));
        assert_eq!(H2OSEventType::PT110Temperature.sensor_type(), Some("PT110"));
        assert_eq!(H2OSEventType::PS110Pressure.sensor_type(), Some("PS110"));
        assert_eq!(H2OSEventType::H2Detection.sensor_type(), Some("H2Detect"));
        assert_eq!(H2OSEventType::GPSPosition.sensor_type(), None);
    }

    #[test]
    fn test_event_mapper_creation() {
        let mapper = EventMapper::new();
        assert_eq!(mapper.source_system(), "h2os");

        let custom_mapper = EventMapper::with_source("custom-system".to_string());
        assert_eq!(custom_mapper.source_system(), "custom-system");
    }

    #[test]
    fn test_inject_provenance() {
        let mapper = EventMapper::new();
        let mut metadata = BTreeMap::new();

        mapper.inject_provenance(
            &mut metadata,
            "fed-001",
            H2OSEventType::PT100Temperature,
        );

        assert_eq!(
            metadata.get("source"),
            Some(&serde_json::Value::String("h2os".to_string()))
        );
        assert_eq!(
            metadata.get("federation_id"),
            Some(&serde_json::Value::String("fed-001".to_string()))
        );
        assert!(metadata.contains_key("h2os_event_type"));
    }

    #[test]
    fn test_map_sensor_metadata() {
        let mapper = EventMapper::new();
        let metadata = mapper.map_sensor_metadata("sensor-001", "device-001", None);

        assert_eq!(
            metadata.get("sensor_id"),
            Some(&serde_json::Value::String("sensor-001".to_string()))
        );
        assert_eq!(
            metadata.get("device_id"),
            Some(&serde_json::Value::String("device-001".to_string()))
        );
    }

    #[test]
    fn test_compute_prev_hash() {
        let mapper = EventMapper::new();

        // Genesis event
        let genesis_hash = mapper.compute_prev_hash("");
        assert_eq!(genesis_hash, vec![0u8; 32]);

        // Non-genesis event
        let prev_hash = mapper.compute_prev_hash("event-001");
        assert_eq!(prev_hash.len(), 32);
        assert_ne!(prev_hash, vec![0u8; 32]);

        // Same input produces same hash
        let prev_hash2 = mapper.compute_prev_hash("event-001");
        assert_eq!(prev_hash, prev_hash2);
    }

    #[test]
    fn test_validate_chain_link() {
        let mapper = EventMapper::new();
        let prev_id = "event-001";
        let computed_hash = mapper.compute_prev_hash(prev_id);

        assert!(mapper.validate_chain_link(&computed_hash, prev_id));
        assert!(!mapper.validate_chain_link(&computed_hash, "event-002"));
        assert!(!mapper.validate_chain_link(&[0u8; 32], prev_id));
    }
}
