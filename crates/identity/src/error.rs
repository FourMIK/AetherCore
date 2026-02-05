//! Error types for AetherCore Identity operations.
//!
//! This module provides comprehensive error handling for identity management,
//! attestation, enrollment, and PKI operations.

use thiserror::Error;

/// Errors that can occur in identity operations.
#[derive(Debug, Error)]
pub enum IdentityError {
    /// Enrollment-related errors
    #[error("Enrollment error: {0}")]
    Enrollment(#[from] crate::enrollment_state::EnrollmentError),

    /// Attestation errors
    #[error("Attestation failed: {0}")]
    Attestation(String),

    /// Platform identity errors
    #[error("Platform identity error: {0}")]
    PlatformIdentity(String),

    /// Device binding errors
    #[error("Device binding error: {0}")]
    DeviceBinding(String),

    /// TPM-related errors
    #[error("TPM error: {0}")]
    Tpm(String),

    /// Certificate Authority errors
    #[error("CA error: {0}")]
    CertificateAuthority(String),

    /// Certificate validation errors
    #[error("Certificate validation failed: {0}")]
    CertificateValidation(String),

    /// Trust chain validation errors
    #[error("Trust chain validation failed: {0}")]
    TrustChainValidation(String),

    /// Federation errors
    #[error("Federation error: {0}")]
    Federation(String),

    /// Genesis bundle errors
    #[error("Genesis bundle error: {0}")]
    GenesisBundle(String),

    /// Signature verification failed
    #[error("Signature verification failed: {0}")]
    SignatureVerification(String),

    /// Key not found
    #[error("Key not found: {key_id}")]
    KeyNotFound { key_id: String },

    /// Identity already exists
    #[error("Identity already exists: {identity_id}")]
    IdentityExists { identity_id: String },

    /// Identity not found
    #[error("Identity not found: {identity_id}")]
    IdentityNotFound { identity_id: String },

    /// Cryptographic errors
    #[error("Cryptographic error: {0}")]
    Crypto(String),

    /// Serialization errors
    #[error("Serialization error: {0}")]
    Serialization(#[from] serde_json::Error),

    /// I/O errors
    #[error("I/O error: {0}")]
    Io(#[from] std::io::Error),

    /// Core errors
    #[error("Core error: {0}")]
    Core(#[from] aethercore_core::Error),

    /// Invalid state
    #[error("Invalid state: {0}")]
    InvalidState(String),

    /// Configuration error
    #[error("Configuration error: {0}")]
    Config(String),
}

/// Result type for identity operations.
pub type IdentityResult<T> = Result<T, IdentityError>;
