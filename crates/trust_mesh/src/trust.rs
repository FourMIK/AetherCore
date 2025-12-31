//! Trust Scoring Module
//!
//! Computes and tracks trust scores based on cryptographic evidence and node health metrics.

use crate::node_health::{NodeHealth, NodeHealthStatus};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// Trust computation constants for health-based scoring
#[derive(Debug, Clone)]
pub struct TrustComputationConfig {
    /// Base score for HEALTHY nodes (before agreement bonus)
    pub healthy_base_score: f64,
    /// Multiplier for agreement bonus on healthy nodes
    pub healthy_agreement_bonus_multiplier: f64,
    /// Agreement threshold where bonus starts (95%)
    pub healthy_agreement_threshold: f64,

    /// Base score for DEGRADED nodes
    pub degraded_base_score: f64,
    /// Score range for degraded nodes (added to base based on agreement)
    pub degraded_score_range: f64,
    /// Agreement threshold where degraded range starts (80%)
    pub degraded_agreement_threshold: f64,
    /// Agreement range for degraded computation (95% - 80% = 15%)
    pub degraded_agreement_range: f64,
    /// Minimum score for degraded nodes
    pub degraded_min_score: f64,
    /// Maximum score for degraded nodes
    pub degraded_max_score: f64,

    /// Base score for COMPROMISED nodes
    pub compromised_base_score: f64,
    /// Score range for compromised nodes
    pub compromised_score_range: f64,
    /// Agreement threshold for compromised computation (80%)
    pub compromised_agreement_threshold: f64,
    /// Minimum score for compromised nodes
    pub compromised_min_score: f64,
    /// Maximum score for compromised nodes
    pub compromised_max_score: f64,
}

impl Default for TrustComputationConfig {
    fn default() -> Self {
        Self {
            healthy_base_score: 0.9,
            healthy_agreement_bonus_multiplier: 0.2,
            healthy_agreement_threshold: 0.95,

            degraded_base_score: 0.5,
            degraded_score_range: 0.3,
            degraded_agreement_threshold: 0.80,
            degraded_agreement_range: 0.15,
            degraded_min_score: 0.3,
            degraded_max_score: 0.8,

            compromised_base_score: 0.1,
            compromised_score_range: 0.3,
            compromised_agreement_threshold: 0.80,
            compromised_min_score: 0.0,
            compromised_max_score: 0.4,
        }
    }
}

/// Trust level thresholds
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum TrustLevel {
    Healthy,     // Trust score >= 0.9
    Suspect,     // Trust score >= 0.5
    Quarantined, // Trust score < 0.5
}

/// Trust score for a node
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TrustScore {
    pub node_id: String,
    pub score: f64, // 0.0 to 1.0
    pub level: TrustLevel,
    pub last_updated: u64,
}

/// Trust scorer
pub struct TrustScorer {
    scores: HashMap<String, TrustScore>,
    computation_config: TrustComputationConfig,
}

impl TrustScorer {
    pub fn new() -> Self {
        Self {
            scores: HashMap::new(),
            computation_config: TrustComputationConfig::default(),
        }
    }

    pub fn with_config(computation_config: TrustComputationConfig) -> Self {
        Self {
            scores: HashMap::new(),
            computation_config,
        }
    }

    pub fn get_score(&self, node_id: &str) -> Option<&TrustScore> {
        self.scores.get(node_id)
    }

    /// Update trust score based on event
    pub fn update_score(&mut self, node_id: &str, delta: f64) {
        let mut score = self.scores.get(node_id).map(|s| s.score).unwrap_or(1.0);

        score = (score + delta).clamp(0.0, 1.0);

        let level = if score >= 0.9 {
            TrustLevel::Healthy
        } else if score >= 0.5 {
            TrustLevel::Suspect
        } else {
            TrustLevel::Quarantined
        };

        let trust_score = TrustScore {
            node_id: node_id.to_string(),
            score,
            level,
            last_updated: std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_millis() as u64,
        };

        self.scores.insert(node_id.to_string(), trust_score);
    }

    /// Compute trust score from node health metrics
    ///
    /// This is the primary interface for integrating integrity metrics
    /// into trust scoring. It converts NodeHealth into a TrustScore.
    ///
    /// Zero trust default: UNKNOWN status yields 0.0 trust score.
    pub fn compute_from_health(&mut self, health: &NodeHealth) {
        let cfg = &self.computation_config;

        let score = match health.status {
            NodeHealthStatus::HEALTHY => {
                // Start with base score, adjust for perfect metrics
                let agreement_bonus = (health.metrics.root_agreement_ratio
                    - cfg.healthy_agreement_threshold)
                    * cfg.healthy_agreement_bonus_multiplier;
                (cfg.healthy_base_score + agreement_bonus).clamp(0.0, 1.0)
            }
            NodeHealthStatus::DEGRADED => {
                // Degraded nodes get moderate trust
                let agreement_factor = (health.metrics.root_agreement_ratio
                    - cfg.degraded_agreement_threshold)
                    / cfg.degraded_agreement_range;
                (cfg.degraded_base_score + agreement_factor * cfg.degraded_score_range)
                    .clamp(cfg.degraded_min_score, cfg.degraded_max_score)
            }
            NodeHealthStatus::COMPROMISED => {
                // Compromised nodes get low trust
                let agreement_factor =
                    health.metrics.root_agreement_ratio / cfg.compromised_agreement_threshold;
                (cfg.compromised_base_score + agreement_factor * cfg.compromised_score_range)
                    .clamp(cfg.compromised_min_score, cfg.compromised_max_score)
            }
            NodeHealthStatus::UNKNOWN => {
                // Zero trust default - no metrics means no trust
                0.0
            }
        };

        let level = if score >= 0.9 {
            TrustLevel::Healthy
        } else if score >= 0.5 {
            TrustLevel::Suspect
        } else {
            TrustLevel::Quarantined
        };

        let trust_score = TrustScore {
            node_id: health.node_id.clone(),
            score,
            level,
            last_updated: health.timestamp,
        };

        self.scores.insert(health.node_id.clone(), trust_score);
    }
}

impl Default for TrustScorer {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::node_health::{IntegrityMetrics, NodeHealth, NodeHealthStatus};

    fn create_test_health(
        node_id: &str,
        status: NodeHealthStatus,
        root_agreement_ratio: f64,
    ) -> NodeHealth {
        NodeHealth {
            node_id: node_id.to_string(),
            timestamp: 1000,
            status,
            metrics: IntegrityMetrics {
                root_agreement_ratio,
                root_drift_count: 0,
                chain_break_count: 0,
                signature_failure_count: 0,
                missing_window_count: 0,
                last_updated: 1000,
            },
        }
    }

    #[test]
    fn test_compute_from_healthy_node() {
        let mut scorer = TrustScorer::new();
        let health = create_test_health("node-1", NodeHealthStatus::HEALTHY, 0.98);

        scorer.compute_from_health(&health);

        let score = scorer.get_score("node-1").unwrap();
        assert_eq!(score.level, TrustLevel::Healthy);
        assert!(score.score >= 0.9);
    }

    #[test]
    fn test_compute_from_degraded_node() {
        let mut scorer = TrustScorer::new();
        let health = create_test_health("node-1", NodeHealthStatus::DEGRADED, 0.85);

        scorer.compute_from_health(&health);

        let score = scorer.get_score("node-1").unwrap();
        assert_eq!(score.level, TrustLevel::Suspect);
        assert!(score.score >= 0.3 && score.score < 0.9);
    }

    #[test]
    fn test_compute_from_compromised_node() {
        let mut scorer = TrustScorer::new();
        let health = create_test_health("node-1", NodeHealthStatus::COMPROMISED, 0.60);

        scorer.compute_from_health(&health);

        let score = scorer.get_score("node-1").unwrap();
        assert_eq!(score.level, TrustLevel::Quarantined);
        assert!(score.score < 0.5);
    }

    #[test]
    fn test_compute_from_unknown_node_zero_trust() {
        let mut scorer = TrustScorer::new();
        let health = create_test_health("node-1", NodeHealthStatus::UNKNOWN, 0.0);

        scorer.compute_from_health(&health);

        let score = scorer.get_score("node-1").unwrap();
        assert_eq!(score.level, TrustLevel::Quarantined);
        assert_eq!(score.score, 0.0); // Zero trust default
    }

    #[test]
    fn test_compute_updates_existing_score() {
        let mut scorer = TrustScorer::new();

        // First compute from healthy status
        let health1 = create_test_health("node-1", NodeHealthStatus::HEALTHY, 0.98);
        scorer.compute_from_health(&health1);

        let score1 = scorer.get_score("node-1").unwrap().score;
        assert!(score1 >= 0.9);

        // Then compute from degraded status
        let health2 = create_test_health("node-1", NodeHealthStatus::DEGRADED, 0.85);
        scorer.compute_from_health(&health2);

        let score2 = scorer.get_score("node-1").unwrap().score;
        assert!(score2 < 0.9);
        assert!(score2 >= 0.3);
    }
}
