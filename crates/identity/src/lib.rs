//! Identity management and authentication for the Fourmik (4MIK) system.
//!
//! This crate provides hardware-rooted identity primitives, attestation mechanisms,
//! and identity binding for all platforms, sensors, and logical actors in the 4MIK
//! network. Every signal and command in the system must be bound to a verifiable
//! identity to prevent spoofing and ensure trusted decision-making.
//!
//! # Core Concepts
//!
//! - **Platform Identity**: Unique, attestable identifiers for physical platforms
//! - **Identity Binding**: Cryptographic binding of signals to platform identities
//! - **Attestation**: Hardware-rooted proof of identity and platform state
//! - **Identity Lifecycle**: Creation, renewal, and revocation of identities
//!
//! # Security Model
//!
//! All identity operations must be:
//! - Hardware-rooted where possible (TPM, secure enclaves, HSM)
//! - Cryptographically verifiable
//! - Auditable and logged
//! - Resistant to replay and spoofing attacks
//!
//! # Integration Points
//!
//! ## CodeRalphie Integration
//! - Identity verification endpoints for external actors
//! - Identity enrollment and lifecycle management APIs
//! - Audit logging and identity event streaming

pub mod attestation;
pub mod device;
pub mod federation;
pub mod materia_slot;
pub mod pki;
pub mod tpm;

pub use attestation::{
    AttestationFinalize, AttestationManager, AttestationRequest, AttestationResponse,
    AttestationResult, HandshakeState, PROTOCOL_VERSION,
};
pub use device::{Attestation, IdentityManager, IdentityVerification, PlatformIdentity};
pub use federation::{FederatedIdentity, FederationRegistry, TrustLevel};
pub use materia_slot::{FederatedMateriaSlot, Materia, MateriaSlot};
pub use pki::{Certificate, CertificateAuthority, CertificateRequest, TrustChainValidator};
pub use tpm::{AttestationKey, PcrValue, TpmManager, TpmQuote};

// Re-export core types for convenience
pub use aethercore_core::{Error, Result};

#[cfg(test)]
mod tests {
    #[test]
    fn it_works() {
        assert_eq!(2 + 2, 4);
    }
}
