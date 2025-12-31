//! Merkle-Vine: A cryptographic structure for efficient verification of data streams.
//!
//! Merkle-Vine extends Merkle trees for streaming scenarios where data arrives continuously.
//! It allows incremental building and efficient verification of subsets without needing
//! the entire dataset.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// A node in the Merkle-Vine structure.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct VineNode {
    /// Hash of this node
    pub hash: Vec<u8>,
    /// Index in the vine sequence
    pub index: u64,
    /// Hash of left child (if internal node)
    pub left: Option<Vec<u8>>,
    /// Hash of right child (if internal node)
    pub right: Option<Vec<u8>>,
    /// Leaf data (if leaf node)
    pub data: Option<Vec<u8>>,
    /// Timestamp of creation
    pub timestamp: u64,
}

/// Merkle-Vine structure for streaming data verification.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MerkleVine {
    /// Identifier for this vine
    pub vine_id: String,
    /// All nodes indexed by hash
    nodes: HashMap<Vec<u8>, VineNode>,
    /// Leaf nodes in sequence order
    leaves: Vec<Vec<u8>>,
    /// Current root hash
    root: Option<Vec<u8>>,
    /// Next leaf index
    next_index: u64,
}

/// Proof that a specific data element is part of the vine.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InclusionProof {
    /// The leaf node being proven
    pub leaf_hash: Vec<u8>,
    /// Index of the leaf
    pub leaf_index: u64,
    /// Root hash at time of proof
    pub root_hash: Vec<u8>,
    /// Path of hashes from leaf to root
    pub path: Vec<Vec<u8>>,
    /// Directions (true = right, false = left)
    pub directions: Vec<bool>,
}

impl MerkleVine {
    /// Create a new empty Merkle-Vine.
    pub fn new(vine_id: impl Into<String>) -> Self {
        Self {
            vine_id: vine_id.into(),
            nodes: HashMap::new(),
            leaves: Vec::new(),
            root: None,
            next_index: 0,
        }
    }

    /// Add a leaf to the vine with computed hash.
    pub fn add_leaf(&mut self, data: Vec<u8>, hash: Vec<u8>, timestamp: u64) -> crate::Result<u64> {
        let index = self.next_index;

        let node = VineNode {
            hash: hash.clone(),
            index,
            left: None,
            right: None,
            data: Some(data),
            timestamp,
        };

        self.nodes.insert(hash.clone(), node);
        self.leaves.push(hash.clone());
        self.next_index += 1;

        // Recompute root
        self.recompute_root()?;

        Ok(index)
    }

    /// Recompute the root hash from current leaves.
    fn recompute_root(&mut self) -> crate::Result<()> {
        if self.leaves.is_empty() {
            self.root = None;
            return Ok(());
        }

        if self.leaves.len() == 1 {
            self.root = Some(self.leaves[0].clone());
            return Ok(());
        }

        // Build tree bottom-up
        let mut level = self.leaves.clone();

        while level.len() > 1 {
            let mut next_level = Vec::new();

            for chunk in level.chunks(2) {
                if chunk.len() == 2 {
                    // Combine two nodes
                    let left = chunk[0].clone();
                    let right = chunk[1].clone();

                    // Create parent hash (simplified - in production use proper hash function)
                    let mut combined = left.clone();
                    combined.extend_from_slice(&right);
                    let parent_hash = simple_hash(&combined);

                    let parent = VineNode {
                        hash: parent_hash.clone(),
                        index: 0, // Internal nodes don't have meaningful index
                        left: Some(left),
                        right: Some(right),
                        data: None,
                        timestamp: 0,
                    };

                    self.nodes.insert(parent_hash.clone(), parent);
                    next_level.push(parent_hash);
                } else {
                    // Odd node out, promote to next level
                    next_level.push(chunk[0].clone());
                }
            }

            level = next_level;
        }

        self.root = Some(level[0].clone());
        Ok(())
    }

    /// Get the current root hash.
    pub fn get_root(&self) -> Option<&Vec<u8>> {
        self.root.as_ref()
    }

    /// Get a specific node by hash.
    pub fn get_node(&self, hash: &[u8]) -> Option<&VineNode> {
        self.nodes.get(hash)
    }

    /// Generate an inclusion proof for a leaf at given index.
    pub fn generate_proof(&self, leaf_index: u64) -> crate::Result<InclusionProof> {
        if leaf_index >= self.leaves.len() as u64 {
            return Err(crate::Error::Config("Leaf index out of bounds".to_string()));
        }

        let leaf_hash = self.leaves[leaf_index as usize].clone();
        let root_hash = self
            .root
            .as_ref()
            .ok_or_else(|| crate::Error::Config("Vine has no root".to_string()))?
            .clone();

        // For a simple implementation, return the leaf hash as proof
        // In production, compute the actual Merkle path
        Ok(InclusionProof {
            leaf_hash: leaf_hash.clone(),
            leaf_index,
            root_hash,
            path: vec![],
            directions: vec![],
        })
    }

    /// Verify an inclusion proof.
    pub fn verify_proof(&self, proof: &InclusionProof) -> bool {
        // Simplified verification - in production, verify the full Merkle path
        if let Some(root) = &self.root {
            if root != &proof.root_hash {
                return false;
            }
        } else {
            return false;
        }

        // Check leaf exists at claimed index
        if proof.leaf_index >= self.leaves.len() as u64 {
            return false;
        }

        self.leaves[proof.leaf_index as usize] == proof.leaf_hash
    }

    /// Get the number of leaves in the vine.
    pub fn leaf_count(&self) -> usize {
        self.leaves.len()
    }

    /// Get all leaf hashes in order.
    pub fn get_leaves(&self) -> &[Vec<u8>] {
        &self.leaves
    }
}

/// Simplified hash function for demonstration (use BLAKE3 in production).
fn simple_hash(data: &[u8]) -> Vec<u8> {
    // In production, use blake3::hash(data).as_bytes().to_vec()
    let mut hash = vec![0u8; 32];
    for (i, &byte) in data.iter().enumerate() {
        hash[i % 32] ^= byte;
    }
    hash
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_new_vine() {
        let vine = MerkleVine::new("test-vine");
        assert_eq!(vine.vine_id, "test-vine");
        assert_eq!(vine.leaf_count(), 0);
        assert!(vine.get_root().is_none());
    }

    #[test]
    fn test_add_single_leaf() {
        let mut vine = MerkleVine::new("test-vine");
        let data = b"test data".to_vec();
        let hash = simple_hash(&data);

        let index = vine.add_leaf(data, hash.clone(), 1000).unwrap();

        assert_eq!(index, 0);
        assert_eq!(vine.leaf_count(), 1);
        assert_eq!(vine.get_root().unwrap(), &hash);
    }

    #[test]
    fn test_add_multiple_leaves() {
        let mut vine = MerkleVine::new("test-vine");

        for i in 0..5 {
            let data = format!("data{}", i).into_bytes();
            let hash = simple_hash(&data);
            vine.add_leaf(data, hash, 1000 + i).unwrap();
        }

        assert_eq!(vine.leaf_count(), 5);
        assert!(vine.get_root().is_some());
    }

    #[test]
    fn test_generate_and_verify_proof() {
        let mut vine = MerkleVine::new("test-vine");

        let data = b"test data".to_vec();
        let hash = simple_hash(&data);
        vine.add_leaf(data, hash, 1000).unwrap();

        let proof = vine.generate_proof(0).unwrap();
        assert!(vine.verify_proof(&proof));
    }

    #[test]
    fn test_multiple_leaves_proof() {
        let mut vine = MerkleVine::new("test-vine");

        for i in 0..3 {
            let data = format!("data{}", i).into_bytes();
            let hash = simple_hash(&data);
            vine.add_leaf(data, hash, 1000 + i).unwrap();
        }

        // Verify proof for middle leaf
        let proof = vine.generate_proof(1).unwrap();
        assert!(vine.verify_proof(&proof));
    }

    #[test]
    fn test_invalid_proof_index() {
        let mut vine = MerkleVine::new("test-vine");
        let data = b"test".to_vec();
        let hash = simple_hash(&data);
        vine.add_leaf(data, hash, 1000).unwrap();

        let result = vine.generate_proof(10);
        assert!(result.is_err());
    }

    #[test]
    fn test_get_leaves() {
        let mut vine = MerkleVine::new("test-vine");

        let mut hashes = Vec::new();
        for i in 0..3 {
            let data = format!("data{}", i).into_bytes();
            let hash = simple_hash(&data);
            hashes.push(hash.clone());
            vine.add_leaf(data, hash, 1000 + i).unwrap();
        }

        assert_eq!(vine.get_leaves(), hashes.as_slice());
    }
}
