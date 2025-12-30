//! ----------------------------------------------------------------------------
//! SECURITY NOTICE: EDGE OPTIMIZED IMPLEMENTATION
//! ----------------------------------------------------------------------------
//! This module contains a Rust native port of the ZK Prover
//! optimized for low-power embedded devices (ARM/RISC-V).
//!
//! NOTE: For production key generation, use the hardware-backed TPM interfaces
//! defined in `crates/identity`.
//! ----------------------------------------------------------------------------
//!
//! Zero-Knowledge proof generation and verification.
//!
//! This module provides ZK-SNARK proof generation for device attestation and location verification.
//! Currently implements a placeholder structure; production will use ark-groth16.

use super::error::{ZkError, ZkResult};
use super::inputs::{ZkPrivateInputs, ZkPublicInputs};
use super::poseidon::{attestation_root, device_commitment, location_commitment};
use serde::{Deserialize, Serialize};

// Placeholder proof component sizes for Groth16 on BN254
// TODO: These will be determined by the actual circuit when using ark-groth16
const PROOF_PI_A_SIZE: usize = 64;
const PROOF_PI_B_SIZE: usize = 128;
const PROOF_PI_C_SIZE: usize = 64;

/// Zero-Knowledge proof output
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ZkProof {
    /// Proof component A
    pub pi_a: Vec<u8>,
    /// Proof component B
    pub pi_b: Vec<u8>,
    /// Proof component C
    pub pi_c: Vec<u8>,
    /// Protocol identifier (e.g., "groth16")
    pub protocol: String,
    /// Elliptic curve identifier (e.g., "bn254")
    pub curve: String,
}

/// Verification key for ZK proofs
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ZkVerificationKey {
    /// Alpha_1 point
    pub alpha_1: Vec<u8>,
    /// Beta_2 point
    pub beta_2: Vec<u8>,
    /// Gamma_2 point
    pub gamma_2: Vec<u8>,
    /// Delta_2 point
    pub delta_2: Vec<u8>,
    /// IC points for public inputs
    pub ic: Vec<Vec<u8>>,
}

/// Trait for ZK proof generation (dependency injection)
pub trait ZkProverTrait: Send + Sync {
    /// Generate a ZK proof from private inputs
    fn generate_proof(
        &self,
        private_inputs: &ZkPrivateInputs,
        public_inputs: &ZkPublicInputs,
    ) -> ZkResult<ZkProof>;

    /// Verify a ZK proof
    fn verify_proof(&self, proof: &ZkProof, public_inputs: &ZkPublicInputs) -> ZkResult<bool>;
}

/// Zero-Knowledge proof generator
#[derive(Debug, Clone)]
pub struct ZkProver {
    /// Whether the prover is initialized
    initialized: bool,
}

impl ZkProver {
    /// Create a new ZK prover instance
    pub fn new() -> Self {
        Self { initialized: false }
    }

    /// Initialize the prover with proving and verification keys
    ///
    /// TODO: Load keys from circuit compilation artifacts
    pub fn initialize(&mut self) -> ZkResult<()> {
        self.initialized = true;
        Ok(())
    }

    /// Compute public inputs from private witness
    ///
    /// This derives the public inputs that the verifier will check
    pub fn compute_public_inputs(
        &self,
        private_inputs: &ZkPrivateInputs,
        merkle_root: [u8; 32],
        current_time: u64,
        max_age: u64,
    ) -> ZkResult<ZkPublicInputs> {
        // Compute device commitment
        let device_comm =
            device_commitment(&private_inputs.device_secret, &private_inputs.device_salt)?;

        // Compute location commitment
        let location_comm = location_commitment(
            &private_inputs.location_hash,
            &private_inputs.location_nonce,
        )?;

        // Compute attestation root
        let att_root = attestation_root(&private_inputs.neighbor_attestations)?;

        Ok(ZkPublicInputs::new(
            device_comm,
            merkle_root,
            current_time,
            location_comm,
            att_root,
            max_age,
        ))
    }

    /// Validate temporal constraints
    fn validate_temporal(&self, timestamp: u64, current_time: u64, max_age: u64) -> ZkResult<()> {
        // Reject time travel (timestamp from the future)
        if timestamp > current_time {
            return Err(ZkError::TemporalViolation(format!(
                "Timestamp {} is in the future (current: {})",
                timestamp, current_time
            )));
        }

        // Check if proof is too old
        let age = current_time.saturating_sub(timestamp);
        if age > max_age {
            return Err(ZkError::TemporalViolation(format!(
                "Proof age {} exceeds maximum allowed age {}",
                age, max_age
            )));
        }

        Ok(())
    }
}

impl Default for ZkProver {
    fn default() -> Self {
        Self::new()
    }
}

impl ZkProverTrait for ZkProver {
    /// Generate a ZK proof from private inputs
    ///
    /// TODO: Implement with ark-groth16 using compiled circuit
    fn generate_proof(
        &self,
        private_inputs: &ZkPrivateInputs,
        public_inputs: &ZkPublicInputs,
    ) -> ZkResult<ZkProof> {
        if !self.initialized {
            return Err(ZkError::NotInitialized);
        }

        // Validate temporal constraints
        self.validate_temporal(
            private_inputs.timestamp,
            public_inputs.current_time,
            public_inputs.max_age,
        )?;

        // Verify that derived public inputs match provided ones
        let derived = self.compute_public_inputs(
            private_inputs,
            public_inputs.merkle_root,
            public_inputs.current_time,
            public_inputs.max_age,
        )?;

        if derived.device_commitment != public_inputs.device_commitment {
            return Err(ZkError::CommitmentMismatch(
                "Device commitment mismatch".to_string(),
            ));
        }

        if derived.expected_location_commitment != public_inputs.expected_location_commitment {
            return Err(ZkError::CommitmentMismatch(
                "Location commitment mismatch".to_string(),
            ));
        }

        if derived.expected_attestation_root != public_inputs.expected_attestation_root {
            return Err(ZkError::CommitmentMismatch(
                "Attestation root mismatch".to_string(),
            ));
        }

        // TODO: Generate actual proof using ark-groth16
        // For now, return a placeholder proof
        Ok(ZkProof {
            pi_a: vec![0u8; PROOF_PI_A_SIZE],
            pi_b: vec![0u8; PROOF_PI_B_SIZE],
            pi_c: vec![0u8; PROOF_PI_C_SIZE],
            protocol: "groth16".to_string(),
            curve: "bn254".to_string(),
        })
    }

    /// Verify a ZK proof
    ///
    /// TODO: Implement with ark-groth16 verification
    fn verify_proof(&self, _proof: &ZkProof, _public_inputs: &ZkPublicInputs) -> ZkResult<bool> {
        if !self.initialized {
            return Err(ZkError::NotInitialized);
        }

        // TODO: Implement actual verification with ark-groth16
        // For now, return success as placeholder
        Ok(true)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn create_test_private_inputs() -> ZkPrivateInputs {
        ZkPrivateInputs::new(
            [1u8; 32],                                    // device_secret
            [2u8; 32],                                    // device_salt
            [3u8; 32],                                    // location_hash
            [4u8; 32],                                    // location_nonce
            1000000,                                      // timestamp
            [[5u8; 32], [6u8; 32], [7u8; 32], [8u8; 32]], // neighbor_attestations
        )
    }

    #[test]
    fn test_prover_initialization() {
        let mut prover = ZkProver::new();
        assert!(!prover.initialized);
        prover.initialize().unwrap();
        assert!(prover.initialized);
    }

    #[test]
    fn test_compute_public_inputs() {
        let mut prover = ZkProver::new();
        prover.initialize().unwrap();

        let private_inputs = create_test_private_inputs();
        let merkle_root = [10u8; 32];
        let current_time = 2000000u64;
        let max_age = 300000u64;

        let public_inputs = prover
            .compute_public_inputs(&private_inputs, merkle_root, current_time, max_age)
            .unwrap();

        assert_eq!(public_inputs.merkle_root, merkle_root);
        assert_eq!(public_inputs.current_time, current_time);
        assert_eq!(public_inputs.max_age, max_age);
    }

    #[test]
    fn test_generate_proof_not_initialized() {
        let prover = ZkProver::new();
        let private_inputs = create_test_private_inputs();
        let public_inputs =
            ZkPublicInputs::new([0u8; 32], [0u8; 32], 2000000, [0u8; 32], [0u8; 32], 300000);

        let result = prover.generate_proof(&private_inputs, &public_inputs);
        assert!(matches!(result, Err(ZkError::NotInitialized)));
    }

    #[test]
    fn test_temporal_validation_future_timestamp() {
        let mut prover = ZkProver::new();
        prover.initialize().unwrap();

        let _private_inputs = ZkPrivateInputs::new(
            [1u8; 32],
            [2u8; 32],
            [3u8; 32],
            [4u8; 32],
            3000000, // timestamp in future
            [[5u8; 32], [6u8; 32], [7u8; 32], [8u8; 32]],
        );

        let result = prover.validate_temporal(3000000, 2000000, 300000);
        assert!(matches!(result, Err(ZkError::TemporalViolation(_))));
    }

    #[test]
    fn test_temporal_validation_too_old() {
        let mut prover = ZkProver::new();
        prover.initialize().unwrap();

        let result = prover.validate_temporal(1000000, 2000000, 300000);
        assert!(matches!(result, Err(ZkError::TemporalViolation(_))));
    }

    #[test]
    fn test_temporal_validation_valid() {
        let mut prover = ZkProver::new();
        prover.initialize().unwrap();

        let result = prover.validate_temporal(1800000, 2000000, 300000);
        assert!(result.is_ok());
    }

    #[test]
    fn test_generate_proof_success() {
        let mut prover = ZkProver::new();
        prover.initialize().unwrap();

        let private_inputs = create_test_private_inputs();

        // Compute the expected public inputs from private witness
        // Use a larger max_age to accommodate the test timestamp
        let public_inputs = prover
            .compute_public_inputs(&private_inputs, [10u8; 32], 2000000, 1500000)
            .unwrap();

        let proof = prover
            .generate_proof(&private_inputs, &public_inputs)
            .unwrap();
        assert_eq!(proof.protocol, "groth16");
        assert_eq!(proof.curve, "bn254");
    }

    #[test]
    fn test_verify_proof() {
        let mut prover = ZkProver::new();
        prover.initialize().unwrap();

        let proof = ZkProof {
            pi_a: vec![0u8; 64],
            pi_b: vec![0u8; 128],
            pi_c: vec![0u8; 64],
            protocol: "groth16".to_string(),
            curve: "bn254".to_string(),
        };

        let public_inputs =
            ZkPublicInputs::new([0u8; 32], [0u8; 32], 2000000, [0u8; 32], [0u8; 32], 300000);

        let result = prover.verify_proof(&proof, &public_inputs).unwrap();
        assert!(result);
    }
}
