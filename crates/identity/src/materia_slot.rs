//! Materia Slot - Generic wrapper for attested assets
//!
//! Provides a generic abstraction for wrapping assets with cryptographic
//! attestation, enabling trust-scored data from federated sources.

use serde::{Deserialize, Serialize};

/// Materia trait for attested assets
///
/// All assets that can be attested must implement this trait to provide
/// cryptographic verification and trust scoring.
pub trait Materia {
    /// Attest the asset with cryptographic binding
    fn attest(&mut self, signature: Vec<u8>, timestamp: u64);

    /// Verify the attestation of this asset
    fn verify(&self) -> bool;

    /// Get the trust score for this asset
    fn trust_score(&self) -> f32;
}

/// Generic wrapper for attested assets
///
/// MateriaSlot wraps any asset type T with attestation metadata,
/// providing cryptographic binding and trust scoring.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MateriaSlot<T> {
    /// The wrapped asset
    pub asset: T,

    /// Cryptographic signature over asset hash
    pub signature: Vec<u8>,

    /// BLAKE3 hash of previous event in chain
    pub prev_hash: Vec<u8>,

    /// BLAKE3 hash of this asset
    pub hash: Vec<u8>,

    /// Trust score (0.0 to 1.0)
    pub trust_score: f32,

    /// Timestamp of attestation (Unix epoch milliseconds)
    pub attested_at: u64,
}

impl<T> MateriaSlot<T>
where
    T: Serialize,
{
    /// Create a new MateriaSlot wrapping an asset
    pub fn new(asset: T, prev_hash: Vec<u8>, trust_score: f32, timestamp: u64) -> Self {
        Self {
            asset,
            signature: Vec::new(),
            prev_hash,
            hash: Vec::new(),
            trust_score: trust_score.clamp(0.0, 1.0),
            attested_at: timestamp,
        }
    }

    /// Compute BLAKE3 hash of the asset
    pub fn compute_hash(&self) -> Result<Vec<u8>, String> {
        let json = serde_json::to_string(&self.asset)
            .map_err(|e| format!("Failed to serialize asset: {}", e))?;
        let hash = blake3::hash(json.as_bytes());
        Ok(hash.as_bytes().to_vec())
    }

    /// Set the hash field after computing it
    pub fn set_hash(&mut self, hash: Vec<u8>) {
        self.hash = hash;
    }

    /// Verify that the stored hash matches the computed hash
    pub fn verify_hash(&self) -> bool {
        match self.compute_hash() {
            Ok(computed) => computed == self.hash,
            Err(_) => false,
        }
    }
}

impl<T> Materia for MateriaSlot<T>
where
    T: Serialize,
{
    fn attest(&mut self, signature: Vec<u8>, timestamp: u64) {
        self.signature = signature;
        self.attested_at = timestamp;
    }

    fn verify(&self) -> bool {
        // Basic verification: hash must be valid and signature must be present
        !self.signature.is_empty() && self.verify_hash()
    }

    fn trust_score(&self) -> f32 {
        self.trust_score
    }
}

/// Federated Materia Slot for H2OS-originated assets
///
/// Extends MateriaSlot with federation-specific metadata for tracking
/// the source system and external identity.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FederatedMateriaSlot<T> {
    /// The base materia slot
    pub slot: MateriaSlot<T>,

    /// External ID in the federated system
    pub external_id: String,

    /// Source system identifier (e.g., "h2os")
    pub source_system: String,

    /// Federation timestamp (when ingested from external system)
    pub federated_at: u64,
}

impl<T> FederatedMateriaSlot<T>
where
    T: Serialize,
{
    /// Create a new FederatedMateriaSlot
    pub fn new(
        asset: T,
        external_id: String,
        source_system: String,
        prev_hash: Vec<u8>,
        trust_score: f32,
        timestamp: u64,
    ) -> Self {
        Self {
            slot: MateriaSlot::new(asset, prev_hash, trust_score, timestamp),
            external_id,
            source_system,
            federated_at: timestamp,
        }
    }

    /// Get the wrapped asset
    pub fn asset(&self) -> &T {
        &self.slot.asset
    }

    /// Get mutable reference to the wrapped asset
    pub fn asset_mut(&mut self) -> &mut T {
        &mut self.slot.asset
    }

    /// Compute hash of the federated asset
    pub fn compute_hash(&self) -> Result<Vec<u8>, String> {
        self.slot.compute_hash()
    }

    /// Set the hash after computing it
    pub fn set_hash(&mut self, hash: Vec<u8>) {
        self.slot.set_hash(hash);
    }
}

impl<T> Materia for FederatedMateriaSlot<T>
where
    T: Serialize,
{
    fn attest(&mut self, signature: Vec<u8>, timestamp: u64) {
        self.slot.attest(signature, timestamp);
    }

    fn verify(&self) -> bool {
        self.slot.verify()
    }

    fn trust_score(&self) -> f32 {
        self.slot.trust_score()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
    struct TestAsset {
        id: String,
        value: u32,
    }

    #[test]
    fn test_materia_slot_creation() {
        let asset = TestAsset {
            id: "test-001".to_string(),
            value: 42,
        };

        let slot = MateriaSlot::new(asset, vec![0u8; 32], 0.8, 1000);

        assert_eq!(slot.trust_score(), 0.8);
        assert_eq!(slot.attested_at, 1000);
        assert!(slot.signature.is_empty());
    }

    #[test]
    fn test_materia_slot_compute_hash() {
        let asset = TestAsset {
            id: "test-001".to_string(),
            value: 42,
        };

        let slot = MateriaSlot::new(asset, vec![0u8; 32], 0.8, 1000);
        let hash = slot.compute_hash().unwrap();

        assert_eq!(hash.len(), 32);
    }

    #[test]
    fn test_materia_slot_verify_hash() {
        let asset = TestAsset {
            id: "test-001".to_string(),
            value: 42,
        };

        let mut slot = MateriaSlot::new(asset, vec![0u8; 32], 0.8, 1000);
        let hash = slot.compute_hash().unwrap();
        slot.set_hash(hash);

        assert!(slot.verify_hash());
    }

    #[test]
    fn test_materia_slot_attest() {
        let asset = TestAsset {
            id: "test-001".to_string(),
            value: 42,
        };

        let mut slot = MateriaSlot::new(asset, vec![0u8; 32], 0.8, 1000);
        let hash = slot.compute_hash().unwrap();
        slot.set_hash(hash);

        slot.attest(vec![1u8; 64], 2000);

        assert_eq!(slot.signature.len(), 64);
        assert_eq!(slot.attested_at, 2000);
        assert!(slot.verify());
    }

    #[test]
    fn test_materia_slot_trust_score_clamping() {
        let asset = TestAsset {
            id: "test-001".to_string(),
            value: 42,
        };

        let slot1 = MateriaSlot::new(asset.clone(), vec![0u8; 32], 1.5, 1000);
        assert_eq!(slot1.trust_score(), 1.0);

        let slot2 = MateriaSlot::new(asset.clone(), vec![0u8; 32], -0.5, 1000);
        assert_eq!(slot2.trust_score(), 0.0);
    }

    #[test]
    fn test_federated_materia_slot_creation() {
        let asset = TestAsset {
            id: "test-001".to_string(),
            value: 42,
        };

        let fed_slot = FederatedMateriaSlot::new(
            asset,
            "h2os-device-001".to_string(),
            "h2os".to_string(),
            vec![0u8; 32],
            0.8,
            1000,
        );

        assert_eq!(fed_slot.external_id, "h2os-device-001");
        assert_eq!(fed_slot.source_system, "h2os");
        assert_eq!(fed_slot.trust_score(), 0.8);
        assert_eq!(fed_slot.federated_at, 1000);
    }

    #[test]
    fn test_federated_materia_slot_asset_access() {
        let asset = TestAsset {
            id: "test-001".to_string(),
            value: 42,
        };

        let mut fed_slot = FederatedMateriaSlot::new(
            asset.clone(),
            "h2os-device-001".to_string(),
            "h2os".to_string(),
            vec![0u8; 32],
            0.8,
            1000,
        );

        assert_eq!(fed_slot.asset().id, "test-001");
        assert_eq!(fed_slot.asset().value, 42);

        fed_slot.asset_mut().value = 100;
        assert_eq!(fed_slot.asset().value, 100);
    }

    #[test]
    fn test_federated_materia_slot_verify() {
        let asset = TestAsset {
            id: "test-001".to_string(),
            value: 42,
        };

        let mut fed_slot = FederatedMateriaSlot::new(
            asset,
            "h2os-device-001".to_string(),
            "h2os".to_string(),
            vec![0u8; 32],
            0.8,
            1000,
        );

        let hash = fed_slot.compute_hash().unwrap();
        fed_slot.set_hash(hash);
        fed_slot.attest(vec![1u8; 64], 2000);

        assert!(fed_slot.verify());
    }
}
