//! Industrial sensor types with hardware attestation
//!
//! Ported from H2OS DeviceControls.cs with cryptographic binding

use super::traits::{MateriaSlot, MerkleVineLink, TpmAttestation};
use serde::{Deserialize, Serialize};

/// PT100 - Pressure Transducer
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PT100 {
    /// Unique slot identifier
    pub slot_id: u16,
    /// Merkle Vine hash chain link
    pub vine: MerkleVineLink,
    /// TPM attestation
    pub attestation: TpmAttestation,
    /// Pressure reading in PSI
    pub pressure_psi: f32,
    /// Timestamp of reading (nanoseconds since epoch)
    pub timestamp_ns: u64,
    /// Sensor status (0 = OK, 1 = Warning, 2 = Error)
    pub status: u8,
}

impl MateriaSlot for PT100 {
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
        hasher.update(&self.pressure_psi.to_le_bytes());
        hasher.update(&self.timestamp_ns.to_le_bytes());
        hasher.update(&[self.status]);
        *hasher.finalize().as_bytes()
    }
}

/// PT110 - Pressure Transducer (alternate model)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PT110 {
    /// Unique slot identifier
    pub slot_id: u16,
    /// Merkle Vine hash chain link
    pub vine: MerkleVineLink,
    /// TPM attestation
    pub attestation: TpmAttestation,
    /// Pressure reading in PSI
    pub pressure_psi: f32,
    /// Timestamp of reading (nanoseconds since epoch)
    pub timestamp_ns: u64,
    /// Sensor status (0 = OK, 1 = Warning, 2 = Error)
    pub status: u8,
}

impl MateriaSlot for PT110 {
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
        hasher.update(&self.pressure_psi.to_le_bytes());
        hasher.update(&self.timestamp_ns.to_le_bytes());
        hasher.update(&[self.status]);
        *hasher.finalize().as_bytes()
    }
}

/// PS110 - Pressure Switch
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PS110 {
    /// Unique slot identifier
    pub slot_id: u16,
    /// Merkle Vine hash chain link
    pub vine: MerkleVineLink,
    /// TPM attestation
    pub attestation: TpmAttestation,
    /// Switch state (true = activated, false = deactivated)
    pub activated: bool,
    /// Pressure threshold in PSI
    pub threshold_psi: f32,
    /// Timestamp of reading (nanoseconds since epoch)
    pub timestamp_ns: u64,
}

impl MateriaSlot for PS110 {
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
        hasher.update(&[self.activated as u8]);
        hasher.update(&self.threshold_psi.to_le_bytes());
        hasher.update(&self.timestamp_ns.to_le_bytes());
        *hasher.finalize().as_bytes()
    }
}

/// H2Detect - Hydrogen Detector
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct H2Detect {
    /// Unique slot identifier
    pub slot_id: u16,
    /// Merkle Vine hash chain link
    pub vine: MerkleVineLink,
    /// TPM attestation
    pub attestation: TpmAttestation,
    /// Hydrogen concentration in PPM (parts per million)
    pub concentration_ppm: f32,
    /// Alarm state (true = alarm triggered)
    pub alarm_active: bool,
    /// Timestamp of reading (nanoseconds since epoch)
    pub timestamp_ns: u64,
}

impl MateriaSlot for H2Detect {
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
        hasher.update(&self.concentration_ppm.to_le_bytes());
        hasher.update(&[self.alarm_active as u8]);
        hasher.update(&self.timestamp_ns.to_le_bytes());
        *hasher.finalize().as_bytes()
    }
}

/// CGFLT - Carrier Gas Filter Fault
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CGFLT {
    /// Unique slot identifier
    pub slot_id: u16,
    /// Merkle Vine hash chain link
    pub vine: MerkleVineLink,
    /// TPM attestation
    pub attestation: TpmAttestation,
    /// Fault state (true = fault detected)
    pub fault_active: bool,
    /// Filter pressure differential in PSI
    pub pressure_diff_psi: f32,
    /// Timestamp of reading (nanoseconds since epoch)
    pub timestamp_ns: u64,
}

impl MateriaSlot for CGFLT {
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
        hasher.update(&[self.fault_active as u8]);
        hasher.update(&self.pressure_diff_psi.to_le_bytes());
        hasher.update(&self.timestamp_ns.to_le_bytes());
        *hasher.finalize().as_bytes()
    }
}
