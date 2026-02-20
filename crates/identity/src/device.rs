//! Device identity management with hardware-rooted attestation.
//!
//! Provides unique, cryptographically-bound identities for physical platforms.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use tracing::{debug, error, info, warn};

pub use crate::android_keystore::AndroidSecuritySignals;

const MIN_ACCEPTED_PATCH_LEVEL: (u32, u32) = (2024, 1);

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
    /// Android Keystore-backed attestation
    Android {
        /// Original challenge/nonce signed by the Android keystore key
        challenge: Vec<u8>,
        /// Signature over the challenge
        signature: Vec<u8>,
        /// Attesting public key
        public_key: Vec<u8>,
        /// Android key attestation certificate chain
        cert_chain: Vec<Vec<u8>>,
        /// Parsed Android security posture signals
        security_signals: AndroidSecuritySignals,
    },
    /// No attestation (testing only - never use in production)
    None,
}

/// Deterministic trust tier assigned by policy.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
pub enum TrustPolicyTier {
    /// StrongBox + verified boot + locked bootloader.
    Highest,
    /// Hardware-backed verified chain (TPM/TEE).
    MediumHigh,
    /// Software-only or policy gate failed.
    LowUnverified,
}

/// Machine-readable reasons emitted by trust policy evaluation.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum TrustReasonCode {
    StrongboxVerifiedBootLockedBootloader,
    TeeVerifiedChain,
    TpmVerifiedChain,
    SoftwareOnlyAttestation,
    UnverifiableAttestation,
    BootStateUnverified,
    BootloaderUnlocked,
    PatchLevelMissing,
    PatchLevelTooOld,
}

/// Structured policy result used across trust evaluators.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct TrustPolicyDecision {
    pub verified: bool,
    pub trust_score: f64,
    pub tier: TrustPolicyTier,
    pub reason_codes: Vec<TrustReasonCode>,
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
    /// Deterministic policy tier.
    pub policy_tier: TrustPolicyTier,
    /// Machine-readable policy reason codes.
    pub reason_codes: Vec<TrustReasonCode>,
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
    #[tracing::instrument(skip(self, identity), fields(identity_id = %identity.id))]
    pub fn register(&mut self, identity: PlatformIdentity) -> crate::Result<()> {
        debug!("Registering new identity");

        if self.identities.contains_key(&identity.id) {
            warn!("Attempted to register duplicate identity");
            return Err(crate::Error::Identity(
                "Identity already registered".to_string(),
            ));
        }

        // Basic validation
        if identity.public_key.is_empty() {
            error!("Identity registration failed: empty public key");
            return Err(crate::Error::Identity(
                "Public key cannot be empty".to_string(),
            ));
        }

        self.identities.insert(identity.id.clone(), identity);
        info!("Identity registered successfully");
        Ok(())
    }

    /// Get an identity by ID.
    pub fn get(&self, id: &str) -> Option<&PlatformIdentity> {
        self.identities.get(id)
    }

    /// Verify an identity.
    #[tracing::instrument(skip(self, identity), fields(identity_id = %identity.id))]
    pub fn verify(&self, identity: &PlatformIdentity) -> IdentityVerification {
        debug!("Verifying identity");
        let now = current_timestamp();

        // Check if revoked
        if self.revoked.contains(&identity.id) {
            warn!("Identity verification failed: revoked");
            return IdentityVerification {
                verified: false,
                identity: identity.clone(),
                trust_score: 0.0,
                verified_at: now,
                details: "Identity has been revoked".to_string(),
                policy_tier: TrustPolicyTier::LowUnverified,
                reason_codes: vec![TrustReasonCode::UnverifiableAttestation],
            };
        }

        let policy = evaluate_trust_policy(identity);
        let details = format!(
            "tier={:?}; reasons={:?}",
            policy.tier, policy.reason_codes
        );

        info!(
            verified = policy.verified,
            trust_score = policy.trust_score,
            "Identity verification complete"
        );
        IdentityVerification {
            verified: policy.verified,
            identity: identity.clone(),
            trust_score: policy.trust_score,
            verified_at: now,
            details,
            policy_tier: policy.tier,
            reason_codes: policy.reason_codes,
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

fn parse_patch_level(patch: &str) -> Option<(u32, u32)> {
    let mut parts = patch.split('-');
    let year = parts.next()?.parse::<u32>().ok()?;
    let month = parts.next()?.parse::<u32>().ok()?;
    if (1..=12).contains(&month) {
        Some((year, month))
    } else {
        None
    }
}

fn patch_level_meets_minimum(patch: Option<&str>) -> Result<bool, TrustReasonCode> {
    let Some(patch) = patch else {
        return Err(TrustReasonCode::PatchLevelMissing);
    };
    let Some(parsed) = parse_patch_level(patch) else {
        return Err(TrustReasonCode::PatchLevelMissing);
    };

    Ok(parsed >= MIN_ACCEPTED_PATCH_LEVEL)
}

fn is_verified_boot_state(state: Option<&str>) -> bool {
    matches!(
        state.map(|s| s.to_ascii_lowercase()),
        Some(ref s) if s == "green" || s == "verified"
    )
}

/// Evaluate deterministic trust policy tiers and constraints.
pub fn evaluate_trust_policy(identity: &PlatformIdentity) -> TrustPolicyDecision {
    match &identity.attestation {
        Attestation::Android {
            security_signals, ..
        } => {
            let mut reasons = Vec::new();
            let verified_boot = is_verified_boot_state(Some(&security_signals.verified_boot_state));
            if !verified_boot {
                reasons.push(TrustReasonCode::BootStateUnverified);
            }

            let bootloader_locked = security_signals
                .extra
                .get("bootloader_locked")
                .map(|v| v == "true")
                .unwrap_or(security_signals.device_locked);
            if !bootloader_locked {
                reasons.push(TrustReasonCode::BootloaderUnlocked);
            }

            let patch_ok = match patch_level_meets_minimum(Some(&security_signals.os_patch_level)) {
                Ok(ok) => ok,
                Err(code) => {
                    reasons.push(code);
                    false
                }
            };
            if !patch_ok && !reasons.contains(&TrustReasonCode::PatchLevelMissing) {
                reasons.push(TrustReasonCode::PatchLevelTooOld);
            }

            if !verified_boot || !bootloader_locked || !patch_ok {
                return TrustPolicyDecision {
                    verified: false,
                    trust_score: 0.2,
                    tier: TrustPolicyTier::LowUnverified,
                    reason_codes: reasons,
                };
            }

            let level = security_signals.security_level.to_ascii_lowercase();
            if level.contains("strongbox") {
                reasons.push(TrustReasonCode::StrongboxVerifiedBootLockedBootloader);
                TrustPolicyDecision {
                    verified: true,
                    trust_score: 1.0,
                    tier: TrustPolicyTier::Highest,
                    reason_codes: reasons,
                }
            } else if level.contains("trusted_environment") || level.contains("tee") {
                reasons.push(TrustReasonCode::TeeVerifiedChain);
                TrustPolicyDecision {
                    verified: true,
                    trust_score: 0.85,
                    tier: TrustPolicyTier::MediumHigh,
                    reason_codes: reasons,
                }
            } else {
                reasons.push(TrustReasonCode::UnverifiableAttestation);
                TrustPolicyDecision {
                    verified: false,
                    trust_score: 0.2,
                    tier: TrustPolicyTier::LowUnverified,
                    reason_codes: reasons,
                }
            }
        }
        Attestation::Tpm { .. } => {
            let mut reasons = Vec::new();
            let verified_boot = is_verified_boot_state(identity.metadata.get("boot_state").map(String::as_str));
            if !verified_boot {
                reasons.push(TrustReasonCode::BootStateUnverified);
            }

            let bootloader_locked = identity
                .metadata
                .get("bootloader_locked")
                .map(|v| v == "true")
                .unwrap_or(true);
            if !bootloader_locked {
                reasons.push(TrustReasonCode::BootloaderUnlocked);
            }

            let patch_ok = match patch_level_meets_minimum(identity.metadata.get("patch_level").map(String::as_str)) {
                Ok(ok) => ok,
                Err(code) => {
                    reasons.push(code);
                    false
                }
            };
            if !patch_ok && !reasons.contains(&TrustReasonCode::PatchLevelMissing) {
                reasons.push(TrustReasonCode::PatchLevelTooOld);
            }

            if verified_boot && bootloader_locked && patch_ok {
                reasons.push(TrustReasonCode::TpmVerifiedChain);
                TrustPolicyDecision {
                    verified: true,
                    trust_score: 0.9,
                    tier: TrustPolicyTier::MediumHigh,
                    reason_codes: reasons,
                }
            } else {
                TrustPolicyDecision {
                    verified: false,
                    trust_score: 0.2,
                    tier: TrustPolicyTier::LowUnverified,
                    reason_codes: reasons,
                }
            }
        }
        Attestation::Software { .. } => TrustPolicyDecision {
            verified: false,
            trust_score: 0.2,
            tier: TrustPolicyTier::LowUnverified,
            reason_codes: vec![TrustReasonCode::SoftwareOnlyAttestation],
        },
        Attestation::None => TrustPolicyDecision {
            verified: false,
            trust_score: 0.0,
            tier: TrustPolicyTier::LowUnverified,
            reason_codes: vec![TrustReasonCode::UnverifiableAttestation],
        },
    }
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

        assert!(!verification.verified);
        assert_eq!(verification.trust_score, 0.2);
        assert_eq!(verification.policy_tier, TrustPolicyTier::LowUnverified);
        assert_eq!(
            verification.reason_codes,
            vec![TrustReasonCode::SoftwareOnlyAttestation]
        );
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
        let mut metadata = HashMap::new();
        metadata.insert("boot_state".to_string(), "green".to_string());
        metadata.insert("bootloader_locked".to_string(), "true".to_string());
        metadata.insert("patch_level".to_string(), "2024-02".to_string());
        let identity = PlatformIdentity {
            id: "test-1".to_string(),
            public_key: vec![1, 2, 3, 4],
            attestation: Attestation::Tpm {
                quote: vec![1, 2, 3],
                pcrs: vec![4, 5, 6],
                ak_cert: vec![7, 8, 9],
            },
            created_at: 1000,
            metadata,
        };

        let verification = manager.verify(&identity);

        assert!(verification.verified);
        assert_eq!(verification.trust_score, 0.9);
        assert_eq!(verification.policy_tier, TrustPolicyTier::MediumHigh);
        assert_eq!(
            verification.reason_codes,
            vec![TrustReasonCode::TpmVerifiedChain]
        );
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

    #[test]
    fn test_trust_policy_mapping_outcomes() {
        let mut strongbox_extra = HashMap::new();
        strongbox_extra.insert("bootloader_locked".to_string(), "true".to_string());

        let strongbox_identity = PlatformIdentity {
            id: "android-map-strongbox".to_string(),
            public_key: vec![1],
            attestation: Attestation::Android {
                challenge: vec![1],
                signature: vec![2],
                public_key: vec![3],
                cert_chain: vec![vec![4]],
                security_signals: AndroidSecuritySignals {
                    api_level: 34,
                    verified_boot_state: "green".to_string(),
                    device_locked: true,
                    os_patch_level: "2024-04".to_string(),
                    security_level: "strongbox".to_string(),
                    extra: strongbox_extra,
                },
            },
            created_at: 0,
            metadata: HashMap::new(),
        };

        let tee_identity = PlatformIdentity {
            id: "android-map-tee".to_string(),
            public_key: vec![1],
            attestation: Attestation::Android {
                challenge: vec![1],
                signature: vec![2],
                public_key: vec![3],
                cert_chain: vec![vec![4]],
                security_signals: AndroidSecuritySignals {
                    api_level: 34,
                    verified_boot_state: "green".to_string(),
                    device_locked: true,
                    os_patch_level: "2024-04".to_string(),
                    security_level: "trusted_environment".to_string(),
                    extra: HashMap::new(),
                },
            },
            created_at: 0,
            metadata: HashMap::new(),
        };

        let software_identity = PlatformIdentity {
            id: "software-map".to_string(),
            public_key: vec![1],
            attestation: Attestation::Software {
                certificate: vec![5],
            },
            created_at: 0,
            metadata: HashMap::new(),
        };

        let strongbox_policy = evaluate_trust_policy(&strongbox_identity);
        let tee_policy = evaluate_trust_policy(&tee_identity);
        let software_policy = evaluate_trust_policy(&software_identity);

        assert_eq!(strongbox_policy.tier, TrustPolicyTier::Highest);
        assert_eq!(tee_policy.tier, TrustPolicyTier::MediumHigh);
        assert_eq!(software_policy.tier, TrustPolicyTier::LowUnverified);
        assert!(strongbox_policy
            .reason_codes
            .contains(&TrustReasonCode::StrongboxVerifiedBootLockedBootloader));
        assert!(tee_policy
            .reason_codes
            .contains(&TrustReasonCode::TeeVerifiedChain));
        assert!(software_policy
            .reason_codes
            .contains(&TrustReasonCode::SoftwareOnlyAttestation));
    }

    #[test]
    fn test_policy_tier_strongbox_highest() {
        let manager = IdentityManager::new();
        let mut extra = HashMap::new();
        extra.insert("bootloader_locked".to_string(), "true".to_string());
        let identity = PlatformIdentity {
            id: "android-1".to_string(),
            public_key: vec![1, 2, 3, 4],
            attestation: Attestation::Android {
                challenge: vec![1],
                signature: vec![2],
                public_key: vec![3],
                cert_chain: vec![vec![4]],
                security_signals: AndroidSecuritySignals {
                    api_level: 34,
                    verified_boot_state: "green".to_string(),
                    device_locked: true,
                    os_patch_level: "2024-03".to_string(),
                    security_level: "strongbox".to_string(),
                    extra,
                },
            },
            created_at: 1000,
            metadata: HashMap::new(),
        };

        let verification = manager.verify(&identity);
        assert!(verification.verified);
        assert_eq!(verification.policy_tier, TrustPolicyTier::Highest);
        assert!(verification
            .reason_codes
            .contains(&TrustReasonCode::StrongboxVerifiedBootLockedBootloader));
    }

    #[test]
    fn test_policy_tier_tee_medium_high() {
        let manager = IdentityManager::new();
        let identity = PlatformIdentity {
            id: "android-tee".to_string(),
            public_key: vec![1, 2, 3, 4],
            attestation: Attestation::Android {
                challenge: vec![1],
                signature: vec![2],
                public_key: vec![3],
                cert_chain: vec![vec![4]],
                security_signals: AndroidSecuritySignals {
                    api_level: 34,
                    verified_boot_state: "verified".to_string(),
                    device_locked: true,
                    os_patch_level: "2024-03".to_string(),
                    security_level: "trusted_environment".to_string(),
                    extra: HashMap::new(),
                },
            },
            created_at: 1000,
            metadata: HashMap::new(),
        };

        let verification = manager.verify(&identity);
        assert!(verification.verified);
        assert_eq!(verification.policy_tier, TrustPolicyTier::MediumHigh);
        assert!(verification
            .reason_codes
            .contains(&TrustReasonCode::TeeVerifiedChain));
    }

    #[test]
    fn test_policy_gates_boot_and_patch() {
        let manager = IdentityManager::new();
        let identity = PlatformIdentity {
            id: "android-fail".to_string(),
            public_key: vec![1, 2, 3, 4],
            attestation: Attestation::Android {
                challenge: vec![1],
                signature: vec![2],
                public_key: vec![3],
                cert_chain: vec![vec![4]],
                security_signals: AndroidSecuritySignals {
                    api_level: 34,
                    verified_boot_state: "orange".to_string(),
                    device_locked: false,
                    os_patch_level: "2023-12".to_string(),
                    security_level: "strongbox".to_string(),
                    extra: HashMap::new(),
                },
            },
            created_at: 1000,
            metadata: HashMap::new(),
        };

        let verification = manager.verify(&identity);
        assert!(!verification.verified);
        assert_eq!(verification.policy_tier, TrustPolicyTier::LowUnverified);
        assert!(verification
            .reason_codes
            .contains(&TrustReasonCode::BootStateUnverified));
        assert!(verification
            .reason_codes
            .contains(&TrustReasonCode::BootloaderUnlocked));
        assert!(verification
            .reason_codes
            .contains(&TrustReasonCode::PatchLevelTooOld));
    }
}
