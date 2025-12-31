//! Solenoid valve types with quorum proof support
//! 
//! Ported from H2OS DeviceControls.cs SOV* fields

use serde::{Deserialize, Serialize};
use super::traits::{MateriaSlot, MerkleVineLink, TpmAttestation};

/// Valve state enumeration
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
pub enum ValveState {
    /// Valve is closed
    Closed,
    /// Valve is open
    Open,
    /// Valve is in fault state
    Fault,
    /// Valve is in unknown/error state
    Unknown,
}

/// Base solenoid valve structure
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SolenoidValve {
    /// Unique slot identifier (valve_id: SOV100=100, SOV101=101, etc.)
    pub slot_id: u16,
    /// Merkle Vine hash chain link
    pub vine: MerkleVineLink,
    /// TPM attestation
    pub attestation: TpmAttestation,
    /// Current valve state
    pub state: ValveState,
    /// Timestamp of last state change (nanoseconds since epoch)
    pub timestamp_ns: u64,
    /// Number of actuation cycles
    pub cycle_count: u32,
    /// Hash of last command that actuated this valve
    pub last_command_hash: [u8; 32],
}

impl MateriaSlot for SolenoidValve {
    fn slot_id(&self) -> u16 {
        self.slot_id
    }
    
    fn vine_link(&self) -> &MerkleVineLink {
        &self.vine
    }
    
    fn attestation(&self) -> &TpmAttestation {
        &self.attestation
    }
    
    fn compute_hash(&self) -> [u8; 32] {
        let mut hasher = blake3::Hasher::new();
        hasher.update(&self.slot_id.to_le_bytes());
        hasher.update(&[self.state as u8]);
        hasher.update(&self.timestamp_ns.to_le_bytes());
        hasher.update(&self.cycle_count.to_le_bytes());
        hasher.update(&self.last_command_hash);
        *hasher.finalize().as_bytes()
    }
}

/// SOV100 - Solenoid Valve 100
pub type SOV100 = SolenoidValve;

/// SOV101 - Solenoid Valve 101
pub type SOV101 = SolenoidValve;

/// SOV102 - Solenoid Valve 102
pub type SOV102 = SolenoidValve;

/// SOV103 - Solenoid Valve 103
pub type SOV103 = SolenoidValve;

/// SOV110 - Solenoid Valve 110
pub type SOV110 = SolenoidValve;
