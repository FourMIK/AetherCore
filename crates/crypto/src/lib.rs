//! Cryptographic primitives and operations for the Fourmik (4MIK) system.
//!
//! This crate provides the cryptographic foundation for the 4MIK trust stack,
//! including signing, verification, hashing, and key management. All cryptographic
//! operations follow vetted algorithms and established security best practices.
//!
//! # Core Capabilities
//!
//! - **Digital Signatures**: Sign and verify messages and data
//! - **Hash Functions**: Cryptographic hashing for integrity and provenance
//! - **Key Management**: Secure generation, storage, and rotation of keys
//! - **Message Authentication**: HMAC and authenticated encryption
//! - **Session Cipher Rotation**: Ephemeral key exchange and session encryption
//!
//! # Supported Algorithms
//!
//! Prefer these vetted algorithms (extend as needed):
//! - **Signatures**: Ed25519, ECDSA (P-256, secp256k1), RSA-PSS
//! - **Hashing**: BLAKE3 (exclusively for all integrity checks)
//! - **Encryption**: ChaCha20-Poly1305, AES-GCM
//! - **Key Exchange**: X25519 (Diffie-Hellman)
//!
//! # Security Principles
//!
//! - Never roll custom cryptographic primitives
//! - All critical messages must be signed
//! - All signatures must be verified before trust
//! - Secrets must never be logged or hardcoded
//! - Use constant-time operations where applicable
//! - Ephemeral keys are rotated periodically and zeroized after use
//!
//! # Integration Points
//!
//! ## CodeRalphie Integration
//! - Cryptographic verification endpoints for external systems
//! - Key distribution and public key infrastructure (PKI) support
//! - Signature validation for cross-domain data exchanges

pub mod chain;
pub mod session;
pub mod signing;
pub mod zk;

#[cfg(feature = "grpc-server")]
pub mod grpc_server;

#[cfg(test)]
mod test_vectors;

pub use chain::{
    compute_event_hash, compute_pointer, verify_chain, Blake3Hash, ChainError, ChainManager,
    ChainMetrics, ChainProof, ChainedEvent, VerifyResult, GENESIS_HASH,
};

pub use session::{
    KeyExchangeMessage, SessionCipher, SessionError, SessionKeyPair, SessionManager, SessionResult,
};

pub use signing::{
    CanonicalEvent, EventSigningService, SignatureResult, SigningError, SigningMetrics,
};

pub use zk::{
    ZkError, ZkPrivateInputs, ZkProof, ZkProofParams, ZkProver, ZkProverTrait, ZkPublicInputs,
    ZkVerificationKey,
};

#[cfg(feature = "grpc-server")]
pub use grpc_server::{start_grpc_server as start_signing_grpc_server, SigningServiceImpl};

#[cfg(test)]
mod tests {
    #[test]
    fn it_works() {
        assert_eq!(2 + 2, 4);
    }
}
