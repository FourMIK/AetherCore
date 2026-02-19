//! Dead man's switch - Safe state enforcement

use super::heartbeat::{Heartbeat, HeartbeatStatus};
use crate::actuation::ValveCommand;
use crate::materia::TpmAttestation;
use serde::{Deserialize, Serialize};

/// System operating mode
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
pub enum SystemMode {
    /// Normal operation - valves can be actuated with quorum proof
    Operational,
    /// FailVisible mode - all valves locked closed, manual attestation required
    FailVisible,
    /// Manual override mode - operator intervention active
    ManualOverride,
}

/// Safety error types
#[derive(Debug, thiserror::Error)]
pub enum SafetyError {
    /// Already in operational mode
    #[error("System already in operational mode")]
    AlreadyOperational,

    /// Cannot resume while heartbeats are expired
    #[error("Cannot resume: {0} heartbeat(s) expired")]
    HeartbeatsExpired(usize),

    /// Invalid attestation
    #[error("Invalid manual attestation: {0}")]
    InvalidAttestation(String),
}

/// Dead man's switch - monitors heartbeats and enforces safe state
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DeadManSwitch {
    /// Tracked heartbeats from all nodes
    pub heartbeats: Vec<Heartbeat>,
    /// Current system mode
    pub mode: SystemMode,
    /// Timestamp of last check (nanoseconds since epoch)
    pub last_check_ns: u64,
}

impl DeadManSwitch {
    /// Create a new dead man's switch
    pub fn new() -> Self {
        Self {
            heartbeats: Vec::new(),
            mode: SystemMode::Operational,
            last_check_ns: 0,
        }
    }

    /// Add a heartbeat to monitor
    pub fn add_heartbeat(&mut self, heartbeat: Heartbeat) {
        self.heartbeats.push(heartbeat);
    }

    /// Evaluate all heartbeats and determine system mode
    ///
    /// # Arguments
    /// * `current_ns` - Current timestamp in nanoseconds since epoch
    ///
    /// Returns the current system mode after evaluation
    pub fn evaluate(&mut self, current_ns: u64) -> SystemMode {
        self.last_check_ns = current_ns;

        // Check all heartbeats
        let mut expired_count = 0;
        for heartbeat in &self.heartbeats {
            match heartbeat.check(current_ns) {
                HeartbeatStatus::Expired => expired_count += 1,
                HeartbeatStatus::Warning => {
                    tracing::warn!(
                        node_id = %heartbeat.node_id,
                        "Heartbeat warning: approaching timeout"
                    );
                }
                HeartbeatStatus::Alive => {}
            }
        }

        // If any heartbeat expired, trigger safe state
        if expired_count > 0 && self.mode == SystemMode::Operational {
            tracing::error!(
                expired_count = expired_count,
                "Heartbeat(s) expired, triggering FailVisible mode"
            );
            self.mode = SystemMode::FailVisible;
        }

        self.mode
    }

    /// Trigger safe state immediately
    ///
    /// Returns commands to close all valves (SOV100-103, SOV110)
    pub fn trigger_safe_state(&mut self) -> Vec<ValveCommand> {
        self.mode = SystemMode::FailVisible;

        // Generate close commands for all known SOV valves
        vec![
            ValveCommand::close(100), // SOV100
            ValveCommand::close(101), // SOV101
            ValveCommand::close(102), // SOV102
            ValveCommand::close(103), // SOV103
            ValveCommand::close(110), // SOV110
        ]
    }

    /// Attempt to resume normal operation
    ///
    /// Requires:
    /// - Manual TPM attestation from authorized operator
    /// - All heartbeats must be alive (not expired)
    ///
    /// # Arguments
    /// * `manual_attestation` - TPM attestation from operator
    pub fn resume(&mut self, manual_attestation: TpmAttestation) -> Result<(), SafetyError> {
        if self.mode == SystemMode::Operational {
            return Err(SafetyError::AlreadyOperational);
        }

        // Verify attestation timestamp is present
        if manual_attestation.timestamp == 0 {
            return Err(SafetyError::InvalidAttestation(
                "Attestation timestamp is zero".to_string(),
            ));
        }

        // Check that all heartbeats are alive
        let current_ns = manual_attestation.timestamp;
        let expired: Vec<_> = self
            .heartbeats
            .iter()
            .filter(|h| h.check(current_ns) == HeartbeatStatus::Expired)
            .map(|h| h.node_id.as_str())
            .collect();

        if !expired.is_empty() {
            return Err(SafetyError::HeartbeatsExpired(expired.len()));
        }

        // Resume operational mode
        self.mode = SystemMode::Operational;
        tracing::info!("System resumed to operational mode with manual attestation");

        Ok(())
    }
}

impl Default for DeadManSwitch {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn create_test_attestation(timestamp: u64) -> TpmAttestation {
        TpmAttestation::new(vec![0xAA; 64], vec![0xFF; 32], vec![0xBB; 128], timestamp)
    }

    #[test]
    fn test_dead_man_switch_operational() {
        let mut dms = DeadManSwitch::new();
        assert_eq!(dms.mode, SystemMode::Operational);

        // Add a healthy heartbeat
        let heartbeat = Heartbeat::new(
            "node-001".to_string(),
            5_000_000_000,
            create_test_attestation(1_000_000_000),
        );
        dms.add_heartbeat(heartbeat);

        // Evaluate at 2 seconds (heartbeat still alive)
        let mode = dms.evaluate(2_000_000_000);
        assert_eq!(mode, SystemMode::Operational);
    }

    #[test]
    fn test_dead_man_switch_fail_visible() {
        let mut dms = DeadManSwitch::new();

        // Add an expired heartbeat
        let heartbeat = Heartbeat::new(
            "node-001".to_string(),
            5_000_000_000,
            create_test_attestation(1_000_000_000),
        );
        dms.add_heartbeat(heartbeat);

        // Evaluate at 7 seconds (heartbeat expired)
        let mode = dms.evaluate(7_000_000_000);
        assert_eq!(mode, SystemMode::FailVisible);
    }

    #[test]
    fn test_trigger_safe_state() {
        let mut dms = DeadManSwitch::new();
        let commands = dms.trigger_safe_state();

        assert_eq!(dms.mode, SystemMode::FailVisible);
        assert_eq!(commands.len(), 5);
    }

    #[test]
    fn test_resume_success() {
        let mut dms = DeadManSwitch::new();
        dms.mode = SystemMode::FailVisible;

        // Add a healthy heartbeat
        let heartbeat = Heartbeat::new(
            "node-001".to_string(),
            5_000_000_000,
            create_test_attestation(1_000_000_000),
        );
        dms.add_heartbeat(heartbeat);

        // Resume at 2 seconds (heartbeat alive)
        let attestation = create_test_attestation(2_000_000_000);
        assert!(dms.resume(attestation).is_ok());
        assert_eq!(dms.mode, SystemMode::Operational);
    }

    #[test]
    fn test_resume_fail_expired_heartbeat() {
        let mut dms = DeadManSwitch::new();
        dms.mode = SystemMode::FailVisible;

        // Add an expired heartbeat
        let heartbeat = Heartbeat::new(
            "node-001".to_string(),
            5_000_000_000,
            create_test_attestation(1_000_000_000),
        );
        dms.add_heartbeat(heartbeat);

        // Try to resume at 7 seconds (heartbeat expired)
        let attestation = create_test_attestation(7_000_000_000);
        let result = dms.resume(attestation);

        assert!(result.is_err());
        assert_eq!(dms.mode, SystemMode::FailVisible);
    }
}
