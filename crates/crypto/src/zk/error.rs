//! Error types for Zero-Knowledge proof operations.

use thiserror::Error;

/// Result type for ZK operations
pub type ZkResult<T> = std::result::Result<T, ZkError>;

/// Error types for Zero-Knowledge proof operations
#[derive(Error, Debug, Clone)]
pub enum ZkError {
    /// Prover system not initialized
    #[error("ZK prover not initialized")]
    NotInitialized,

    /// Proving key not found
    #[error("Proving key not found: {0}")]
    ProvingKeyNotFound(String),

    /// Verification key not found
    #[error("Verification key not found: {0}")]
    VerificationKeyNotFound(String),

    /// Temporal constraint violated
    #[error("Temporal violation: {0}")]
    TemporalViolation(String),

    /// Commitment mismatch
    #[error("Commitment mismatch: {0}")]
    CommitmentMismatch(String),

    /// Proof generation failed
    #[error("Proof generation failed: {0}")]
    ProofGenerationFailed(String),

    /// Proof verification failed
    #[error("Verification failed: {0}")]
    VerificationFailed(String),

    /// Invalid input
    #[error("Invalid input: {0}")]
    InvalidInput(String),

    /// Hash computation error
    #[error("Hash error: {0}")]
    HashError(String),
}
