//! Domain layer abstraction for Zero-Knowledge proof services.
//!
//! This module provides a domain-level interface for ZK proof operations,
//! decoupling the business logic from cryptographic implementation details.

use serde::{Deserialize, Serialize};

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

/// Service trait for ZK proof operations (domain layer)
pub trait ZkProverService: Send + Sync {
    /// Generate a ZK proof from a request
    fn generate(&self, request: &ZkProofRequest) -> crate::Result<ZkProofResult>;

    /// Verify a ZK proof
    fn verify(&self, proof_bytes: &[u8], public_inputs_hash: &[u8; 32]) -> crate::Result<bool>;
}
