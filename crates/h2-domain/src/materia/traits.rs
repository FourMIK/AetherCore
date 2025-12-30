//! Materia Slot trait definition
//! 
//! Defines the core interface that all hardware-rooted sensor types must implement.

use serde::{Deserialize, Serialize};
use serde::de::DeserializeOwned;

/// Merkle Vine Link - BLAKE3 hash chain link for integrity verification
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct MerkleVineLink {
    /// Current hash of this data point (32 bytes)
    pub current: [u8; 32],
    /// Previous hash in the chain (32 bytes)
    pub previous: [u8; 32],
    /// Sequence number in the chain
    pub sequence: u64,
}

impl MerkleVineLink {
    /// Create a new vine link
    pub fn new(current: [u8; 32], previous: [u8; 32], sequence: u64) -> Self {
        Self {
            current,
            previous,
            sequence,
        }
    }
    
    /// Create from blake3::Hash values
    pub fn from_hashes(current: blake3::Hash, previous: blake3::Hash, sequence: u64) -> Self {
        Self {
            current: *current.as_bytes(),
            previous: *previous.as_bytes(),
            sequence,
        }
    }
    
    /// Get current hash as blake3::Hash
    pub fn current_hash(&self) -> blake3::Hash {
        blake3::Hash::from(self.current)
    }
    
    /// Get previous hash as blake3::Hash
    pub fn previous_hash(&self) -> blake3::Hash {
        blake3::Hash::from(self.previous)
    }
}

/// TPM Attestation - Hardware-rooted cryptographic proof
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct TpmAttestation {
    /// TPM quote signature
    pub quote: Vec<u8>,
    /// PCR (Platform Configuration Register) values
    pub pcr_values: Vec<u8>,
    /// Attestation timestamp (nanoseconds since epoch)
    pub timestamp_ns: u64,
    /// TPM public key used for verification
    pub tpm_public_key: Vec<u8>,
}

impl TpmAttestation {
    /// Create a new TPM attestation
    pub fn new(quote: Vec<u8>, pcr_values: Vec<u8>, timestamp_ns: u64, tpm_public_key: Vec<u8>) -> Self {
        Self {
            quote,
            pcr_values,
            timestamp_ns,
            tpm_public_key,
        }
    }
}

/// Materia Slot trait - Core interface for all attested sensor types
pub trait MateriaSlot: Serialize + DeserializeOwned {
    /// Get the unique slot identifier
    fn slot_id(&self) -> u16;
    
    /// Get reference to the Merkle Vine link
    fn vine_link(&self) -> &MerkleVineLink;
    
    /// Get reference to the TPM attestation
    fn attestation(&self) -> &TpmAttestation;
    
    /// Compute BLAKE3 hash of this slot's data
    fn compute_hash(&self) -> blake3::Hash;
    
    /// Verify chain integrity against previous hash
    fn verify_chain(&self, previous: &[u8; 32]) -> bool {
        self.vine_link().previous == *previous
    }
}
