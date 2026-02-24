//! Zero-Knowledge proof module for device attestation and location verification.
//!
//! This module provides ZK-SNARK capabilities for privacy-preserving authentication
//! and location proofs, ported from AuthynticOne TypeScript implementation.

pub mod error;
pub mod inputs;
pub mod poseidon;
pub mod prover;

pub use error::{ZkError, ZkResult};
pub use inputs::{ZkPrivateInputs, ZkProofParams, ZkPublicInputs};
pub use prover::{ZkProof, ZkProver, ZkProverTrait, ZkVerificationKey};
