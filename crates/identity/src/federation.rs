//! Federated identity management for H2OS fleet assets
//!
//! Provides trust-scored identity federation for external systems,
//! enabling AetherCore to consume H2OS fleet management data with
//! cryptographic attestation and trust verification.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;

use crate::{TrustPolicyTier, TrustReasonCode};

/// Trust level for federated identities based on attestation strength
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum TrustLevel {
    /// TPM/Secure Enclave bound, highest trust (1.0)
    HardwareAttested,
    /// H2OS source, schema validated (0.8)
    FederatedVerified,
    /// H2OS source, stale or validation warning (0.5)
    FederatedDegraded,
    /// Failed verification, data must be purged (0.0)
    Spoofed,
}

impl TrustLevel {
    /// Get numerical trust score for this level
    pub fn score(&self) -> f32 {
        match self {
            TrustLevel::HardwareAttested => 1.0,
            TrustLevel::FederatedVerified => 0.8,
            TrustLevel::FederatedDegraded => 0.5,
            TrustLevel::Spoofed => 0.0,
        }
    }

    /// Check if this trust level is acceptable for operations
    pub fn is_acceptable(&self) -> bool {
        !matches!(self, TrustLevel::Spoofed)
    }

    /// Compute trust level from attestation parameters
    pub fn from_attestation(
        has_hardware_binding: bool,
        schema_valid: bool,
        is_stale: bool,
    ) -> Self {
        if !schema_valid {
            return TrustLevel::Spoofed;
        }

        if has_hardware_binding {
            TrustLevel::HardwareAttested
        } else if is_stale {
            TrustLevel::FederatedDegraded
        } else {
            TrustLevel::FederatedVerified
        }
    }

    /// Compute trust level from evaluated device policy.
    pub fn from_policy(
        tier: TrustPolicyTier,
        reason_codes: &[TrustReasonCode],
        schema_valid: bool,
        is_stale: bool,
    ) -> Self {
        if !schema_valid {
            return TrustLevel::Spoofed;
        }
        if is_stale {
            return TrustLevel::FederatedDegraded;
        }
        if reason_codes.iter().any(|code| {
            matches!(
                code,
                TrustReasonCode::BootStateUnverified
                    | TrustReasonCode::BootloaderUnlocked
                    | TrustReasonCode::PatchLevelMissing
                    | TrustReasonCode::PatchLevelTooOld
            )
        }) {
            return TrustLevel::FederatedDegraded;
        }

        match tier {
            TrustPolicyTier::Highest | TrustPolicyTier::MediumHigh => TrustLevel::HardwareAttested,
            TrustPolicyTier::LowUnverified => TrustLevel::FederatedDegraded,
        }
    }
}

/// Federated identity representing an external H2OS identity
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FederatedIdentity {
    /// Unique identifier in the federated system (e.g., H2OS device ID)
    pub external_id: String,

    /// Source system identifier (e.g., "h2os")
    pub source_system: String,

    /// Current trust level
    pub trust_level: TrustLevel,

    /// Timestamp of last verification (Unix epoch milliseconds)
    pub last_verified: u64,

    /// Timestamp when identity was first ingested
    pub ingested_at: u64,

    /// Number of successful attestation verifications
    pub attestation_count: u64,

    /// Optional metadata from the federated system
    pub metadata: HashMap<String, String>,
}

impl FederatedIdentity {
    /// Create a new federated identity
    pub fn new(
        external_id: String,
        source_system: String,
        trust_level: TrustLevel,
        timestamp: u64,
    ) -> Self {
        Self {
            external_id,
            source_system,
            trust_level,
            last_verified: timestamp,
            ingested_at: timestamp,
            attestation_count: 0,
            metadata: HashMap::new(),
        }
    }

    /// Update trust level and verification timestamp
    pub fn update_trust(&mut self, trust_level: TrustLevel, timestamp: u64) {
        self.trust_level = trust_level;
        self.last_verified = timestamp;
        if trust_level.is_acceptable() {
            self.attestation_count += 1;
        }
    }

    /// Compute current trust score
    pub fn trust_score(&self) -> f32 {
        self.trust_level.score()
    }

    /// Check if identity is stale (not verified in staleness_threshold_ms)
    pub fn is_stale(&self, current_time_ms: u64, staleness_threshold_ms: u64) -> bool {
        current_time_ms.saturating_sub(self.last_verified) > staleness_threshold_ms
    }
}

/// Registry for managing federated identity mappings
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FederationRegistry {
    /// Map from external ID to federated identity
    identities: HashMap<String, FederatedIdentity>,

    /// Staleness threshold in milliseconds (default: 5 minutes)
    staleness_threshold_ms: u64,
}

impl FederationRegistry {
    /// Create a new federation registry
    pub fn new() -> Self {
        Self {
            identities: HashMap::new(),
            staleness_threshold_ms: 5 * 60 * 1000, // 5 minutes
        }
    }

    /// Create a registry with custom staleness threshold
    pub fn with_staleness_threshold(staleness_threshold_ms: u64) -> Self {
        Self {
            identities: HashMap::new(),
            staleness_threshold_ms,
        }
    }

    /// Register or update a federated identity
    pub fn register(
        &mut self,
        external_id: String,
        source_system: String,
        trust_level: TrustLevel,
        timestamp: u64,
    ) {
        if let Some(identity) = self.identities.get_mut(&external_id) {
            identity.update_trust(trust_level, timestamp);
        } else {
            let identity =
                FederatedIdentity::new(external_id.clone(), source_system, trust_level, timestamp);
            self.identities.insert(external_id, identity);
        }
    }

    /// Get a federated identity by external ID
    pub fn get(&self, external_id: &str) -> Option<&FederatedIdentity> {
        self.identities.get(external_id)
    }

    /// Get a mutable reference to a federated identity
    pub fn get_mut(&mut self, external_id: &str) -> Option<&mut FederatedIdentity> {
        self.identities.get_mut(external_id)
    }

    /// Remove a federated identity
    pub fn remove(&mut self, external_id: &str) -> Option<FederatedIdentity> {
        self.identities.remove(external_id)
    }

    /// Check staleness and degrade trust for stale identities
    pub fn update_staleness(&mut self, current_time_ms: u64) {
        for identity in self.identities.values_mut() {
            if identity.is_stale(current_time_ms, self.staleness_threshold_ms) {
                if identity.trust_level != TrustLevel::Spoofed {
                    identity.trust_level = TrustLevel::FederatedDegraded;
                }
            }
        }
    }

    /// Purge all spoofed identities
    pub fn purge_spoofed(&mut self) {
        self.identities
            .retain(|_, identity| identity.trust_level != TrustLevel::Spoofed);
    }

    /// Get count of identities by trust level
    pub fn count_by_trust_level(&self, level: TrustLevel) -> usize {
        self.identities
            .values()
            .filter(|i| i.trust_level == level)
            .count()
    }

    /// Get all identities
    pub fn all_identities(&self) -> impl Iterator<Item = &FederatedIdentity> {
        self.identities.values()
    }
}

impl Default for FederationRegistry {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_trust_level_scores() {
        assert_eq!(TrustLevel::HardwareAttested.score(), 1.0);
        assert_eq!(TrustLevel::FederatedVerified.score(), 0.8);
        assert_eq!(TrustLevel::FederatedDegraded.score(), 0.5);
        assert_eq!(TrustLevel::Spoofed.score(), 0.0);
    }

    #[test]
    fn test_trust_level_acceptable() {
        assert!(TrustLevel::HardwareAttested.is_acceptable());
        assert!(TrustLevel::FederatedVerified.is_acceptable());
        assert!(TrustLevel::FederatedDegraded.is_acceptable());
        assert!(!TrustLevel::Spoofed.is_acceptable());
    }

    #[test]
    fn test_trust_level_from_attestation() {
        assert_eq!(
            TrustLevel::from_attestation(true, true, false),
            TrustLevel::HardwareAttested
        );
        assert_eq!(
            TrustLevel::from_attestation(false, true, false),
            TrustLevel::FederatedVerified
        );
        assert_eq!(
            TrustLevel::from_attestation(false, true, true),
            TrustLevel::FederatedDegraded
        );
        assert_eq!(
            TrustLevel::from_attestation(false, false, false),
            TrustLevel::Spoofed
        );
    }

    #[test]
    fn test_trust_level_from_policy() {
        assert_eq!(
            TrustLevel::from_policy(TrustPolicyTier::Highest, &[], true, false),
            TrustLevel::HardwareAttested
        );
        assert_eq!(
            TrustLevel::from_policy(
                TrustPolicyTier::MediumHigh,
                &[TrustReasonCode::PatchLevelTooOld],
                true,
                false,
            ),
            TrustLevel::FederatedDegraded
        );
        assert_eq!(
            TrustLevel::from_policy(TrustPolicyTier::LowUnverified, &[], true, false),
            TrustLevel::FederatedDegraded
        );
        assert_eq!(
            TrustLevel::from_policy(TrustPolicyTier::Highest, &[], false, false),
            TrustLevel::Spoofed
        );
    }

    #[test]
    fn test_federated_identity_creation() {
        let identity = FederatedIdentity::new(
            "h2os-device-001".to_string(),
            "h2os".to_string(),
            TrustLevel::FederatedVerified,
            1000,
        );

        assert_eq!(identity.external_id, "h2os-device-001");
        assert_eq!(identity.source_system, "h2os");
        assert_eq!(identity.trust_level, TrustLevel::FederatedVerified);
        assert_eq!(identity.trust_score(), 0.8);
        assert_eq!(identity.attestation_count, 0);
    }

    #[test]
    fn test_federated_identity_update_trust() {
        let mut identity = FederatedIdentity::new(
            "test-001".to_string(),
            "h2os".to_string(),
            TrustLevel::FederatedDegraded,
            1000,
        );

        identity.update_trust(TrustLevel::FederatedVerified, 2000);
        assert_eq!(identity.trust_level, TrustLevel::FederatedVerified);
        assert_eq!(identity.last_verified, 2000);
        assert_eq!(identity.attestation_count, 1);
    }

    #[test]
    fn test_federated_identity_staleness() {
        let identity = FederatedIdentity::new(
            "test-001".to_string(),
            "h2os".to_string(),
            TrustLevel::FederatedVerified,
            1000,
        );

        assert!(!identity.is_stale(2000, 5000));
        assert!(identity.is_stale(10000, 5000));
    }

    #[test]
    fn test_federation_registry() {
        let mut registry = FederationRegistry::new();

        registry.register(
            "device-001".to_string(),
            "h2os".to_string(),
            TrustLevel::FederatedVerified,
            1000,
        );

        assert!(registry.get("device-001").is_some());
        assert_eq!(registry.get("device-001").unwrap().trust_score(), 0.8);
    }

    #[test]
    fn test_federation_registry_update_staleness() {
        let mut registry = FederationRegistry::with_staleness_threshold(5000);

        registry.register(
            "device-001".to_string(),
            "h2os".to_string(),
            TrustLevel::FederatedVerified,
            1000,
        );

        // Not stale yet
        registry.update_staleness(2000);
        assert_eq!(
            registry.get("device-001").unwrap().trust_level,
            TrustLevel::FederatedVerified
        );

        // Now stale
        registry.update_staleness(10000);
        assert_eq!(
            registry.get("device-001").unwrap().trust_level,
            TrustLevel::FederatedDegraded
        );
    }

    #[test]
    fn test_federation_registry_purge_spoofed() {
        let mut registry = FederationRegistry::new();

        registry.register(
            "good-device".to_string(),
            "h2os".to_string(),
            TrustLevel::FederatedVerified,
            1000,
        );
        registry.register(
            "bad-device".to_string(),
            "h2os".to_string(),
            TrustLevel::Spoofed,
            1000,
        );

        assert_eq!(registry.identities.len(), 2);
        registry.purge_spoofed();
        assert_eq!(registry.identities.len(), 1);
        assert!(registry.get("good-device").is_some());
        assert!(registry.get("bad-device").is_none());
    }

    #[test]
    fn test_federation_registry_count_by_trust_level() {
        let mut registry = FederationRegistry::new();

        registry.register(
            "dev1".to_string(),
            "h2os".to_string(),
            TrustLevel::FederatedVerified,
            1000,
        );
        registry.register(
            "dev2".to_string(),
            "h2os".to_string(),
            TrustLevel::FederatedVerified,
            1000,
        );
        registry.register(
            "dev3".to_string(),
            "h2os".to_string(),
            TrustLevel::FederatedDegraded,
            1000,
        );

        assert_eq!(
            registry.count_by_trust_level(TrustLevel::FederatedVerified),
            2
        );
        assert_eq!(
            registry.count_by_trust_level(TrustLevel::FederatedDegraded),
            1
        );
        assert_eq!(registry.count_by_trust_level(TrustLevel::Spoofed), 0);
    }
}
