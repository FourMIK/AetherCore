//! Canonical Event Domain Model
//!
//! Pure domain representation of canonical events with deterministic hashing

use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

/// Event hash type (BLAKE3 hash as hex string)
pub type EventHash = String;

/// Canonical event types
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum EventType {
    AIS,
    GPS,
    TELEMETRY,
    SYSTEM,
    CUSTOM,
}

/// Ed25519 signature as hex-encoded bytes
pub type Signature = String;

/// Ed25519 public key as hex-encoded bytes  
pub type PublicKey = String;

/// Canonical event structure
///
/// This is the domain representation of an event after validation and canonicalization.
/// All fields are immutable after creation.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CanonicalEvent {
    /// Unique event identifier
    pub event_id: String,

    /// Event type discriminator
    pub event_type: EventType,

    /// Unix epoch timestamp in milliseconds
    pub timestamp: u64,

    /// Device identity that generated this event
    pub device_id: String,

    /// Sequence number for this device's event stream
    pub sequence: u64,

    /// Event payload (canonicalized, sorted keys)
    pub payload: EventPayload,

    /// Hash of previous event in this device's chain (empty for first event)
    pub prev_hash: EventHash,

    /// Chain height (sequence in the device's event chain)
    pub chain_height: u64,

    /// BLAKE3 hash of canonical representation (computed without signature)
    pub hash: EventHash,

    /// Ed25519 signature over the hash (empty before signing)
    #[serde(skip_serializing_if = "String::is_empty", default)]
    pub signature: Signature,

    /// Ed25519 public key of the signing device
    #[serde(skip_serializing_if = "String::is_empty", default)]
    pub public_key: PublicKey,

    /// Node identifier (matches device_id for single-node devices)
    pub node_id: String,

    /// Optional metadata (sorted for deterministic serialization)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub metadata: Option<BTreeMap<String, serde_json::Value>>,
}

/// Event payload with deterministic serialization
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(untagged)]
pub enum EventPayload {
    /// AIS maritime vessel data
    AIS {
        mmsi: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        vessel_name: Option<String>,
        latitude: f64,
        longitude: f64,
        speed: f64,
        course: f64,
        #[serde(skip_serializing_if = "Option::is_none")]
        heading: Option<f64>,
        #[serde(skip_serializing_if = "Option::is_none")]
        nav_status: Option<String>,
        message_type: u32,
    },

    /// GPS location data
    GPS {
        latitude: f64,
        longitude: f64,
        #[serde(skip_serializing_if = "Option::is_none")]
        altitude: Option<f64>,
        #[serde(skip_serializing_if = "Option::is_none")]
        speed: Option<f64>,
        #[serde(skip_serializing_if = "Option::is_none")]
        heading: Option<f64>,
        #[serde(skip_serializing_if = "Option::is_none")]
        hdop: Option<f64>,
        #[serde(skip_serializing_if = "Option::is_none")]
        satellites: Option<u32>,
    },

    /// Telemetry sensor reading
    Telemetry {
        sensor_type: String,
        unit: String,
        value: f64,
        #[serde(skip_serializing_if = "Option::is_none")]
        metadata: Option<BTreeMap<String, serde_json::Value>>,
    },

    /// System operational event
    System {
        subtype: SystemSubtype,
        message: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        error_code: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        context: Option<BTreeMap<String, serde_json::Value>>,
    },

    /// Custom application-specific event
    Custom {
        custom_type: String,
        data: BTreeMap<String, serde_json::Value>,
    },

    /// Fleet asset position and state
    Fleet {
        asset_id: String,
        asset_type: String,
        latitude: f64,
        longitude: f64,
        #[serde(skip_serializing_if = "Option::is_none")]
        altitude: Option<f64>,
        #[serde(skip_serializing_if = "Option::is_none")]
        speed: Option<f64>,
        #[serde(skip_serializing_if = "Option::is_none")]
        heading: Option<f64>,
        state: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        metadata: Option<BTreeMap<String, serde_json::Value>>,
    },

    /// Mission dispatch and lifecycle events
    Mission {
        mission_id: String,
        mission_type: String,
        state: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        assigned_assets: Option<Vec<String>>,
        #[serde(skip_serializing_if = "Option::is_none")]
        waypoints: Option<Vec<BTreeMap<String, serde_json::Value>>>,
        #[serde(skip_serializing_if = "Option::is_none")]
        metadata: Option<BTreeMap<String, serde_json::Value>>,
    },

    /// Operational alerts
    Alert {
        alert_id: String,
        severity: String,
        category: String,
        message: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        source_asset: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        acknowledged: Option<bool>,
        #[serde(skip_serializing_if = "Option::is_none")]
        metadata: Option<BTreeMap<String, serde_json::Value>>,
    },
}

/// System event subtypes
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum SystemSubtype {
    Startup,
    Shutdown,
    Error,
    Warning,
    ConfigChange,
}

impl CanonicalEvent {
    /// Compute BLAKE3 hash of canonical representation (without signature fields)
    ///
    /// This must be called after all fields are set to compute the event hash.
    /// The signature and public_key fields are excluded from the hash computation.
    pub fn compute_hash(&self) -> crate::Result<EventHash> {
        let canonical = self.to_canonical_json_for_signing()?;
        let hash = blake3::hash(canonical.as_bytes());
        Ok(hex::encode(hash.as_bytes()))
    }

    /// Serialize to canonical JSON for signing (sorted keys, deterministic, excludes signature fields)
    pub fn to_canonical_json_for_signing(&self) -> crate::Result<String> {
        // Use BTreeMap to ensure sorted keys
        let mut map = BTreeMap::new();

        map.insert(
            "chain_height",
            serde_json::to_value(self.chain_height).unwrap(),
        );
        map.insert("device_id", serde_json::to_value(&self.device_id).unwrap());
        map.insert("event_id", serde_json::to_value(&self.event_id).unwrap());
        map.insert("event_type", serde_json::to_value(self.event_type).unwrap());
        map.insert("node_id", serde_json::to_value(&self.node_id).unwrap());
        map.insert("payload", serde_json::to_value(&self.payload).unwrap());
        map.insert("prev_hash", serde_json::to_value(&self.prev_hash).unwrap());
        map.insert("sequence", serde_json::to_value(self.sequence).unwrap());
        map.insert("timestamp", serde_json::to_value(self.timestamp).unwrap());

        if let Some(ref metadata) = self.metadata {
            map.insert("metadata", serde_json::to_value(metadata).unwrap());
        }

        // Note: signature and public_key are intentionally excluded from hash computation

        serde_json::to_string(&map)
            .map_err(|e| crate::DomainError::SerializationError(e.to_string()))
    }

    /// Serialize to canonical JSON including all fields
    pub fn to_canonical_json(&self) -> crate::Result<String> {
        serde_json::to_string(self)
            .map_err(|e| crate::DomainError::SerializationError(e.to_string()))
    }

    /// Verify hash matches canonical representation
    pub fn verify_hash(&self) -> crate::Result<bool> {
        let computed = self.compute_hash()?;
        Ok(computed == self.hash)
    }

    /// Get the bytes to be signed (the event hash)
    ///
    /// Returns an error if the hash field contains invalid hex data.
    pub fn signing_bytes(&self) -> Result<Vec<u8>, crate::DomainError> {
        hex::decode(&self.hash).map_err(|e| {
            crate::DomainError::ValidationError(format!("Invalid hash hex data: {}", e))
        })
    }

    /// Check if event is signed
    pub fn is_signed(&self) -> bool {
        !self.signature.is_empty() && !self.public_key.is_empty()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_canonical_event_hash_deterministic() {
        let event1 = CanonicalEvent {
            event_id: "test-001".to_string(),
            event_type: EventType::GPS,
            timestamp: 1702031820000,
            device_id: "device-001".to_string(),
            node_id: "node-001".to_string(),
            sequence: 1,
            prev_hash: String::new(),
            chain_height: 1,
            payload: EventPayload::GPS {
                latitude: 34.052235,
                longitude: -118.243683,
                altitude: Some(100.0),
                speed: None,
                heading: None,
                hdop: None,
                satellites: None,
            },
            hash: String::new(),
            signature: String::new(),
            public_key: String::new(),
            metadata: None,
        };

        let hash1 = event1.compute_hash().unwrap();

        // Create identical event
        let event2 = event1.clone();
        let hash2 = event2.compute_hash().unwrap();

        assert_eq!(
            hash1, hash2,
            "Identical events must produce identical hashes"
        );
    }

    #[test]
    fn test_canonical_json_sorted_keys() {
        let event = CanonicalEvent {
            event_id: "test-001".to_string(),
            event_type: EventType::GPS,
            timestamp: 1702031820000,
            device_id: "device-001".to_string(),
            node_id: "node-001".to_string(),
            sequence: 1,
            prev_hash: String::new(),
            chain_height: 1,
            payload: EventPayload::GPS {
                latitude: 34.052235,
                longitude: -118.243683,
                altitude: None,
                speed: None,
                heading: None,
                hdop: None,
                satellites: None,
            },
            hash: String::new(),
            signature: String::new(),
            public_key: String::new(),
            metadata: None,
        };

        let json = event.to_canonical_json_for_signing().unwrap();

        // Keys should be in alphabetical order
        let first_key_pos = json.find("\"chain_height\"").unwrap();
        let second_key_pos = json.find("\"device_id\"").unwrap();
        let third_key_pos = json.find("\"event_id\"").unwrap();

        assert!(first_key_pos < second_key_pos);
        assert!(second_key_pos < third_key_pos);
    }

    #[test]
    fn test_verify_hash() {
        let mut event = CanonicalEvent {
            event_id: "test-001".to_string(),
            event_type: EventType::GPS,
            timestamp: 1702031820000,
            device_id: "device-001".to_string(),
            node_id: "node-001".to_string(),
            sequence: 1,
            prev_hash: String::new(),
            chain_height: 1,
            payload: EventPayload::GPS {
                latitude: 34.052235,
                longitude: -118.243683,
                altitude: None,
                speed: None,
                heading: None,
                hdop: None,
                satellites: None,
            },
            hash: String::new(),
            signature: String::new(),
            public_key: String::new(),
            metadata: None,
        };

        // Compute and set hash
        event.hash = event.compute_hash().unwrap();

        // Verification should pass
        assert!(event.verify_hash().unwrap());

        // Tamper with hash
        event.hash = "deadbeef".to_string();

        // Verification should fail
        assert!(!event.verify_hash().unwrap());
    }

    #[test]
    fn test_signature_fields_excluded_from_hash() {
        let event1 = CanonicalEvent {
            event_id: "test-001".to_string(),
            event_type: EventType::GPS,
            timestamp: 1702031820000,
            device_id: "device-001".to_string(),
            node_id: "node-001".to_string(),
            sequence: 1,
            prev_hash: String::new(),
            chain_height: 1,
            payload: EventPayload::GPS {
                latitude: 34.052235,
                longitude: -118.243683,
                altitude: None,
                speed: None,
                heading: None,
                hdop: None,
                satellites: None,
            },
            hash: String::new(),
            signature: String::new(),
            public_key: String::new(),
            metadata: None,
        };

        let hash1 = event1.compute_hash().unwrap();

        // Add signature and public key
        let mut event2 = event1.clone();
        event2.signature = "abcd1234".to_string();
        event2.public_key = "ef567890".to_string();

        let hash2 = event2.compute_hash().unwrap();

        // Hash should be the same (signature fields excluded from hash)
        assert_eq!(hash1, hash2);
    }

    #[test]
    fn test_is_signed() {
        let mut event = CanonicalEvent {
            event_id: "test-001".to_string(),
            event_type: EventType::GPS,
            timestamp: 1702031820000,
            device_id: "device-001".to_string(),
            node_id: "node-001".to_string(),
            sequence: 1,
            prev_hash: String::new(),
            chain_height: 1,
            payload: EventPayload::GPS {
                latitude: 34.052235,
                longitude: -118.243683,
                altitude: None,
                speed: None,
                heading: None,
                hdop: None,
                satellites: None,
            },
            hash: String::new(),
            signature: String::new(),
            public_key: String::new(),
            metadata: None,
        };

        assert!(!event.is_signed());

        event.signature = "sig".to_string();
        event.public_key = "key".to_string();

        assert!(event.is_signed());
    }
}
