//! Trust Mesh Performance Benchmarks
//!
//! Measures performance of core trust mesh operations on desktop hardware:
//! - Event signing with Ed25519 (BLAKE3 hashing)
//! - Merkle aggregation over event batches
//! - Checkpoint creation and verification
//! - Trust score computation

use aethercore_domain::canonical_event::{EventPayload, EventType};
use aethercore_domain::CanonicalEvent;
use aethercore_trust_mesh::{
    merkle::{CheckpointWindow, MerkleAggregator},
    node_health::NodeHealthComputer,
    signing::{EventSigner, InMemoryKeyManager, KeyManager},
    trust::TrustScorer,
};
use criterion::{black_box, criterion_group, criterion_main, BenchmarkId, Criterion};
use std::collections::BTreeMap;

/// Create a sample canonical event for benchmarking
fn create_test_event(node_id: &str, sequence: u64, prev_hash: String) -> CanonicalEvent {
    let timestamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_millis() as u64;

    let mut payload_map = BTreeMap::new();
    payload_map.insert("test_key".to_string(), serde_json::json!("test_value"));
    payload_map.insert("sequence".to_string(), serde_json::json!(sequence));

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

/// Benchmark: Event signing with Ed25519 (single event)
fn bench_event_signing_single(c: &mut Criterion) {
    let mut key_manager = InMemoryKeyManager::new();
    key_manager.generate_key("node-1").unwrap();
    let signer = EventSigner::new(key_manager);

    c.bench_function("event_signing_single", |b| {
        b.iter(|| {
            let event = create_test_event("node-1", 1, String::new());
            black_box(signer.sign_event(event).unwrap())
        })
    });
}

/// Benchmark: Event signing throughput (batch of events)
fn bench_event_signing_batch(c: &mut Criterion) {
    let mut key_manager = InMemoryKeyManager::new();
    key_manager.generate_key("node-1").unwrap();
    let signer = EventSigner::new(key_manager);

    let sizes = vec![10, 100, 1000];

    for size in sizes {
        c.bench_with_input(
            BenchmarkId::new("event_signing_batch", size),
            &size,
            |b, &size| {
                b.iter(|| {
                    let mut prev_hash = String::new();
                    for i in 0..size {
                        let event = create_test_event("node-1", i, prev_hash.clone());
                        let signed_event = signer.sign_event(event).unwrap();
                        prev_hash = signed_event.hash.clone();
                        black_box(signed_event);
                    }
                });
            },
        );
    }
}

/// Benchmark: Merkle checkpoint creation
fn bench_merkle_checkpoint_creation(c: &mut Criterion) {
    let node_id = "node-1";
    let mut key_manager = InMemoryKeyManager::new();
    let public_key = key_manager.generate_key(node_id).unwrap();
    let mut aggregator = MerkleAggregator::new(node_id.to_string());

    let sizes = vec![10, 100, 1000];

    for size in sizes {
        // Pre-generate event hashes for the window
        let event_hashes: Vec<String> = (0..size).map(|i| format!("hash-{:08}", i)).collect();
        let timestamps: Vec<u64> = (0..size).map(|i| 1000000 + i as u64 * 1000).collect();
        let heights: Vec<u64> = (0..size).collect();

        c.bench_with_input(
            BenchmarkId::new("merkle_checkpoint_create", size),
            &size,
            |b, _| {
                b.iter(|| {
                    let window = CheckpointWindow::from_events(
                        node_id.to_string(),
                        1,
                        event_hashes.clone(),
                        &timestamps,
                        &heights,
                    )
                    .unwrap();
                    // Create dummy signature
                    let signature = String::new();
                    black_box(
                        aggregator
                            .create_checkpoint(window, public_key.clone(), signature)
                            .unwrap(),
                    )
                });
            },
        );
    }
}

/// Benchmark: Trust score computation
fn bench_trust_score_computation(c: &mut Criterion) {
    let scorer = TrustScorer::new();

    c.bench_function("trust_score_compute", |b| {
        b.iter(|| {
            let node_id = "node-0";
            black_box(scorer.get_score(node_id))
        })
    });
}

/// Benchmark: Node health computation with integrity metrics
fn bench_node_health_computation(c: &mut Criterion) {
    let computer = NodeHealthComputer::new();

    c.bench_function("node_health_compute", |b| {
        b.iter(|| black_box(computer.get_node_health("node-1")))
    });
}

/// Benchmark: Gossip message serialization overhead
fn bench_gossip_serialization(c: &mut Criterion) {
    use aethercore_trust_mesh::gossip::GossipMessage;

    let message = GossipMessage::CheckpointSummary {
        node_id: "node-1".to_string(),
        latest_seq_no: 1000,
        latest_root_hash: hex::encode(vec![0u8; 32]),
        signature: hex::encode(vec![0u8; 64]),
    };

    c.bench_function("gossip_serialize", |b| {
        b.iter(|| black_box(serde_json::to_string(&message).unwrap()))
    });

    let serialized = serde_json::to_string(&message).unwrap();
    c.bench_function("gossip_deserialize", |b| {
        b.iter(|| black_box(serde_json::from_str::<GossipMessage>(&serialized).unwrap()))
    });
}

criterion_group!(
    benches,
    bench_event_signing_single,
    bench_event_signing_batch,
    bench_merkle_checkpoint_creation,
    bench_trust_score_computation,
    bench_node_health_computation,
    bench_gossip_serialization,
);

criterion_main!(benches);
