//! Tactical Mesh Layer - High-level coordinator
//!
//! Integrates all mesh components for resilient peer-to-peer networking
//! in contested, multi-domain environments.

use crate::bunker::{BunkerMode, BunkerState, StoredBlock, StoredEvent};
use crate::gossip::{AethericWhisper, GossipMessage, GossipResult};
use crate::peer::{PeerInfo, PeerTable};
use crate::routing::{LinkQuality, RoutingTable};
use crate::spectral::{FrequencyHopper, HoppingPattern};
use serde::{Deserialize, Serialize};
use std::path::Path;

/// Tactical Mesh Layer coordinator
pub struct TacticalMesh {
    /// Node identifier
    node_id: String,
    /// Peer discovery and management
    peer_table: PeerTable,
    /// Gossip protocol for state propagation
    gossip: AethericWhisper,
    /// Multi-hop routing
    routing_table: RoutingTable,
    /// Frequency hopping for EW hardening
    frequency_hopper: FrequencyHopper,
    /// Offline-first persistence
    bunker_mode: BunkerMode,
}

impl TacticalMesh {
    /// Create a new tactical mesh instance
    pub fn new<P: AsRef<Path>>(
        node_id: String,
        seed_peers: Vec<String>,
        db_path: P,
    ) -> Result<Self, String> {
        let bunker_mode = BunkerMode::new(db_path).map_err(|e| e.to_string())?;

        Ok(Self {
            node_id: node_id.clone(),
            peer_table: PeerTable::new(seed_peers),
            gossip: AethericWhisper::new(node_id.clone()),
            routing_table: RoutingTable::new(node_id.clone()),
            frequency_hopper: FrequencyHopper::new(0.1), // 10% PER threshold
            bunker_mode,
        })
    }

    /// Add or update a peer
    pub fn add_peer(&mut self, peer: PeerInfo) -> Result<(), String> {
        // Update peer table
        self.peer_table.upsert_peer(peer.clone())?;

        // Update routing table with direct link
        // TODO: Replace hardcoded values with actual link quality measurements
        let link_quality = LinkQuality {
            snr_db: 20.0, // Placeholder - should be measured from radio layer
            trust_score: peer.trust_score,
            latency_ms: peer.latency_ms,
            packet_error_rate: 0.01, // Placeholder - should be measured from radio layer
            last_measured: peer.last_seen,
        };

        self.routing_table
            .update_neighbor(peer.node_id.clone(), link_quality);

        // Check if we need to exit bunker mode
        if self.bunker_mode.state() == &BunkerState::Isolated && self.peer_table.peer_count() > 0
        {
            self.bunker_mode.exit_bunker_mode();
        }

        Ok(())
    }

    /// Remove a peer (link failed)
    pub fn remove_peer(&mut self, node_id: &str) {
        self.peer_table.remove_peer(node_id);
        self.routing_table.remove_neighbor(node_id);

        // Check if we need to enter bunker mode
        if self.peer_table.is_bunker_mode() {
            self.bunker_mode.enter_bunker_mode();
        }
    }

    /// Process incoming gossip message
    pub fn process_gossip(&mut self, message: GossipMessage) -> GossipResult {
        self.gossip.process_message(message)
    }

    /// Update local state and create gossip message
    pub fn update_local_state(
        &mut self,
        merkle_root: Vec<u8>,
        block_height: u64,
        signature: Vec<u8>,
    ) -> Option<GossipMessage> {
        self.gossip.update_local_state(merkle_root, block_height);
        self.gossip.create_gossip_message(signature)
    }

    /// Find next hop for routing to destination
    pub fn find_route(&self, destination: &str) -> Option<String> {
        self.routing_table.find_next_hop(destination)
    }

    /// Set frequency hopping pattern
    pub fn set_hopping_pattern(&mut self, pattern: HoppingPattern) {
        self.frequency_hopper.set_pattern(pattern);
    }

    /// Update link quality metrics and check for frequency hop
    pub fn update_link_metrics(&mut self, per: f64) {
        self.frequency_hopper.update_per(per);

        // Check if we need to hop due to jamming
        if self.frequency_hopper.should_hop() {
            self.frequency_hopper.hop();
        }
    }

    /// Get current operational state
    pub fn get_mesh_status(&self) -> MeshStatus {
        MeshStatus {
            node_id: self.node_id.clone(),
            peer_count: self.peer_table.peer_count(),
            bunker_mode: self.bunker_mode.state() == &BunkerState::Isolated,
            jamming_detected: self.frequency_hopper.is_jamming_detected(),
            current_channel: self.frequency_hopper.current_channel(),
        }
    }

    /// Store data locally (for bunker mode)
    pub fn store_block(&mut self, block: StoredBlock) -> Result<(), String> {
        self.bunker_mode
            .store_block(block)
            .map_err(|e| e.to_string())
    }

    /// Store event locally (for bunker mode)
    pub fn store_event(&mut self, event: StoredEvent) -> Result<(), String> {
        self.bunker_mode
            .store_event(event)
            .map_err(|e| e.to_string())
    }

    /// Get unsynced data for deferred sync
    pub fn get_unsynced_data(&self) -> Result<(Vec<StoredBlock>, Vec<StoredEvent>), String> {
        let blocks = self
            .bunker_mode
            .get_unsynced_blocks()
            .map_err(|e| e.to_string())?;
        let events = self
            .bunker_mode
            .get_unsynced_events()
            .map_err(|e| e.to_string())?;
        Ok((blocks, events))
    }

    /// Mark data as synced after successful upload
    pub fn mark_synced(&mut self, block_hashes: Vec<Vec<u8>>, event_ids: Vec<String>) -> Result<(), String> {
        for hash in block_hashes {
            self.bunker_mode
                .mark_block_synced(&hash)
                .map_err(|e| e.to_string())?;
        }
        for id in event_ids {
            self.bunker_mode
                .mark_event_synced(&id)
                .map_err(|e| e.to_string())?;
        }

        // If all data is synced, return to connected state
        let (block_count, event_count) = self
            .bunker_mode
            .get_unsynced_count()
            .map_err(|e| e.to_string())?;
        if block_count == 0 && event_count == 0 && self.bunker_mode.state() == &BunkerState::Syncing {
            self.bunker_mode.enter_connected_state();
        }

        Ok(())
    }

    /// Get peer information
    pub fn get_peer(&self, node_id: &str) -> Option<&PeerInfo> {
        self.peer_table.get_peer(node_id)
    }

    /// Get all active peers
    pub fn get_all_peers(&self) -> Vec<&PeerInfo> {
        self.peer_table.get_all_peers()
    }
}

/// Mesh operational status
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MeshStatus {
    /// Node identifier
    pub node_id: String,
    /// Number of active peers
    pub peer_count: usize,
    /// Whether in bunker mode
    pub bunker_mode: bool,
    /// Whether jamming is detected
    pub jamming_detected: bool,
    /// Current frequency channel
    pub current_channel: Option<u32>,
}

#[cfg(test)]
mod tests {
    use super::*;

    fn create_test_peer(id: &str) -> PeerInfo {
        PeerInfo {
            node_id: id.to_string(),
            trust_score: 0.8,
            latency_ms: 50,
            last_seen: std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_millis() as u64,
            address: "127.0.0.1:8080".to_string(),
            public_key: vec![1, 2, 3, 4],
            attestation_verified: true,
        }
    }

    #[test]
    fn test_tactical_mesh_creation() {
        let mesh = TacticalMesh::new(
            "node1".to_string(),
            vec!["seed1".to_string()],
            ":memory:",
        )
        .unwrap();

        let status = mesh.get_mesh_status();
        assert_eq!(status.node_id, "node1");
        assert_eq!(status.peer_count, 0);
        assert!(!status.bunker_mode);
    }

    #[test]
    fn test_add_peer_exits_bunker_mode() {
        let mut mesh = TacticalMesh::new("node1".to_string(), vec![], ":memory:").unwrap();

        // Initially in connected state
        assert_eq!(mesh.bunker_mode.state(), &BunkerState::Connected);

        // Remove all peers to enter bunker mode
        mesh.bunker_mode.enter_bunker_mode();
        assert_eq!(mesh.bunker_mode.state(), &BunkerState::Isolated);

        // Add peer should exit bunker mode
        mesh.add_peer(create_test_peer("node2")).unwrap();
        assert_eq!(mesh.bunker_mode.state(), &BunkerState::Syncing);
    }

    #[test]
    fn test_remove_peer_enters_bunker_mode() {
        let mut mesh = TacticalMesh::new("node1".to_string(), vec![], ":memory:").unwrap();

        mesh.add_peer(create_test_peer("node2")).unwrap();
        assert!(!mesh.get_mesh_status().bunker_mode);

        mesh.remove_peer("node2");
        let status = mesh.get_mesh_status();
        assert!(status.bunker_mode);
    }

    #[test]
    fn test_routing_through_peer() {
        let mut mesh = TacticalMesh::new("node1".to_string(), vec![], ":memory:").unwrap();

        mesh.add_peer(create_test_peer("node2")).unwrap();

        let next_hop = mesh.find_route("node2");
        assert_eq!(next_hop, Some("node2".to_string()));
    }

    #[test]
    fn test_store_and_retrieve_data() {
        let mut mesh = TacticalMesh::new("node1".to_string(), vec![], ":memory:").unwrap();

        let block = StoredBlock {
            hash: vec![1, 2, 3],
            height: 100,
            data: vec![4, 5, 6],
            timestamp: 1000,
            synced: false,
        };

        mesh.store_block(block.clone()).unwrap();

        let (blocks, _) = mesh.get_unsynced_data().unwrap();
        assert_eq!(blocks.len(), 1);
        assert_eq!(blocks[0].height, 100);
    }
}
