//! Attested sensor telemetry readings
//!
//! Provides cryptographically attested sensor reading structs for H2OS
//! sensor types (PT100, PS110, H2Detect, GPS) with Merkle-chained verification.

use serde::{Deserialize, Serialize};

/// Attested PT100 temperature reading
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AttestedPT100Reading {
    /// Sensor identifier
    pub sensor_id: String,

    /// Temperature in Celsius
    pub temperature_c: f64,

    /// Timestamp in milliseconds
    pub timestamp_ms: u64,

    /// Ed25519 signature over reading
    pub signature: Vec<u8>,

    /// BLAKE3 hash of previous reading
    pub prev_hash: Vec<u8>,

    /// Trust score (0.0 to 1.0)
    pub trust_score: f32,

    /// Device identifier
    pub device_id: String,
}

impl AttestedPT100Reading {
    /// Create a new PT100 reading
    pub fn new(
        sensor_id: String,
        temperature_c: f64,
        timestamp_ms: u64,
        prev_hash: Vec<u8>,
        trust_score: f32,
        device_id: String,
    ) -> Self {
        Self {
            sensor_id,
            temperature_c,
            timestamp_ms,
            signature: Vec::new(),
            prev_hash,
            trust_score: trust_score.clamp(0.0, 1.0),
            device_id,
        }
    }

    /// Compute BLAKE3 hash of this reading
    pub fn compute_hash(&self) -> Vec<u8> {
        let mut hasher = blake3::Hasher::new();
        hasher.update(self.sensor_id.as_bytes());
        hasher.update(&self.temperature_c.to_le_bytes());
        hasher.update(&self.timestamp_ms.to_le_bytes());
        hasher.update(self.device_id.as_bytes());
        hasher.finalize().as_bytes().to_vec()
    }

    /// Attest the reading with a signature
    pub fn attest(&mut self, signature: Vec<u8>) {
        self.signature = signature;
    }

    /// Verify that signature is present
    pub fn is_attested(&self) -> bool {
        !self.signature.is_empty()
    }
}

/// Attested pressure reading (PS110)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AttestedPressureReading {
    /// Sensor identifier
    pub sensor_id: String,

    /// Pressure in PSI
    pub pressure_psi: f64,

    /// Timestamp in milliseconds
    pub timestamp_ms: u64,

    /// Ed25519 signature over reading
    pub signature: Vec<u8>,

    /// BLAKE3 hash of previous reading
    pub prev_hash: Vec<u8>,

    /// Trust score (0.0 to 1.0)
    pub trust_score: f32,

    /// Device identifier
    pub device_id: String,
}

impl AttestedPressureReading {
    /// Create a new pressure reading
    pub fn new(
        sensor_id: String,
        pressure_psi: f64,
        timestamp_ms: u64,
        prev_hash: Vec<u8>,
        trust_score: f32,
        device_id: String,
    ) -> Self {
        Self {
            sensor_id,
            pressure_psi,
            timestamp_ms,
            signature: Vec::new(),
            prev_hash,
            trust_score: trust_score.clamp(0.0, 1.0),
            device_id,
        }
    }

    /// Compute BLAKE3 hash of this reading
    pub fn compute_hash(&self) -> Vec<u8> {
        let mut hasher = blake3::Hasher::new();
        hasher.update(self.sensor_id.as_bytes());
        hasher.update(&self.pressure_psi.to_le_bytes());
        hasher.update(&self.timestamp_ms.to_le_bytes());
        hasher.update(self.device_id.as_bytes());
        hasher.finalize().as_bytes().to_vec()
    }

    /// Attest the reading with a signature
    pub fn attest(&mut self, signature: Vec<u8>) {
        self.signature = signature;
    }

    /// Verify that signature is present
    pub fn is_attested(&self) -> bool {
        !self.signature.is_empty()
    }
}

/// Attested hydrogen detection reading
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AttestedH2DetectReading {
    /// Sensor identifier
    pub sensor_id: String,

    /// Hydrogen detected flag
    pub h2_detected: bool,

    /// Concentration in PPM (if detected)
    pub concentration_ppm: Option<f64>,

    /// Timestamp in milliseconds
    pub timestamp_ms: u64,

    /// Ed25519 signature over reading
    pub signature: Vec<u8>,

    /// BLAKE3 hash of previous reading
    pub prev_hash: Vec<u8>,

    /// Trust score (0.0 to 1.0)
    pub trust_score: f32,

    /// Device identifier
    pub device_id: String,
}

impl AttestedH2DetectReading {
    /// Create a new H2 detection reading
    pub fn new(
        sensor_id: String,
        h2_detected: bool,
        concentration_ppm: Option<f64>,
        timestamp_ms: u64,
        prev_hash: Vec<u8>,
        trust_score: f32,
        device_id: String,
    ) -> Self {
        Self {
            sensor_id,
            h2_detected,
            concentration_ppm,
            timestamp_ms,
            signature: Vec::new(),
            prev_hash,
            trust_score: trust_score.clamp(0.0, 1.0),
            device_id,
        }
    }

    /// Compute BLAKE3 hash of this reading
    pub fn compute_hash(&self) -> Vec<u8> {
        let mut hasher = blake3::Hasher::new();
        hasher.update(self.sensor_id.as_bytes());
        hasher.update(&[self.h2_detected as u8]);
        if let Some(conc) = self.concentration_ppm {
            hasher.update(&conc.to_le_bytes());
        }
        hasher.update(&self.timestamp_ms.to_le_bytes());
        hasher.update(self.device_id.as_bytes());
        hasher.finalize().as_bytes().to_vec()
    }

    /// Attest the reading with a signature
    pub fn attest(&mut self, signature: Vec<u8>) {
        self.signature = signature;
    }

    /// Verify that signature is present
    pub fn is_attested(&self) -> bool {
        !self.signature.is_empty()
    }

    /// Check if this is a critical detection
    pub fn is_critical(&self) -> bool {
        self.h2_detected
    }
}

/// Attested GPS reading
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AttestedGPSReading {
    /// Sensor/device identifier
    pub device_id: String,

    /// Latitude in degrees
    pub latitude: f64,

    /// Longitude in degrees
    pub longitude: f64,

    /// Altitude in meters (optional)
    pub altitude: Option<f64>,

    /// Speed in km/h (optional)
    pub speed: Option<f64>,

    /// Heading in degrees (optional)
    pub heading: Option<f64>,

    /// Timestamp in milliseconds
    pub timestamp_ms: u64,

    /// Ed25519 signature over reading
    pub signature: Vec<u8>,

    /// BLAKE3 hash of previous reading
    pub prev_hash: Vec<u8>,

    /// Trust score (0.0 to 1.0)
    pub trust_score: f32,
}

impl AttestedGPSReading {
    /// Create a new GPS reading
    pub fn new(
        device_id: String,
        latitude: f64,
        longitude: f64,
        timestamp_ms: u64,
        prev_hash: Vec<u8>,
        trust_score: f32,
    ) -> Self {
        Self {
            device_id,
            latitude,
            longitude,
            altitude: None,
            speed: None,
            heading: None,
            timestamp_ms,
            signature: Vec::new(),
            prev_hash,
            trust_score: trust_score.clamp(0.0, 1.0),
        }
    }

    /// Compute BLAKE3 hash of this reading
    pub fn compute_hash(&self) -> Vec<u8> {
        let mut hasher = blake3::Hasher::new();
        hasher.update(self.device_id.as_bytes());
        hasher.update(&self.latitude.to_le_bytes());
        hasher.update(&self.longitude.to_le_bytes());
        if let Some(alt) = self.altitude {
            hasher.update(&alt.to_le_bytes());
        }
        hasher.update(&self.timestamp_ms.to_le_bytes());
        hasher.finalize().as_bytes().to_vec()
    }

    /// Attest the reading with a signature
    pub fn attest(&mut self, signature: Vec<u8>) {
        self.signature = signature;
    }

    /// Verify that signature is present
    pub fn is_attested(&self) -> bool {
        !self.signature.is_empty()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_pt100_reading_creation() {
        let reading = AttestedPT100Reading::new(
            "pt100-001".to_string(),
            25.5,
            1000,
            vec![0u8; 32],
            0.8,
            "device-001".to_string(),
        );

        assert_eq!(reading.temperature_c, 25.5);
        assert_eq!(reading.trust_score, 0.8);
        assert!(!reading.is_attested());
    }

    #[test]
    fn test_pt100_reading_attest() {
        let mut reading = AttestedPT100Reading::new(
            "pt100-001".to_string(),
            25.5,
            1000,
            vec![0u8; 32],
            0.8,
            "device-001".to_string(),
        );

        reading.attest(vec![1u8; 64]);
        assert!(reading.is_attested());
    }

    #[test]
    fn test_pt100_reading_compute_hash() {
        let reading = AttestedPT100Reading::new(
            "pt100-001".to_string(),
            25.5,
            1000,
            vec![0u8; 32],
            0.8,
            "device-001".to_string(),
        );

        let hash = reading.compute_hash();
        assert_eq!(hash.len(), 32);
    }

    #[test]
    fn test_pressure_reading_creation() {
        let reading = AttestedPressureReading::new(
            "ps110-001".to_string(),
            150.0,
            1000,
            vec![0u8; 32],
            0.8,
            "device-001".to_string(),
        );

        assert_eq!(reading.pressure_psi, 150.0);
        assert_eq!(reading.trust_score, 0.8);
    }

    #[test]
    fn test_h2detect_reading_creation() {
        let reading = AttestedH2DetectReading::new(
            "h2-001".to_string(),
            true,
            Some(500.0),
            1000,
            vec![0u8; 32],
            0.8,
            "device-001".to_string(),
        );

        assert!(reading.h2_detected);
        assert_eq!(reading.concentration_ppm, Some(500.0));
        assert!(reading.is_critical());
    }

    #[test]
    fn test_h2detect_reading_not_detected() {
        let reading = AttestedH2DetectReading::new(
            "h2-001".to_string(),
            false,
            None,
            1000,
            vec![0u8; 32],
            0.8,
            "device-001".to_string(),
        );

        assert!(!reading.h2_detected);
        assert!(!reading.is_critical());
    }

    #[test]
    fn test_gps_reading_creation() {
        let reading = AttestedGPSReading::new(
            "gps-001".to_string(),
            45.0,
            -122.0,
            1000,
            vec![0u8; 32],
            0.8,
        );

        assert_eq!(reading.latitude, 45.0);
        assert_eq!(reading.longitude, -122.0);
        assert_eq!(reading.trust_score, 0.8);
    }

    #[test]
    fn test_gps_reading_compute_hash() {
        let mut reading = AttestedGPSReading::new(
            "gps-001".to_string(),
            45.0,
            -122.0,
            1000,
            vec![0u8; 32],
            0.8,
        );

        reading.altitude = Some(100.0);
        let hash = reading.compute_hash();
        assert_eq!(hash.len(), 32);
    }

    #[test]
    fn test_trust_score_clamping() {
        let reading1 = AttestedPT100Reading::new(
            "pt100-001".to_string(),
            25.5,
            1000,
            vec![0u8; 32],
            1.5,
            "device-001".to_string(),
        );
        assert_eq!(reading1.trust_score, 1.0);

        let reading2 = AttestedPT100Reading::new(
            "pt100-001".to_string(),
            25.5,
            1000,
            vec![0u8; 32],
            -0.5,
            "device-001".to_string(),
        );
        assert_eq!(reading2.trust_score, 0.0);
    }
}
