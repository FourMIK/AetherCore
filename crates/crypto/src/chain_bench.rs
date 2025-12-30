//! Performance benchmarks for chain operations.
//!
//! These tests verify that the chain can handle large numbers of events:
//! - Build chains of 10,000+ events
//! - Verify chains efficiently
//! - No pathological slowdowns

use crate::chain::ChainManager;
use crate::signing::CanonicalEvent;
use std::collections::HashMap;
use std::time::Instant;

fn create_test_event(sequence: u64) -> CanonicalEvent {
    let mut payload = HashMap::new();
    payload.insert("value".to_string(), serde_json::json!(sequence));

    CanonicalEvent {
        event_type: "benchmark.event".to_string(),
        timestamp: 1700000000000 + sequence * 100,
        source_id: format!("device-{:03}", sequence % 100),
        sequence,
        payload,
    }
}

#[test]
fn bench_chain_build_10k_events() {
    let mut manager = ChainManager::new();
    let event_count: usize = 10_000;

    println!("\n=== Building Chain with {} Events ===", event_count);

    let start = Instant::now();

    for i in 0..event_count {
        let event = create_test_event(i as u64);
        manager.append_to_chain(event).unwrap();
    }

    let build_duration = start.elapsed();

    println!("Total events: {}", manager.len());
    println!("Build time: {:.2}ms", build_duration.as_secs_f64() * 1000.0);
    println!(
        "Avg per event: {:.2}μs",
        build_duration.as_micros() as f64 / event_count as f64
    );

    // Verify reasonable performance
    // Target: < 50ms total for 10k events (< 5μs per event) in release mode
    // Allow 150ms in debug builds on CI
    assert!(
        build_duration.as_millis() < 150,
        "Chain build too slow: {}ms (target: <150ms)",
        build_duration.as_millis()
    );

    assert_eq!(manager.len(), event_count);
    assert_eq!(manager.metrics().chain_events_total, event_count as u64);
}

#[test]
fn bench_chain_verify_10k_events() {
    // Build chain
    let mut manager = ChainManager::new();
    let event_count: usize = 10_000;

    for i in 0..event_count {
        let event = create_test_event(i as u64);
        manager.append_to_chain(event).unwrap();
    }

    println!("\n=== Verifying Chain with {} Events ===", event_count);

    // Verify chain
    let start = Instant::now();
    let result = manager.verify_chain_from_start();
    let verify_duration = start.elapsed();

    println!("Verification: {:?}", result);
    println!(
        "Verify time: {:.2}ms",
        verify_duration.as_secs_f64() * 1000.0
    );
    println!(
        "Avg per event: {:.2}μs",
        verify_duration.as_micros() as f64 / event_count as f64
    );

    // Verify reasonable performance
    // Target: < 50ms total for 10k events (< 5μs per event) in release mode
    // Allow 150ms in debug builds on CI
    assert!(
        verify_duration.as_millis() < 150,
        "Chain verification too slow: {}ms (target: <150ms)",
        verify_duration.as_millis()
    );

    assert!(matches!(result, crate::chain::VerifyResult::Ok));
}

#[test]
fn bench_chain_build_and_verify_100k_events() {
    // This is a stress test for larger chains
    let mut manager = ChainManager::new();
    let event_count: usize = 100_000;

    println!(
        "\n=== Stress Test: Building Chain with {} Events ===",
        event_count
    );

    let build_start = Instant::now();

    for i in 0..event_count {
        let event = create_test_event(i as u64);
        manager.append_to_chain(event).unwrap();
    }

    let build_duration = build_start.elapsed();

    println!("Build time: {:.2}s", build_duration.as_secs_f64());
    println!(
        "Avg per event: {:.2}μs",
        build_duration.as_micros() as f64 / event_count as f64
    );

    // Verify chain
    println!("Verifying chain...");
    let verify_start = Instant::now();
    let result = manager.verify_chain_from_start();
    let verify_duration = verify_start.elapsed();

    println!("Verify time: {:.2}s", verify_duration.as_secs_f64());
    println!(
        "Avg per event: {:.2}μs",
        verify_duration.as_micros() as f64 / event_count as f64
    );

    // Should complete within reasonable time
    // Target: < 1s total for 100k events
    assert!(
        build_duration.as_secs() < 2,
        "Chain build too slow: {}s",
        build_duration.as_secs()
    );
    assert!(
        verify_duration.as_secs() < 2,
        "Chain verification too slow: {}s",
        verify_duration.as_secs()
    );

    assert!(matches!(result, crate::chain::VerifyResult::Ok));
}

#[test]
fn bench_chain_partial_verification() {
    // Build a large chain
    let mut manager = ChainManager::new();
    let event_count: usize = 50_000;

    for i in 0..event_count {
        let event = create_test_event(i as u64);
        manager.append_to_chain(event).unwrap();
    }

    println!("\n=== Partial Chain Verification ===");

    // Verify from middle of chain
    let start_index = 25_000;
    let start = Instant::now();
    let result = manager.verify_chain_from(start_index);
    let duration = start.elapsed();

    println!("Verified from index {}", start_index);
    println!("Verify time: {:.2}ms", duration.as_secs_f64() * 1000.0);

    assert!(matches!(result, crate::chain::VerifyResult::Ok));
}

#[test]
fn bench_hash_computation_throughput() {
    let event_count: usize = 10_000;
    let event = create_test_event(0);

    println!("\n=== Hash Computation Throughput ===");

    let start = Instant::now();

    for _ in 0..event_count {
        let _ = crate::chain::compute_event_hash(&event).unwrap();
    }

    let duration = start.elapsed();
    let ops_per_sec = event_count as f64 / duration.as_secs_f64();

    println!("Total hashes: {}", event_count);
    println!("Total time: {:.2}ms", duration.as_secs_f64() * 1000.0);
    println!("Throughput: {:.0} hashes/sec", ops_per_sec);
    println!(
        "Avg per hash: {:.2}μs",
        duration.as_micros() as f64 / event_count as f64
    );

    // BLAKE3 should be very fast
    // Target: > 100k hashes/sec (< 10μs per hash)
    assert!(
        ops_per_sec > 50_000.0,
        "Hash computation too slow: {:.0} ops/sec",
        ops_per_sec
    );
}
