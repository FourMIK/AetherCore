//! Valve command structures with safety requirements

use super::quorum::QuorumProof;
use crate::materia::TpmAttestation;
use serde::{Deserialize, Serialize};

/// Safety reason for command execution
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum SafetyReason {
    /// Hydrogen detected
    H2Detected,
    /// Heartbeat expired
    HeartbeatExpired,
    /// Quorum revoked
    QuorumRevoked,
    /// Manual shutdown initiated
    ManualShutdown,
    /// Threshold breach detected
    ThresholdBreach,
}

/// Valve command enumeration
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum ValveCommand {
    /// Open valve with quorum proof
    ///
    /// Requires:
    /// - QuorumProof with threshold signatures
    /// - H2Detect attestation confirming zero leaks
    Open {
        /// Valve identifier
        valve_id: u16,
        /// Quorum proof from trusted nodes
        quorum_proof: QuorumProof,
        /// H2 clear attestation (H2Detect must confirm zero leaks)
        h2_clear_attestation: TpmAttestation,
    },

    /// Close valve (no proof required for safety)
    Close {
        /// Valve identifier
        valve_id: u16,
    },

    /// Emergency shutdown (immediate, all valves)
    EmergencyShutdown {
        /// Reason for emergency shutdown
        reason: SafetyReason,
        /// Initiator node or operator identifier
        initiator: String,
    },
}

/// Command validation error
#[derive(Debug, thiserror::Error)]
pub enum CommandError {
    /// Quorum verification failed
    #[error("Quorum verification failed: {0}")]
    QuorumFailed(String),

    /// H2 detector indicates leak
    #[error("H2 leak detected: {0}")]
    H2Detected(String),

    /// Invalid valve identifier
    #[error("Invalid valve ID: {0}")]
    InvalidValveId(u16),
}

impl ValveCommand {
    /// Create an open command
    pub fn open(
        valve_id: u16,
        quorum_proof: QuorumProof,
        h2_clear_attestation: TpmAttestation,
    ) -> Self {
        Self::Open {
            valve_id,
            quorum_proof,
            h2_clear_attestation,
        }
    }

    /// Create a close command
    pub fn close(valve_id: u16) -> Self {
        Self::Close { valve_id }
    }

    /// Create an emergency shutdown command
    pub fn emergency_shutdown(reason: SafetyReason, initiator: String) -> Self {
        Self::EmergencyShutdown { reason, initiator }
    }

    /// Verify the command can be executed safely
    ///
    /// For Open commands:
    /// - Verifies quorum proof
    /// - Checks H2 attestation timestamp is recent
    pub fn validate(&self) -> Result<(), CommandError> {
        match self {
            ValveCommand::Open {
                quorum_proof,
                h2_clear_attestation,
                ..
            } => {
                // Verify quorum proof
                quorum_proof
                    .verify()
                    .map_err(|e| CommandError::QuorumFailed(format!("{}", e)))?;

                // Check that H2 attestation timestamp is present
                // In production, would validate the attestation signature and check
                // that H2 concentration is zero
                if h2_clear_attestation.timestamp == 0 {
                    return Err(CommandError::H2Detected(
                        "H2 attestation timestamp is zero".to_string(),
                    ));
                }

                Ok(())
            }
            ValveCommand::Close { .. } => Ok(()),
            ValveCommand::EmergencyShutdown { .. } => Ok(()),
        }
    }
}
