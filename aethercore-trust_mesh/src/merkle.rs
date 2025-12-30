//! Merkle Aggregation Module
//!
//! Implements Merkle tree aggregation over event batches and signed checkpoint management.

use fourmik_domain::{EventHash, PublicKey, Signature};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use thiserror::Error;

/// Merkle aggregation errors
#[derive(Debug, Error)]
pub enum MerkleError {
    #[error("Empty window: cannot create checkpoint from empty event set")]
    EmptyWindow,

    #[error("Hash computation failed: {0}")]
    HashFailed(String),

    #[error("Checkpoint validation failed: {0}")]
    ValidationFailed(String),

    #[error("Signature error: {0}")]
    SignatureError(String),

    #[error("Mismatched lengths: {0}")]
    LengthMismatch(String),
}

pub type Result<T> = std::result::Result<T, MerkleError>;

/// Window of events to be aggregated into a Merkle root
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CheckpointWindow {
    /// Node that created this window
    pub node_id: String,

    /// Window identifier (sequential)
    pub window_id: u64,

    /// Start timestamp of window
    pub window_start: u64,

    /// End timestamp of window
    pub window_end: u64,

    /// Event hashes in this window (in order)
    pub event_hashes: Vec<EventHash>,

    /// Chain height range covered by this window
    pub chain_height_start: u64,
    pub chain_height_end: u64,
}

impl CheckpointWindow {
    /// Create a new window from a batch of events
    pub fn from_events(
        node_id: String,
        window_id: u64,
        event_hashes: Vec<EventHash>,
        timestamps: &[u64],
        heights: &[u64],
    ) -> Result<Self> {
        if event_hashes.is_empty() {
            return Err(MerkleError::EmptyWindow);
        }

        // Validate that all slices have the same length
        if timestamps.len() != event_hashes.len() || heights.len() != event_hashes.len() {
            return Err(MerkleError::ValidationFailed(
                "Mismatched lengths: event_hashes, timestamps, and heights must have same length"
                    .to_string(),
            ));
        }

        let window_start = timestamps[0];
        let window_end = timestamps[timestamps.len() - 1];
        let chain_height_start = heights[0];
        let chain_height_end = heights[heights.len() - 1];

        Ok(Self {
            node_id,
            window_id,
            window_start,
            window_end,
            event_hashes,
            chain_height_start,
            chain_height_end,
        })
    }

    /// Get the number of events in this window
    pub fn event_count(&self) -> u64 {
        self.event_hashes.len() as u64
    }
}

/// Signed ledger checkpoint with Merkle root
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LedgerCheckpoint {
    /// Merkle root hash of all events in the window
    pub root_hash: EventHash,

    /// Ed25519 signature over the root hash
    pub signature: Signature,

    /// Node that created this checkpoint
    pub node_id: String,

    /// Sequence number of this checkpoint (monotonic per node)
    pub seq_no: u64,

    /// Timestamp when checkpoint was created
    pub created_at: u64,

    /// Public key used for signing
    pub public_key: PublicKey,

    /// Window metadata
    pub window_start: u64,
    pub window_end: u64,
    pub event_count: u64,
    pub chain_height_start: u64,
    pub chain_height_end: u64,

    /// Optional compact Merkle proof
    #[serde(skip_serializing_if = "Option::is_none")]
    pub proof: Option<Vec<EventHash>>,
}

impl LedgerCheckpoint {
    /// Compute hash for signing (canonical representation)
    pub fn compute_signing_hash(&self) -> String {
        let canonical = format!(
            "{}:{}:{}:{}:{}:{}:{}:{}:{}",
            self.node_id,
            self.seq_no,
            self.root_hash,
            self.window_start,
            self.window_end,
            self.event_count,
            self.chain_height_start,
            self.chain_height_end,
            self.created_at
        );

        let hash = blake3::hash(canonical.as_bytes());
        hex::encode(hash.as_bytes())
    }
}

/// Merkle tree aggregator
pub struct MerkleAggregator {
    /// Node identifier
    node_id: String,

    /// Next checkpoint sequence number
    next_seq_no: u64,

    /// Checkpoints created by this node
    local_checkpoints: HashMap<u64, LedgerCheckpoint>,
}

impl MerkleAggregator {
    pub fn new(node_id: String) -> Self {
        Self {
            node_id,
            next_seq_no: 0,
            local_checkpoints: HashMap::new(),
        }
    }

    /// Build a Merkle tree over event hashes and return the root
    ///
    /// Uses BLAKE3 for hashing. The tree is built bottom-up by repeatedly
    /// hashing pairs of nodes until a single root remains.
    /// Uses a delimiter to prevent length extension attacks.
    pub fn build_merkle_tree(&self, event_hashes: &[EventHash]) -> Result<EventHash> {
        if event_hashes.is_empty() {
            return Err(MerkleError::EmptyWindow);
        }

        // Single hash case
        if event_hashes.len() == 1 {
            return Ok(event_hashes[0].clone());
        }

        let mut current_level: Vec<EventHash> = event_hashes.to_vec();

        // Build tree bottom-up
        while current_level.len() > 1 {
            let mut next_level = Vec::new();

            // Process pairs
            for chunk in current_level.chunks(2) {
                if chunk.len() == 2 {
                    // Hash pair with delimiter to prevent length extension attacks
                    let combined = format!("{}|{}", chunk[0], chunk[1]);
                    let hash = blake3::hash(combined.as_bytes());
                    next_level.push(hex::encode(hash.as_bytes()));
                } else {
                    // Odd node - promote to next level
                    next_level.push(chunk[0].clone());
                }
            }

            current_level = next_level;
        }

        Ok(current_level[0].clone())
    }

    /// Create a checkpoint from a window of events
    pub fn create_checkpoint(
        &mut self,
        window: CheckpointWindow,
        public_key: PublicKey,
        signature: Signature,
    ) -> Result<LedgerCheckpoint> {
        let root_hash = self.build_merkle_tree(&window.event_hashes)?;

        let checkpoint = LedgerCheckpoint {
            root_hash,
            signature,
            node_id: self.node_id.clone(),
            seq_no: self.next_seq_no,
            created_at: std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_millis() as u64,
            public_key,
            window_start: window.window_start,
            window_end: window.window_end,
            event_count: window.event_count(),
            chain_height_start: window.chain_height_start,
            chain_height_end: window.chain_height_end,
            proof: None,
        };

        self.local_checkpoints
            .insert(self.next_seq_no, checkpoint.clone());
        self.next_seq_no += 1;

        Ok(checkpoint)
    }

    /// Verify checkpoint continuity (seq numbers are consecutive)
    pub fn verify_continuity(&self, checkpoints: &[LedgerCheckpoint]) -> bool {
        if checkpoints.is_empty() {
            return true;
        }

        let mut prev_seq = checkpoints[0].seq_no;

        for checkpoint in checkpoints.iter().skip(1) {
            if checkpoint.seq_no != prev_seq + 1 {
                return false;
            }
            prev_seq = checkpoint.seq_no;
        }

        true
    }

    /// Detect gaps in checkpoint sequence
    pub fn detect_gaps(&self, checkpoints: &[LedgerCheckpoint]) -> Vec<u64> {
        if checkpoints.is_empty() {
            return vec![];
        }

        let mut sorted = checkpoints.to_vec();
        sorted.sort_by_key(|c| c.seq_no);

        let mut gaps = Vec::new();
        let mut prev_seq = sorted[0].seq_no;

        for checkpoint in sorted.iter().skip(1) {
            if checkpoint.seq_no > prev_seq + 1 {
                // Gap detected
                for missing in (prev_seq + 1)..checkpoint.seq_no {
                    gaps.push(missing);
                }
            }
            prev_seq = checkpoint.seq_no;
        }

        gaps
    }

    /// Get the latest checkpoint
    pub fn get_latest_checkpoint(&self) -> Option<&LedgerCheckpoint> {
        if self.next_seq_no == 0 {
            return None;
        }
        self.local_checkpoints.get(&(self.next_seq_no - 1))
    }

    /// Get a specific checkpoint by sequence number
    pub fn get_checkpoint(&self, seq_no: u64) -> Option<&LedgerCheckpoint> {
        self.local_checkpoints.get(&seq_no)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_build_merkle_tree_single_hash() {
        let aggregator = MerkleAggregator::new("test-node".to_string());
        let hashes = vec!["hash1".to_string()];

        let root = aggregator.build_merkle_tree(&hashes).unwrap();
        assert_eq!(root, "hash1");
    }

    #[test]
    fn test_build_merkle_tree_two_hashes() {
        let aggregator = MerkleAggregator::new("test-node".to_string());
        let hashes = vec!["hash1".to_string(), "hash2".to_string()];

        let root = aggregator.build_merkle_tree(&hashes).unwrap();
        assert!(!root.is_empty());
        assert_ne!(root, "hash1");
        assert_ne!(root, "hash2");
    }

    #[test]
    fn test_build_merkle_tree_multiple_hashes() {
        let aggregator = MerkleAggregator::new("test-node".to_string());
        let hashes = vec![
            "hash1".to_string(),
            "hash2".to_string(),
            "hash3".to_string(),
            "hash4".to_string(),
        ];

        let root = aggregator.build_merkle_tree(&hashes).unwrap();
        assert!(!root.is_empty());
    }

    #[test]
    fn test_merkle_tree_deterministic() {
        let aggregator = MerkleAggregator::new("test-node".to_string());
        let hashes = vec![
            "hash1".to_string(),
            "hash2".to_string(),
            "hash3".to_string(),
        ];

        let root1 = aggregator.build_merkle_tree(&hashes).unwrap();
        let root2 = aggregator.build_merkle_tree(&hashes).unwrap();

        assert_eq!(root1, root2);
    }

    #[test]
    fn test_merkle_tree_detects_tampering() {
        let aggregator = MerkleAggregator::new("test-node".to_string());
        let hashes1 = vec![
            "hash1".to_string(),
            "hash2".to_string(),
            "hash3".to_string(),
        ];

        let hashes2 = vec![
            "hash1".to_string(),
            "hash2_tampered".to_string(),
            "hash3".to_string(),
        ];

        let root1 = aggregator.build_merkle_tree(&hashes1).unwrap();
        let root2 = aggregator.build_merkle_tree(&hashes2).unwrap();

        assert_ne!(root1, root2);
    }

    #[test]
    fn test_create_checkpoint_window() {
        let window = CheckpointWindow::from_events(
            "node-001".to_string(),
            0,
            vec!["hash1".to_string(), "hash2".to_string()],
            &[1000, 2000],
            &[0, 1],
        )
        .unwrap();

        assert_eq!(window.event_count(), 2);
        assert_eq!(window.window_start, 1000);
        assert_eq!(window.window_end, 2000);
    }

    #[test]
    fn test_verify_continuity() {
        let aggregator = MerkleAggregator::new("test-node".to_string());

        let checkpoints = vec![
            LedgerCheckpoint {
                root_hash: "root1".to_string(),
                signature: String::new(),
                node_id: "node-001".to_string(),
                seq_no: 0,
                created_at: 1000,
                public_key: String::new(),
                window_start: 1000,
                window_end: 2000,
                event_count: 10,
                chain_height_start: 0,
                chain_height_end: 9,
                proof: None,
            },
            LedgerCheckpoint {
                root_hash: "root2".to_string(),
                signature: String::new(),
                node_id: "node-001".to_string(),
                seq_no: 1,
                created_at: 2000,
                public_key: String::new(),
                window_start: 2000,
                window_end: 3000,
                event_count: 10,
                chain_height_start: 10,
                chain_height_end: 19,
                proof: None,
            },
        ];

        assert!(aggregator.verify_continuity(&checkpoints));
    }

    #[test]
    fn test_detect_gaps() {
        let aggregator = MerkleAggregator::new("test-node".to_string());

        let checkpoints = vec![
            LedgerCheckpoint {
                root_hash: "root1".to_string(),
                signature: String::new(),
                node_id: "node-001".to_string(),
                seq_no: 0,
                created_at: 1000,
                public_key: String::new(),
                window_start: 1000,
                window_end: 2000,
                event_count: 10,
                chain_height_start: 0,
                chain_height_end: 9,
                proof: None,
            },
            LedgerCheckpoint {
                root_hash: "root3".to_string(),
                signature: String::new(),
                node_id: "node-001".to_string(),
                seq_no: 3, // Gap: missing 1 and 2
                created_at: 4000,
                public_key: String::new(),
                window_start: 4000,
                window_end: 5000,
                event_count: 10,
                chain_height_start: 30,
                chain_height_end: 39,
                proof: None,
            },
        ];

        let gaps = aggregator.detect_gaps(&checkpoints);
        assert_eq!(gaps, vec![1, 2]);
    }
}
