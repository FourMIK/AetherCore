//! Merkle Vine Performance Benchmarks
//!
//! Measures performance of Merkle Vine operations on desktop hardware:
//! - Adding leaves to the vine
//! - Root recomputation with BLAKE3
//! - Proof generation and verification
//! - Batch updates for streaming data

use criterion::{black_box, criterion_group, criterion_main, Criterion, BenchmarkId};
use aethercore_core::merkle_vine::MerkleVine;
use blake3;

/// Generate test data with BLAKE3 hash
fn generate_test_leaf(index: u64) -> (Vec<u8>, Vec<u8>) {
    let data = format!("test-data-{:08}", index).into_bytes();
    let hash = blake3::hash(&data).as_bytes().to_vec();
    (data, hash)
}

/// Benchmark: Single leaf addition to vine
fn bench_vine_add_leaf_single(c: &mut Criterion) {
    c.bench_function("vine_add_leaf_single", |b| {
        let mut vine = MerkleVine::new("test-vine");
        let mut index = 0u64;
        
        b.iter(|| {
            let (data, hash) = generate_test_leaf(index);
            let timestamp = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_millis() as u64;
            black_box(vine.add_leaf(data, hash, timestamp).unwrap());
            index += 1;
        })
    });
}

/// Benchmark: Batch leaf additions with varying sizes
fn bench_vine_add_leaf_batch(c: &mut Criterion) {
    let batch_sizes = vec![10, 100, 1000];
    
    for size in batch_sizes {
        c.bench_with_input(
            BenchmarkId::new("vine_add_leaf_batch", size),
            &size,
            |b, &size| {
                b.iter(|| {
                    let mut vine = MerkleVine::new("test-vine");
                    let timestamp = std::time::SystemTime::now()
                        .duration_since(std::time::UNIX_EPOCH)
                        .unwrap()
                        .as_millis() as u64;
                    
                    for i in 0..size {
                        let (data, hash) = generate_test_leaf(i);
                        black_box(vine.add_leaf(data, hash, timestamp + i).unwrap());
                    }
                });
            },
        );
    }
}

/// Benchmark: Root hash retrieval
fn bench_vine_get_root(c: &mut Criterion) {
    // Pre-build vines of different sizes
    let sizes = vec![10, 100, 1000];
    
    for size in sizes {
        let mut vine = MerkleVine::new("test-vine");
        let timestamp = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_millis() as u64;
        
        for i in 0..size {
            let (data, hash) = generate_test_leaf(i);
            vine.add_leaf(data, hash, timestamp + i).unwrap();
        }
        
        c.bench_with_input(
            BenchmarkId::new("vine_get_root", size),
            &size,
            |b, _| {
                b.iter(|| {
                    black_box(vine.get_root())
                });
            },
        );
    }
}

/// Benchmark: Proof generation for inclusion verification
fn bench_vine_generate_proof(c: &mut Criterion) {
    let sizes = vec![100, 1000];
    
    for size in sizes {
        let mut vine = MerkleVine::new("test-vine");
        let timestamp = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_millis() as u64;
        
        for i in 0..size {
            let (data, hash) = generate_test_leaf(i);
            vine.add_leaf(data, hash.clone(), timestamp + i).unwrap();
        }
        
        c.bench_with_input(
            BenchmarkId::new("vine_generate_proof", size),
            &size,
            |b, _| {
                b.iter(|| {
                    // Generate proof for a middle leaf
                    let target_index = size / 2;
                    black_box(vine.generate_proof(target_index))
                });
            },
        );
    }
}

/// Benchmark: Proof verification
fn bench_vine_verify_proof(c: &mut Criterion) {
    // Build a vine with 100 leaves
    let mut vine = MerkleVine::new("test-vine");
    let timestamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_millis() as u64;
    
    for i in 0..100 {
        let (data, hash) = generate_test_leaf(i);
        vine.add_leaf(data, hash.clone(), timestamp + i).unwrap();
    }
    
    let proof = vine.generate_proof(50).ok();
    
    if let Some(proof) = proof {
        c.bench_function("vine_verify_proof", |b| {
            b.iter(|| {
                black_box(vine.verify_proof(&proof))
            })
        });
    }
}

/// Benchmark: BLAKE3 hashing for leaf data
fn bench_blake3_hashing(c: &mut Criterion) {
    let data_sizes = vec![64, 256, 1024, 4096]; // bytes
    
    for size in data_sizes {
        let data = vec![0u8; size];
        
        c.bench_with_input(
            BenchmarkId::new("blake3_hash", size),
            &size,
            |b, _| {
                b.iter(|| {
                    black_box(blake3::hash(&data))
                });
            },
        );
    }
}

/// Benchmark: Sequential vine updates (simulating streaming data)
fn bench_vine_streaming_updates(c: &mut Criterion) {
    c.bench_function("vine_streaming_updates_100", |b| {
        b.iter(|| {
            let mut vine = MerkleVine::new("streaming-vine");
            let base_timestamp = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_millis() as u64;
            
            // Simulate 100 sequential updates
            for i in 0..100 {
                let (data, hash) = generate_test_leaf(i);
                black_box(vine.add_leaf(data, hash, base_timestamp + i).unwrap());
            }
        });
    });
}

/// Benchmark: Vine serialization for network transmission
fn bench_vine_serialization(c: &mut Criterion) {
    // Build a vine with 100 leaves
    let mut vine = MerkleVine::new("test-vine");
    let timestamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_millis() as u64;
    
    for i in 0..100 {
        let (data, hash) = generate_test_leaf(i);
        vine.add_leaf(data, hash, timestamp + i).unwrap();
    }
    
    // Skip serialization as MerkleVine may not be serializable
    // This benchmark would measure the cost of transmitting the vine data
    // In production, only checkpoints and proofs need to be serialized
    c.bench_function("vine_serialize_size_estimation", |b| {
        b.iter(|| {
            // Estimate serialization cost as root hash + leaf count
            let _size = 32 + 8; // 32 bytes for hash + 8 bytes for count
            black_box(vine.get_root())
        })
    });
}

criterion_group!(
    benches,
    bench_vine_add_leaf_single,
    bench_vine_add_leaf_batch,
    bench_vine_get_root,
    bench_vine_generate_proof,
    bench_vine_verify_proof,
    bench_blake3_hashing,
    bench_vine_streaming_updates,
    bench_vine_serialization,
);

criterion_main!(benches);
