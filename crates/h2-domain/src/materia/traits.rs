//! Materia Slot trait definition
//! 
//! Defines the core interface that all hardware-rooted sensor types must implement.

use serde::{Deserialize, Serialize, de::DeserializeOwned};

/// Merkle Vine Link - BLAKE3 hash chain link for integrity verification
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct MerkleVineLink {
    /// Previous hash in the chain (32 bytes)
    pub previous_hash: [u8; 32],
    /// Current hash of this data point (32 bytes)
    pub current_hash: [u8; 32],
    /// Sequence number in the chain
    pub sequence: u64,
    /// Timestamp in nanoseconds since epoch
    pub timestamp_ns: u64,
}

impl MerkleVineLink {
    /// Create a new vine link
    pub fn new(previous_hash: [u8; 32], current_hash: [u8; 32], sequence: u64, timestamp_ns: u64) -> Self {
        Self {
            previous_hash,
            current_hash,
            sequence,
            timestamp_ns,
        }
    }
    
    /// Create from blake3::Hash values
    pub fn from_hashes(previous: blake3::Hash, current: blake3::Hash, sequence: u64, timestamp_ns: u64) -> Self {
        Self {
            previous_hash: *previous.as_bytes(),
            current_hash: *current.as_bytes(),
            sequence,
            timestamp_ns,
        }
    }
    
    /// Get current hash as blake3::Hash
    pub fn current_hash_obj(&self) -> blake3::Hash {
        blake3::Hash::from(self.current_hash)
    }
    
    /// Get previous hash as blake3::Hash
    pub fn previous_hash_obj(&self) -> blake3::Hash {
        blake3::Hash::from(self.previous_hash)
    }
}

/// TPM Attestation - Hardware-rooted cryptographic proof
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct TpmAttestation {
    /// TPM quote signature
    pub quote_signature: Vec<u8>,
    /// PCR (Platform Configuration Register) values
    pub pcr_values: Vec<u8>,
    /// Attestation Key certificate
    pub ak_cert: Vec<u8>,
    /// Timestamp in nanoseconds since epoch
    pub timestamp: u64,
}

impl TpmAttestation {
    /// Create a new TPM attestation
    pub fn new(quote_signature: Vec<u8>, pcr_values: Vec<u8>, ak_cert: Vec<u8>, timestamp: u64) -> Self {
        Self {
            quote_signature,
            pcr_values,
            ak_cert,
            timestamp,
        }
    }
}

/// Materia Slot trait - Core interface for all attested sensor types
pub trait MateriaSlot: Serialize + DeserializeOwned + Send + Sync {
    /// Get the unique slot identifier
    fn slot_id(&self) -> u16;
    
    /// Get reference to the Merkle Vine link
    fn vine_link(&self) -> &MerkleVineLink;
    
    /// Get reference to the TPM attestation
    fn attestation(&self) -> &TpmAttestation;
    
    /// Compute BLAKE3 hash of this slot's data
    fn compute_hash(&self) -> [u8; 32];
    
    /// Verify chain integrity against previous hash
    fn verify_chain(&self, previous: &[u8; 32]) -> bool {
        self.vine_link().previous_hash == *previous
    }
}
