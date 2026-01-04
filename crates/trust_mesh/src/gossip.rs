//! Gossip Protocol Module
//!
//! Implements lightweight gossip for checkpoint synchronization and chain proof
//! exchange across the mesh.

use crate::merkle::LedgerCheckpoint;
use aethercore_crypto::ChainProof;
use serde::{Deserialize, Serialize};

/// Gossip message types
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum GossipMessage {
    /// Summary of latest checkpoint
    CheckpointSummary {
        node_id: String,
        latest_seq_no: u64,
        latest_root_hash: String,
        signature: String,
    },

    /// Request for missing checkpoints
    CheckpointRequest {
        node_id: String,
        from_seq: u64,
        to_seq: u64,
    },

    /// Response with requested checkpoints
    CheckpointResponse { checkpoints: Vec<LedgerCheckpoint> },
    
    /// Chain proof for integrity verification
    ChainProofAnnouncement {
        /// Node/stream identifier
        node_id: String,
        /// Chain proof
        proof: ChainProof,
    },
    
    /// Request for chain proof from a specific node
    ChainProofRequest {
        /// Requesting node ID
        requester_id: String,
        /// Target node ID
        target_node_id: String,
    },
    
    /// Response with chain proof
    ChainProofResponse {
        /// Node ID providing the proof
        node_id: String,
        /// Chain proof
        proof: ChainProof,
    },
}

/// Peer state in the gossip network
#[derive(Debug, Clone)]
pub struct PeerState {
    pub peer_id: String,
    pub last_seen: u64,
    pub latest_seq_no: u64,
    pub latest_root_hash: String,
}

/// Gossip protocol manager
pub struct GossipProtocol {
    #[allow(dead_code)]
    node_id: String,
    peers: Vec<PeerState>,
}

impl GossipProtocol {
    pub fn new(node_id: String) -> Self {
        Self {
            node_id,
            peers: Vec::new(),
        }
    }

    pub fn add_peer(&mut self, peer: PeerState) {
        self.peers.push(peer);
    }

    pub fn get_peers(&self) -> &[PeerState] {
        &self.peers
    }
}
