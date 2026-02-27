//! Chain Builder for Event Chains
//!
//! Pure domain logic for building and verifying event chains with:
//! - Linear predecessor links
//! - Exponential skip links (powers of 2)
//! - Merkle-Vine aggregation
//! - BLAKE3 hashing

use crate::{CanonicalEvent, DomainError, EventHash, Result};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// Chain link representing an event in the chain
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChainLink {
    /// Event hash
    pub event_hash: EventHash,

    /// Sequence number in chain
    pub sequence: u64,

    /// Hash of previous link (empty for genesis)
    pub previous_hash: EventHash,

    /// Skip link pointers (exponential backpointers)
    pub skip_links: Vec<SkipLink>,

    /// Timestamp of link creation
    pub timestamp: u64,

    /// Device ID that created this event
    pub device_id: String,
}

/// Skip link for efficient chain traversal
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SkipLink {
    /// Distance back in chain (power of 2)
    pub distance: u64,

    /// Hash of target link
    pub target_hash: EventHash,

    /// Sequence number of target
    pub target_sequence: u64,
}

/// Chain root representing the current state of the chain
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChainRoot {
    /// Root hash (Merkle root of all events)
    pub root_hash: EventHash,

    /// Current chain length
    pub length: u64,

    /// Hash of most recent link
    pub head_hash: EventHash,

    /// Timestamp of last update
    pub updated_at: u64,
}

/// ChainBuilder maintains event chains and computes Merkle roots
///
/// This is pure domain logic with no I/O dependencies.
pub struct ChainBuilder {
    /// Chain identifier
    chain_id: String,

    /// All links indexed by hash
    links: HashMap<EventHash, ChainLink>,

    /// Links in sequence order
    sequence: Vec<EventHash>,

    /// Current root
    root: Option<ChainRoot>,
}

impl ChainBuilder {
    /// Create a new chain builder
    pub fn new(chain_id: impl Into<String>) -> Self {
        Self {
            chain_id: chain_id.into(),
            links: HashMap::new(),
            sequence: Vec::new(),
            root: None,
        }
    }

    /// Append an event to the chain
    ///
    /// This is the core domain operation that:
    /// 1. Assigns sequence number
    /// 2. Links to previous event
    /// 3. Computes skip links
    /// 4. Updates Merkle root
    pub fn append_event(&mut self, event: &CanonicalEvent) -> Result<ChainLink> {
        // Get sequence number
        let sequence = self.sequence.len() as u64;

        // Get previous hash
        let previous_hash = if sequence == 0 {
            String::new() // Genesis
        } else {
            self.sequence
                .last()
                .ok_or_else(|| DomainError::ChainError("No previous link".to_string()))?
                .clone()
        };

        // Compute skip links
        let skip_links = self.compute_skip_links(sequence)?;

        // Create chain link
        let link = ChainLink {
            event_hash: event.hash.clone(),
            sequence,
            previous_hash,
            skip_links,
            timestamp: event.timestamp,
            device_id: event.device_id.clone(),
        };

        // Verify event hash is correct
        if !event.verify_hash()? {
            return Err(DomainError::ValidationError(
                "Event hash mismatch".to_string(),
            ));
        }

        // Add to chain
        self.links.insert(event.hash.clone(), link.clone());
        self.sequence.push(event.hash.clone());

        // Recompute root
        self.recompute_root()?;

        Ok(link)
    }

    /// Compute skip links for a sequence number
    ///
    /// Skip links follow exponential pattern: 2^0, 2^1, 2^2, ...
    /// For sequence N, create links to N-1, N-2, N-4, N-8, N-16, ...
    fn compute_skip_links(&self, sequence: u64) -> Result<Vec<SkipLink>> {
        let mut skip_links = Vec::new();

        if sequence == 0 {
            return Ok(skip_links); // Genesis has no skip links
        }

        // Linear predecessor (distance 1)
        if sequence >= 1 {
            if let Some(target_hash) = self.sequence.get((sequence - 1) as usize) {
                skip_links.push(SkipLink {
                    distance: 1,
                    target_hash: target_hash.clone(),
                    target_sequence: sequence - 1,
                });
            }
        }

        // Exponential skip links (powers of 2)
        let mut power = 1u64;
        loop {
            let distance = 1u64 << power; // 2^power
            if distance > sequence {
                break;
            }

            let target_seq = sequence - distance;
            if let Some(target_hash) = self.sequence.get(target_seq as usize) {
                skip_links.push(SkipLink {
                    distance,
                    target_hash: target_hash.clone(),
                    target_sequence: target_seq,
                });
            }

            power += 1;
            if power > 63 {
                break; // Prevent overflow
            }
        }

        Ok(skip_links)
    }

    /// Recompute Merkle root from current chain state
    fn recompute_root(&mut self) -> Result<()> {
        if self.sequence.is_empty() {
            self.root = None;
            return Ok(());
        }

        // Build Merkle tree bottom-up
        let mut level: Vec<Vec<u8>> = self
            .sequence
            .iter()
            .map(|h| hex::decode(h).unwrap_or_default())
            .collect();

        while level.len() > 1 {
            let mut next_level = Vec::new();

            for chunk in level.chunks(2) {
                if chunk.len() == 2 {
                    // Combine two nodes
                    let mut combined = chunk[0].clone();
                    combined.extend_from_slice(&chunk[1]);
                    let parent_hash = blake3::hash(&combined);
                    next_level.push(parent_hash.as_bytes().to_vec());
                } else {
                    // Odd node out, promote to next level
                    next_level.push(chunk[0].clone());
                }
            }

            level = next_level;
        }

        let root_bytes = &level[0];
        let root_hash = hex::encode(root_bytes);
        let head_hash = self
            .sequence
            .last()
            .ok_or_else(|| {
                DomainError::ChainError("Cannot create root from empty chain".to_string())
            })?
            .clone();
        let length = self.sequence.len() as u64;

        self.root = Some(ChainRoot {
            root_hash,
            length,
            head_hash,
            updated_at: std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map_err(|e| DomainError::ChainError(format!("System time error: {}", e)))?
                .as_millis() as u64,
        });

        Ok(())
    }

    /// Get current chain root
    pub fn get_root(&self) -> Option<&ChainRoot> {
        self.root.as_ref()
    }

    /// Get the chain identifier
    pub fn chain_id(&self) -> &str {
        &self.chain_id
    }

    /// Get a link by hash
    pub fn get_link(&self, hash: &str) -> Option<&ChainLink> {
        self.links.get(hash)
    }

    /// Get chain length
    pub fn len(&self) -> usize {
        self.sequence.len()
    }

    /// Check if chain is empty
    pub fn is_empty(&self) -> bool {
        self.sequence.is_empty()
    }

    /// Get event hash at a specific chain height
    pub fn get_hash_at(&self, height: u64) -> Option<&EventHash> {
        self.sequence.get(height as usize)
    }

    /// Verify chain continuity (no gaps or breaks)
    pub fn verify_continuity(&self) -> Result<bool> {
        if self.sequence.is_empty() {
            return Ok(true);
        }

        // Check genesis link
        let genesis_hash = &self.sequence[0];
        let genesis = self
            .links
            .get(genesis_hash)
            .ok_or_else(|| DomainError::ChainError("Missing genesis link".to_string()))?;

        if !genesis.previous_hash.is_empty() {
            return Err(DomainError::InvariantViolation(
                "Genesis must have empty previous_hash".to_string(),
            ));
        }

        // Check all subsequent links
        for i in 1..self.sequence.len() {
            let hash = &self.sequence[i];
            let link = self
                .links
                .get(hash)
                .ok_or_else(|| DomainError::ChainError(format!("Missing link at {}", i)))?;

            let prev_hash = &self.sequence[i - 1];
            if &link.previous_hash != prev_hash {
                return Err(DomainError::InvariantViolation(format!(
                    "Link {} does not point to correct predecessor",
                    i
                )));
            }

            if link.sequence != i as u64 {
                return Err(DomainError::InvariantViolation(format!(
                    "Link {} has incorrect sequence number",
                    i
                )));
            }
        }

        Ok(true)
    }

    /// Verify skip links are correct
    pub fn verify_skip_links(&self) -> Result<bool> {
        for (i, hash) in self.sequence.iter().enumerate() {
            let link = self.links.get(hash).ok_or_else(|| {
                DomainError::ChainError(format!("Missing link for hash at position {}", i))
            })?;

            for skip in &link.skip_links {
                // Verify target exists
                if skip.target_sequence >= i as u64 {
                    return Err(DomainError::InvariantViolation(
                        "Skip link points forward".to_string(),
                    ));
                }

                let target_hash = &self.sequence[skip.target_sequence as usize];
                if target_hash != &skip.target_hash {
                    return Err(DomainError::InvariantViolation(
                        "Skip link hash mismatch".to_string(),
                    ));
                }

                // Verify distance is correct
                let actual_distance = i as u64 - skip.target_sequence;
                if actual_distance != skip.distance {
                    return Err(DomainError::InvariantViolation(format!(
                        "Skip link distance mismatch: expected {}, got {}",
                        skip.distance, actual_distance
                    )));
                }

                // Verify distance is a power of 2
                if !is_power_of_two(skip.distance) {
                    return Err(DomainError::InvariantViolation(
                        "Skip link distance must be power of 2".to_string(),
                    ));
                }
            }
        }

        Ok(true)
    }
}

/// Check if a number is a power of 2
fn is_power_of_two(n: u64) -> bool {
    n > 0 && (n & (n - 1)) == 0
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::canonical_event::{EventPayload, EventType};

    fn create_test_event(id: &str, sequence: u64, timestamp: u64) -> CanonicalEvent {
        let mut event = CanonicalEvent {
            event_id: id.to_string(),
            event_type: EventType::GPS,
            timestamp,
            device_id: "test-device".to_string(),
            node_id: "test-node".to_string(),
            sequence,
            prev_hash: String::new(),
            chain_height: sequence,
            payload: EventPayload::GPS {
                latitude: 34.052235,
                longitude: -118.243683,
                altitude: None,
                speed: None,
                heading: None,
                hdop: None,
                satellites: None,
            },
            hash: String::new(),
            signature: String::new(),
            public_key: String::new(),
            metadata: None,
        };
        event.hash = event.compute_hash().unwrap();
        event
    }

    #[test]
    fn test_new_chain_builder() {
        let builder = ChainBuilder::new("test-chain");
        assert_eq!(builder.len(), 0);
        assert!(builder.is_empty());
        assert!(builder.get_root().is_none());
    }

    #[test]
    fn test_append_genesis_event() {
        let mut builder = ChainBuilder::new("test-chain");
        let event = create_test_event("event-1", 0, 1000);

        let link = builder.append_event(&event).unwrap();

        assert_eq!(link.sequence, 0);
        assert_eq!(link.previous_hash, "");
        assert_eq!(link.skip_links.len(), 0);
        assert_eq!(builder.len(), 1);
    }

    #[test]
    fn test_append_multiple_events() {
        let mut builder = ChainBuilder::new("test-chain");

        for i in 0..5 {
            let event = create_test_event(&format!("event-{}", i), i, 1000 + i * 100);
            builder.append_event(&event).unwrap();
        }

        assert_eq!(builder.len(), 5);
        assert!(builder.get_root().is_some());
    }

    #[test]
    fn test_skip_links_exponential() {
        let mut builder = ChainBuilder::new("test-chain");

        // Add 16 events
        for i in 0..16 {
            let event = create_test_event(&format!("event-{}", i), i, 1000 + i * 100);
            builder.append_event(&event).unwrap();
        }

        // Check event 15 has skip links to 14, 13, 11, 7
        let link15 = builder.get_link(&builder.sequence[15]).unwrap();

        // Should have skip links at distances: 1, 2, 4, 8
        let distances: Vec<u64> = link15.skip_links.iter().map(|s| s.distance).collect();
        assert_eq!(distances, vec![1, 2, 4, 8]);

        // Verify targets
        assert_eq!(link15.skip_links[0].target_sequence, 14); // 15-1
        assert_eq!(link15.skip_links[1].target_sequence, 13); // 15-2
        assert_eq!(link15.skip_links[2].target_sequence, 11); // 15-4
        assert_eq!(link15.skip_links[3].target_sequence, 7); // 15-8
    }

    #[test]
    fn test_verify_continuity() {
        let mut builder = ChainBuilder::new("test-chain");

        for i in 0..5 {
            let event = create_test_event(&format!("event-{}", i), i, 1000 + i * 100);
            builder.append_event(&event).unwrap();
        }

        assert!(builder.verify_continuity().unwrap());
    }

    #[test]
    fn test_verify_skip_links() {
        let mut builder = ChainBuilder::new("test-chain");

        for i in 0..10 {
            let event = create_test_event(&format!("event-{}", i), i, 1000 + i * 100);
            builder.append_event(&event).unwrap();
        }

        assert!(builder.verify_skip_links().unwrap());
    }

    #[test]
    fn test_is_power_of_two() {
        assert!(is_power_of_two(1));
        assert!(is_power_of_two(2));
        assert!(is_power_of_two(4));
        assert!(is_power_of_two(8));
        assert!(is_power_of_two(16));

        assert!(!is_power_of_two(0));
        assert!(!is_power_of_two(3));
        assert!(!is_power_of_two(5));
        assert!(!is_power_of_two(6));
    }

    #[test]
    fn test_chain_root_updates() {
        let mut builder = ChainBuilder::new("test-chain");

        let event1 = create_test_event("event-1", 0, 1000);
        builder.append_event(&event1).unwrap();

        let root1 = builder.get_root().unwrap().root_hash.clone();

        let event2 = create_test_event("event-2", 1, 2000);
        builder.append_event(&event2).unwrap();

        let root2 = builder.get_root().unwrap().root_hash.clone();

        // Root should change after adding event
        assert_ne!(root1, root2);
    }
}
