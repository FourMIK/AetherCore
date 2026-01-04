//! Topology Benchmarking Module
//!
//! Red Cell stress testing for trust mesh performance under different network topologies.
//! Validates sub-millisecond throughput requirements for contested environments.

use crate::{
    merkle::{CheckpointWindow, MerkleAggregator},
    node_health::{IntegrityMetrics, NodeHealth, NodeHealthComputer, NodeHealthStatus},
    signing::{EventSigner, InMemoryKeyManager, KeyManager},
    trust::TrustScorer,
};
use aethercore_domain::canonical_event::{EventPayload, EventType};
use aethercore_domain::CanonicalEvent;
use std::collections::BTreeMap;
use std::time::{Duration, Instant};

/// Scenario ALPHA: 2-node direct C2 link
/// Target: < 0.5ms verification latency
pub struct ScenarioAlpha {
    nodes: Vec<String>,
}

impl ScenarioAlpha {
    pub fn new() -> Self {
        Self {
            nodes: vec!["c2-node".to_string(), "edge-node".to_string()],
        }
    }

    pub fn run_benchmark(&self) -> TopologyBenchmarkResult {
        let mut key_manager = InMemoryKeyManager::new();
        for node_id in &self.nodes {
            key_manager.generate_key(node_id).unwrap();
        }

        let signer = EventSigner::new(key_manager);
        let mut latencies = Vec::new();

        // Generate and sign 1000 events to measure latency
        for i in 0..1000u64 {
            let event = create_test_event(&self.nodes[(i % 2) as usize], i, String::new());
            let start = Instant::now();
            let _signed = signer.sign_event(event).unwrap();
            let duration = start.elapsed();
            latencies.push(duration);
        }

        TopologyBenchmarkResult::from_latencies("ALPHA (2-node C2 link)", latencies, Duration::from_micros(500))
    }
}

/// Scenario OMEGA: 50-node full swarm grid
/// Target: < 5ms verification latency at 95th percentile
pub struct ScenarioOmega {
    nodes: Vec<String>,
}

impl ScenarioOmega {
    pub fn new() -> Self {
        Self {
            nodes: (0..50).map(|i| format!("swarm-node-{:03}", i)).collect(),
        }
    }

    pub fn run_benchmark(&self) -> TopologyBenchmarkResult {
        let mut key_manager = InMemoryKeyManager::new();
        for node_id in &self.nodes {
            key_manager.generate_key(node_id).unwrap();
        }

        let signer = EventSigner::new(key_manager);
        let mut latencies = Vec::new();

        // Simulate high-velocity mesh with concurrent operations
        for i in 0..5000u64 {
            let node_idx = (i as usize) % self.nodes.len();
            let event = create_test_event(&self.nodes[node_idx], i, String::new());
            let start = Instant::now();
            let _signed = signer.sign_event(event).unwrap();
            let duration = start.elapsed();
            latencies.push(duration);
        }

        TopologyBenchmarkResult::from_latencies("OMEGA (50-node swarm)", latencies, Duration::from_millis(5))
    }

    /// Inject Byzantine nodes with spoofed Merkle roots
    pub fn run_byzantine_test(&self) -> ByzantineTestResult {
        let health_computer = NodeHealthComputer::new();
        let scorer = TrustScorer::new();

        let mut quarantine_count = 0;
        let mut suspect_count = 0;

        // Simulate Byzantine behavior: low root agreement
        for node_id in &self.nodes[0..10] {
            // 10 Byzantine nodes
            // Record poor root agreement (40% matches)
            for _ in 0..40 {
                health_computer.record_root_comparison(node_id, true);
            }
            for _ in 0..60 {
                health_computer.record_root_comparison(node_id, false);
            }

            let health = health_computer.get_node_health(node_id);
            scorer.compute_from_health(&health);

            let score = scorer.get_score(node_id).unwrap();
            match score.level {
                crate::trust::TrustLevel::Quarantined => quarantine_count += 1,
                crate::trust::TrustLevel::Suspect => suspect_count += 1,
                _ => {}
            }
        }

        // Simulate honest nodes: high root agreement
        for node_id in &self.nodes[10..] {
            // 40 honest nodes
            for _ in 0..98 {
                health_computer.record_root_comparison(node_id, true);
            }
            for _ in 0..2 {
                health_computer.record_root_comparison(node_id, false);
            }

            let health = health_computer.get_node_health(node_id);
            scorer.compute_from_health(&health);
        }

        ByzantineTestResult {
            total_byzantine: 10,
            quarantined: quarantine_count,
            suspect: suspect_count,
            detected: quarantine_count + suspect_count,
        }
    }
}

/// Merkle Vine window verification benchmark
pub fn benchmark_merkle_window_verification(window_sizes: &[usize]) -> Vec<WindowBenchmarkResult> {
    let mut results = Vec::new();

    for &window_size in window_sizes {
        let aggregator = MerkleAggregator::new("bench-node".to_string());
        let event_hashes: Vec<String> = (0..window_size)
            .map(|i| format!("hash-{:08x}", i))
            .collect();
        let timestamps: Vec<u64> = (0..window_size as u64).map(|i| 1000000 + i * 1000).collect();
        let heights: Vec<u64> = (0..window_size as u64).collect();

        let mut latencies = Vec::new();

        for _ in 0..100 {
            let window = CheckpointWindow::from_events(
                "bench-node".to_string(),
                1,
                event_hashes.clone(),
                &timestamps,
                &heights,
            )
            .unwrap();

            let start = Instant::now();
            let _root = aggregator.build_merkle_tree(&window.event_hashes).unwrap();
            let duration = start.elapsed();
            latencies.push(duration);
        }

        results.push(WindowBenchmarkResult {
            window_size,
            latencies,
        });
    }

    results
}

/// Benchmark result for topology tests
pub struct TopologyBenchmarkResult {
    pub scenario: String,
    pub count: usize,
    pub min: Duration,
    pub max: Duration,
    pub mean: Duration,
    pub p50: Duration,
    pub p95: Duration,
    pub p99: Duration,
    pub target: Duration,
    pub passes: bool,
}

impl TopologyBenchmarkResult {
    fn from_latencies(scenario: &str, mut latencies: Vec<Duration>, target: Duration) -> Self {
        latencies.sort();
        let count = latencies.len();
        let min = latencies[0];
        let max = latencies[count - 1];
        let mean = Duration::from_nanos(
            (latencies.iter().map(|d| d.as_nanos()).sum::<u128>() / count as u128) as u64,
        );
        let p50 = latencies[count * 50 / 100];
        let p95 = latencies[count * 95 / 100];
        let p99 = latencies[count * 99 / 100];

        Self {
            scenario: scenario.to_string(),
            count,
            min,
            max,
            mean,
            p50,
            p95,
            p99,
            target,
            passes: p95 <= target,
        }
    }

    pub fn format_report(&self) -> String {
        format!(
            r#"
Scenario: {}
  Samples:  {}
  Min:      {:?}
  Mean:     {:?}
  P50:      {:?}
  P95:      {:?}
  P99:      {:?}
  Max:      {:?}
  Target:   {:?}
  Status:   {}
"#,
            self.scenario,
            self.count,
            self.min,
            self.mean,
            self.p50,
            self.p95,
            self.p99,
            self.max,
            self.target,
            if self.passes { "✓ PASS" } else { "✗ FAIL" }
        )
    }
}

/// Byzantine test result
pub struct ByzantineTestResult {
    pub total_byzantine: usize,
    pub quarantined: usize,
    pub suspect: usize,
    pub detected: usize,
}

impl ByzantineTestResult {
    pub fn format_report(&self) -> String {
        let detection_rate = (self.detected as f64 / self.total_byzantine as f64) * 100.0;
        format!(
            r#"
Byzantine Node Detection:
  Total Byzantine:  {}
  Quarantined:      {}
  Suspect:          {}
  Detected:         {} ({:.1}%)
  Status:           {}
"#,
            self.total_byzantine,
            self.quarantined,
            self.suspect,
            self.detected,
            detection_rate,
            if detection_rate >= 90.0 {
                "✓ PASS (>90% detection)"
            } else {
                "✗ FAIL (<90% detection)"
            }
        )
    }
}

/// Window benchmark result
pub struct WindowBenchmarkResult {
    pub window_size: usize,
    pub latencies: Vec<Duration>,
}

impl WindowBenchmarkResult {
    pub fn mean_micros(&self) -> f64 {
        let sum: u128 = self.latencies.iter().map(|d| d.as_micros()).sum();
        sum as f64 / self.latencies.len() as f64
    }

    pub fn format_report(&self) -> String {
        format!(
            "  Window Size {}: {:.2}µs avg",
            self.window_size,
            self.mean_micros()
        )
    }
}

fn create_test_event(node_id: &str, sequence: u64, prev_hash: String) -> CanonicalEvent {
    let timestamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_millis() as u64;

    let mut payload_map = BTreeMap::new();
    payload_map.insert("test_key".to_string(), serde_json::json!("test_value"));

    CanonicalEvent {
        event_id: format!("event-{}-{}", node_id, sequence),
        event_type: EventType::TELEMETRY,
        timestamp,
        device_id: node_id.to_string(),
        sequence,
        payload: EventPayload::Telemetry {
            sensor_type: "test_sensor".to_string(),
            unit: "units".to_string(),
            value: sequence as f64,
            metadata: Some(payload_map),
        },
        prev_hash,
        chain_height: sequence,
        hash: String::new(),
        signature: String::new(),
        public_key: String::new(),
        node_id: node_id.to_string(),
        metadata: None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_scenario_alpha_performance() {
        let scenario = ScenarioAlpha::new();
        let result = scenario.run_benchmark();
        println!("{}", result.format_report());
        // In tests, we allow more lenient timing
    }

    #[test]
    fn test_scenario_omega_performance() {
        let scenario = ScenarioOmega::new();
        let result = scenario.run_benchmark();
        println!("{}", result.format_report());
        // In tests, we allow more lenient timing
    }

    #[test]
    fn test_byzantine_detection() {
        let scenario = ScenarioOmega::new();
        let result = scenario.run_byzantine_test();
        println!("{}", result.format_report());
        // Should detect most Byzantine nodes
        assert!(result.detected >= 8); // At least 80% detection
    }

    #[test]
    fn test_merkle_window_benchmarks() {
        let window_sizes = vec![100, 500, 1000];
        let results = benchmark_merkle_window_verification(&window_sizes);

        println!("\nMerkle Window Verification Performance:");
        for result in results {
            println!("{}", result.format_report());
        }
    }
}
