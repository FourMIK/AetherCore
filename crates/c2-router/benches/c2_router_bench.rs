//! C2 Router Performance Benchmarks
//!
//! Measures performance of C2 command routing operations on desktop hardware:
//! - Command dispatch to single units
//! - Swarm command fan-out to multiple units
//! - Authority signature verification with Ed25519
//! - Quorum gate validation
//! - Truth-Chain ledger recording

use criterion::{black_box, criterion_group, criterion_main, Criterion, BenchmarkId};
use aethercore_c2_router::{
    dispatcher::{CommandDispatcher, UnitDispatchResult},
    command_types::{UnitCommand, SwarmCommand, Coordinate, FormationType, ScanParameters, ScanType},
    authority::{AuthorityVerifier, AuthoritySignature},
    quorum::{QuorumGate, QuorumProof, CommandScope},
    ledger::TruthChainRecorder,
};
use ed25519_dalek::{SigningKey, Signer};
use rand::RngCore;

/// Generate a test Ed25519 keypair
fn generate_test_keypair() -> (SigningKey, [u8; 32]) {
    let mut csprng = rand::rngs::OsRng;
    let mut seed = [0u8; 32];
    csprng.fill_bytes(&mut seed);
    let signing_key = SigningKey::from_bytes(&seed);
    let verifying_key = signing_key.verifying_key();
    (signing_key, verifying_key.to_bytes())
}

/// Create a test authority signature
fn create_test_signature(
    authority_id: &str,
    message: &[u8],
    signing_key: &SigningKey,
    public_key: [u8; 32],
) -> AuthoritySignature {
    let signature = signing_key.sign(message);
    let timestamp_ns = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_nanos() as u64;
    
    AuthoritySignature::new(
        authority_id.to_string(),
        signature.to_bytes().to_vec(),
        public_key,
        timestamp_ns,
    )
}

/// Benchmark: Single unit command dispatch
fn bench_unit_command_dispatch(c: &mut Criterion) {
    let dispatcher = CommandDispatcher::new();
    let command = UnitCommand::Navigate {
        waypoint: Coordinate { lat: 45.0, lon: -122.0, alt: Some(100.0) },
        speed: Some(10.0),
        altitude: Some(100.0),
    };
    
    c.bench_function("unit_command_dispatch", |b| {
        b.iter(|| {
            let timestamp_ns = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos() as u64;
            black_box(dispatcher.dispatch_unit_command("unit-1", &command, timestamp_ns).unwrap())
        })
    });
}

/// Benchmark: Swarm command fan-out (varying unit counts)
fn bench_swarm_command_fanout(c: &mut Criterion) {
    let dispatcher = CommandDispatcher::new();
    let command = SwarmCommand::FormationMove {
        formation: FormationType::Line,
        target_center: Coordinate { lat: 45.0, lon: -122.0, alt: Some(100.0) },
        spacing_meters: 50.0,
        speed: Some(10.0),
    };
    
    let unit_counts = vec![5, 10, 25, 50, 100];
    
    for count in unit_counts {
        let unit_ids: Vec<String> = (0..count)
            .map(|i| format!("unit-{}", i))
            .collect();
        
        c.bench_with_input(
            BenchmarkId::new("swarm_command_fanout", count),
            &count,
            |b, _| {
                b.iter(|| {
                    let timestamp_ns = std::time::SystemTime::now()
                        .duration_since(std::time::UNIX_EPOCH)
                        .unwrap()
                        .as_nanos() as u64;
                    black_box(dispatcher.dispatch_swarm_command(
                        format!("swarm-cmd-{}", timestamp_ns),
                        &command,
                        &unit_ids,
                        timestamp_ns,
                    ).unwrap())
                });
            },
        );
    }
}

/// Benchmark: Authority signature verification
fn bench_authority_verification(c: &mut Criterion) {
    let mut verifier = AuthorityVerifier::new();
    let (signing_key, public_key) = generate_test_keypair();
    verifier.register_authority("operator-1".to_string(), public_key);
    
    let message = b"test command payload for verification";
    let signature = create_test_signature("operator-1", message, &signing_key, public_key);
    
    c.bench_function("authority_verification_single", |b| {
        b.iter(|| {
            black_box(verifier.verify_signature(&signature, message).unwrap())
        })
    });
}

/// Benchmark: Authority verification with multiple signatures (quorum)
fn bench_authority_verification_quorum(c: &mut Criterion) {
    let mut verifier = AuthorityVerifier::new();
    
    // Create 3 authorities
    let mut authorities = Vec::new();
    for i in 0..3 {
        let (signing_key, public_key) = generate_test_keypair();
        let authority_id = format!("coalition-{}", i);
        verifier.register_authority(authority_id.clone(), public_key);
        authorities.push((authority_id, signing_key, public_key));
    }
    
    let message = b"test command payload requiring quorum";
    
    c.bench_function("authority_verification_quorum_3", |b| {
        b.iter(|| {
            // Verify all 3 signatures
            for (authority_id, signing_key, public_key) in &authorities {
                let signature = create_test_signature(authority_id, message, signing_key, *public_key);
                black_box(verifier.verify_signature(&signature, message).unwrap());
            }
        })
    });
}

/// Benchmark: Quorum gate validation
fn bench_quorum_gate_validation(c: &mut Criterion) {
    let verifier = AuthorityVerifier::new();
    let gate = QuorumGate::new(verifier);
    
    // Create test proofs
    let operator_proof = QuorumProof {
        operator_signature: Some(create_test_signature(
            "operator-1",
            b"test",
            &generate_test_keypair().0,
            generate_test_keypair().1,
        )),
        coalition_signatures: vec![],
    };
    
    c.bench_function("quorum_gate_single_unit", |b| {
        b.iter(|| {
            black_box(gate.validate_quorum(&CommandScope::SingleUnit, &operator_proof).unwrap())
        })
    });
    
    // Multi-unit quorum
    let multi_unit_proof = QuorumProof {
        operator_signature: Some(create_test_signature(
            "operator-1",
            b"test",
            &generate_test_keypair().0,
            generate_test_keypair().1,
        )),
        coalition_signatures: vec![
            create_test_signature(
                "coalition-1",
                b"test",
                &generate_test_keypair().0,
                generate_test_keypair().1,
            ),
        ],
    };
    
    c.bench_function("quorum_gate_swarm_small", |b| {
        b.iter(|| {
            black_box(gate.validate_quorum(&CommandScope::SwarmSmall, &multi_unit_proof).unwrap())
        })
    });
}

/// Benchmark: Truth-Chain ledger recording
fn bench_truthchain_recording(c: &mut Criterion) {
    let recorder = TruthChainRecorder::new("node-1".to_string());
    
    c.bench_function("truthchain_record_unit_command", |b| {
        let mut seq = 0u64;
        b.iter(|| {
            seq += 1;
            let timestamp_ns = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos() as u64;
            black_box(recorder.record_unit_command(
                format!("unit-cmd-{}", seq),
                "unit-1".to_string(),
                "Navigate".to_string(),
                timestamp_ns,
            ))
        })
    });
    
    c.bench_function("truthchain_record_swarm_command", |b| {
        let mut seq = 0u64;
        b.iter(|| {
            seq += 1;
            let timestamp_ns = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos() as u64;
            let unit_ids = vec!["unit-1".to_string(), "unit-2".to_string(), "unit-3".to_string()];
            black_box(recorder.record_swarm_command(
                format!("swarm-cmd-{}", seq),
                unit_ids,
                "FormationMove".to_string(),
                timestamp_ns,
            ))
        })
    });
}

/// Benchmark: Command serialization overhead
fn bench_command_serialization(c: &mut Criterion) {
    let unit_command = UnitCommand::Navigate {
        waypoint: Coordinate { lat: 45.0, lon: -122.0, alt: Some(100.0) },
        speed: Some(10.0),
        altitude: Some(100.0),
    };
    
    c.bench_function("command_serialize_unit", |b| {
        b.iter(|| {
            black_box(serde_json::to_string(&unit_command).unwrap())
        })
    });
    
    let swarm_command = SwarmCommand::AreaScan {
        scan_params: ScanParameters {
            scan_type: ScanType::Visual,
            resolution: 1.0,
            overlap: 0.3,
        },
        boundary: vec![
            Coordinate { lat: 45.0, lon: -122.0, alt: Some(100.0) },
            Coordinate { lat: 45.1, lon: -122.0, alt: Some(100.0) },
            Coordinate { lat: 45.1, lon: -122.1, alt: Some(100.0) },
            Coordinate { lat: 45.0, lon: -122.1, alt: Some(100.0) },
        ],
    };
    
    c.bench_function("command_serialize_swarm", |b| {
        b.iter(|| {
            black_box(serde_json::to_string(&swarm_command).unwrap())
        })
    });
}

criterion_group!(
    benches,
    bench_unit_command_dispatch,
    bench_swarm_command_fanout,
    bench_authority_verification,
    bench_authority_verification_quorum,
    bench_quorum_gate_validation,
    bench_truthchain_recording,
    bench_command_serialization,
);

criterion_main!(benches);
