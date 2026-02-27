//! Cryptographic heartbeat monitor
//!
//! Ported from H2OS VehicleCommunication.cs with attestation

use crate::materia::TpmAttestation;
use serde::{Deserialize, Serialize};

/// Heartbeat status enumeration
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
pub enum HeartbeatStatus {
    /// Heartbeat is active and current
    Alive,
    /// Heartbeat has a warning (approaching timeout)
    Warning,
    /// Heartbeat has expired (triggers safe state)
    Expired,
}

/// Cryptographic heartbeat monitor
///
/// Tracks node communication status with TPM attestations.
/// When heartbeat expires, system enters safe state (all valves closed).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Heartbeat {
    /// Node identifier
    pub node_id: String,
    /// Timestamp of last attestation (nanoseconds since epoch)
    pub last_attestation_ns: u64,
    /// Timeout threshold (nanoseconds)
    pub timeout_ns: u64,
    /// Latest TPM attestation
    pub attestation: TpmAttestation,
}

impl Heartbeat {
    /// Create a new heartbeat monitor
    ///
    /// # Arguments
    /// * `node_id` - Node identifier
    /// * `timeout_ns` - Timeout threshold in nanoseconds
    /// * `attestation` - Initial TPM attestation
    pub fn new(node_id: String, timeout_ns: u64, attestation: TpmAttestation) -> Self {
        Self {
            node_id,
            last_attestation_ns: attestation.timestamp,
            timeout_ns,
            attestation,
        }
    }

    /// Update heartbeat with new attestation
    ///
    /// # Arguments
    /// * `attestation` - New TPM attestation
    /// * `timestamp_ns` - Current timestamp in nanoseconds since epoch
    pub fn update(&mut self, attestation: TpmAttestation, timestamp_ns: u64) {
        self.last_attestation_ns = timestamp_ns;
        self.attestation = attestation;
    }

    /// Check heartbeat status
    ///
    /// # Arguments
    /// * `current_ns` - Current timestamp in nanoseconds since epoch
    ///
    /// Returns:
    /// - `Alive` if within timeout
    /// - `Warning` if within 80% of timeout (warning threshold)
    /// - `Expired` if past timeout
    pub fn check(&self, current_ns: u64) -> HeartbeatStatus {
        let elapsed = current_ns.saturating_sub(self.last_attestation_ns);

        if elapsed >= self.timeout_ns {
            HeartbeatStatus::Expired
        } else if elapsed >= (self.timeout_ns * 4 / 5) {
            // Warning at 80% of timeout
            HeartbeatStatus::Warning
        } else {
            HeartbeatStatus::Alive
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn create_test_attestation(timestamp: u64) -> TpmAttestation {
        TpmAttestation::new(vec![0xAA; 64], vec![0xFF; 32], vec![0xBB; 128], timestamp)
    }

    #[test]
    fn test_heartbeat_alive() {
        let attestation = create_test_attestation(1_000_000_000);
        let heartbeat = Heartbeat::new(
            "node-001".to_string(),
            5_000_000_000, // 5 second timeout
            attestation,
        );

        // Check at 2 seconds (within timeout)
        assert_eq!(heartbeat.check(2_000_000_000), HeartbeatStatus::Alive);
    }

    #[test]
    fn test_heartbeat_warning() {
        let attestation = create_test_attestation(1_000_000_000);
        let heartbeat = Heartbeat::new(
            "node-001".to_string(),
            5_000_000_000, // 5 second timeout
            attestation,
        );

        // Check at 5 seconds (80% of timeout = 4s, so 5s should be warning)
        assert_eq!(heartbeat.check(5_000_000_000), HeartbeatStatus::Warning);
    }

    #[test]
    fn test_heartbeat_expired() {
        let attestation = create_test_attestation(1_000_000_000);
        let heartbeat = Heartbeat::new(
            "node-001".to_string(),
            5_000_000_000, // 5 second timeout
            attestation,
        );

        // Check at 7 seconds (beyond timeout)
        assert_eq!(heartbeat.check(7_000_000_000), HeartbeatStatus::Expired);
    }

    #[test]
    fn test_heartbeat_update() {
        let attestation1 = create_test_attestation(1_000_000_000);
        let mut heartbeat = Heartbeat::new("node-001".to_string(), 5_000_000_000, attestation1);

        let attestation2 = create_test_attestation(3_000_000_000);
        heartbeat.update(attestation2, 3_000_000_000);

        assert_eq!(heartbeat.last_attestation_ns, 3_000_000_000);
        assert_eq!(heartbeat.check(4_000_000_000), HeartbeatStatus::Alive);
    }
}
