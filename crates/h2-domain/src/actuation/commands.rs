//! Valve command structures with safety requirements

use serde::{Deserialize, Serialize};
use super::quorum::QuorumProof;
use crate::materia::H2Detect;

/// Safety reason for emergency shutdown
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum SafetyReason {
    /// Hydrogen leak detected
    HydrogenLeak {
        /// Hydrogen concentration in PPM
        concentration_ppm: f32
    },
    /// Pressure threshold exceeded
    PressureExceeded {
        /// Pressure reading in PSI
        pressure_psi: f32
    },
    /// Communication heartbeat expired
    HeartbeatExpired,
    /// Manual emergency stop
    ManualStop {
        /// Operator identifier
        operator_id: String
    },
    /// System fault detected
    SystemFault {
        /// Fault code
        fault_code: u32
    },
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
        /// H2 detector reading confirming no leaks
        h2_attestation: Option<H2Detect>,
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
    },
}

impl ValveCommand {
    /// Create an open command
    pub fn open(valve_id: u16, quorum_proof: QuorumProof) -> Self {
        Self::Open {
            valve_id,
            quorum_proof,
            h2_attestation: None,
        }
    }
    
    /// Create an open command with H2 attestation
    pub fn open_with_h2_attestation(
        valve_id: u16,
        quorum_proof: QuorumProof,
        h2_attestation: H2Detect,
    ) -> Self {
        Self::Open {
            valve_id,
            quorum_proof,
            h2_attestation: Some(h2_attestation),
        }
    }
    
    /// Create a close command
    pub fn close(valve_id: u16) -> Self {
        Self::Close { valve_id }
    }
    
    /// Create an emergency shutdown command
    pub fn emergency_shutdown(reason: SafetyReason) -> Self {
        Self::EmergencyShutdown { reason }
    }
    
    /// Verify the command can be executed safely
    /// 
    /// For Open commands:
    /// - Verifies quorum proof
    /// - Checks H2 detector if present (concentration must be 0)
    pub fn verify(&self) -> Result<(), String> {
        match self {
            ValveCommand::Open {
                quorum_proof,
                h2_attestation,
                ..
            } => {
                // Verify quorum proof
                quorum_proof
                    .verify()
                    .map_err(|e| format!("Quorum verification failed: {}", e))?;
                
                // Check H2 detector if present
                if let Some(h2) = h2_attestation {
                    if h2.concentration_ppm > 0.0 {
                        return Err(format!(
                            "Cannot open valve: hydrogen detected ({} ppm)",
                            h2.concentration_ppm
                        ));
                    }
                    if h2.alarm_active {
                        return Err("Cannot open valve: H2 alarm active".to_string());
                    }
                }
                
                Ok(())
            }
            ValveCommand::Close { .. } => Ok(()),
            ValveCommand::EmergencyShutdown { .. } => Ok(()),
        }
    }
}
