//! Aetheric Whisper - Gossip Protocol for State Propagation
//!
//! Lightweight gossip protocol for propagating Merkle Roots across the swarm
//! without central coordination.

use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::time::{SystemTime, UNIX_EPOCH};

/// Gossip message containing state updates
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GossipMessage {
    /// Message ID for deduplication
    pub msg_id: String,
    /// Source node ID
    pub source_node: String,
    /// Merkle root hash being gossiped
    pub merkle_root: Vec<u8>,
    /// Block height / sequence number
    pub block_height: u64,
    /// Timestamp of message creation
    pub timestamp: u64,
    /// Signature from source node
    pub signature: Vec<u8>,
    /// Number of hops this message has traveled
    pub hop_count: u8,
}

/// Gossip protocol manager
#[derive(Debug)]
pub struct AethericWhisper {
    /// Node's own ID
    node_id: String,
    /// Current local Merkle root
    local_merkle_root: Option<Vec<u8>>,
    /// Current local block height
    local_block_height: u64,
    /// Recently seen message IDs for deduplication
    seen_messages: HashSet<String>,
    /// Peer states: node_id -> (merkle_root, block_height, timestamp)
    peer_states: HashMap<String, (Vec<u8>, u64, u64)>,
    /// Maximum hops before message is dropped
    max_hops: u8,
    /// Maximum age for messages (milliseconds)
    max_message_age_ms: u64,
}

impl AethericWhisper {
    /// Create a new gossip protocol manager
    pub fn new(node_id: String) -> Self {
        Self {
            node_id,
            local_merkle_root: None,
            local_block_height: 0,
            seen_messages: HashSet::new(),
            peer_states: HashMap::new(),
            max_hops: 10,
            max_message_age_ms: 60000, // 60 seconds
        }
    }

    /// Update local state with new Merkle root
    pub fn update_local_state(&mut self, merkle_root: Vec<u8>, block_height: u64) {
        self.local_merkle_root = Some(merkle_root);
        self.local_block_height = block_height;
    }

    /// Create a gossip message with current local state
    pub fn create_gossip_message(&self, signature: Vec<u8>) -> Option<GossipMessage> {
        self.local_merkle_root.as_ref().map(|root| GossipMessage {
            msg_id: format!("{}-{}", self.node_id, current_timestamp()),
            source_node: self.node_id.clone(),
            merkle_root: root.clone(),
            block_height: self.local_block_height,
            timestamp: current_timestamp(),
            signature,
            hop_count: 0,
        })
    }

    /// Process an incoming gossip message
    pub fn process_message(&mut self, mut message: GossipMessage) -> GossipResult {
        // Check if message is too old
        let now = current_timestamp();
        if now - message.timestamp > self.max_message_age_ms {
            return GossipResult::Dropped("Message too old".to_string());
        }

        // Check hop count
        if message.hop_count >= self.max_hops {
            return GossipResult::Dropped("Max hops exceeded".to_string());
        }

        // Check for duplicate
        if self.seen_messages.contains(&message.msg_id) {
            return GossipResult::Duplicate;
        }

        // Mark as seen
        self.seen_messages.insert(message.msg_id.clone());

        // Update peer state
        self.peer_states.insert(
            message.source_node.clone(),
            (
                message.merkle_root.clone(),
                message.block_height,
                message.timestamp,
            ),
        );

        // Check for conflict with local state
        if let Some(local_root) = &self.local_merkle_root {
            if message.merkle_root != *local_root
                && message.block_height == self.local_block_height
            {
                // Fork detected at same height
                return GossipResult::ConflictDetected {
                    local_root: local_root.clone(),
                    local_height: self.local_block_height,
                    peer_root: message.merkle_root.clone(),
                    peer_height: message.block_height,
                    peer_node: message.source_node.clone(),
                };
            }

            // Peer is ahead
            if message.block_height > self.local_block_height {
                return GossipResult::PeerAhead {
                    peer_root: message.merkle_root.clone(),
                    peer_height: message.block_height,
                    peer_node: message.source_node.clone(),
                };
            }
        }

        // Increment hop count for forwarding
        message.hop_count += 1;

        GossipResult::Accepted {
            should_forward: true,
            message,
        }
    }

    /// Get the current consensus view (most common state among peers)
    pub fn get_consensus_view(&self) -> Option<ConsensusView> {
        if self.peer_states.is_empty() {
            return None;
        }

        // Count occurrences of each (merkle_root, block_height) pair
        let mut state_counts: HashMap<(Vec<u8>, u64), usize> = HashMap::new();
        for (root, height, _) in self.peer_states.values() {
            *state_counts.entry((root.clone(), *height)).or_insert(0) += 1;
        }

        // Find most common state
        let max_count = state_counts.values().max().copied()?;
        let consensus_state = state_counts
            .into_iter()
            .find(|(_, count)| *count == max_count)?;

        Some(ConsensusView {
            merkle_root: consensus_state.0 .0,
            block_height: consensus_state.0 .1,
            peer_count: max_count,
            total_peers: self.peer_states.len(),
        })
    }

    /// Prune old messages from seen set
    pub fn prune_old_messages(&mut self, max_seen: usize) {
        if self.seen_messages.len() > max_seen {
            self.seen_messages.clear();
        }
    }

    /// Get peer state
    pub fn get_peer_state(&self, node_id: &str) -> Option<&(Vec<u8>, u64, u64)> {
        self.peer_states.get(node_id)
    }
}

/// Result of processing a gossip message
#[derive(Debug)]
pub enum GossipResult {
    /// Message accepted and should be forwarded
    Accepted {
        /// Whether to forward to other peers
        should_forward: bool,
        /// The message to forward
        message: GossipMessage,
    },
    /// Duplicate message, already seen
    Duplicate,
    /// Message dropped (too old, max hops, etc.)
    Dropped(String),
    /// Fork detected - peer has different root at same height
    ConflictDetected {
        /// Local Merkle root
        local_root: Vec<u8>,
        /// Local block height
        local_height: u64,
        /// Peer's Merkle root
        peer_root: Vec<u8>,
        /// Peer's block height
        peer_height: u64,
        /// Peer node ID
        peer_node: String,
    },
    /// Peer is ahead of us
    PeerAhead {
        /// Peer's Merkle root
        peer_root: Vec<u8>,
        /// Peer's block height
        peer_height: u64,
        /// Peer node ID
        peer_node: String,
    },
}

/// Consensus view of the network
#[derive(Debug, Clone)]
pub struct ConsensusView {
    /// Consensus Merkle root
    pub merkle_root: Vec<u8>,
    /// Consensus block height
    pub block_height: u64,
    /// Number of peers agreeing
    pub peer_count: usize,
    /// Total number of peers
    pub total_peers: usize,
}

/// Get current timestamp in milliseconds
fn current_timestamp() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_millis() as u64
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_create_gossip_message() {
        let mut whisper = AethericWhisper::new("node1".to_string());
        whisper.update_local_state(vec![1, 2, 3], 100);

        let msg = whisper.create_gossip_message(vec![4, 5, 6]).unwrap();
        assert_eq!(msg.source_node, "node1");
        assert_eq!(msg.merkle_root, vec![1, 2, 3]);
        assert_eq!(msg.block_height, 100);
        assert_eq!(msg.hop_count, 0);
    }

    #[test]
    fn test_process_message_accepted() {
        let mut whisper = AethericWhisper::new("node1".to_string());
        whisper.update_local_state(vec![1, 2, 3], 100);

        let msg = GossipMessage {
            msg_id: "msg1".to_string(),
            source_node: "node2".to_string(),
            merkle_root: vec![1, 2, 3],
            block_height: 100,
            timestamp: current_timestamp(),
            signature: vec![],
            hop_count: 0,
        };

        match whisper.process_message(msg) {
            GossipResult::Accepted { should_forward, .. } => assert!(should_forward),
            _ => panic!("Expected Accepted"),
        }
    }

    #[test]
    fn test_process_duplicate_message() {
        let mut whisper = AethericWhisper::new("node1".to_string());

        let msg = GossipMessage {
            msg_id: "msg1".to_string(),
            source_node: "node2".to_string(),
            merkle_root: vec![1, 2, 3],
            block_height: 100,
            timestamp: current_timestamp(),
            signature: vec![],
            hop_count: 0,
        };

        whisper.process_message(msg.clone());
        let result = whisper.process_message(msg);

        matches!(result, GossipResult::Duplicate);
    }

    #[test]
    fn test_conflict_detection() {
        let mut whisper = AethericWhisper::new("node1".to_string());
        whisper.update_local_state(vec![1, 2, 3], 100);

        let msg = GossipMessage {
            msg_id: "msg1".to_string(),
            source_node: "node2".to_string(),
            merkle_root: vec![4, 5, 6], // Different root, same height
            block_height: 100,
            timestamp: current_timestamp(),
            signature: vec![],
            hop_count: 0,
        };

        match whisper.process_message(msg) {
            GossipResult::ConflictDetected { .. } => {}
            _ => panic!("Expected ConflictDetected"),
        }
    }

    #[test]
    fn test_peer_ahead_detection() {
        let mut whisper = AethericWhisper::new("node1".to_string());
        whisper.update_local_state(vec![1, 2, 3], 100);

        let msg = GossipMessage {
            msg_id: "msg1".to_string(),
            source_node: "node2".to_string(),
            merkle_root: vec![4, 5, 6],
            block_height: 150, // Higher block height
            timestamp: current_timestamp(),
            signature: vec![],
            hop_count: 0,
        };

        match whisper.process_message(msg) {
            GossipResult::PeerAhead { .. } => {}
            _ => panic!("Expected PeerAhead"),
        }
    }

    #[test]
    fn test_max_hops_enforcement() {
        let mut whisper = AethericWhisper::new("node1".to_string());
        whisper.max_hops = 3;

        let msg = GossipMessage {
            msg_id: "msg1".to_string(),
            source_node: "node2".to_string(),
            merkle_root: vec![1, 2, 3],
            block_height: 100,
            timestamp: current_timestamp(),
            signature: vec![],
            hop_count: 10,
        };

        match whisper.process_message(msg) {
            GossipResult::Dropped(reason) => assert!(reason.contains("hops")),
            _ => panic!("Expected Dropped"),
        }
    }

    #[test]
    fn test_get_consensus_view() {
        let mut whisper = AethericWhisper::new("node1".to_string());

        // Simulate 3 peers with same state
        whisper.peer_states.insert(
            "node2".to_string(),
            (vec![1, 2, 3], 100, current_timestamp()),
        );
        whisper.peer_states.insert(
            "node3".to_string(),
            (vec![1, 2, 3], 100, current_timestamp()),
        );
        whisper.peer_states.insert(
            "node4".to_string(),
            (vec![1, 2, 3], 100, current_timestamp()),
        );

        let consensus = whisper.get_consensus_view().unwrap();
        assert_eq!(consensus.merkle_root, vec![1, 2, 3]);
        assert_eq!(consensus.block_height, 100);
        assert_eq!(consensus.peer_count, 3);
    }
}
