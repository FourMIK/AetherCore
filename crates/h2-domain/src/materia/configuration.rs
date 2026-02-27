//! Device configuration with TPM binding
//!
//! Ported from H2OS DeviceConfiguration.cs with attestation

use super::traits::{MerkleVineLink, TpmAttestation};
use serde::{Deserialize, Serialize};
use thiserror::Error;

/// Threshold drift error
#[derive(Debug, Error)]
pub enum ThresholdDriftError {
    /// Customer pressure hi-hi threshold drifted
    #[error("Customer pressure hi-hi drifted by {delta} PSI (old: {old}, new: {new})")]
    CustomerPressureHiHi {
        /// Previous threshold value
        old: f32,
        /// New threshold value
        new: f32,
        /// Absolute drift amount
        delta: f32,
    },

    /// Customer pressure lo-lo threshold drifted
    #[error("Customer pressure lo-lo drifted by {delta} PSI (old: {old}, new: {new})")]
    CustomerPressureLoLo {
        /// Previous threshold value
        old: f32,
        /// New threshold value
        new: f32,
        /// Absolute drift amount
        delta: f32,
    },

    /// Customer pressure fill threshold drifted
    #[error("Customer pressure fill drifted by {delta} PSI (old: {old}, new: {new})")]
    CustomerPressureFill {
        /// Previous threshold value
        old: f32,
        /// New threshold value
        new: f32,
        /// Absolute drift amount
        delta: f32,
    },

    /// Customer volume drifted
    #[error("Customer volume drifted by {delta} cubic feet (old: {old}, new: {new})")]
    CustomerVolume {
        /// Previous threshold value
        old: f32,
        /// New threshold value
        new: f32,
        /// Absolute drift amount
        delta: f32,
    },

    /// Pressure drop setpoint 1 drifted
    #[error("Pressure drop SP1 drifted by {delta} PSI (old: {old}, new: {new})")]
    PressureDropSp1 {
        /// Previous setpoint value
        old: f32,
        /// New setpoint value
        new: f32,
        /// Absolute drift amount
        delta: f32,
    },

    /// Pressure drop setpoint 2 drifted
    #[error("Pressure drop SP2 drifted by {delta} PSI (old: {old}, new: {new})")]
    PressureDropSp2 {
        /// Previous setpoint value
        old: f32,
        /// New setpoint value
        new: f32,
        /// Absolute drift amount
        delta: f32,
    },

    /// N2 purge flag changed
    #[error("N2 purge requirement changed (old: {old}, new: {new})")]
    N2PurgeChanged {
        /// Previous purge requirement
        old: bool,
        /// New purge requirement
        new: bool,
    },
}

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

    /// Check for threshold drift between configurations
    ///
    /// Returns the first detected drift error, or None if configurations match.
    /// A drift error should trigger FailVisible lockout.
    pub fn check_threshold_drift(&self, other: &Self) -> Option<ThresholdDriftError> {
        // Check customer pressure hi-hi
        if self.customer_pressure_hi_hi != other.customer_pressure_hi_hi {
            return Some(ThresholdDriftError::CustomerPressureHiHi {
                old: self.customer_pressure_hi_hi,
                new: other.customer_pressure_hi_hi,
                delta: (other.customer_pressure_hi_hi - self.customer_pressure_hi_hi).abs(),
            });
        }

        // Check customer pressure lo-lo
        if self.customer_pressure_lo_lo != other.customer_pressure_lo_lo {
            return Some(ThresholdDriftError::CustomerPressureLoLo {
                old: self.customer_pressure_lo_lo,
                new: other.customer_pressure_lo_lo,
                delta: (other.customer_pressure_lo_lo - self.customer_pressure_lo_lo).abs(),
            });
        }

        // Check customer pressure fill
        if self.customer_pressure_fill != other.customer_pressure_fill {
            return Some(ThresholdDriftError::CustomerPressureFill {
                old: self.customer_pressure_fill,
                new: other.customer_pressure_fill,
                delta: (other.customer_pressure_fill - self.customer_pressure_fill).abs(),
            });
        }

        // Check customer volume
        if self.customer_volume != other.customer_volume {
            return Some(ThresholdDriftError::CustomerVolume {
                old: self.customer_volume,
                new: other.customer_volume,
                delta: (other.customer_volume - self.customer_volume).abs(),
            });
        }

        // Check pressure drop SP1
        if self.pressure_drop_sp1 != other.pressure_drop_sp1 {
            return Some(ThresholdDriftError::PressureDropSp1 {
                old: self.pressure_drop_sp1,
                new: other.pressure_drop_sp1,
                delta: (other.pressure_drop_sp1 - self.pressure_drop_sp1).abs(),
            });
        }

        // Check pressure drop SP2
        if self.pressure_drop_sp2 != other.pressure_drop_sp2 {
            return Some(ThresholdDriftError::PressureDropSp2 {
                old: self.pressure_drop_sp2,
                new: other.pressure_drop_sp2,
                delta: (other.pressure_drop_sp2 - self.pressure_drop_sp2).abs(),
            });
        }

        // Check N2 purge requirement
        if self.n2_purge_required != other.n2_purge_required {
            return Some(ThresholdDriftError::N2PurgeChanged {
                old: self.n2_purge_required,
                new: other.n2_purge_required,
            });
        }

        None
    }
}
