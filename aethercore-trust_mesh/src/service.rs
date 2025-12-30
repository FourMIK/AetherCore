//! Trust Mesh Service
//!
//! Main service that coordinates all trust mesh components.

use crate::{
    gossip::GossipProtocol,
    ledger::DistributedLedger,
    merkle::MerkleAggregator,
    node_health::{NodeHealth, NodeHealthComputer},
    signing::{EventSigner, KeyManager},
    trust::TrustScorer,
};
use fourmik_domain::CanonicalEvent;
use serde::{Deserialize, Serialize};

/// Trust mesh configuration
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TrustMeshConfig {
    pub node_id: String,
    pub checkpoint_window_size: u64,
    pub checkpoint_interval_ms: u64,
    pub gossip_interval_ms: u64,
}

impl Default for TrustMeshConfig {
    fn default() -> Self {
        Self {
            node_id: "default-node".to_string(),
            checkpoint_window_size: 100,
            checkpoint_interval_ms: 60000, // 1 minute
            gossip_interval_ms: 10000,     // 10 seconds
        }
    }
}

/// Main trust mesh service
pub struct TrustMeshService<K: KeyManager> {
    #[allow(dead_code)]
    config: TrustMeshConfig,
    signer: EventSigner<K>,
    #[allow(dead_code)]
    aggregator: MerkleAggregator,
    ledger: DistributedLedger,
    #[allow(dead_code)]
    gossip: GossipProtocol,
    trust_scorer: TrustScorer,
    health_computer: NodeHealthComputer,
}

impl<K: KeyManager> TrustMeshService<K> {
    pub fn new(config: TrustMeshConfig, key_manager: K) -> Self {
        let node_id = config.node_id.clone();

        Self {
            config: config.clone(),
            signer: EventSigner::new(key_manager),
            aggregator: MerkleAggregator::new(node_id.clone()),
            ledger: DistributedLedger::new(node_id.clone()),
            gossip: GossipProtocol::new(node_id.clone()),
            trust_scorer: TrustScorer::new(),
            health_computer: NodeHealthComputer::new(),
        }
    }

    /// Sign and chain an event
    pub fn sign_and_chain_event(
        &self,
        event: CanonicalEvent,
    ) -> crate::signing::Result<CanonicalEvent> {
        self.signer.sign_event(event)
    }

    /// Get the latest checkpoint for a node
    pub fn get_latest_checkpoint(&self, node_id: &str) -> Option<&crate::merkle::LedgerCheckpoint> {
        self.ledger.state().get_latest(node_id)
    }

    /// Get trust score for a node
    pub fn get_trust_score(&self, node_id: &str) -> Option<&crate::trust::TrustScore> {
        self.trust_scorer.get_score(node_id)
    }

    /// Get node health with integrity metrics
    ///
    /// Returns status=UNKNOWN and zero trust semantics if:
    /// - Node metrics are unavailable
    /// - Metrics are stale
    /// - Metrics are inconsistent
    pub fn get_node_health(&self, node_id: &str) -> NodeHealth {
        self.health_computer.get_node_health(node_id)
    }

    /// Get the health computer for direct metrics recording
    pub fn health_computer(&self) -> &NodeHealthComputer {
        &self.health_computer
    }
}
