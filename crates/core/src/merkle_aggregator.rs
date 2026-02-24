//! Merkle Aggregation Service
//!
//! Implements deterministic Merkle tree construction for batch verification of events.
//!
//! # Features
//! - Deterministic sorted leaf preprocessing
//! - BLAKE3-based Merkle tree construction
//! - Proof generation and verification
//! - Time-based and count-based aggregation scheduling
//! - Integration with event ledger

use blake3::Hasher;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use thiserror::Error;
use tracing::{debug, info};

/// Merkle aggregation errors
#[derive(Debug, Error)]
pub enum MerkleError {
    #[error("Empty leaf set: cannot build Merkle tree from empty leaves")]
    EmptyLeaves,

    #[error("Invalid leaf index: {index} (tree has {count} leaves)")]
    InvalidLeafIndex { index: usize, count: usize },

    #[error("Proof verification failed: computed root {computed} != expected {expected}")]
    ProofVerificationFailed { computed: String, expected: String },

    #[error("Invalid proof: {0}")]
    InvalidProof(String),
}

pub type Result<T> = std::result::Result<T, MerkleError>;

/// A 32-byte hash (BLAKE3)
pub type Hash = [u8; 32];

/// Merkle proof for a specific leaf
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct MerkleProof {
    /// The leaf hash being proven
    pub leaf_hash: Hash,
    /// Index of the leaf in the original sorted list
    pub leaf_index: usize,
    /// Sibling hashes along the path to root (bottom-up)
    pub sibling_hashes: Vec<Hash>,
    /// Direction bits: true = sibling is on right, false = sibling is on left
    pub direction_bits: Vec<bool>,
    /// The expected root hash
    pub root_hash: Hash,
}

/// Merkle tree structure
#[derive(Debug, Clone)]
pub struct MerkleTree {
    /// Sorted leaf hashes
    leaves: Vec<Hash>,
    /// All nodes in the tree, level by level (leaves are level 0)
    levels: Vec<Vec<Hash>>,
    /// Root hash
    root: Hash,
}

impl MerkleTree {
    /// Build a Merkle tree from sorted leaf hashes
    ///
    /// # Arguments
    /// * `sorted_leaves` - Pre-sorted leaf hashes (sorted lexicographically)
    ///
    /// # Returns
    /// * `Ok(MerkleTree)` - The constructed tree
    /// * `Err(MerkleError)` - If leaves are empty
    pub fn build(sorted_leaves: Vec<Hash>) -> Result<Self> {
        if sorted_leaves.is_empty() {
            return Err(MerkleError::EmptyLeaves);
        }

        let mut levels = vec![sorted_leaves.clone()];
        let mut current_level = sorted_leaves.clone();

        // Build tree bottom-up
        while current_level.len() > 1 {
            let mut next_level = Vec::new();

            for chunk in current_level.chunks(2) {
                let parent = if chunk.len() == 2 {
                    // Combine two nodes: H(left || right)
                    Self::hash_pair(chunk[0], chunk[1])
                } else {
                    // Odd node out - promote it unchanged
                    chunk[0]
                };
                next_level.push(parent);
            }

            levels.push(next_level.clone());
            current_level = next_level;
        }

        let root = current_level[0];

        Ok(Self {
            leaves: sorted_leaves,
            levels,
            root,
        })
    }

    /// Hash a pair of nodes deterministically
    fn hash_pair(left: Hash, right: Hash) -> Hash {
        let mut hasher = Hasher::new();
        hasher.update(&left);
        hasher.update(&right);
        *hasher.finalize().as_bytes()
    }

    /// Get the root hash
    pub fn root(&self) -> Hash {
        self.root
    }

    /// Get the leaf count
    pub fn leaf_count(&self) -> usize {
        self.leaves.len()
    }

    /// Generate a Merkle proof for a leaf at the given index
    pub fn generate_proof(&self, leaf_index: usize) -> Result<MerkleProof> {
        if leaf_index >= self.leaves.len() {
            return Err(MerkleError::InvalidLeafIndex {
                index: leaf_index,
                count: self.leaves.len(),
            });
        }

        let leaf_hash = self.leaves[leaf_index];
        let mut sibling_hashes = Vec::new();
        let mut direction_bits = Vec::new();
        let mut current_index = leaf_index;

        // Traverse from leaf to root, collecting siblings
        for level in 0..self.levels.len() - 1 {
            let level_nodes = &self.levels[level];

            // Determine sibling index and direction
            let is_right_child = current_index % 2 == 1;
            let sibling_index = if is_right_child {
                current_index - 1
            } else {
                // Left child
                if current_index + 1 < level_nodes.len() {
                    current_index + 1
                } else {
                    // No sibling (odd node), skip this level
                    current_index /= 2;
                    continue;
                }
            };

            sibling_hashes.push(level_nodes[sibling_index]);
            direction_bits.push(!is_right_child); // true if sibling is on right

            current_index /= 2;
        }

        Ok(MerkleProof {
            leaf_hash,
            leaf_index,
            sibling_hashes,
            direction_bits,
            root_hash: self.root,
        })
    }

    /// Verify a Merkle proof
    pub fn verify_proof(proof: &MerkleProof) -> Result<bool> {
        if proof.sibling_hashes.len() != proof.direction_bits.len() {
            return Err(MerkleError::InvalidProof(
                "Sibling hashes and direction bits length mismatch".to_string(),
            ));
        }

        let mut current_hash = proof.leaf_hash;

        // Recompute root by combining with siblings
        for (sibling, &sibling_on_right) in
            proof.sibling_hashes.iter().zip(proof.direction_bits.iter())
        {
            current_hash = if sibling_on_right {
                // Sibling is on right, so we're the left child
                Self::hash_pair(current_hash, *sibling)
            } else {
                // Sibling is on left, so we're the right child
                Self::hash_pair(*sibling, current_hash)
            };
        }

        if current_hash == proof.root_hash {
            Ok(true)
        } else {
            Err(MerkleError::ProofVerificationFailed {
                computed: hex::encode(current_hash),
                expected: hex::encode(proof.root_hash),
            })
        }
    }
}

/// Preprocess and sort leaves deterministically
///
/// Takes a list of event hashes (as raw bytes or hex strings) and:
/// 1. Extracts/converts to 32-byte hashes
/// 2. Sorts lexicographically
/// 3. Returns the sorted list
pub fn preprocess_leaves(event_hashes: &[Vec<u8>]) -> Vec<Hash> {
    let mut leaves: Vec<Hash> = event_hashes
        .iter()
        .map(|h| {
            let mut hash = [0u8; 32];
            let len = h.len().min(32);
            hash[..len].copy_from_slice(&h[..len]);
            hash
        })
        .collect();

    // Sort lexicographically for determinism
    leaves.sort_unstable();
    leaves
}

/// Aggregation batch metadata
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AggregationBatch {
    /// Batch identifier
    pub batch_id: u64,
    /// Merkle root hash
    pub root_hash: Hash,
    /// Start sequence number from ledger
    pub start_seq_no: u64,
    /// End sequence number from ledger
    pub end_seq_no: u64,
    /// Number of events in batch
    pub event_count: usize,
    /// Timestamp when batch was created
    pub created_at: u64,
}

/// Aggregation scheduler configuration
#[derive(Debug, Clone)]
pub struct AggregationConfig {
    /// Time interval for aggregation (in milliseconds)
    pub time_interval_ms: u64,
    /// Count threshold for aggregation
    pub count_threshold: usize,
}

impl Default for AggregationConfig {
    fn default() -> Self {
        Self {
            time_interval_ms: 1000, // 1 second
            count_threshold: 100,   // 100 events
        }
    }
}

/// Merkle aggregation service
pub struct MerkleAggregator {
    /// Configuration
    config: AggregationConfig,
    /// Next batch ID
    next_batch_id: u64,
    /// Batch metadata by batch_id
    batches: HashMap<u64, AggregationBatch>,
    /// Buffer of pending event hashes
    buffer: Vec<(u64, Vec<u8>)>, // (seq_no, hash)
    /// Last aggregation timestamp
    last_aggregation: SystemTime,
}

impl MerkleAggregator {
    /// Create a new aggregator with configuration
    pub fn new(config: AggregationConfig) -> Self {
        Self {
            config,
            next_batch_id: 0,
            batches: HashMap::new(),
            buffer: Vec::new(),
            last_aggregation: SystemTime::now(),
        }
    }

    /// Add an event hash to the buffer
    ///
    /// Automatically triggers aggregation if threshold is reached
    pub fn add_event_hash(&mut self, seq_no: u64, hash: Vec<u8>) -> Option<AggregationBatch> {
        self.buffer.push((seq_no, hash));

        // Check if we should trigger aggregation
        if self.should_aggregate() {
            self.aggregate_batch().ok()
        } else {
            None
        }
    }

    /// Check if aggregation should be triggered
    fn should_aggregate(&self) -> bool {
        // Count threshold
        if self.buffer.len() >= self.config.count_threshold {
            return true;
        }

        // Time threshold
        if let Ok(elapsed) = self.last_aggregation.elapsed() {
            if elapsed >= Duration::from_millis(self.config.time_interval_ms) {
                return !self.buffer.is_empty();
            }
        }

        false
    }

    /// Force aggregation of current buffer
    pub fn aggregate_batch(&mut self) -> Result<AggregationBatch> {
        if self.buffer.is_empty() {
            return Err(MerkleError::EmptyLeaves);
        }

        info!(
            batch_id = self.next_batch_id,
            event_count = self.buffer.len(),
            "Aggregating batch"
        );

        // Extract event hashes
        let event_hashes: Vec<Vec<u8>> = self.buffer.iter().map(|(_, h)| h.clone()).collect();

        // Preprocess and sort leaves
        let sorted_leaves = preprocess_leaves(&event_hashes);

        // Build Merkle tree
        let tree = MerkleTree::build(sorted_leaves)?;

        // Get sequence range
        let start_seq_no = self.buffer.first().unwrap().0;
        let end_seq_no = self.buffer.last().unwrap().0;

        let batch = AggregationBatch {
            batch_id: self.next_batch_id,
            root_hash: tree.root(),
            start_seq_no,
            end_seq_no,
            event_count: self.buffer.len(),
            created_at: SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_millis() as u64,
        };

        debug!(
            batch_id = batch.batch_id,
            root_hash = hex::encode(batch.root_hash),
            "Batch aggregated"
        );

        // Store batch
        self.batches.insert(self.next_batch_id, batch.clone());
        self.next_batch_id += 1;

        // Clear buffer
        self.buffer.clear();
        self.last_aggregation = SystemTime::now();

        Ok(batch)
    }

    /// Get batch metadata by ID
    pub fn get_batch(&self, batch_id: u64) -> Option<&AggregationBatch> {
        self.batches.get(&batch_id)
    }

    /// Get all batches
    pub fn get_all_batches(&self) -> Vec<&AggregationBatch> {
        self.batches.values().collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn create_test_hash(value: u8) -> Hash {
        let mut hash = [0u8; 32];
        hash[0] = value;
        hash
    }

    #[test]
    fn test_build_merkle_tree_single_leaf() {
        let leaves = vec![create_test_hash(1)];
        let tree = MerkleTree::build(leaves.clone()).unwrap();

        assert_eq!(tree.root(), leaves[0]);
        assert_eq!(tree.leaf_count(), 1);
    }

    #[test]
    fn test_build_merkle_tree_two_leaves() {
        let leaves = vec![create_test_hash(1), create_test_hash(2)];
        let tree = MerkleTree::build(leaves).unwrap();

        assert_eq!(tree.leaf_count(), 2);
        // Root should be different from either leaf
        assert_ne!(tree.root(), create_test_hash(1));
        assert_ne!(tree.root(), create_test_hash(2));
    }

    #[test]
    fn test_build_merkle_tree_odd_leaves() {
        let leaves = vec![
            create_test_hash(1),
            create_test_hash(2),
            create_test_hash(3),
        ];
        let tree = MerkleTree::build(leaves).unwrap();

        assert_eq!(tree.leaf_count(), 3);
    }

    #[test]
    fn test_merkle_tree_deterministic() {
        let leaves = vec![
            create_test_hash(1),
            create_test_hash(2),
            create_test_hash(3),
            create_test_hash(4),
        ];

        let tree1 = MerkleTree::build(leaves.clone()).unwrap();
        let tree2 = MerkleTree::build(leaves).unwrap();

        assert_eq!(tree1.root(), tree2.root());
    }

    #[test]
    fn test_preprocess_leaves_sorting() {
        let hashes = vec![vec![3u8; 32], vec![1u8; 32], vec![2u8; 32]];

        let sorted = preprocess_leaves(&hashes);

        // Should be sorted lexicographically
        assert_eq!(sorted[0][0], 1);
        assert_eq!(sorted[1][0], 2);
        assert_eq!(sorted[2][0], 3);
    }

    #[test]
    fn test_shuffled_input_same_root() {
        let hashes1 = vec![vec![3u8; 32], vec![1u8; 32], vec![2u8; 32]];
        let hashes2 = vec![vec![1u8; 32], vec![3u8; 32], vec![2u8; 32]];

        let leaves1 = preprocess_leaves(&hashes1);
        let leaves2 = preprocess_leaves(&hashes2);

        let tree1 = MerkleTree::build(leaves1).unwrap();
        let tree2 = MerkleTree::build(leaves2).unwrap();

        // Same root despite different input order
        assert_eq!(tree1.root(), tree2.root());
    }

    #[test]
    fn test_generate_and_verify_proof() {
        let leaves = vec![
            create_test_hash(1),
            create_test_hash(2),
            create_test_hash(3),
            create_test_hash(4),
        ];

        let tree = MerkleTree::build(leaves).unwrap();

        // Generate proof for leaf at index 1
        let proof = tree.generate_proof(1).unwrap();

        // Verify proof
        assert!(MerkleTree::verify_proof(&proof).unwrap());
    }

    #[test]
    fn test_proof_verification_fails_on_tampered_leaf() {
        let leaves = vec![
            create_test_hash(1),
            create_test_hash(2),
            create_test_hash(3),
            create_test_hash(4),
        ];

        let tree = MerkleTree::build(leaves).unwrap();
        let mut proof = tree.generate_proof(1).unwrap();

        // Tamper with leaf hash
        proof.leaf_hash = create_test_hash(99);

        // Verification should fail
        assert!(MerkleTree::verify_proof(&proof).is_err());
    }

    #[test]
    fn test_proof_verification_fails_on_tampered_sibling() {
        let leaves = vec![
            create_test_hash(1),
            create_test_hash(2),
            create_test_hash(3),
            create_test_hash(4),
        ];

        let tree = MerkleTree::build(leaves).unwrap();
        let mut proof = tree.generate_proof(1).unwrap();

        // Tamper with sibling hash
        if !proof.sibling_hashes.is_empty() {
            proof.sibling_hashes[0] = create_test_hash(99);
        }

        // Verification should fail
        assert!(MerkleTree::verify_proof(&proof).is_err());
    }

    #[test]
    fn test_aggregator_count_threshold() {
        let config = AggregationConfig {
            time_interval_ms: 10000, // 10 seconds (won't trigger)
            count_threshold: 3,
        };

        let mut aggregator = MerkleAggregator::new(config);

        // Add events below threshold
        aggregator.add_event_hash(1, vec![1u8; 32]);
        aggregator.add_event_hash(2, vec![2u8; 32]);
        assert_eq!(aggregator.batches.len(), 0);

        // Reach threshold
        let batch = aggregator.add_event_hash(3, vec![3u8; 32]);
        assert!(batch.is_some());
        assert_eq!(aggregator.batches.len(), 1);
    }

    #[test]
    fn test_aggregator_manual_trigger() {
        let config = AggregationConfig::default();
        let mut aggregator = MerkleAggregator::new(config);

        aggregator.add_event_hash(1, vec![1u8; 32]);
        aggregator.add_event_hash(2, vec![2u8; 32]);

        let batch = aggregator.aggregate_batch().unwrap();
        assert_eq!(batch.event_count, 2);
        assert_eq!(batch.start_seq_no, 1);
        assert_eq!(batch.end_seq_no, 2);
    }

    #[test]
    fn test_multiple_proof_indices() {
        let leaves = vec![
            create_test_hash(1),
            create_test_hash(2),
            create_test_hash(3),
            create_test_hash(4),
            create_test_hash(5),
        ];

        let tree = MerkleTree::build(leaves).unwrap();

        // Generate and verify proofs for all leaves
        for i in 0..5 {
            let proof = tree.generate_proof(i).unwrap();
            assert!(MerkleTree::verify_proof(&proof).unwrap());
        }
    }
}
