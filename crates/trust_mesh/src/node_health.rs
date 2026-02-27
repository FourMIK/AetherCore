//! Node Health Module
//!
//! Provides integrity metric export for trust scoring without internal state guessing.
//! Exposes a clean, machine-readable node health signal derived from mesh integrity behavior.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

/// Node health status enumeration
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum NodeHealthStatus {
    /// Node is operating normally with good integrity metrics
    HEALTHY,
    /// Node is degraded with some integrity issues but still functioning
    DEGRADED,
    /// Node integrity is compromised with frequent failures
    COMPROMISED,
    /// Metrics are unavailable, stale, or inconsistent - zero trust default
    UNKNOWN,
}

/// Core integrity metrics tracked for each node
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IntegrityMetrics {
    /// Ratio of roots matching peer majority (0.0 to 1.0)
    pub root_agreement_ratio: f64,

    /// Number of times our root diverged from peer majority
    pub root_drift_count: u64,

    /// Total chain breaks detected
    pub chain_break_count: u64,

    /// Count of invalid signatures (incoming or local)
    pub signature_failure_count: u64,

    /// Count of missed or failed Merkle aggregation windows
    pub missing_window_count: u64,

    /// Timestamp when these metrics were last updated (Unix milliseconds)
    pub last_updated: u64,
}

impl Default for IntegrityMetrics {
    fn default() -> Self {
        Self {
            root_agreement_ratio: 0.0,
            root_drift_count: 0,
            chain_break_count: 0,
            signature_failure_count: 0,
            missing_window_count: 0,
            last_updated: current_timestamp_ms(),
        }
    }
}

/// Node health information with status and metrics
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NodeHealth {
    /// Node identifier
    pub node_id: String,

    /// Generation timestamp (Unix milliseconds)
    pub timestamp: u64,

    /// Current health status
    pub status: NodeHealthStatus,

    /// Integrity metrics
    pub metrics: IntegrityMetrics,
}

impl NodeHealth {
    /// Create a new NodeHealth with UNKNOWN status (zero trust default)
    pub fn unknown(node_id: String) -> Self {
        Self {
            node_id,
            timestamp: current_timestamp_ms(),
            status: NodeHealthStatus::UNKNOWN,
            metrics: IntegrityMetrics::default(),
        }
    }
}

/// Raw counters for tracking integrity metrics (thread-safe)
#[derive(Debug, Clone, Default)]
pub struct IntegrityCounters {
    /// Total roots compared with peers
    pub roots_compared_total: u64,

    /// Total roots matching peer majority
    pub roots_matching_total: u64,

    /// Total roots drifting from peer majority
    pub roots_drifting_total: u64,

    /// Total chain breaks detected
    pub chain_breaks_total: u64,

    /// Total signature failures
    pub signature_failures_total: u64,

    /// Total missing or failed Merkle windows
    pub missing_windows_total: u64,

    /// Last update timestamp (Unix milliseconds)
    pub last_updated: u64,
}

/// Configuration for health computation thresholds
#[derive(Debug, Clone)]
pub struct HealthThresholds {
    /// Minimum root agreement ratio for HEALTHY status
    pub healthy_min_agreement: f64,

    /// Minimum root agreement ratio for DEGRADED status (below is COMPROMISED)
    pub degraded_min_agreement: f64,

    /// Maximum chain breaks for HEALTHY status
    pub healthy_max_chain_breaks: u64,

    /// Maximum signature failures for HEALTHY status
    pub healthy_max_signature_failures: u64,

    /// Maximum missing windows for HEALTHY status
    pub healthy_max_missing_windows: u64,

    /// Maximum chain breaks before COMPROMISED status (severe condition)
    pub compromised_max_chain_breaks: u64,

    /// Maximum signature failures before COMPROMISED status (severe condition)
    pub compromised_max_signature_failures: u64,

    /// Maximum missing windows before COMPROMISED status (severe condition)
    pub compromised_max_missing_windows: u64,

    /// Metrics staleness TTL in milliseconds
    pub staleness_ttl_ms: u64,
}

impl Default for HealthThresholds {
    fn default() -> Self {
        Self {
            healthy_min_agreement: 0.95,            // 95% agreement for healthy
            degraded_min_agreement: 0.80,           // 80% agreement for degraded
            healthy_max_chain_breaks: 0,            // Zero chain breaks for healthy
            healthy_max_signature_failures: 2,      // Up to 2 signature failures tolerated
            healthy_max_missing_windows: 1,         // Up to 1 missing window tolerated
            compromised_max_chain_breaks: 5,        // More than 5 chain breaks is severe
            compromised_max_signature_failures: 10, // More than 10 sig failures is severe
            compromised_max_missing_windows: 10,    // More than 10 missing windows is severe
            staleness_ttl_ms: 300_000,              // 5 minutes
        }
    }
}

/// Node health computer with threshold-based status determination
pub struct NodeHealthComputer {
    thresholds: HealthThresholds,
    counters: Arc<Mutex<HashMap<String, IntegrityCounters>>>,
}

impl NodeHealthComputer {
    /// Create a new health computer with default thresholds
    pub fn new() -> Self {
        Self::with_thresholds(HealthThresholds::default())
    }

    /// Create a new health computer with custom thresholds
    pub fn with_thresholds(thresholds: HealthThresholds) -> Self {
        Self {
            thresholds,
            counters: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    /// Update root agreement metrics for a node
    pub fn record_root_comparison(&self, node_id: &str, matches_majority: bool) {
        let mut counters = self.counters.lock().unwrap();
        let node_counters = counters.entry(node_id.to_string()).or_default();

        node_counters.roots_compared_total += 1;
        if matches_majority {
            node_counters.roots_matching_total += 1;
        } else {
            node_counters.roots_drifting_total += 1;
        }
        node_counters.last_updated = current_timestamp_ms();
    }

    /// Record a chain break for a node
    pub fn record_chain_break(&self, node_id: &str) {
        let mut counters = self.counters.lock().unwrap();
        let node_counters = counters.entry(node_id.to_string()).or_default();

        node_counters.chain_breaks_total += 1;
        node_counters.last_updated = current_timestamp_ms();
    }

    /// Record a signature failure for a node
    pub fn record_signature_failure(&self, node_id: &str) {
        let mut counters = self.counters.lock().unwrap();
        let node_counters = counters.entry(node_id.to_string()).or_default();

        node_counters.signature_failures_total += 1;
        node_counters.last_updated = current_timestamp_ms();
    }

    /// Record a missing or failed Merkle window for a node
    pub fn record_missing_window(&self, node_id: &str) {
        let mut counters = self.counters.lock().unwrap();
        let node_counters = counters.entry(node_id.to_string()).or_default();

        node_counters.missing_windows_total += 1;
        node_counters.last_updated = current_timestamp_ms();
    }

    /// Get node health with computed status
    ///
    /// Returns status=UNKNOWN and zero trust semantics if:
    /// - Node metrics are unavailable
    /// - Metrics are stale (beyond TTL)
    /// - Metrics are inconsistent
    pub fn get_node_health(&self, node_id: &str) -> NodeHealth {
        let counters = self.counters.lock().unwrap();

        // If no counters exist, return UNKNOWN (zero trust default)
        let node_counters = match counters.get(node_id) {
            Some(c) => c,
            None => return NodeHealth::unknown(node_id.to_string()),
        };

        // Check staleness
        let now = current_timestamp_ms();
        let age_ms = now.saturating_sub(node_counters.last_updated);
        if age_ms > self.thresholds.staleness_ttl_ms {
            return NodeHealth::unknown(node_id.to_string());
        }

        // Compute derived metrics
        let root_agreement_ratio = if node_counters.roots_compared_total > 0 {
            node_counters.roots_matching_total as f64 / node_counters.roots_compared_total as f64
        } else {
            0.0 // No comparisons yet, zero trust default
        };

        let metrics = IntegrityMetrics {
            root_agreement_ratio,
            root_drift_count: node_counters.roots_drifting_total,
            chain_break_count: node_counters.chain_breaks_total,
            signature_failure_count: node_counters.signature_failures_total,
            missing_window_count: node_counters.missing_windows_total,
            last_updated: node_counters.last_updated,
        };

        // Determine status based on thresholds
        let status = self.compute_status(&metrics);

        NodeHealth {
            node_id: node_id.to_string(),
            timestamp: now,
            status,
            metrics,
        }
    }

    /// Compute health status based on metrics and thresholds
    fn compute_status(&self, metrics: &IntegrityMetrics) -> NodeHealthStatus {
        // If no comparisons have been made, return UNKNOWN
        if metrics.root_agreement_ratio == 0.0 {
            return NodeHealthStatus::UNKNOWN;
        }

        // Check for COMPROMISED conditions
        if metrics.root_agreement_ratio < self.thresholds.degraded_min_agreement {
            return NodeHealthStatus::COMPROMISED;
        }

        // Check for chain breaks or excessive failures indicating compromise
        if metrics.chain_break_count > self.thresholds.compromised_max_chain_breaks
            || metrics.signature_failure_count > self.thresholds.compromised_max_signature_failures
            || metrics.missing_window_count > self.thresholds.compromised_max_missing_windows
        {
            return NodeHealthStatus::COMPROMISED;
        }

        // Check for DEGRADED conditions
        if metrics.root_agreement_ratio < self.thresholds.healthy_min_agreement
            || metrics.chain_break_count > self.thresholds.healthy_max_chain_breaks
            || metrics.signature_failure_count > self.thresholds.healthy_max_signature_failures
            || metrics.missing_window_count > self.thresholds.healthy_max_missing_windows
        {
            return NodeHealthStatus::DEGRADED;
        }

        // Otherwise HEALTHY
        NodeHealthStatus::HEALTHY
    }

    /// Get a snapshot of all node counters (for testing/debugging)
    pub fn get_all_counters(&self) -> HashMap<String, IntegrityCounters> {
        self.counters.lock().unwrap().clone()
    }

    /// Reset counters for a node (should only be used during explicit rebootstrap)
    pub fn reset_node_counters(&self, node_id: &str) {
        let mut counters = self.counters.lock().unwrap();
        counters.remove(node_id);
    }
}

impl Default for NodeHealthComputer {
    fn default() -> Self {
        Self::new()
    }
}

/// Get current timestamp in milliseconds since Unix epoch
fn current_timestamp_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or(Duration::ZERO)
        .as_millis() as u64
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::thread;
    use std::time::Duration;

    #[test]
    fn test_unknown_status_when_no_metrics() {
        let computer = NodeHealthComputer::new();
        let health = computer.get_node_health("node-1");

        assert_eq!(health.status, NodeHealthStatus::UNKNOWN);
        assert_eq!(health.node_id, "node-1");
        assert_eq!(health.metrics.root_agreement_ratio, 0.0);
    }

    #[test]
    fn test_healthy_status_with_good_metrics() {
        let computer = NodeHealthComputer::new();

        // Record good root agreements
        for _ in 0..100 {
            computer.record_root_comparison("node-1", true);
        }

        let health = computer.get_node_health("node-1");

        assert_eq!(health.status, NodeHealthStatus::HEALTHY);
        assert_eq!(health.metrics.root_agreement_ratio, 1.0);
        assert_eq!(health.metrics.root_drift_count, 0);
    }

    #[test]
    fn test_degraded_status_with_some_drift() {
        let computer = NodeHealthComputer::new();

        // Record 90 matches and 10 drifts (90% agreement)
        for _ in 0..90 {
            computer.record_root_comparison("node-1", true);
        }
        for _ in 0..10 {
            computer.record_root_comparison("node-1", false);
        }

        let health = computer.get_node_health("node-1");

        assert_eq!(health.status, NodeHealthStatus::DEGRADED);
        assert_eq!(health.metrics.root_agreement_ratio, 0.9);
        assert_eq!(health.metrics.root_drift_count, 10);
    }

    #[test]
    fn test_compromised_status_with_low_agreement() {
        let computer = NodeHealthComputer::new();

        // Record 70 matches and 30 drifts (70% agreement)
        for _ in 0..70 {
            computer.record_root_comparison("node-1", true);
        }
        for _ in 0..30 {
            computer.record_root_comparison("node-1", false);
        }

        let health = computer.get_node_health("node-1");

        assert_eq!(health.status, NodeHealthStatus::COMPROMISED);
        assert_eq!(health.metrics.root_agreement_ratio, 0.7);
    }

    #[test]
    fn test_degraded_status_with_chain_breaks() {
        let computer = NodeHealthComputer::new();

        // Record perfect root agreement but with a chain break
        for _ in 0..100 {
            computer.record_root_comparison("node-1", true);
        }
        computer.record_chain_break("node-1");

        let health = computer.get_node_health("node-1");

        assert_eq!(health.status, NodeHealthStatus::DEGRADED);
        assert_eq!(health.metrics.chain_break_count, 1);
    }

    #[test]
    fn test_compromised_status_with_many_chain_breaks() {
        let computer = NodeHealthComputer::new();

        // Record perfect root agreement but with many chain breaks
        for _ in 0..100 {
            computer.record_root_comparison("node-1", true);
        }
        for _ in 0..10 {
            computer.record_chain_break("node-1");
        }

        let health = computer.get_node_health("node-1");

        assert_eq!(health.status, NodeHealthStatus::COMPROMISED);
        assert_eq!(health.metrics.chain_break_count, 10);
    }

    #[test]
    fn test_signature_failure_tracking() {
        let computer = NodeHealthComputer::new();

        // Record good root agreement with some signature failures
        for _ in 0..100 {
            computer.record_root_comparison("node-1", true);
        }
        for _ in 0..3 {
            computer.record_signature_failure("node-1");
        }

        let health = computer.get_node_health("node-1");

        assert_eq!(health.status, NodeHealthStatus::DEGRADED);
        assert_eq!(health.metrics.signature_failure_count, 3);
    }

    #[test]
    fn test_missing_window_tracking() {
        let computer = NodeHealthComputer::new();

        // Record good root agreement with some missing windows
        for _ in 0..100 {
            computer.record_root_comparison("node-1", true);
        }
        for _ in 0..2 {
            computer.record_missing_window("node-1");
        }

        let health = computer.get_node_health("node-1");

        assert_eq!(health.status, NodeHealthStatus::DEGRADED);
        assert_eq!(health.metrics.missing_window_count, 2);
    }

    #[test]
    fn test_staleness_detection() {
        let mut thresholds = HealthThresholds::default();
        thresholds.staleness_ttl_ms = 100; // 100ms TTL for testing

        let computer = NodeHealthComputer::with_thresholds(thresholds);

        // Record good metrics
        for _ in 0..100 {
            computer.record_root_comparison("node-1", true);
        }

        // Verify healthy initially
        let health = computer.get_node_health("node-1");
        assert_eq!(health.status, NodeHealthStatus::HEALTHY);

        // Wait for metrics to go stale
        thread::sleep(Duration::from_millis(150));

        // Should now return UNKNOWN due to staleness
        let health = computer.get_node_health("node-1");
        assert_eq!(health.status, NodeHealthStatus::UNKNOWN);
    }

    #[test]
    fn test_multiple_nodes_tracked_independently() {
        let computer = NodeHealthComputer::new();

        // Node 1: healthy
        for _ in 0..100 {
            computer.record_root_comparison("node-1", true);
        }

        // Node 2: degraded
        for _ in 0..90 {
            computer.record_root_comparison("node-2", true);
        }
        for _ in 0..10 {
            computer.record_root_comparison("node-2", false);
        }

        // Node 3: compromised
        for _ in 0..60 {
            computer.record_root_comparison("node-3", true);
        }
        for _ in 0..40 {
            computer.record_root_comparison("node-3", false);
        }

        let health1 = computer.get_node_health("node-1");
        let health2 = computer.get_node_health("node-2");
        let health3 = computer.get_node_health("node-3");

        assert_eq!(health1.status, NodeHealthStatus::HEALTHY);
        assert_eq!(health2.status, NodeHealthStatus::DEGRADED);
        assert_eq!(health3.status, NodeHealthStatus::COMPROMISED);
    }

    #[test]
    fn test_reset_node_counters() {
        let computer = NodeHealthComputer::new();

        // Record some metrics
        for _ in 0..100 {
            computer.record_root_comparison("node-1", true);
        }
        computer.record_chain_break("node-1");

        // Verify metrics exist
        let health = computer.get_node_health("node-1");
        assert_eq!(health.status, NodeHealthStatus::DEGRADED);

        // Reset counters
        computer.reset_node_counters("node-1");

        // Should now return UNKNOWN
        let health = computer.get_node_health("node-1");
        assert_eq!(health.status, NodeHealthStatus::UNKNOWN);
    }

    #[test]
    fn test_unknown_status_with_no_root_comparisons() {
        let computer = NodeHealthComputer::new();

        // Record other metrics but no root comparisons
        computer.record_signature_failure("node-1");
        computer.record_chain_break("node-1");

        let health = computer.get_node_health("node-1");

        // Should be UNKNOWN because root_agreement_ratio is 0.0
        assert_eq!(health.status, NodeHealthStatus::UNKNOWN);
    }
}
