//! Integration tests for node health in mesh simulation scenarios

use fourmik_trust_mesh::{NodeHealthComputer, NodeHealthStatus};
use std::thread;
use std::time::Duration;

/// Test normal scenario where roots mostly agree and no chain breaks
#[test]
fn test_normal_scenario_healthy_nodes() {
    let computer = NodeHealthComputer::new();

    // Simulate 3 nodes with mostly agreeing roots
    for node_id in &["node-1", "node-2", "node-3"] {
        // 98% agreement - very healthy
        for _ in 0..98 {
            computer.record_root_comparison(node_id, true);
        }
        for _ in 0..2 {
            computer.record_root_comparison(node_id, false);
        }
    }

    // All nodes should be HEALTHY
    for node_id in &["node-1", "node-2", "node-3"] {
        let health = computer.get_node_health(node_id);
        assert_eq!(
            health.status,
            NodeHealthStatus::HEALTHY,
            "Node {} should be HEALTHY in normal scenario",
            node_id
        );
        assert!(health.metrics.root_agreement_ratio >= 0.95);
        assert_eq!(health.metrics.chain_break_count, 0);
        assert_eq!(health.metrics.signature_failure_count, 0);
    }
}

/// Test drift scenario where one node diverges repeatedly
#[test]
fn test_drift_scenario_one_node_degrades() {
    let computer = NodeHealthComputer::new();

    // Node 1: healthy - 98% agreement
    for _ in 0..98 {
        computer.record_root_comparison("node-1", true);
    }
    for _ in 0..2 {
        computer.record_root_comparison("node-1", false);
    }

    // Node 2: healthy - 96% agreement
    for _ in 0..96 {
        computer.record_root_comparison("node-2", true);
    }
    for _ in 0..4 {
        computer.record_root_comparison("node-2", false);
    }

    // Node 3: drifting - 85% agreement (should be DEGRADED)
    for _ in 0..85 {
        computer.record_root_comparison("node-3", true);
    }
    for _ in 0..15 {
        computer.record_root_comparison("node-3", false);
    }

    let health1 = computer.get_node_health("node-1");
    let health2 = computer.get_node_health("node-2");
    let health3 = computer.get_node_health("node-3");

    assert_eq!(health1.status, NodeHealthStatus::HEALTHY);
    assert_eq!(health2.status, NodeHealthStatus::HEALTHY);
    assert_eq!(health3.status, NodeHealthStatus::DEGRADED);

    // Node 3 should have high drift count
    assert_eq!(health3.metrics.root_drift_count, 15);
}

/// Test corruption scenario with chain breaks and signature failures
#[test]
fn test_corruption_scenario_rapid_degradation() {
    let computer = NodeHealthComputer::new();

    // Node starts healthy
    for _ in 0..100 {
        computer.record_root_comparison("node-1", true);
    }

    let health = computer.get_node_health("node-1");
    assert_eq!(health.status, NodeHealthStatus::HEALTHY);

    // Inject chain breaks (simulating corruption)
    for _ in 0..3 {
        computer.record_chain_break("node-1");
    }

    let health = computer.get_node_health("node-1");
    assert_eq!(health.status, NodeHealthStatus::DEGRADED);
    assert_eq!(health.metrics.chain_break_count, 3);

    // More chain breaks push it to COMPROMISED
    for _ in 0..5 {
        computer.record_chain_break("node-1");
    }

    let health = computer.get_node_health("node-1");
    assert_eq!(health.status, NodeHealthStatus::COMPROMISED);
    assert_eq!(health.metrics.chain_break_count, 8);
}

/// Test signature failure injection causing degradation
#[test]
fn test_signature_failure_degradation() {
    let computer = NodeHealthComputer::new();

    // Node starts with good root agreement
    for _ in 0..100 {
        computer.record_root_comparison("node-1", true);
    }

    // Inject a few signature failures
    for _ in 0..3 {
        computer.record_signature_failure("node-1");
    }

    let health = computer.get_node_health("node-1");
    assert_eq!(health.status, NodeHealthStatus::DEGRADED);
    assert_eq!(health.metrics.signature_failure_count, 3);

    // Many more signature failures → COMPROMISED
    for _ in 0..10 {
        computer.record_signature_failure("node-1");
    }

    let health = computer.get_node_health("node-1");
    assert_eq!(health.status, NodeHealthStatus::COMPROMISED);
    assert_eq!(health.metrics.signature_failure_count, 13);
}

/// Test missing window scenario
#[test]
fn test_missing_window_scenario() {
    let computer = NodeHealthComputer::new();

    // Node has good root agreement
    for _ in 0..100 {
        computer.record_root_comparison("node-1", true);
    }

    // Record one missing window (tolerated)
    computer.record_missing_window("node-1");

    let health = computer.get_node_health("node-1");
    assert_eq!(health.status, NodeHealthStatus::HEALTHY);
    assert_eq!(health.metrics.missing_window_count, 1);

    // Another missing window pushes to DEGRADED
    computer.record_missing_window("node-1");

    let health = computer.get_node_health("node-1");
    assert_eq!(health.status, NodeHealthStatus::DEGRADED);
    assert_eq!(health.metrics.missing_window_count, 2);
}

/// Test mixed mesh with healthy, degraded, and compromised nodes
#[test]
fn test_mixed_mesh_simulation() {
    let computer = NodeHealthComputer::new();

    // Node 1: Healthy - perfect agreement
    for _ in 0..100 {
        computer.record_root_comparison("healthy-node", true);
    }

    // Node 2: Degraded - some drift and a chain break
    for _ in 0..90 {
        computer.record_root_comparison("degraded-node", true);
    }
    for _ in 0..10 {
        computer.record_root_comparison("degraded-node", false);
    }
    computer.record_chain_break("degraded-node");

    // Node 3: Compromised - low agreement and signature failures
    for _ in 0..60 {
        computer.record_root_comparison("compromised-node", true);
    }
    for _ in 0..40 {
        computer.record_root_comparison("compromised-node", false);
    }
    for _ in 0..5 {
        computer.record_signature_failure("compromised-node");
    }

    // Node 4: Unknown - no metrics yet
    // (no recordings)

    let healthy = computer.get_node_health("healthy-node");
    let degraded = computer.get_node_health("degraded-node");
    let compromised = computer.get_node_health("compromised-node");
    let unknown = computer.get_node_health("unknown-node");

    assert_eq!(healthy.status, NodeHealthStatus::HEALTHY);
    assert_eq!(degraded.status, NodeHealthStatus::DEGRADED);
    assert_eq!(compromised.status, NodeHealthStatus::COMPROMISED);
    assert_eq!(unknown.status, NodeHealthStatus::UNKNOWN);
}

/// Test that stale metrics trigger UNKNOWN status (zero trust)
#[test]
fn test_stale_metrics_zero_trust() {
    use fourmik_trust_mesh::HealthThresholds;

    let mut thresholds = HealthThresholds::default();
    thresholds.staleness_ttl_ms = 100; // 100ms for testing

    let computer = NodeHealthComputer::with_thresholds(thresholds);

    // Record healthy metrics
    for _ in 0..100 {
        computer.record_root_comparison("node-1", true);
    }

    let health = computer.get_node_health("node-1");
    assert_eq!(health.status, NodeHealthStatus::HEALTHY);

    // Wait for staleness
    thread::sleep(Duration::from_millis(150));

    // Should be UNKNOWN (zero trust)
    let health = computer.get_node_health("node-1");
    assert_eq!(health.status, NodeHealthStatus::UNKNOWN);
}

/// Test recovery from degraded to healthy
#[test]
fn test_node_recovery_to_healthy() {
    let computer = NodeHealthComputer::new();

    // Node starts with poor agreement (degraded) - no chain breaks
    for _ in 0..85 {
        computer.record_root_comparison("node-1", true);
    }
    for _ in 0..15 {
        computer.record_root_comparison("node-1", false);
    }

    let health = computer.get_node_health("node-1");
    assert_eq!(health.status, NodeHealthStatus::DEGRADED);

    // Node recovers with good agreement
    for _ in 0..100 {
        computer.record_root_comparison("node-1", true);
    }

    let health = computer.get_node_health("node-1");
    // With 185 matches out of 200 total (92.5%), still DEGRADED
    assert_eq!(health.status, NodeHealthStatus::DEGRADED);

    // Continue good behavior
    for _ in 0..200 {
        computer.record_root_comparison("node-1", true);
    }

    let health = computer.get_node_health("node-1");
    // Now 385 matches out of 400 total (96.25%), above 95% threshold - HEALTHY!
    assert_eq!(health.status, NodeHealthStatus::HEALTHY);

    // Verify continued healthy status with more good behavior
    for _ in 0..500 {
        computer.record_root_comparison("node-1", true);
    }

    let health = computer.get_node_health("node-1");
    // Now 885 matches out of 900 total (98.33%), well above 95% threshold
    // No chain breaks, signature failures, or missing windows
    assert_eq!(health.status, NodeHealthStatus::HEALTHY);
}

/// Test that health API returns consistent timestamps
#[test]
fn test_health_timestamp_consistency() {
    let computer = NodeHealthComputer::new();

    // Record some metrics
    for _ in 0..100 {
        computer.record_root_comparison("node-1", true);
    }

    let health1 = computer.get_node_health("node-1");
    thread::sleep(Duration::from_millis(10));
    let health2 = computer.get_node_health("node-1");

    // Health timestamp should be current (generation time)
    assert!(health2.timestamp >= health1.timestamp);

    // Metrics last_updated should be the same (no new recordings)
    assert_eq!(health1.metrics.last_updated, health2.metrics.last_updated);
}

/// Test zero trust behavior when metrics are inconsistent
#[test]
fn test_zero_trust_with_no_root_comparisons() {
    let computer = NodeHealthComputer::new();

    // Record only non-root metrics
    computer.record_chain_break("node-1");
    computer.record_signature_failure("node-1");
    computer.record_missing_window("node-1");

    let health = computer.get_node_health("node-1");

    // Should be UNKNOWN because root_agreement_ratio is 0.0
    // (no root comparisons made, zero trust default)
    assert_eq!(health.status, NodeHealthStatus::UNKNOWN);
    assert_eq!(health.metrics.root_agreement_ratio, 0.0);
}

/// Test that health computer handles concurrent updates
#[test]
fn test_concurrent_metric_updates() {
    use std::sync::Arc;

    let computer = Arc::new(NodeHealthComputer::new());
    let mut handles = vec![];

    // Spawn multiple threads updating different nodes
    for i in 0..5 {
        let computer_clone = Arc::clone(&computer);
        let node_id = format!("node-{}", i);

        let handle = thread::spawn(move || {
            for _ in 0..100 {
                computer_clone.record_root_comparison(&node_id, true);
            }
        });

        handles.push(handle);
    }

    // Wait for all threads
    for handle in handles {
        handle.join().unwrap();
    }

    // All nodes should be healthy
    for i in 0..5 {
        let node_id = format!("node-{}", i);
        let health = computer.get_node_health(&node_id);
        assert_eq!(health.status, NodeHealthStatus::HEALTHY);
        assert_eq!(health.metrics.root_agreement_ratio, 1.0);
    }
}
