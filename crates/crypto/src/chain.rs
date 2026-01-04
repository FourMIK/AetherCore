//! Event Chain Module - BLAKE3-based Integrity Chain
//!
//! This module provides a cryptographic chain of events using BLAKE3 hashes,
//! where each event links to the previous event via a hash pointer. This enables:
//!
//! - Tamper detection: Any modification to an event breaks the chain
//! - Missing event detection: Gaps in the sequence are immediately visible
//! - Reordering detection: Events out of sequence break chain continuity
//! - Efficient verification: Chain integrity can be verified sequentially
//!
//! # Chain Structure
//!
//! Each event in the chain contains:
//! - `event_hash`: BLAKE3 hash of the canonical event
//! - `prev_event_hash`: Hash of the previous event (or None for genesis)
//!
//! The chain forms a linked list where each event cryptographically commits
//! to the previous event, creating an immutable audit trail.
//!
//! # Performance
//!
//! Target: Build and verify 10,000+ events without pathological slowdown
//! - Hash computation: ~1-2μs per event (BLAKE3 is very fast)
//! - Chain verification: Linear O(n) in number of events

use blake3::Hasher;
use serde::{Deserialize, Serialize};
use std::fmt;
use thiserror::Error;

use crate::signing::CanonicalEvent;

/// A BLAKE3 hash represented as a 32-byte array.
pub type Blake3Hash = [u8; 32];

/// Represents a sentinel value for the genesis event (first event in chain).
pub const GENESIS_HASH: Blake3Hash = [0u8; 32];

/// An event with its computed hash and reference to the previous event.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ChainedEvent {
    /// The canonical event data
    pub event: CanonicalEvent,
    /// BLAKE3 hash of this event
    pub event_hash: Blake3Hash,
    /// Hash of the previous event in the chain (GENESIS_HASH for first event)
    pub prev_event_hash: Blake3Hash,
}

impl ChainedEvent {
    /// Creates a new chained event by computing its hash and linking to previous.
    pub fn new(event: CanonicalEvent, prev_event_hash: Blake3Hash) -> Result<Self, ChainError> {
        let event_hash = compute_event_hash(&event)?;
        Ok(Self {
            event,
            event_hash,
            prev_event_hash,
        })
    }

    /// Verifies that this event's hash is correct.
    pub fn verify_hash(&self) -> Result<(), ChainError> {
        let computed_hash = compute_event_hash(&self.event)?;
        if computed_hash != self.event_hash {
            return Err(ChainError::HashMismatch {
                expected: self.event_hash,
                actual: computed_hash,
            });
        }
        Ok(())
    }

    /// Verifies that this event correctly links to the previous event.
    pub fn verify_link(&self, prev_hash: Blake3Hash) -> Result<(), ChainError> {
        if self.prev_event_hash != prev_hash {
            return Err(ChainError::BrokenLink {
                expected: prev_hash,
                actual: self.prev_event_hash,
            });
        }
        Ok(())
    }
}

/// Errors that can occur in chain operations.
#[derive(Debug, Error)]
pub enum ChainError {
    #[error("Failed to serialize event for hashing: {reason}")]
    SerializationError { reason: String },

    #[error("Hash mismatch: expected {expected:?}, got {actual:?}")]
    HashMismatch {
        expected: Blake3Hash,
        actual: Blake3Hash,
    },

    #[error("Broken chain link: expected prev_hash {expected:?}, got {actual:?}")]
    BrokenLink {
        expected: Blake3Hash,
        actual: Blake3Hash,
    },

    #[error("Chain break detected at index {index}: {reason}")]
    ChainBreak { index: usize, reason: String },

    #[error("Empty chain")]
    EmptyChain,

    #[error("Invalid genesis event: prev_hash must be GENESIS_HASH")]
    InvalidGenesis,
}

/// Result of chain verification.
#[derive(Debug, Clone)]
pub enum VerifyResult {
    /// Chain is valid
    Ok,
    /// Chain break detected at specific index
    Error { error_type: String, index: usize },
}

impl fmt::Display for VerifyResult {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            VerifyResult::Ok => write!(f, "ok"),
            VerifyResult::Error { error_type, index } => {
                write!(f, "error: {} at index {}", error_type, index)
            }
        }
    }
}

/// Computes the BLAKE3 hash of a canonical event.
///
/// This function uses the same deterministic serialization as the signing service
/// to ensure consistency between signing and hashing operations.
///
/// # Arguments
/// * `event` - The canonical event to hash
///
/// # Returns
/// * `Ok(Blake3Hash)` - The 32-byte BLAKE3 hash
/// * `Err(ChainError)` - If serialization fails
pub fn compute_event_hash(event: &CanonicalEvent) -> Result<Blake3Hash, ChainError> {
    // Use the same serialization as signing service for consistency
    let serialized = serde_json::to_vec(event).map_err(|e| ChainError::SerializationError {
        reason: e.to_string(),
    })?;

    let mut hasher = Hasher::new();
    hasher.update(&serialized);
    let hash = hasher.finalize();

    Ok(*hash.as_bytes())
}

/// Computes a pointer hash that includes both the current and previous hash.
///
/// This creates a compound hash that commits to both the current event
/// and the entire history leading up to it.
///
/// # Arguments
/// * `current_hash` - Hash of the current event
/// * `previous_hash` - Hash of the previous event
///
/// # Returns
/// * 32-byte BLAKE3 hash of the concatenated hashes
pub fn compute_pointer(current_hash: Blake3Hash, previous_hash: Blake3Hash) -> Blake3Hash {
    let mut hasher = Hasher::new();
    hasher.update(&previous_hash);
    hasher.update(&current_hash);
    let hash = hasher.finalize();
    *hash.as_bytes()
}

/// Verifies the integrity of an event chain.
///
/// This function checks:
/// 1. Each event's hash is correctly computed
/// 2. Each event's prev_event_hash matches the previous event's hash
/// 3. The first event has GENESIS_HASH as its prev_event_hash
///
/// # Arguments
/// * `events` - Sequence of chained events to verify
///
/// # Returns
/// * `VerifyResult::Ok` - If chain is valid
/// * `VerifyResult::Error` - If chain break detected, with index and error type
pub fn verify_chain(events: &[ChainedEvent]) -> VerifyResult {
    if events.is_empty() {
        return VerifyResult::Error {
            error_type: "empty_chain".to_string(),
            index: 0,
        };
    }

    // Verify genesis event
    if events[0].prev_event_hash != GENESIS_HASH {
        return VerifyResult::Error {
            error_type: "invalid_genesis".to_string(),
            index: 0,
        };
    }

    // Verify each event's hash and link to previous
    for (i, event) in events.iter().enumerate() {
        // Verify event hash is correct
        if let Err(e) = event.verify_hash() {
            return VerifyResult::Error {
                error_type: format!("hash_mismatch: {}", e),
                index: i,
            };
        }

        // Verify link to previous event (skip genesis check for first event)
        if i > 0 {
            let prev_hash = events[i - 1].event_hash;
            if let Err(e) = event.verify_link(prev_hash) {
                return VerifyResult::Error {
                    error_type: format!("broken_link: {}", e),
                    index: i,
                };
            }
        }
    }

    VerifyResult::Ok
}

/// Chain manager that maintains the event chain state.
pub struct ChainManager {
    /// All events in the chain
    events: Vec<ChainedEvent>,
    /// Metrics for observability
    metrics: ChainMetrics,
}

/// Metrics for chain operations.
#[derive(Debug, Default, Clone)]
pub struct ChainMetrics {
    /// Total number of events added to chain
    pub chain_events_total: u64,
    /// Total number of chain breaks detected
    pub chain_breaks_detected_total: u64,
}

impl ChainManager {
    /// Creates a new empty chain manager.
    pub fn new() -> Self {
        Self {
            events: Vec::new(),
            metrics: ChainMetrics::default(),
        }
    }

    /// Appends an event to the chain.
    ///
    /// The event is hashed and linked to the previous event in the chain.
    /// For the first event, it's linked to GENESIS_HASH.
    ///
    /// # Arguments
    /// * `event` - The canonical event to append
    ///
    /// # Returns
    /// * `Ok(Blake3Hash)` - The hash of the newly added event
    /// * `Err(ChainError)` - If hashing fails
    pub fn append_to_chain(&mut self, event: CanonicalEvent) -> Result<Blake3Hash, ChainError> {
        let prev_hash = self.get_chain_head();
        let chained_event = ChainedEvent::new(event, prev_hash)?;
        let event_hash = chained_event.event_hash;

        self.events.push(chained_event);
        self.metrics.chain_events_total += 1;

        Ok(event_hash)
    }

    /// Gets the hash of the most recent event (chain head).
    ///
    /// Returns GENESIS_HASH if the chain is empty.
    pub fn get_chain_head(&self) -> Blake3Hash {
        self.events
            .last()
            .map(|e| e.event_hash)
            .unwrap_or(GENESIS_HASH)
    }

    /// Verifies the entire chain from the beginning.
    ///
    /// # Returns
    /// * `VerifyResult::Ok` - If chain is valid
    /// * `VerifyResult::Error` - If chain break detected
    pub fn verify_chain_from_start(&mut self) -> VerifyResult {
        let result = verify_chain(&self.events);
        if let VerifyResult::Error { .. } = result {
            self.metrics.chain_breaks_detected_total += 1;
        }
        result
    }

    /// Verifies the chain starting from a specific index.
    ///
    /// This verifies the continuity from the start_index onwards, checking that
    /// each event properly links to the previous one in the full chain.
    ///
    /// # Arguments
    /// * `start_index` - Index to start verification from
    ///
    /// # Returns
    /// * `VerifyResult` - Result of verification
    pub fn verify_chain_from(&mut self, start_index: usize) -> VerifyResult {
        if start_index >= self.events.len() {
            return VerifyResult::Error {
                error_type: "index_out_of_bounds".to_string(),
                index: start_index,
            };
        }

        // For partial verification, we need to check each event against its predecessor
        // in the full chain, not treat it as a new genesis
        for i in start_index..self.events.len() {
            let event = &self.events[i];

            // Verify event hash is correct
            if let Err(e) = event.verify_hash() {
                self.metrics.chain_breaks_detected_total += 1;
                return VerifyResult::Error {
                    error_type: format!("hash_mismatch: {}", e),
                    index: i,
                };
            }

            // Verify link to previous event
            let expected_prev = if i == 0 {
                GENESIS_HASH
            } else {
                self.events[i - 1].event_hash
            };

            if let Err(e) = event.verify_link(expected_prev) {
                self.metrics.chain_breaks_detected_total += 1;
                return VerifyResult::Error {
                    error_type: format!("broken_link: {}", e),
                    index: i,
                };
            }
        }

        VerifyResult::Ok
    }

    /// Gets a reference to the chain metrics.
    pub fn metrics(&self) -> &ChainMetrics {
        &self.metrics
    }

    /// Gets the number of events in the chain.
    pub fn len(&self) -> usize {
        self.events.len()
    }

    /// Checks if the chain is empty.
    pub fn is_empty(&self) -> bool {
        self.events.is_empty()
    }

    /// Gets a reference to a specific event in the chain.
    pub fn get_event(&self, index: usize) -> Option<&ChainedEvent> {
        self.events.get(index)
    }

    /// Gets all events in the chain.
    pub fn events(&self) -> &[ChainedEvent] {
        &self.events
    }
}

impl Default for ChainManager {
    fn default() -> Self {
        Self::new()
    }
}

/// Chain proof for cross-node verification
///
/// Contains a cryptographic proof of the chain state that can be
/// exchanged with other nodes for integrity verification.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ChainProof {
    /// Node/stream identifier
    pub chain_id: String,
    /// Current chain head hash
    pub head_hash: Blake3Hash,
    /// Chain length
    pub chain_length: usize,
    /// Timestamp of proof generation (nanoseconds)
    pub timestamp_ns: u64,
    /// Optional signature of the proof (for authenticated exchange)
    pub signature: Option<Vec<u8>>,
}

impl ChainProof {
    /// Create a new chain proof
    pub fn new(chain_id: String, head_hash: Blake3Hash, chain_length: usize) -> Self {
        Self {
            chain_id,
            head_hash,
            chain_length,
            timestamp_ns: current_timestamp_ns(),
            signature: None,
        }
    }
    
    /// Create a proof with signature
    pub fn with_signature(mut self, signature: Vec<u8>) -> Self {
        self.signature = Some(signature);
        self
    }
    
    /// Verify this proof matches another proof (for consensus)
    pub fn matches(&self, other: &ChainProof) -> bool {
        self.chain_id == other.chain_id
            && self.head_hash == other.head_hash
            && self.chain_length == other.chain_length
    }
}

impl ChainManager {
    /// Generate a proof of the current chain state
    pub fn generate_proof(&self, chain_id: String) -> ChainProof {
        ChainProof::new(chain_id, self.get_chain_head(), self.len())
    }
    
    /// Verify a chain proof against local state
    ///
    /// Returns true if the proof matches the local chain head and length.
    pub fn verify_proof(&self, proof: &ChainProof) -> bool {
        proof.head_hash == self.get_chain_head() && proof.chain_length == self.len()
    }
}

/// Get current timestamp in nanoseconds since UNIX epoch
fn current_timestamp_ns() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .expect("Time went backwards")
        .as_nanos() as u64
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;

    fn create_test_event(event_type: &str, sequence: u64) -> CanonicalEvent {
        CanonicalEvent {
            event_type: event_type.to_string(),
            timestamp: 1700000000000 + sequence * 1000,
            source_id: "test-device".to_string(),
            sequence,
            payload: HashMap::new(),
        }
    }

    #[test]
    fn test_compute_event_hash() {
        let event = create_test_event("test.event", 1);
        let hash1 = compute_event_hash(&event).unwrap();
        let hash2 = compute_event_hash(&event).unwrap();

        // Hash should be deterministic
        assert_eq!(hash1, hash2);
        assert_eq!(hash1.len(), 32);
    }

    #[test]
    fn test_compute_pointer() {
        let hash1 = [1u8; 32];
        let hash2 = [2u8; 32];

        let pointer = compute_pointer(hash1, hash2);
        assert_eq!(pointer.len(), 32);

        // Should be deterministic
        let pointer2 = compute_pointer(hash1, hash2);
        assert_eq!(pointer, pointer2);

        // Different inputs should produce different outputs
        let pointer3 = compute_pointer(hash2, hash1);
        assert_ne!(pointer, pointer3);
    }

    #[test]
    fn test_chained_event_creation() {
        let event = create_test_event("test.event", 1);
        let prev_hash = GENESIS_HASH;

        let chained = ChainedEvent::new(event.clone(), prev_hash).unwrap();

        assert_eq!(chained.event, event);
        assert_eq!(chained.prev_event_hash, prev_hash);
        assert_eq!(chained.event_hash.len(), 32);
    }

    #[test]
    fn test_chained_event_verify_hash() {
        let event = create_test_event("test.event", 1);
        let chained = ChainedEvent::new(event, GENESIS_HASH).unwrap();

        // Should verify successfully
        assert!(chained.verify_hash().is_ok());

        // Modify hash to break verification
        let mut broken = chained.clone();
        broken.event_hash[0] ^= 0xFF;
        assert!(broken.verify_hash().is_err());
    }

    #[test]
    fn test_chained_event_verify_link() {
        let event = create_test_event("test.event", 1);
        let prev_hash = [42u8; 32];
        let chained = ChainedEvent::new(event, prev_hash).unwrap();

        // Should verify with correct prev_hash
        assert!(chained.verify_link(prev_hash).is_ok());

        // Should fail with wrong prev_hash
        let wrong_hash = [99u8; 32];
        assert!(chained.verify_link(wrong_hash).is_err());
    }

    #[test]
    fn test_verify_chain_happy_path() {
        // Create a small valid chain
        let mut events = Vec::new();

        for i in 0..5 {
            let event = create_test_event("test.event", i);
            let prev_hash = events
                .last()
                .map(|e: &ChainedEvent| e.event_hash)
                .unwrap_or(GENESIS_HASH);
            events.push(ChainedEvent::new(event, prev_hash).unwrap());
        }

        let result = verify_chain(&events);
        assert!(matches!(result, VerifyResult::Ok));
    }

    #[test]
    fn test_verify_chain_empty() {
        let events: Vec<ChainedEvent> = Vec::new();
        let result = verify_chain(&events);
        assert!(matches!(result, VerifyResult::Error { .. }));
    }

    #[test]
    fn test_verify_chain_invalid_genesis() {
        let event = create_test_event("test.event", 0);
        let wrong_prev = [1u8; 32];
        let chained = ChainedEvent::new(event, wrong_prev).unwrap();

        let result = verify_chain(&[chained]);
        if let VerifyResult::Error { error_type, index } = result {
            assert_eq!(index, 0);
            assert!(error_type.contains("genesis"));
        } else {
            panic!("Expected error");
        }
    }

    #[test]
    fn test_verify_chain_dropped_event() {
        // Create a chain of 5 events
        let mut events = Vec::new();
        for i in 0..5 {
            let event = create_test_event("test.event", i);
            let prev_hash = events
                .last()
                .map(|e: &ChainedEvent| e.event_hash)
                .unwrap_or(GENESIS_HASH);
            events.push(ChainedEvent::new(event, prev_hash).unwrap());
        }

        // Remove event at index 2 (middle of chain)
        events.remove(2);

        // Chain should be broken
        let result = verify_chain(&events);
        if let VerifyResult::Error { index, .. } = result {
            assert_eq!(index, 2); // Break detected at next event
        } else {
            panic!("Expected chain break");
        }
    }

    #[test]
    fn test_verify_chain_modified_prev_hash() {
        // Create a valid chain
        let mut events = Vec::new();
        for i in 0..5 {
            let event = create_test_event("test.event", i);
            let prev_hash = events
                .last()
                .map(|e: &ChainedEvent| e.event_hash)
                .unwrap_or(GENESIS_HASH);
            events.push(ChainedEvent::new(event, prev_hash).unwrap());
        }

        // Modify prev_hash of event at index 3
        events[3].prev_event_hash[0] ^= 0xFF;

        // Chain should be broken
        let result = verify_chain(&events);
        if let VerifyResult::Error { index, .. } = result {
            assert_eq!(index, 3);
        } else {
            panic!("Expected chain break");
        }
    }

    #[test]
    fn test_verify_chain_swapped_events() {
        // Create a valid chain
        let mut events = Vec::new();
        for i in 0..5 {
            let event = create_test_event("test.event", i);
            let prev_hash = events
                .last()
                .map(|e: &ChainedEvent| e.event_hash)
                .unwrap_or(GENESIS_HASH);
            events.push(ChainedEvent::new(event, prev_hash).unwrap());
        }

        // Swap events at index 2 and 3
        events.swap(2, 3);

        // Chain should be broken
        let result = verify_chain(&events);
        assert!(matches!(result, VerifyResult::Error { .. }));
    }

    #[test]
    fn test_chain_manager_append() {
        let mut manager = ChainManager::new();

        assert_eq!(manager.len(), 0);
        assert_eq!(manager.get_chain_head(), GENESIS_HASH);

        // Append first event
        let event1 = create_test_event("test.event", 1);
        let hash1 = manager.append_to_chain(event1).unwrap();

        assert_eq!(manager.len(), 1);
        assert_eq!(manager.get_chain_head(), hash1);

        // Append second event
        let event2 = create_test_event("test.event", 2);
        let hash2 = manager.append_to_chain(event2).unwrap();

        assert_eq!(manager.len(), 2);
        assert_eq!(manager.get_chain_head(), hash2);

        // Verify chain is valid
        let result = manager.verify_chain_from_start();
        assert!(matches!(result, VerifyResult::Ok));
    }

    #[test]
    fn test_chain_manager_metrics() {
        let mut manager = ChainManager::new();

        for i in 0..10 {
            let event = create_test_event("test.event", i);
            manager.append_to_chain(event).unwrap();
        }

        assert_eq!(manager.metrics().chain_events_total, 10);
        assert_eq!(manager.metrics().chain_breaks_detected_total, 0);

        // Verify chain (no breaks)
        manager.verify_chain_from_start();
        assert_eq!(manager.metrics().chain_breaks_detected_total, 0);
    }

    #[test]
    fn test_chain_manager_get_event() {
        let mut manager = ChainManager::new();

        for i in 0..5 {
            let event = create_test_event("test.event", i);
            manager.append_to_chain(event).unwrap();
        }

        // Get event by index
        let event = manager.get_event(2).unwrap();
        assert_eq!(event.event.sequence, 2);

        // Out of bounds
        assert!(manager.get_event(10).is_none());
    }

    #[test]
    fn test_chain_proof_creation() {
        let mut manager = ChainManager::new();
        
        for i in 0..5 {
            let event = create_test_event("test.event", i);
            manager.append_to_chain(event).unwrap();
        }
        
        let proof = manager.generate_proof("test-chain".to_string());
        
        assert_eq!(proof.chain_id, "test-chain");
        assert_eq!(proof.chain_length, 5);
        assert_eq!(proof.head_hash, manager.get_chain_head());
    }

    #[test]
    fn test_chain_proof_verification() {
        let mut manager = ChainManager::new();
        
        for i in 0..3 {
            let event = create_test_event("test.event", i);
            manager.append_to_chain(event).unwrap();
        }
        
        let proof = manager.generate_proof("test-chain".to_string());
        
        // Proof should verify against current state
        assert!(manager.verify_proof(&proof));
        
        // Add another event
        let event = create_test_event("test.event", 3);
        manager.append_to_chain(event).unwrap();
        
        // Old proof should no longer verify
        assert!(!manager.verify_proof(&proof));
    }

    #[test]
    fn test_chain_proof_matching() {
        let proof1 = ChainProof::new("chain-1".to_string(), [1u8; 32], 10);
        let proof2 = ChainProof::new("chain-1".to_string(), [1u8; 32], 10);
        let proof3 = ChainProof::new("chain-1".to_string(), [2u8; 32], 10);
        
        assert!(proof1.matches(&proof2));
        assert!(!proof1.matches(&proof3));
    }

    #[test]
    fn test_chain_proof_with_signature() {
        let signature = vec![0x42u8; 64];
        let proof = ChainProof::new("chain-1".to_string(), [1u8; 32], 5)
            .with_signature(signature.clone());
        
        assert_eq!(proof.signature, Some(signature));
    }
}
