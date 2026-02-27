//! Domain layer abstraction for Zero-Knowledge proof services.
//!
//! This module provides a domain-level interface for ZK proof operations,
//! decoupling the business logic from cryptographic implementation details.
//!
//! # Physics Constraints
//!
//! In addition to cryptographic verification, this module enforces operational
//! physics constraints to detect Byzantine behavior:
//!
//! - **Temporal Bounds**: Proof timestamps must be within acceptable drift limits
//! - **Spatial Bounds**: Geographic movement must respect maximum velocity constraints
//!
//! These constraints were ported from AuthynticProof.circom to ensure semantic
//! validation alongside cryptographic proof verification.

use serde::{Deserialize, Serialize};
use std::time::{SystemTime, UNIX_EPOCH};
use thiserror::Error;

/// Maximum acceptable latency for proof timestamps (500ms)
/// Proofs with timestamps beyond this are rejected as temporal violations
pub const MAX_LATENCY_MS: u64 = 500;

/// Maximum velocity for geographic drift (343 m/s - speed of sound)
/// Movement exceeding this velocity is rejected as spatial violations
pub const MAX_VELOCITY_MPS: f64 = 343.0;

/// Minimum time delta for spatial validation (1 millisecond)
/// Time deltas below this are too short for meaningful velocity calculations
const MIN_TIME_DELTA_MS: f64 = 1.0;

/// Geographic coordinates (latitude, longitude)
#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
pub struct GeoCoordinate {
    /// Latitude in degrees (-90 to 90)
    pub latitude: f64,
    /// Longitude in degrees (-180 to 180)
    pub longitude: f64,
}

impl GeoCoordinate {
    /// Create a new geographic coordinate
    ///
    /// # Arguments
    /// * `latitude` - Latitude in degrees (-90 to 90)
    /// * `longitude` - Longitude in degrees (-180 to 180)
    ///
    /// # Returns
    /// * `Ok(GeoCoordinate)` - Valid coordinate
    /// * `Err(ZkVerificationError)` - Invalid coordinate
    pub fn new(latitude: f64, longitude: f64) -> Result<Self, ZkVerificationError> {
        if !(-90.0..=90.0).contains(&latitude) {
            return Err(ZkVerificationError::InvalidCoordinate(format!(
                "Latitude must be between -90 and 90, got {}",
                latitude
            )));
        }
        if !(-180.0..=180.0).contains(&longitude) {
            return Err(ZkVerificationError::InvalidCoordinate(format!(
                "Longitude must be between -180 and 180, got {}",
                longitude
            )));
        }
        Ok(Self {
            latitude,
            longitude,
        })
    }

    /// Calculate haversine distance to another coordinate in meters
    ///
    /// This uses the haversine formula to calculate great-circle distance
    /// between two points on Earth's surface.
    ///
    /// # Arguments
    /// * `other` - The other coordinate
    ///
    /// # Returns
    /// Distance in meters
    pub fn haversine_distance(&self, other: &GeoCoordinate) -> f64 {
        const EARTH_RADIUS_M: f64 = 6371000.0; // Earth's radius in meters

        let lat1_rad = self.latitude.to_radians();
        let lat2_rad = other.latitude.to_radians();
        let delta_lat = (other.latitude - self.latitude).to_radians();
        let delta_lon = (other.longitude - self.longitude).to_radians();

        let a = (delta_lat / 2.0).sin().powi(2)
            + lat1_rad.cos() * lat2_rad.cos() * (delta_lon / 2.0).sin().powi(2);

        let c = 2.0 * a.sqrt().atan2((1.0 - a).sqrt());

        EARTH_RADIUS_M * c
    }
}

/// Errors that can occur during ZK verification
#[derive(Debug, Error)]
pub enum ZkVerificationError {
    #[error("Temporal violation: proof_timestamp={proof_timestamp}, current_time={current_time}, max_drift_ms={max_drift_ms}")]
    TemporalViolation {
        proof_timestamp: u64,
        current_time: u64,
        max_drift_ms: u64,
    },

    #[error("Spatial violation: distance={distance_m:.2}m, time_delta={time_delta_s:.2}s, velocity={velocity_mps:.2}m/s, max_velocity={max_velocity_mps:.2}m/s")]
    SpatialViolation {
        distance_m: f64,
        time_delta_s: f64,
        velocity_mps: f64,
        max_velocity_mps: f64,
    },

    #[error("Invalid coordinate: {0}")]
    InvalidCoordinate(String),

    #[error("Cryptographic verification failed: {0}")]
    CryptographicFailure(String),

    #[error("Invalid proof: {0}")]
    InvalidProof(String),

    #[error("Missing required field: {0}")]
    MissingField(String),
}

/// Request for ZK proof generation
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ZkProofRequest {
    /// Device identifier
    pub device_id: u64,
    /// Timestamp when proof is requested (Unix milliseconds)
    pub timestamp: u64,
    /// Hash of the device's location
    pub location_hash: [u8; 32],
    /// Attestations from neighboring devices
    pub neighbor_attestations: Vec<[u8; 32]>,
    /// Merkle root of trusted device set
    pub merkle_root: [u8; 32],
    /// Optional geographic coordinates for spatial validation
    pub coordinates: Option<GeoCoordinate>,
    /// Optional last seen timestamp for temporal validation
    pub last_seen: Option<u64>,
}

/// Result of ZK proof generation
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ZkProofResult {
    /// Serialized proof bytes
    pub proof_bytes: Vec<u8>,
    /// Hash of public inputs for verification
    pub public_inputs_hash: [u8; 32],
    /// Timestamp when proof was generated (Unix milliseconds)
    pub generated_at: u64,
}

/// Physics validation result
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PhysicsValidation {
    /// Whether temporal bounds are satisfied
    pub temporal_valid: bool,
    /// Whether spatial bounds are satisfied
    pub spatial_valid: bool,
    /// Optional temporal violation details
    pub temporal_error: Option<String>,
    /// Optional spatial violation details
    pub spatial_error: Option<String>,
}

/// Service trait for ZK proof operations (domain layer)
pub trait ZkProverService: Send + Sync {
    /// Generate a ZK proof from a request
    fn generate(&self, request: &ZkProofRequest) -> crate::Result<ZkProofResult>;

    /// Verify a ZK proof
    fn verify(&self, proof_bytes: &[u8], public_inputs_hash: &[u8; 32]) -> crate::Result<bool>;
}

/// Extended ZK verifier with physics constraint validation
pub trait ZkPhysicsVerifier: ZkProverService {
    /// Verify temporal bounds
    ///
    /// Ensures that:
    /// - `proof_timestamp` > `last_seen`
    /// - `proof_timestamp` < `current_time` + MAX_LATENCY_MS
    ///
    /// # Arguments
    /// * `proof_timestamp` - Timestamp from the proof (Unix milliseconds)
    /// * `last_seen` - Last seen timestamp for this device (Unix milliseconds)
    ///
    /// # Returns
    /// * `Ok(())` - Temporal bounds satisfied
    /// * `Err(ZkVerificationError)` - Temporal violation detected
    fn verify_temporal_bounds(
        &self,
        proof_timestamp: u64,
        last_seen: u64,
    ) -> Result<(), ZkVerificationError> {
        let current_time = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("System time before UNIX epoch")
            .as_millis() as u64;

        // Check if proof is after last_seen
        if proof_timestamp <= last_seen {
            return Err(ZkVerificationError::TemporalViolation {
                proof_timestamp,
                current_time,
                max_drift_ms: MAX_LATENCY_MS,
            });
        }

        // Check if proof is not too far in the future
        let max_future_time = current_time + MAX_LATENCY_MS;
        if proof_timestamp > max_future_time {
            return Err(ZkVerificationError::TemporalViolation {
                proof_timestamp,
                current_time,
                max_drift_ms: MAX_LATENCY_MS,
            });
        }

        Ok(())
    }

    /// Verify spatial bounds
    ///
    /// Ensures that geographic movement is consistent with MAX_VELOCITY.
    /// Calculates haversine distance and validates velocity.
    ///
    /// # Arguments
    /// * `prev_coord` - Previous geographic coordinate
    /// * `curr_coord` - Current geographic coordinate
    /// * `time_delta_ms` - Time elapsed between coordinates (milliseconds)
    ///
    /// # Returns
    /// * `Ok(())` - Spatial bounds satisfied
    /// * `Err(ZkVerificationError)` - Spatial violation detected
    fn verify_spatial_bounds(
        &self,
        prev_coord: &GeoCoordinate,
        curr_coord: &GeoCoordinate,
        time_delta_ms: u64,
    ) -> Result<(), ZkVerificationError> {
        // Calculate distance using haversine formula
        let distance_m = prev_coord.haversine_distance(curr_coord);

        // Convert time delta to seconds
        let time_delta_s = time_delta_ms as f64 / 1000.0;

        // Prevent division by zero and handle very short time deltas
        if time_delta_s < MIN_TIME_DELTA_MS / 1000.0 {
            // Time delta too short for meaningful velocity calculation
            return Ok(());
        }

        // Calculate velocity
        let velocity_mps = distance_m / time_delta_s;

        // Check if velocity exceeds maximum
        if velocity_mps > MAX_VELOCITY_MPS {
            return Err(ZkVerificationError::SpatialViolation {
                distance_m,
                time_delta_s,
                velocity_mps,
                max_velocity_mps: MAX_VELOCITY_MPS,
            });
        }

        Ok(())
    }

    /// Perform complete physics validation
    ///
    /// This combines temporal and spatial validation into a single check.
    ///
    /// # Arguments
    /// * `request` - The ZK proof request with physics metadata
    ///
    /// # Returns
    /// * `Ok(PhysicsValidation)` - Validation results
    ///
    /// # Note
    /// - Temporal validation is only performed if `last_seen` is provided
    /// - Spatial validation requires historical coordinate data and is not yet implemented
    ///   in this method. It should be performed separately using `verify_spatial_bounds`
    ///   with tracked coordinate history.
    fn validate_physics(
        &self,
        request: &ZkProofRequest,
    ) -> Result<PhysicsValidation, ZkVerificationError> {
        let mut validation = PhysicsValidation {
            temporal_valid: true,
            spatial_valid: true,
            temporal_error: None,
            spatial_error: None,
        };

        // Validate temporal bounds if last_seen is provided
        if let Some(last_seen) = request.last_seen {
            match self.verify_temporal_bounds(request.timestamp, last_seen) {
                Ok(()) => {}
                Err(e) => {
                    validation.temporal_valid = false;
                    validation.temporal_error = Some(e.to_string());
                }
            }
        }

        // Note: Spatial validation would require previous coordinates and timestamp
        // which would need to be tracked separately. Implementations of this trait
        // should maintain coordinate history and call verify_spatial_bounds directly
        // when historical data is available.

        Ok(validation)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_geocoordinate_creation() {
        let coord = GeoCoordinate::new(37.7749, -122.4194);
        assert!(coord.is_ok());

        let invalid_lat = GeoCoordinate::new(91.0, -122.4194);
        assert!(invalid_lat.is_err());

        let invalid_lon = GeoCoordinate::new(37.7749, 181.0);
        assert!(invalid_lon.is_err());
    }

    #[test]
    fn test_haversine_distance() {
        // San Francisco to Los Angeles (approximately 559 km)
        let sf = GeoCoordinate::new(37.7749, -122.4194).unwrap();
        let la = GeoCoordinate::new(34.0522, -118.2437).unwrap();

        let distance = sf.haversine_distance(&la);
        assert!(
            (distance - 559_000.0).abs() < 10_000.0,
            "Expected ~559km, got {}m",
            distance
        );
    }

    #[test]
    fn test_haversine_distance_same_point() {
        let coord = GeoCoordinate::new(0.0, 0.0).unwrap();
        let distance = coord.haversine_distance(&coord);
        assert!(distance < 1.0, "Same point should have ~0 distance");
    }

    #[test]
    fn test_temporal_bounds_valid() {
        struct MockVerifier;
        impl ZkProverService for MockVerifier {
            fn generate(&self, _request: &ZkProofRequest) -> crate::Result<ZkProofResult> {
                Ok(ZkProofResult {
                    proof_bytes: Vec::new(),
                    public_inputs_hash: [0u8; 32],
                    generated_at: 0,
                })
            }
            fn verify(
                &self,
                _proof_bytes: &[u8],
                _public_inputs_hash: &[u8; 32],
            ) -> crate::Result<bool> {
                Ok(true)
            }
        }
        impl ZkPhysicsVerifier for MockVerifier {}

        let verifier = MockVerifier;

        let current_time = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_millis() as u64;

        let last_seen = current_time - 1000; // 1 second ago
        let proof_timestamp = current_time - 500; // 500ms ago

        let result = verifier.verify_temporal_bounds(proof_timestamp, last_seen);
        assert!(result.is_ok());
    }

    #[test]
    fn test_temporal_bounds_too_old() {
        struct MockVerifier;
        impl ZkProverService for MockVerifier {
            fn generate(&self, _request: &ZkProofRequest) -> crate::Result<ZkProofResult> {
                Ok(ZkProofResult {
                    proof_bytes: Vec::new(),
                    public_inputs_hash: [0u8; 32],
                    generated_at: 0,
                })
            }
            fn verify(
                &self,
                _proof_bytes: &[u8],
                _public_inputs_hash: &[u8; 32],
            ) -> crate::Result<bool> {
                Ok(true)
            }
        }
        impl ZkPhysicsVerifier for MockVerifier {}

        let verifier = MockVerifier;

        let last_seen = 1000;
        let proof_timestamp = 500; // Before last_seen

        let result = verifier.verify_temporal_bounds(proof_timestamp, last_seen);
        assert!(result.is_err());
        assert!(matches!(
            result.unwrap_err(),
            ZkVerificationError::TemporalViolation { .. }
        ));
    }

    #[test]
    fn test_temporal_bounds_too_future() {
        struct MockVerifier;
        impl ZkProverService for MockVerifier {
            fn generate(&self, _request: &ZkProofRequest) -> crate::Result<ZkProofResult> {
                Ok(ZkProofResult {
                    proof_bytes: Vec::new(),
                    public_inputs_hash: [0u8; 32],
                    generated_at: 0,
                })
            }
            fn verify(
                &self,
                _proof_bytes: &[u8],
                _public_inputs_hash: &[u8; 32],
            ) -> crate::Result<bool> {
                Ok(true)
            }
        }
        impl ZkPhysicsVerifier for MockVerifier {}

        let verifier = MockVerifier;

        let current_time = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_millis() as u64;

        let last_seen = current_time - 1000;
        let proof_timestamp = current_time + MAX_LATENCY_MS + 1000; // Too far in future

        let result = verifier.verify_temporal_bounds(proof_timestamp, last_seen);
        assert!(result.is_err());
        assert!(matches!(
            result.unwrap_err(),
            ZkVerificationError::TemporalViolation { .. }
        ));
    }

    #[test]
    fn test_spatial_bounds_valid() {
        struct MockVerifier;
        impl ZkProverService for MockVerifier {
            fn generate(&self, _request: &ZkProofRequest) -> crate::Result<ZkProofResult> {
                Ok(ZkProofResult {
                    proof_bytes: Vec::new(),
                    public_inputs_hash: [0u8; 32],
                    generated_at: 0,
                })
            }
            fn verify(
                &self,
                _proof_bytes: &[u8],
                _public_inputs_hash: &[u8; 32],
            ) -> crate::Result<bool> {
                Ok(true)
            }
        }
        impl ZkPhysicsVerifier for MockVerifier {}

        let verifier = MockVerifier;

        // Moving 100 meters in 1 second = 100 m/s (well below 343 m/s)
        let coord1 = GeoCoordinate::new(37.7749, -122.4194).unwrap();
        let coord2 = GeoCoordinate::new(37.7758, -122.4194).unwrap(); // ~100m north

        let result = verifier.verify_spatial_bounds(&coord1, &coord2, 1000); // 1 second
        assert!(result.is_ok());
    }

    #[test]
    fn test_spatial_bounds_violation() {
        struct MockVerifier;
        impl ZkProverService for MockVerifier {
            fn generate(&self, _request: &ZkProofRequest) -> crate::Result<ZkProofResult> {
                Ok(ZkProofResult {
                    proof_bytes: Vec::new(),
                    public_inputs_hash: [0u8; 32],
                    generated_at: 0,
                })
            }
            fn verify(
                &self,
                _proof_bytes: &[u8],
                _public_inputs_hash: &[u8; 32],
            ) -> crate::Result<bool> {
                Ok(true)
            }
        }
        impl ZkPhysicsVerifier for MockVerifier {}

        let verifier = MockVerifier;

        // Moving ~559 km in 1 second = 559,000 m/s (way above 343 m/s)
        let sf = GeoCoordinate::new(37.7749, -122.4194).unwrap();
        let la = GeoCoordinate::new(34.0522, -118.2437).unwrap();

        let result = verifier.verify_spatial_bounds(&sf, &la, 1000); // 1 second
        assert!(result.is_err());
        assert!(matches!(
            result.unwrap_err(),
            ZkVerificationError::SpatialViolation { .. }
        ));
    }

    #[test]
    fn test_spatial_bounds_very_short_time() {
        struct MockVerifier;
        impl ZkProverService for MockVerifier {
            fn generate(&self, _request: &ZkProofRequest) -> crate::Result<ZkProofResult> {
                Ok(ZkProofResult {
                    proof_bytes: Vec::new(),
                    public_inputs_hash: [0u8; 32],
                    generated_at: 0,
                })
            }
            fn verify(
                &self,
                _proof_bytes: &[u8],
                _public_inputs_hash: &[u8; 32],
            ) -> crate::Result<bool> {
                Ok(true)
            }
        }
        impl ZkPhysicsVerifier for MockVerifier {}

        let verifier = MockVerifier;

        let coord1 = GeoCoordinate::new(37.7749, -122.4194).unwrap();
        let coord2 = GeoCoordinate::new(37.7758, -122.4194).unwrap();

        // Very short time delta should be OK (prevents division by zero)
        let result = verifier.verify_spatial_bounds(&coord1, &coord2, 0);
        assert!(result.is_ok());
    }
}
