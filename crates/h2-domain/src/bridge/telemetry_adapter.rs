//! Telemetry adapter for ingesting H2OS sensor data
//!
//! Transforms H2OS sensor readings (PT100, PT110, PS110, H2Detect, GPS)
//! into AetherCore CanonicalEvents with Merkle-chained attestation.

use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

use crate::bridge::event_mapper::{EventMapper, H2OSEventType};

/// Telemetry transformation result
pub type TelemetryTransform = Result<TransformedTelemetry, TelemetryError>;

/// Transformed telemetry ready for canonical event creation
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TransformedTelemetry {
    /// Event type
    pub event_type: String,

    /// Sensor type (for telemetry)
    pub sensor_type: Option<String>,

    /// Value (for telemetry)
    pub value: Option<f64>,

    /// Unit of measurement (for telemetry)
    pub unit: Option<String>,

    /// GPS data (if applicable)
    pub gps_data: Option<GPSData>,

    /// Metadata
    pub metadata: BTreeMap<String, serde_json::Value>,

    /// Previous hash (BLAKE3)
    pub prev_hash: Vec<u8>,

    /// Timestamp in milliseconds
    pub timestamp_ms: u64,
}

/// GPS position data
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GPSData {
    /// Latitude in decimal degrees
    pub latitude: f64,
    /// Longitude in decimal degrees
    pub longitude: f64,
    /// Altitude in meters (if available)
    pub altitude: Option<f64>,
    /// Speed over ground in meters/second (if available)
    pub speed: Option<f64>,
    /// Heading in degrees (if available)
    pub heading: Option<f64>,
}

/// Telemetry transformation errors
#[derive(Debug, Clone, thiserror::Error)]
pub enum TelemetryError {
    /// Sensor reading failed validation
    #[error("Invalid sensor reading: {0}")]
    InvalidReading(String),

    /// Required telemetry field is missing
    #[error("Missing required field: {0}")]
    MissingField(String),

    /// Hash chain validation failed, possible replay
    #[error("Replay attack detected: hash chain validation failed")]
    ReplayAttack,

    /// Timestamp was invalid or outside allowed window
    #[error("Invalid timestamp: {0}")]
    InvalidTimestamp(String),
}

/// H2OS telemetry adapter
#[derive(Debug, Clone)]
pub struct H2OSTelemetryAdapter {
    /// Event mapper for provenance injection
    mapper: EventMapper,
}

impl H2OSTelemetryAdapter {
    /// Create a new telemetry adapter
    pub fn new() -> Self {
        Self {
            mapper: EventMapper::new(),
        }
    }

    /// Create adapter with custom event mapper
    pub fn with_mapper(mapper: EventMapper) -> Self {
        Self { mapper }
    }

    /// Transform PT100 temperature reading
    pub fn transform_pt100(
        &self,
        device_id: &str,
        sensor_id: &str,
        temperature_c: f64,
        previous_id: &str,
        timestamp_ms: u64,
        federation_id: &str,
    ) -> TelemetryTransform {
        let mut metadata = self.mapper.map_sensor_metadata(sensor_id, device_id, None);
        self.mapper.inject_provenance(
            &mut metadata,
            federation_id,
            H2OSEventType::PT100Temperature,
        );

        Ok(TransformedTelemetry {
            event_type: H2OSEventType::PT100Temperature
                .to_canonical_type()
                .to_string(),
            sensor_type: Some("PT100".to_string()),
            value: Some(temperature_c),
            unit: Some("celsius".to_string()),
            gps_data: None,
            metadata,
            prev_hash: self.mapper.compute_prev_hash(previous_id),
            timestamp_ms,
        })
    }

    /// Transform PT110 temperature reading
    pub fn transform_pt110(
        &self,
        device_id: &str,
        sensor_id: &str,
        temperature_c: f64,
        previous_id: &str,
        timestamp_ms: u64,
        federation_id: &str,
    ) -> TelemetryTransform {
        let mut metadata = self.mapper.map_sensor_metadata(sensor_id, device_id, None);
        self.mapper.inject_provenance(
            &mut metadata,
            federation_id,
            H2OSEventType::PT110Temperature,
        );

        Ok(TransformedTelemetry {
            event_type: H2OSEventType::PT110Temperature
                .to_canonical_type()
                .to_string(),
            sensor_type: Some("PT110".to_string()),
            value: Some(temperature_c),
            unit: Some("celsius".to_string()),
            gps_data: None,
            metadata,
            prev_hash: self.mapper.compute_prev_hash(previous_id),
            timestamp_ms,
        })
    }

    /// Transform PS110 pressure reading
    pub fn transform_ps110(
        &self,
        device_id: &str,
        sensor_id: &str,
        pressure_psi: f64,
        previous_id: &str,
        timestamp_ms: u64,
        federation_id: &str,
    ) -> TelemetryTransform {
        let mut metadata = self.mapper.map_sensor_metadata(sensor_id, device_id, None);
        self.mapper
            .inject_provenance(&mut metadata, federation_id, H2OSEventType::PS110Pressure);

        Ok(TransformedTelemetry {
            event_type: H2OSEventType::PS110Pressure.to_canonical_type().to_string(),
            sensor_type: Some("PS110".to_string()),
            value: Some(pressure_psi),
            unit: Some("psi".to_string()),
            gps_data: None,
            metadata,
            prev_hash: self.mapper.compute_prev_hash(previous_id),
            timestamp_ms,
        })
    }

    /// Transform H2Detect hydrogen detection reading
    pub fn transform_h2detect(
        &self,
        device_id: &str,
        sensor_id: &str,
        detected: bool,
        concentration_ppm: Option<f64>,
        previous_id: &str,
        timestamp_ms: u64,
        federation_id: &str,
    ) -> TelemetryTransform {
        let mut metadata = self.mapper.map_sensor_metadata(sensor_id, device_id, None);
        self.mapper
            .inject_provenance(&mut metadata, federation_id, H2OSEventType::H2Detection);

        metadata.insert("h2_detected".to_string(), serde_json::Value::Bool(detected));

        // Default to 1.0 PPM when H2 is detected but concentration not specified
        // This indicates detection occurred but quantification was not available
        let value = if detected {
            concentration_ppm.unwrap_or(1.0)
        } else {
            0.0
        };

        Ok(TransformedTelemetry {
            event_type: H2OSEventType::H2Detection.to_canonical_type().to_string(),
            sensor_type: Some("H2Detect".to_string()),
            value: Some(value),
            unit: Some("ppm".to_string()),
            gps_data: None,
            metadata,
            prev_hash: self.mapper.compute_prev_hash(previous_id),
            timestamp_ms,
        })
    }

    /// Transform GPS position update
    pub fn transform_gps(
        &self,
        device_id: &str,
        latitude: f64,
        longitude: f64,
        altitude: Option<f64>,
        speed: Option<f64>,
        heading: Option<f64>,
        previous_id: &str,
        timestamp_ms: u64,
        federation_id: &str,
    ) -> TelemetryTransform {
        let mut metadata = self.mapper.map_sensor_metadata("gps", device_id, None);
        self.mapper
            .inject_provenance(&mut metadata, federation_id, H2OSEventType::GPSPosition);

        Ok(TransformedTelemetry {
            event_type: H2OSEventType::GPSPosition.to_canonical_type().to_string(),
            sensor_type: None,
            value: None,
            unit: None,
            gps_data: Some(GPSData {
                latitude,
                longitude,
                altitude,
                speed,
                heading,
            }),
            metadata,
            prev_hash: self.mapper.compute_prev_hash(previous_id),
            timestamp_ms,
        })
    }

    /// Validate replay attack detection
    pub fn validate_no_replay(
        &self,
        claimed_prev_hash: &[u8],
        actual_prev_id: &str,
    ) -> Result<(), TelemetryError> {
        if self
            .mapper
            .validate_chain_link(claimed_prev_hash, actual_prev_id)
        {
            Ok(())
        } else {
            Err(TelemetryError::ReplayAttack)
        }
    }

    /// Get reference to the event mapper
    pub fn mapper(&self) -> &EventMapper {
        &self.mapper
    }
}

impl Default for H2OSTelemetryAdapter {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_transform_pt100() {
        let adapter = H2OSTelemetryAdapter::new();
        let result = adapter.transform_pt100(
            "device-001",
            "pt100-001",
            25.5,
            "event-000",
            1000,
            "fed-001",
        );

        assert!(result.is_ok());
        let telemetry = result.unwrap();
        assert_eq!(telemetry.event_type, "TELEMETRY");
        assert_eq!(telemetry.sensor_type, Some("PT100".to_string()));
        assert_eq!(telemetry.value, Some(25.5));
        assert_eq!(telemetry.unit, Some("celsius".to_string()));
        assert_eq!(telemetry.prev_hash.len(), 32);
    }

    #[test]
    fn test_transform_pt110() {
        let adapter = H2OSTelemetryAdapter::new();
        let result = adapter.transform_pt110(
            "device-001",
            "pt110-001",
            30.0,
            "event-000",
            1000,
            "fed-001",
        );

        assert!(result.is_ok());
        let telemetry = result.unwrap();
        assert_eq!(telemetry.sensor_type, Some("PT110".to_string()));
        assert_eq!(telemetry.value, Some(30.0));
    }

    #[test]
    fn test_transform_ps110() {
        let adapter = H2OSTelemetryAdapter::new();
        let result = adapter.transform_ps110(
            "device-001",
            "ps110-001",
            150.0,
            "event-000",
            1000,
            "fed-001",
        );

        assert!(result.is_ok());
        let telemetry = result.unwrap();
        assert_eq!(telemetry.sensor_type, Some("PS110".to_string()));
        assert_eq!(telemetry.value, Some(150.0));
        assert_eq!(telemetry.unit, Some("psi".to_string()));
    }

    #[test]
    fn test_transform_h2detect() {
        let adapter = H2OSTelemetryAdapter::new();

        // No detection
        let result = adapter.transform_h2detect(
            "device-001",
            "h2-001",
            false,
            None,
            "event-000",
            1000,
            "fed-001",
        );
        assert!(result.is_ok());
        let telemetry = result.unwrap();
        assert_eq!(telemetry.value, Some(0.0));

        // Detection with concentration
        let result = adapter.transform_h2detect(
            "device-001",
            "h2-001",
            true,
            Some(500.0),
            "event-000",
            1000,
            "fed-001",
        );
        assert!(result.is_ok());
        let telemetry = result.unwrap();
        assert_eq!(telemetry.value, Some(500.0));
        assert_eq!(
            telemetry.metadata.get("h2_detected"),
            Some(&serde_json::Value::Bool(true))
        );
    }

    #[test]
    fn test_transform_gps() {
        let adapter = H2OSTelemetryAdapter::new();
        let result = adapter.transform_gps(
            "device-001",
            45.0,
            -122.0,
            Some(100.0),
            Some(10.0),
            Some(90.0),
            "event-000",
            1000,
            "fed-001",
        );

        assert!(result.is_ok());
        let telemetry = result.unwrap();
        assert_eq!(telemetry.event_type, "GPS");
        assert!(telemetry.gps_data.is_some());

        let gps = telemetry.gps_data.unwrap();
        assert_eq!(gps.latitude, 45.0);
        assert_eq!(gps.longitude, -122.0);
        assert_eq!(gps.altitude, Some(100.0));
    }

    #[test]
    fn test_validate_no_replay() {
        let adapter = H2OSTelemetryAdapter::new();
        let prev_id = "event-001";
        let correct_hash = adapter.mapper().compute_prev_hash(prev_id);

        // Valid chain link
        assert!(adapter.validate_no_replay(&correct_hash, prev_id).is_ok());

        // Invalid chain link (replay attack)
        let wrong_hash = vec![0u8; 32];
        assert!(adapter.validate_no_replay(&wrong_hash, prev_id).is_err());
    }

    #[test]
    fn test_prev_hash_deterministic() {
        let adapter = H2OSTelemetryAdapter::new();

        let result1 = adapter
            .transform_pt100(
                "device-001",
                "pt100-001",
                25.5,
                "event-000",
                1000,
                "fed-001",
            )
            .unwrap();

        let result2 = adapter
            .transform_pt100(
                "device-001",
                "pt100-001",
                25.5,
                "event-000",
                1000,
                "fed-001",
            )
            .unwrap();

        // Same previous_id should produce same prev_hash
        assert_eq!(result1.prev_hash, result2.prev_hash);
    }

    #[test]
    fn test_genesis_event_prev_hash() {
        let adapter = H2OSTelemetryAdapter::new();
        let result = adapter
            .transform_pt100(
                "device-001",
                "pt100-001",
                25.5,
                "", // Genesis event
                1000,
                "fed-001",
            )
            .unwrap();

        // Genesis event should have zero hash
        assert_eq!(result.prev_hash, vec![0u8; 32]);
    }
}
