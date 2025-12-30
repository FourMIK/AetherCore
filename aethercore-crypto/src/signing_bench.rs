//! Performance benchmarks for event signing service.
//!
//! These tests verify that the performance targets are met:
//! - Event signing: <1ms median per event
//!
//! Note: These use #[test] instead of #[bench] to run in stable Rust and
//! enforce performance requirements in CI. They are performance verification
//! tests that fail if requirements aren't met, not profiling benchmarks.

use crate::signing::{CanonicalEvent, EventSigningService};
use std::collections::HashMap;
use std::time::Instant;

/// Helper to get current timestamp
fn current_timestamp() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_millis() as u64
}

#[test]
fn bench_event_signing() {
    let mut service = EventSigningService::new();
    let iterations = 1000;
    let mut durations = Vec::with_capacity(iterations);

    for i in 0..iterations {
        let event = CanonicalEvent {
            event_type: "benchmark.event".to_string(),
            timestamp: current_timestamp(),
            source_id: format!("device-{:03}", i % 100),
            sequence: i as u64,
            payload: HashMap::new(),
        };

        let start = Instant::now();
        let _result = service.sign_event(&event).unwrap();
        let duration = start.elapsed();
        durations.push(duration.as_micros());
    }

    durations.sort();
    let median = durations[iterations / 2];
    let p95 = durations[(iterations * 95) / 100];
    let p99 = durations[(iterations * 99) / 100];
    let max = durations[iterations - 1];

    println!("\n=== Event Signing Performance ===");
    println!("Iterations: {}", iterations);
    println!("Median:     {}μs", median);
    println!("P95:        {}μs", p95);
    println!("P99:        {}μs", p99);
    println!("Max:        {}μs", max);
    println!("Target:     <1000μs (1ms)");

    // Target: <1ms (1000μs) median for event signing
    assert!(
        median < 1000,
        "Event signing too slow: {}μs median (target: <1000μs)",
        median
    );

    // P95 should also be reasonable
    assert!(
        p95 < 2000,
        "P95 event signing too slow: {}μs (target: <2000μs)",
        p95
    );
}

#[test]
fn bench_event_signing_with_payload() {
    let mut service = EventSigningService::new();
    let iterations = 1000;
    let mut durations = Vec::with_capacity(iterations);

    for i in 0..iterations {
        let mut payload = HashMap::new();
        payload.insert(
            "temperature".to_string(),
            serde_json::json!(25.5 + (i as f64 * 0.1)),
        );
        payload.insert("humidity".to_string(), serde_json::json!(60 + (i % 40)));
        payload.insert("pressure".to_string(), serde_json::json!(1013.25));

        let event = CanonicalEvent {
            event_type: "sensor.reading".to_string(),
            timestamp: current_timestamp(),
            source_id: format!("sensor-{:03}", i % 50),
            sequence: i as u64,
            payload,
        };

        let start = Instant::now();
        let _result = service.sign_event(&event).unwrap();
        let duration = start.elapsed();
        durations.push(duration.as_micros());
    }

    durations.sort();
    let median = durations[iterations / 2];
    let p95 = durations[(iterations * 95) / 100];

    println!("\n=== Event Signing with Payload Performance ===");
    println!("Iterations: {}", iterations);
    println!("Median:     {}μs", median);
    println!("P95:        {}μs", p95);

    // Should still be <1ms median even with payload
    assert!(
        median < 1000,
        "Event signing with payload too slow: {}μs median (target: <1000μs)",
        median
    );
}

#[test]
fn bench_signature_throughput() {
    let mut service = EventSigningService::new();
    let iterations = 10000;

    let mut events = Vec::with_capacity(iterations);
    for i in 0..iterations {
        events.push(CanonicalEvent {
            event_type: "throughput.test".to_string(),
            timestamp: current_timestamp(),
            source_id: format!("device-{:03}", i % 100),
            sequence: i as u64,
            payload: HashMap::new(),
        });
    }

    let start = Instant::now();
    for event in &events {
        let _result = service.sign_event(event).unwrap();
    }
    let total_duration = start.elapsed();

    let ops_per_sec = (iterations as f64) / total_duration.as_secs_f64();
    println!("\n=== Signature Throughput ===");
    println!("Total events:   {}", iterations);
    println!("Total time:     {:.2}s", total_duration.as_secs_f64());
    println!("Throughput:     {:.0} events/sec", ops_per_sec);
    println!("Target:         >1,000 events/sec (debug), >10,000 events/sec (release)");

    // In debug builds, target >1k ops/sec (release builds will be much faster)
    // The README target of >10k ops/sec applies to release builds
    assert!(
        ops_per_sec > 1000.0,
        "Throughput too low: {:.0} ops/sec (target: >1,000 ops/sec in debug mode)",
        ops_per_sec
    );
}

#[test]
fn bench_validation_overhead() {
    let mut service = EventSigningService::new();
    let iterations = 1000;

    // Measure validation time
    let mut validation_durations = Vec::with_capacity(iterations);
    for i in 0..iterations {
        let event = CanonicalEvent {
            event_type: "validation.test".to_string(),
            timestamp: current_timestamp(),
            source_id: format!("device-{:03}", i % 100),
            sequence: i as u64,
            payload: HashMap::new(),
        };

        let start = Instant::now();
        let _ = event.validate();
        validation_durations.push(start.elapsed().as_nanos());
    }

    // Measure full signing time
    let mut signing_durations = Vec::with_capacity(iterations);
    for i in 0..iterations {
        let event = CanonicalEvent {
            event_type: "validation.test".to_string(),
            timestamp: current_timestamp(),
            source_id: format!("device-{:03}", i % 100),
            sequence: i as u64,
            payload: HashMap::new(),
        };

        let start = Instant::now();
        let _ = service.sign_event(&event);
        signing_durations.push(start.elapsed().as_nanos());
    }

    validation_durations.sort();
    signing_durations.sort();

    let validation_median = validation_durations[iterations / 2];
    let signing_median = signing_durations[iterations / 2];
    let validation_pct = (validation_median as f64 / signing_median as f64) * 100.0;

    println!("\n=== Validation Overhead ===");
    println!("Validation median: {}ns", validation_median);
    println!("Signing median:    {}ns", signing_median);
    println!("Validation %:      {:.1}%", validation_pct);

    // Validation should be a small fraction of total signing time
    assert!(
        validation_pct < 10.0,
        "Validation overhead too high: {:.1}% (should be <10%)",
        validation_pct
    );
}
