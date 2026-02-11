//! Peer Discovery and Topology Management
//!
//! Implements decentralized node discovery using mDNS for local LAN discovery
//! and seed peer lists for WAN bootstrapping.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::time::{SystemTime, UNIX_EPOCH};

/// Unique identifier for a node in the mesh
pub type NodeId = String;

/// Peer information with trust scoring
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PeerInfo {
    /// Unique node identifier
    pub node_id: NodeId,
    /// Trust score (0.0 to 1.0)
    pub trust_score: f64,
    /// Network latency in milliseconds
    pub latency_ms: u64,
    /// Last seen timestamp (Unix epoch milliseconds)
    pub last_seen: u64,
    /// Peer address (IP:port or multiaddr)
    pub address: String,
    /// Public key for signature verification
    pub public_key: Vec<u8>,
    /// Hardware attestation status
    pub attestation_verified: bool,
}

/// Peer discovery and management table
#[derive(Debug)]
pub struct PeerTable {
    /// Active peers indexed by node ID
    peers: HashMap<NodeId, PeerInfo>,
    /// Seed peer addresses for WAN bootstrapping
    seed_peers: Vec<String>,
    /// Maximum peers to track
    max_peers: usize,
    /// Minimum trust score threshold
    min_trust_score: f64,
}

impl PeerTable {
    /// Create a new peer table
    pub fn new(seed_peers: Vec<String>) -> Self {
        Self {
            peers: HashMap::new(),
            seed_peers,
            max_peers: 100,
            min_trust_score: 0.5,
        }
    }

    /// Add or update a peer
    pub fn upsert_peer(&mut self, peer: PeerInfo) -> Result<(), String> {
        // Validate trust score
        if peer.trust_score < self.min_trust_score {
            return Err(format!(
                "Trust score {} below minimum {}",
                peer.trust_score, self.min_trust_score
            ));
        }

        // Check capacity
        if self.peers.len() >= self.max_peers && !self.peers.contains_key(&peer.node_id) {
            // Evict lowest trust peer
            if let Some(lowest_peer_id) = self.find_lowest_trust_peer() {
                self.peers.remove(&lowest_peer_id);
            } else {
                return Err("Peer table full".to_string());
            }
        }

        self.peers.insert(peer.node_id.clone(), peer);
        Ok(())
    }

    /// Get a peer by node ID
    pub fn get_peer(&self, node_id: &str) -> Option<&PeerInfo> {
        self.peers.get(node_id)
    }

    /// Remove a peer
    pub fn remove_peer(&mut self, node_id: &str) -> Option<PeerInfo> {
        self.peers.remove(node_id)
    }

    /// Get all active peers
    pub fn get_all_peers(&self) -> Vec<&PeerInfo> {
        self.peers.values().collect()
    }

    /// Get peers suitable for routing (high trust, recently seen)
    pub fn get_routing_peers(&self, max_age_ms: u64) -> Vec<&PeerInfo> {
        let now = current_timestamp();
        self.peers
            .values()
            .filter(|p| p.trust_score >= self.min_trust_score && (now - p.last_seen) <= max_age_ms)
            .collect()
    }

    /// Find peer with lowest trust score
    fn find_lowest_trust_peer(&self) -> Option<NodeId> {
        self.peers
            .iter()
            .min_by(|a, b| a.1.trust_score.partial_cmp(&b.1.trust_score).unwrap())
            .map(|(id, _)| id.clone())
    }

    /// Update trust score for a peer
    pub fn update_trust_score(&mut self, node_id: &str, new_score: f64) -> Result<(), String> {
        if let Some(peer) = self.peers.get_mut(node_id) {
            peer.trust_score = new_score;
            Ok(())
        } else {
            Err("Peer not found".to_string())
        }
    }

    /// Get peer count
    pub fn peer_count(&self) -> usize {
        self.peers.len()
    }

    /// Get seed peers
    pub fn seed_peers(&self) -> &[String] {
        &self.seed_peers
    }

    /// Check if we're in Bunker Mode (no active peers)
    pub fn is_bunker_mode(&self) -> bool {
        self.peer_count() == 0
    }
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

    fn create_test_peer(id: &str, trust_score: f64) -> PeerInfo {
        PeerInfo {
            node_id: id.to_string(),
            trust_score,
            latency_ms: 50,
            last_seen: current_timestamp(),
            address: "127.0.0.1:8080".to_string(),
            public_key: vec![1, 2, 3, 4],
            attestation_verified: true,
        }
    }

    #[test]
    fn test_peer_table_creation() {
        let table = PeerTable::new(vec!["seed1".to_string(), "seed2".to_string()]);
        assert_eq!(table.peer_count(), 0);
        assert_eq!(table.seed_peers().len(), 2);
    }

    #[test]
    fn test_upsert_peer() {
        let mut table = PeerTable::new(vec![]);
        let peer = create_test_peer("node1", 0.8);

        table.upsert_peer(peer.clone()).unwrap();
        assert_eq!(table.peer_count(), 1);

        let retrieved = table.get_peer("node1").unwrap();
        assert_eq!(retrieved.node_id, "node1");
    }

    #[test]
    fn test_reject_low_trust_peer() {
        let mut table = PeerTable::new(vec![]);
        let peer = create_test_peer("node1", 0.3);

        let result = table.upsert_peer(peer);
        assert!(result.is_err());
    }

    #[test]
    fn test_update_trust_score() {
        let mut table = PeerTable::new(vec![]);
        let peer = create_test_peer("node1", 0.8);
        table.upsert_peer(peer).unwrap();

        table.update_trust_score("node1", 0.9).unwrap();
        assert_eq!(table.get_peer("node1").unwrap().trust_score, 0.9);
    }

    #[test]
    fn test_bunker_mode_detection() {
        let table = PeerTable::new(vec![]);
        assert!(table.is_bunker_mode());

        let mut table = PeerTable::new(vec![]);
        table.upsert_peer(create_test_peer("node1", 0.8)).unwrap();
        assert!(!table.is_bunker_mode());
    }

    #[test]
    fn test_get_routing_peers() {
        let mut table = PeerTable::new(vec![]);

        // Add recent peer
        table.upsert_peer(create_test_peer("node1", 0.8)).unwrap();

        // Add old peer
        let mut old_peer = create_test_peer("node2", 0.9);
        old_peer.last_seen = current_timestamp() - 60000; // 60 seconds ago
        table.upsert_peer(old_peer).unwrap();

        let routing_peers = table.get_routing_peers(30000); // 30 second window
        assert_eq!(routing_peers.len(), 1);
        assert_eq!(routing_peers[0].node_id, "node1");
    }
}
