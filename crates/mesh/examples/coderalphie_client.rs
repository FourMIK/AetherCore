//! CodeRalphie Edge Client - Tactical Mesh Integration Example
//!
//! This example demonstrates how to integrate the Tactical Mesh Layer
//! with a CodeRalphie edge client for resilient C2 in contested environments.
//!
//! Run with: cargo run --example coderalphie_client

use aethercore_mesh::{
    TacticalMesh, PeerInfo, GossipMessage, StoredBlock, StoredEvent,
    generate_hopping_pattern,
};
use std::time::{SystemTime, UNIX_EPOCH};

/// CodeRalphie edge client
struct CodeRalphieClient {
    /// Node identifier
    node_id: String,
    /// Tactical mesh instance
    mesh: TacticalMesh,
}

impl CodeRalphieClient {
    /// Create a new CodeRalphie client
    fn new(node_id: String, seed_peers: Vec<String>) -> Result<Self, String> {
        let db_path = format!("/tmp/coderalphie_{}.db", node_id);
        let mesh = TacticalMesh::new(node_id.clone(), seed_peers, db_path)?;

        Ok(Self { node_id, mesh })
    }

    /// Simulate peer discovery via mDNS
    fn discover_peers(&mut self) -> Result<(), String> {
        println!("[{}] Discovering peers via mDNS...", self.node_id);

        // Simulate discovering peer nodes
        let peers = vec![
            PeerInfo {
                node_id: "node-alpha-2".to_string(),
                trust_score: 0.95,
                latency_ms: 45,
                last_seen: current_timestamp(),
                address: "192.168.1.101:8080".to_string(),
                public_key: vec![1, 2, 3, 4],
                attestation_verified: true,
            },
            PeerInfo {
                node_id: "node-bravo-1".to_string(),
                trust_score: 0.88,
                latency_ms: 120,
                last_seen: current_timestamp(),
                address: "192.168.1.102:8080".to_string(),
                public_key: vec![5, 6, 7, 8],
                attestation_verified: true,
            },
        ];

        for peer in peers {
            println!("  - Discovered peer: {} (trust: {:.2})", peer.node_id, peer.trust_score);
            self.mesh.add_peer(peer)?;
        }

        Ok(())
    }

    /// Update local state and gossip to swarm
    fn publish_state_update(&mut self, merkle_root: Vec<u8>, block_height: u64) -> Result<(), String> {
        println!("[{}] Publishing state update (height: {}, root: {:?}...)", 
                 self.node_id, block_height, &merkle_root[..4]);

        // Sign with dummy signature (in production, use TPM)
        let signature = vec![0u8; 64];

        if let Some(message) = self.mesh.update_local_state(merkle_root, block_height, signature) {
            println!("  - Gossip message created: {}", message.msg_id);
            // In production, broadcast to peers
        }

        Ok(())
    }

    /// Process incoming gossip message
    fn handle_gossip(&mut self, message: GossipMessage) {
        println!("[{}] Received gossip from {}", self.node_id, message.source_node);

        match self.mesh.process_gossip(message) {
            aethercore_mesh::GossipResult::Accepted { should_forward, message } => {
                println!("  - Message accepted (height: {})", message.block_height);
                if should_forward {
                    println!("  - Forwarding to peers...");
                }
            }
            aethercore_mesh::GossipResult::ConflictDetected { peer_node, peer_height, .. } => {
                println!("  - ⚠️  FORK DETECTED from {} at height {}", peer_node, peer_height);
                println!("  - Initiating branch sync...");
            }
            aethercore_mesh::GossipResult::PeerAhead { peer_node, peer_height, .. } => {
                println!("  - Peer {} is ahead at height {}, syncing...", peer_node, peer_height);
            }
            aethercore_mesh::GossipResult::Duplicate => {
                println!("  - Duplicate message, ignoring");
            }
            aethercore_mesh::GossipResult::Dropped(reason) => {
                println!("  - Message dropped: {}", reason);
            }
        }
    }

    /// Configure frequency hopping pattern
    fn configure_spectral_agility(&mut self) {
        println!("[{}] Configuring Spectral Agility...", self.node_id);

        // Generate deterministic hopping pattern from shared seed
        let seed = vec![42, 43, 44, 45]; // In production, derive from shared secret
        let pattern = generate_hopping_pattern(
            seed,
            10,              // 10 channels
            (2400, 2480),    // 2.4 GHz ISM band (MHz)
            100,             // 100ms dwell time
        );

        println!("  - Pattern: {:?}", pattern.channels);
        self.mesh.set_hopping_pattern(pattern);
    }

    /// Simulate jamming scenario
    fn simulate_jamming(&mut self) {
        println!("[{}] ⚠️  Jamming detected! PER = 0.35", self.node_id);
        
        // Update link metrics with high PER
        self.mesh.update_link_metrics(0.35);

        let status = self.mesh.get_mesh_status();
        if status.jamming_detected {
            println!("  - Frequency hop triggered to channel {:?}", status.current_channel);
        }
    }

    /// Enter bunker mode (network isolation)
    fn enter_bunker_mode(&mut self) -> Result<(), String> {
        println!("[{}] 🏰 ENTERING BUNKER MODE - All links severed", self.node_id);

        // Remove all peers to trigger bunker mode
        let peers: Vec<String> = self.mesh.get_all_peers()
            .iter()
            .map(|p| p.node_id.clone())
            .collect();

        for peer_id in peers {
            self.mesh.remove_peer(&peer_id);
        }

        let status = self.mesh.get_mesh_status();
        if status.bunker_mode {
            println!("  - Bunker mode active. Storing data locally...");
        }

        Ok(())
    }

    /// Store mission data while in bunker mode
    fn store_mission_data(&mut self) -> Result<(), String> {
        println!("[{}] Storing mission data offline...", self.node_id);

        // Store a block
        let block = StoredBlock {
            hash: vec![1, 2, 3, 4],
            height: 100,
            data: b"Mission telemetry data".to_vec(),
            timestamp: current_timestamp(),
            synced: false,
        };
        self.mesh.store_block(block)?;

        // Store an event
        let event = StoredEvent {
            id: "mission-001".to_string(),
            event_type: "c2_command".to_string(),
            payload: b"Target coordinates: 35.2N, 45.3E".to_vec(),
            timestamp: current_timestamp(),
            synced: false,
        };
        self.mesh.store_event(event)?;

        println!("  - Data stored in local SQLite chain_store");
        Ok(())
    }

    /// Reconnect and sync data
    fn reconnect_and_sync(&mut self) -> Result<(), String> {
        println!("[{}] 📡 Reconnecting to mesh...", self.node_id);

        // Rediscover peers
        self.discover_peers()?;

        let status = self.mesh.get_mesh_status();
        println!("  - Peers: {}, Bunker: {}", status.peer_count, status.bunker_mode);

        // Get unsynced data
        let (blocks, events) = self.mesh.get_unsynced_data()?;
        println!("  - Unsynced data: {} blocks, {} events", blocks.len(), events.len());

        // Simulate uploading data
        println!("  - Uploading to swarm...");
        let block_hashes: Vec<Vec<u8>> = blocks.iter().map(|b| b.hash.clone()).collect();
        let event_ids: Vec<String> = events.iter().map(|e| e.id.clone()).collect();

        self.mesh.mark_synced(block_hashes, event_ids)?;
        println!("  - Sync complete!");

        Ok(())
    }

    /// Display mesh status
    fn show_status(&self) {
        let status = self.mesh.get_mesh_status();
        println!("\n=== Mesh Status ===");
        println!("Node ID: {}", status.node_id);
        println!("Peers: {}", status.peer_count);
        println!("Bunker Mode: {}", status.bunker_mode);
        println!("Jamming: {}", status.jamming_detected);
        println!("Channel: {:?}", status.current_channel);
        println!("==================\n");
    }
}

fn current_timestamp() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_millis() as u64
}

fn main() -> Result<(), String> {
    println!("🚀 CodeRalphie Edge Client - Tactical Mesh Demo\n");

    // Create client
    let mut client = CodeRalphieClient::new(
        "node-alpha-1".to_string(),
        vec!["192.168.1.100:8080".to_string()],
    )?;

    // Phase 1: Normal Operation
    println!("=== Phase 1: Normal Operation ===\n");
    client.discover_peers()?;
    client.show_status();

    client.publish_state_update(vec![1, 2, 3, 4, 5, 6, 7, 8], 100)?;

    // Simulate receiving gossip
    let incoming_gossip = GossipMessage {
        msg_id: "msg-001".to_string(),
        source_node: "node-bravo-1".to_string(),
        merkle_root: vec![1, 2, 3, 4, 5, 6, 7, 8],
        block_height: 100,
        timestamp: current_timestamp(),
        signature: vec![0; 64],
        hop_count: 1,
    };
    client.handle_gossip(incoming_gossip);

    // Phase 2: Electronic Warfare
    println!("\n=== Phase 2: Electronic Warfare ===\n");
    client.configure_spectral_agility();
    client.simulate_jamming();
    client.show_status();

    // Phase 3: Bunker Mode
    println!("\n=== Phase 3: Total Isolation (Bunker Mode) ===\n");
    client.enter_bunker_mode()?;
    client.show_status();
    client.store_mission_data()?;

    // Phase 4: Reconnection & Sync
    println!("\n=== Phase 4: Reconnection & Deferred Sync ===\n");
    client.reconnect_and_sync()?;
    client.show_status();

    println!("✅ Demo complete! Tactical Mesh Layer operational.\n");

    Ok(())
}
