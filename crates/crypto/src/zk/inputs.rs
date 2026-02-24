//! Input and output types for Zero-Knowledge proofs.
//!
//! These types match the AuthynticProof.circom schema for device attestation
//! and location verification.

use serde::{Deserialize, Serialize};

/// Parameters for generating a ZK proof
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ZkProofParams {
    /// Device identifier
    pub device_id: u64,
    /// Timestamp when proof is generated (Unix milliseconds)
    pub timestamp: u64,
    /// Hash of the device's location
    pub location_hash: [u8; 32],
    /// Attestations from neighboring devices
    pub neighbor_attestations: Vec<[u8; 32]>,
}

/// Private inputs to the ZK proof (witness)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ZkPrivateInputs {
    /// Device secret key (private)
    pub device_secret: [u8; 32],
    /// Salt for device commitment
    pub device_salt: [u8; 32],
    /// Location hash (private)
    pub location_hash: [u8; 32],
    /// Nonce for location commitment
    pub location_nonce: [u8; 32],
    /// Timestamp (Unix milliseconds)
    pub timestamp: u64,
    /// Neighbor attestations (fixed array of 4 for circuit compatibility)
    pub neighbor_attestations: [[u8; 32]; 4],
}

/// Public inputs to the ZK proof (known to verifier)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ZkPublicInputs {
    /// Commitment to device identity
    pub device_commitment: [u8; 32],
    /// Merkle root of trusted device set
    pub merkle_root: [u8; 32],
    /// Current time for temporal verification (Unix milliseconds)
    pub current_time: u64,
    /// Expected commitment to location
    pub expected_location_commitment: [u8; 32],
    /// Expected root of attestation tree
    pub expected_attestation_root: [u8; 32],
    /// Maximum age of proof in milliseconds
    pub max_age: u64,
}

impl ZkPrivateInputs {
    /// Create new private inputs with validation
    pub fn new(
        device_secret: [u8; 32],
        device_salt: [u8; 32],
        location_hash: [u8; 32],
        location_nonce: [u8; 32],
        timestamp: u64,
        neighbor_attestations: [[u8; 32]; 4],
    ) -> Self {
        Self {
            device_secret,
            device_salt,
            location_hash,
            location_nonce,
            timestamp,
            neighbor_attestations,
        }
    }
}

impl ZkPublicInputs {
    /// Create new public inputs
    pub fn new(
        device_commitment: [u8; 32],
        merkle_root: [u8; 32],
        current_time: u64,
        expected_location_commitment: [u8; 32],
        expected_attestation_root: [u8; 32],
        max_age: u64,
    ) -> Self {
        Self {
            device_commitment,
            merkle_root,
            current_time,
            expected_location_commitment,
            expected_attestation_root,
            max_age,
        }
    }
}
