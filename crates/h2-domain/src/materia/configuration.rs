//! Device configuration with TPM binding
//! 
//! Ported from H2OS DeviceConfiguration.cs with attestation

use serde::{Deserialize, Serialize};
use super::traits::{MerkleVineLink, TpmAttestation};

/// Attested device configuration
/// 
/// Wraps configuration values with TPM attestation and triggers FailVisible
/// lockout on threshold drift.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AttestedConfiguration {
    /// Merkle Vine hash chain link
    pub vine: MerkleVineLink,
    /// TPM attestation
    pub attestation: TpmAttestation,
    /// Configuration type identifier
    pub configuration_type: String,
    /// Configuration name
    pub configuration_name: String,
    /// Customer pressure high-high threshold (PSI)
    pub customer_pressure_hi_hi: f32,
    /// Customer pressure low-low threshold (PSI)
    pub customer_pressure_lo_lo: f32,
    /// Customer pressure fill setpoint (PSI)
    pub customer_pressure_fill: f32,
    /// Customer volume (cubic feet)
    pub customer_volume: f32,
    /// Pressure drop setpoint 1 (PSI)
    pub pressure_drop_sp1: f32,
    /// Pressure drop setpoint 2 (PSI)
    pub pressure_drop_sp2: f32,
    /// N2 purge required flag
    pub n2_purge_required: bool,
    /// Configuration hash computed over all fields (32 bytes)
    pub config_hash: [u8; 32],
}

impl AttestedConfiguration {
    /// Compute BLAKE3 hash over all configuration fields
    pub fn compute_config_hash(&self) -> [u8; 32] {
        let mut hasher = blake3::Hasher::new();
        hasher.update(self.configuration_type.as_bytes());
        hasher.update(self.configuration_name.as_bytes());
        hasher.update(&self.customer_pressure_hi_hi.to_le_bytes());
        hasher.update(&self.customer_pressure_lo_lo.to_le_bytes());
        hasher.update(&self.customer_pressure_fill.to_le_bytes());
        hasher.update(&self.customer_volume.to_le_bytes());
        hasher.update(&self.pressure_drop_sp1.to_le_bytes());
        hasher.update(&self.pressure_drop_sp2.to_le_bytes());
        hasher.update(&[self.n2_purge_required as u8]);
        *hasher.finalize().as_bytes()
    }
    
    /// Verify that the stored config_hash matches the computed hash
    /// 
    /// Returns true if the configuration has not drifted, false otherwise.
    /// A false result should trigger FailVisible lockout.
    pub fn verify_integrity(&self) -> bool {
        self.config_hash == self.compute_config_hash()
    }
}
