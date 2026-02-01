//! Merkle-Vine: Cryptographic structure for streaming data.
//! SECURITY: Uses BLAKE3 (256-bit).

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use blake3::Hasher;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct VineNode {
    pub hash: Vec<u8>,
    pub index: u64,
    pub left: Option<Vec<u8>>,
    pub right: Option<Vec<u8>>,
    pub data: Option<Vec<u8>>,
    pub timestamp: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MerkleVine {
    pub vine_id: String,
    nodes: HashMap<Vec<u8>, VineNode>,
    leaves: Vec<Vec<u8>>,
    root: Option<Vec<u8>>,
    next_index: u64,
}

impl MerkleVine {
    pub fn new(vine_id: impl Into<String>) -> Self {
        Self {
            vine_id: vine_id.into(),
            nodes: HashMap::new(),
            leaves: Vec::new(),
            root: None,
            next_index: 0,
        }
    }

    pub fn add_leaf(&mut self, data: Vec<u8>, timestamp: u64) -> crate::Result<u64> {
        let index = self.next_index;
        let data_hash = hash_leaf(&data); // Hash raw data
        let node_hash = hash_node_meta(&data_hash, index, timestamp); // Hash metadata

        let node = VineNode {
            hash: node_hash.clone(),
            index,
            left: None,
            right: None,
            data: Some(data),
            timestamp,
        };

        self.nodes.insert(node_hash.clone(), node);
        self.leaves.push(node_hash.clone());
        self.next_index += 1;
        self.recompute_root()?;
        Ok(index)
    }

    fn recompute_root(&mut self) -> crate::Result<()> {
        if self.leaves.is_empty() { self.root = None; return Ok(()); }
        if self.leaves.len() == 1 { self.root = Some(self.leaves[0].clone()); return Ok(()); }

        let mut level = self.leaves.clone();
        while level.len() > 1 {
            let mut next_level = Vec::new();
            for chunk in level.chunks(2) {
                if chunk.len() == 2 {
                    let left = chunk[0].clone();
                    let right = chunk[1].clone();
                    let parent_hash = hash_parent(&left, &right);
                    let parent = VineNode {
                        hash: parent_hash.clone(),
                        index: 0, 
                        left: Some(left),
                        right: Some(right),
                        data: None,
                        timestamp: 0,
                    };
                    self.nodes.insert(parent_hash.clone(), parent);
                    next_level.push(parent_hash);
                } else {
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

    /// Get the number of leaves in the vine.
    pub fn leaf_count(&self) -> usize {
        self.leaves.len()
    }

    /// Get all leaf hashes in order.
    pub fn get_leaves(&self) -> &[Vec<u8>] {
        &self.leaves
    }
}

pub fn hash_leaf(data: &[u8]) -> Vec<u8> {
    let mut hasher = Hasher::new();
    hasher.update(b"4MIK-LEAF-V1");
    hasher.update(data);
    hasher.finalize().as_bytes().to_vec()
}

pub fn hash_node_meta(data_hash: &[u8], index: u64, timestamp: u64) -> Vec<u8> {
    let mut hasher = Hasher::new();
    hasher.update(b"4MIK-META-V1");
    hasher.update(data_hash);
    hasher.update(&index.to_be_bytes());
    hasher.update(&timestamp.to_be_bytes());
    hasher.finalize().as_bytes().to_vec()
}

pub fn hash_parent(left: &[u8], right: &[u8]) -> Vec<u8> {
    let mut hasher = Hasher::new();
    hasher.update(b"4MIK-NODE-V1");
    hasher.update(left);
    hasher.update(right);
    hasher.finalize().as_bytes().to_vec()
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

        let index = vine.add_leaf(data, 1000).unwrap();

        assert_eq!(index, 0);
        assert_eq!(vine.leaf_count(), 1);
        assert!(vine.get_root().is_some());
    }

    #[test]
    fn test_add_multiple_leaves() {
        let mut vine = MerkleVine::new("test-vine");

        for i in 0..5 {
            let data = format!("data{}", i).into_bytes();
            vine.add_leaf(data, 1000 + i).unwrap();
        }

        assert_eq!(vine.leaf_count(), 5);
        assert!(vine.get_root().is_some());
    }

    #[test]
    fn test_blake3_hashing() {
        let data = b"test data";
        let hash = hash_leaf(data);
        assert_eq!(hash.len(), 32); // BLAKE3 produces 32-byte hashes
    }

    #[test]
    fn test_deterministic_hashing() {
        let data = b"test data";
        let hash1 = hash_leaf(data);
        let hash2 = hash_leaf(data);
        assert_eq!(hash1, hash2); // Same input should produce same hash
    }

    #[test]
    fn test_node_meta_hash() {
        let data_hash = vec![0u8; 32];
        let hash = hash_node_meta(&data_hash, 0, 1000);
        assert_eq!(hash.len(), 32);
    }

    #[test]
    fn test_parent_hash() {
        let left = vec![1u8; 32];
        let right = vec![2u8; 32];
        let hash = hash_parent(&left, &right);
        assert_eq!(hash.len(), 32);
    }
}
