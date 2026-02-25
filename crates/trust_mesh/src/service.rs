//! Trust Mesh Service
//!
//! Main service that coordinates all trust mesh components.

use crate::{
    gossip::GossipProtocol,
    ledger::DistributedLedger,
    merkle::MerkleAggregator,
    node_health::{NodeHealth, NodeHealthComputer},
    signing::{EventSigner, KeyManager},
    trust::{TrustScore, TrustScorer},
};
use aethercore_domain::CanonicalEvent;
use serde::{Deserialize, Serialize};

/// Trust mesh configuration
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TrustMeshConfig {
    pub node_id: String,
    pub checkpoint_window_size: u64,
    pub checkpoint_interval_ms: u64,
    pub gossip_interval_ms: u64,
}

impl TrustMeshConfig {
    /// Desktop grid configuration optimized for high-velocity desktop data streams
    /// Tuned for contested environment with sub-millisecond throughput requirements
    pub fn desktop_grid(node_id: String) -> Self {
        Self {
            node_id,
            checkpoint_window_size: 500, // Increased from 100 to handle high-throughput streams
            checkpoint_interval_ms: 30000, // 30 seconds - balanced for RF jitter tolerance
            gossip_interval_ms: 10,      // 10ms - optimized for high-speed desktop bus
        }
    }
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
    pub fn get_trust_score(&self, node_id: &str) -> Option<crate::trust::TrustScore> {
        // Lazily compute trust from health if this node has not been scored yet.
        self.trust_scorer
            .get_score(node_id)
            .or_else(|| self.recompute_trust_from_health(node_id))
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

    /// Recompute trust score for a node from the current health snapshot.
    ///
    /// This method is the bridge from integrity metrics (`NodeHealthComputer`)
    /// into operational trust gating (`TrustScorer`).
    pub fn recompute_trust_from_health(&self, node_id: &str) -> Option<TrustScore> {
        let health = self.health_computer.get_node_health(node_id);
        self.trust_scorer.compute_from_health(&health);
        self.trust_scorer.get_score(node_id)
    }

    /// Record a root comparison outcome and immediately refresh trust score.
    pub fn record_root_comparison(
        &self,
        node_id: &str,
        matches_majority: bool,
    ) -> Option<TrustScore> {
        self.health_computer
            .record_root_comparison(node_id, matches_majority);
        self.recompute_trust_from_health(node_id)
    }

    /// Record a chain break and immediately refresh trust score.
    pub fn record_chain_break(&self, node_id: &str) -> Option<TrustScore> {
        self.health_computer.record_chain_break(node_id);
        self.recompute_trust_from_health(node_id)
    }

    /// Record a signature verification failure and immediately refresh trust score.
    pub fn record_signature_failure(&self, node_id: &str) -> Option<TrustScore> {
        self.health_computer.record_signature_failure(node_id);
        self.recompute_trust_from_health(node_id)
    }

    /// Record a missing/failed Merkle window and immediately refresh trust score.
    pub fn record_missing_window(&self, node_id: &str) -> Option<TrustScore> {
        self.health_computer.record_missing_window(node_id);
        self.recompute_trust_from_health(node_id)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::signing::InMemoryKeyManager;
    use crate::trust::TrustLevel;

    fn service_with_key(node_id: &str) -> TrustMeshService<InMemoryKeyManager> {
        let mut key_manager = InMemoryKeyManager::new();
        key_manager.generate_key(node_id).unwrap();
        TrustMeshService::new(
            TrustMeshConfig::desktop_grid(node_id.to_string()),
            key_manager,
        )
    }

    #[test]
    fn get_trust_score_lazily_computes_unknown_nodes() {
        let service = service_with_key("local-node");
        let score = service.get_trust_score("peer-1").unwrap();

        assert_eq!(score.level, TrustLevel::Quarantined);
        assert_eq!(score.score, 0.0);
    }

    #[test]
    fn record_root_comparison_promotes_trust_to_healthy() {
        let service = service_with_key("local-node");

        for _ in 0..20 {
            service.record_root_comparison("peer-1", true);
        }

        let score = service.get_trust_score("peer-1").unwrap();
        assert_eq!(score.level, TrustLevel::Healthy);
        assert!(score.score >= 0.9);
    }
}
