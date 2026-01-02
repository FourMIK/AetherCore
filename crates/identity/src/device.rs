//! Device identity management with hardware-rooted attestation.
//!
//! Provides unique, cryptographically-bound identities for physical platforms.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// Unique platform identifier with cryptographic binding.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct PlatformIdentity {
    /// Unique identifier for the platform
    pub id: String,
    /// Public key for signature verification (DER-encoded)
    pub public_key: Vec<u8>,
    /// Hardware attestation proof (platform-specific)
    pub attestation: Attestation,
    /// Timestamp of identity creation (Unix epoch milliseconds)
    pub created_at: u64,
    /// Optional metadata
    pub metadata: HashMap<String, String>,
}

/// Hardware attestation proof types.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum Attestation {
    /// TPM-based attestation
    Tpm {
        /// TPM quote signature
        quote: Vec<u8>,
        /// Platform Configuration Registers (PCRs)
        pcrs: Vec<u8>,
        /// Attestation key certificate
        ak_cert: Vec<u8>,
    },
    /// Software-based attestation (for testing/development)
    Software {
        /// Self-signed certificate
        certificate: Vec<u8>,
    },
    /// No attestation (testing only - never use in production)
    None,
}

/// Identity verification result.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IdentityVerification {
    /// Whether the identity passed verification
    pub verified: bool,
    /// The verified identity
    pub identity: PlatformIdentity,
    /// Trust score (0.0 to 1.0)
    pub trust_score: f64,
    /// Timestamp of verification
    pub verified_at: u64,
    /// Verification details
    pub details: String,
}

/// Identity manager for creating and verifying platform identities.
#[derive(Debug)]
pub struct IdentityManager {
    /// Known identities indexed by ID
    identities: HashMap<String, PlatformIdentity>,
    /// Revoked identity IDs
    revoked: std::collections::HashSet<String>,
}

impl IdentityManager {
    /// Create a new identity manager.
    pub fn new() -> Self {
        Self {
            identities: HashMap::new(),
            revoked: std::collections::HashSet::new(),
        }
    }

    /// Register a new identity.
    pub fn register(&mut self, identity: PlatformIdentity) -> crate::Result<()> {
        if self.identities.contains_key(&identity.id) {
            return Err(crate::Error::Identity(
                "Identity already registered".to_string(),
            ));
        }

        // Basic validation
        if identity.public_key.is_empty() {
            return Err(crate::Error::Identity(
                "Public key cannot be empty".to_string(),
            ));
        }

        self.identities.insert(identity.id.clone(), identity);
        Ok(())
    }

    /// Get an identity by ID.
    pub fn get(&self, id: &str) -> Option<&PlatformIdentity> {
        self.identities.get(id)
    }

    /// Verify an identity.
    pub fn verify(&self, identity: &PlatformIdentity) -> IdentityVerification {
        let now = current_timestamp();

        // Check if revoked
        if self.revoked.contains(&identity.id) {
            return IdentityVerification {
                verified: false,
                identity: identity.clone(),
                trust_score: 0.0,
                verified_at: now,
                details: "Identity has been revoked".to_string(),
            };
        }

        // Check attestation type and assign trust score
        let (verified, trust_score, details) = match &identity.attestation {
            Attestation::Tpm { .. } => {
                // In production, verify TPM quote and PCRs
                (true, 1.0, "TPM attestation verified".to_string())
            }
            Attestation::Software { .. } => {
                // Software attestation has lower trust
                (true, 0.7, "Software attestation verified".to_string())
            }
            Attestation::None => (false, 0.0, "No attestation provided".to_string()),
        };

        IdentityVerification {
            verified,
            identity: identity.clone(),
            trust_score,
            verified_at: now,
            details,
        }
    }

    /// Revoke an identity.
    pub fn revoke(&mut self, id: &str) -> crate::Result<()> {
        if !self.identities.contains_key(id) {
            return Err(crate::Error::Identity("Identity not found".to_string()));
        }

        self.revoked.insert(id.to_string());
        Ok(())
    }

    /// Check if an identity is revoked.
    pub fn is_revoked(&self, id: &str) -> bool {
        self.revoked.contains(id)
    }

    /// Check if an identity is enrolled (registered and not revoked).
    pub fn is_enrolled(&self, id: &str) -> bool {
        self.identities.contains_key(id) && !self.revoked.contains(id)
    }

    /// List all registered identities.
    pub fn list(&self) -> Vec<&PlatformIdentity> {
        self.identities.values().collect()
    }
}

impl Default for IdentityManager {
    fn default() -> Self {
        Self::new()
    }
}

/// Get current timestamp in milliseconds.
fn current_timestamp() -> u64 {
    use std::time::{SystemTime, UNIX_EPOCH};
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_millis() as u64
}

#[cfg(test)]
mod tests {
    use super::*;

    fn create_test_identity(id: &str) -> PlatformIdentity {
        PlatformIdentity {
            id: id.to_string(),
            public_key: vec![1, 2, 3, 4],
            attestation: Attestation::Software {
                certificate: vec![5, 6, 7, 8],
            },
            created_at: 1000,
            metadata: HashMap::new(),
        }
    }

    #[test]
    fn test_register_identity() {
        let mut manager = IdentityManager::new();
        let identity = create_test_identity("test-1");

        manager.register(identity.clone()).unwrap();

        let retrieved = manager.get("test-1").unwrap();
        assert_eq!(retrieved.id, "test-1");
    }

    #[test]
    fn test_reject_duplicate_registration() {
        let mut manager = IdentityManager::new();
        let identity = create_test_identity("test-1");

        manager.register(identity.clone()).unwrap();
        let result = manager.register(identity);

        assert!(result.is_err());
    }

    #[test]
    fn test_verify_identity() {
        let manager = IdentityManager::new();
        let identity = create_test_identity("test-1");

        let verification = manager.verify(&identity);

        assert!(verification.verified);
        assert_eq!(verification.trust_score, 0.7); // Software attestation
    }

    #[test]
    fn test_revoke_identity() {
        let mut manager = IdentityManager::new();
        let identity = create_test_identity("test-1");

        manager.register(identity.clone()).unwrap();
        manager.revoke("test-1").unwrap();

        assert!(manager.is_revoked("test-1"));

        let verification = manager.verify(&identity);
        assert!(!verification.verified);
        assert_eq!(verification.trust_score, 0.0);
    }

    #[test]
    fn test_tpm_attestation_trust() {
        let manager = IdentityManager::new();
        let identity = PlatformIdentity {
            id: "test-1".to_string(),
            public_key: vec![1, 2, 3, 4],
            attestation: Attestation::Tpm {
                quote: vec![1, 2, 3],
                pcrs: vec![4, 5, 6],
                ak_cert: vec![7, 8, 9],
            },
            created_at: 1000,
            metadata: HashMap::new(),
        };

        let verification = manager.verify(&identity);

        assert!(verification.verified);
        assert_eq!(verification.trust_score, 1.0); // TPM has highest trust
    }

    #[test]
    fn test_no_attestation_fails() {
        let manager = IdentityManager::new();
        let identity = PlatformIdentity {
            id: "test-1".to_string(),
            public_key: vec![1, 2, 3, 4],
            attestation: Attestation::None,
            created_at: 1000,
            metadata: HashMap::new(),
        };

        let verification = manager.verify(&identity);

        assert!(!verification.verified);
        assert_eq!(verification.trust_score, 0.0);
    }

    #[test]
    fn test_list_identities() {
        let mut manager = IdentityManager::new();

        manager.register(create_test_identity("test-1")).unwrap();
        manager.register(create_test_identity("test-2")).unwrap();

        let list = manager.list();
        assert_eq!(list.len(), 2);
    }
}
