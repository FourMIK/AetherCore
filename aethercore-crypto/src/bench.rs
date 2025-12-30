//! Performance benchmarks for session cipher rotation.
//!
//! These tests verify that the performance targets are met:
//! - Complete key rotation: <5ms median

#![allow(unused_mut)] // mut is needed for compute_shared_secret which takes &mut self

use crate::session::{SessionKeyPair, SessionManager};
use std::time::Instant;

#[test]
fn bench_key_generation() {
    let iterations = 100;
    let mut durations = Vec::new();

    for _ in 0..iterations {
        let start = Instant::now();
        let _keypair = SessionKeyPair::generate().unwrap();
        let duration = start.elapsed();
        durations.push(duration.as_micros());
    }

    durations.sort();
    let median = durations[iterations / 2];
    let p95 = durations[(iterations * 95) / 100];

    println!("Key generation: median={}μs, p95={}μs", median, p95);

    // X25519 key generation should be fast (<1ms typical)
    assert!(median < 1000, "Key generation too slow: {}μs", median);
}

#[test]
fn bench_key_exchange() {
    let iterations = 100;
    let mut durations = Vec::new();

    for _ in 0..iterations {
        let mut alice_keypair = SessionKeyPair::generate().unwrap();
        let mut bob_keypair = SessionKeyPair::generate().unwrap();
        let bob_public = bob_keypair.public;

        let start = Instant::now();
        let _shared_secret = alice_keypair.compute_shared_secret(&bob_public).unwrap();
        let duration = start.elapsed();
        durations.push(duration.as_micros());
    }

    durations.sort();
    let median = durations[iterations / 2];
    let p95 = durations[(iterations * 95) / 100];

    println!("Key exchange (DH): median={}μs, p95={}μs", median, p95);

    // X25519 DH should be reasonably fast (<1ms typical in release builds)
    // In debug builds, allow up to 1ms
    assert!(median < 1000, "Key exchange too slow: {}μs", median);
}

#[test]
fn bench_full_session_rotation() {
    let iterations = 100;
    let mut durations = Vec::new();

    for _ in 0..iterations {
        let mut alice = SessionManager::new("alice".to_string());
        let mut bob = SessionManager::new("bob".to_string());

        // Initial handshake
        let alice_msg = alice.initiate_session().unwrap();
        let bob_msg = bob.initiate_session().unwrap();
        alice.complete_key_exchange(&bob_msg).unwrap();
        bob.complete_key_exchange(&alice_msg).unwrap();

        // Measure rotation
        let start = Instant::now();

        let alice_rotate = alice.initiate_rotation().unwrap();
        let bob_rotate = bob.initiate_rotation().unwrap();
        alice.complete_rotation(&bob_rotate).unwrap();
        bob.complete_rotation(&alice_rotate).unwrap();

        let duration = start.elapsed();
        durations.push(duration.as_micros());
    }

    durations.sort();
    let median = durations[iterations / 2];
    let p95 = durations[(iterations * 95) / 100];
    let max = durations[iterations - 1];

    println!(
        "Full rotation: median={}μs, p95={}μs, max={}μs",
        median, p95, max
    );

    // Target: <5ms (5000μs) median for complete rotation
    assert!(
        median < 5000,
        "Rotation too slow: {}μs (target: <5000μs)",
        median
    );

    // P95 should also be reasonable
    assert!(p95 < 10000, "P95 rotation too slow: {}μs", p95);
}

#[test]
fn bench_encrypt_decrypt() {
    let mut alice = SessionManager::new("alice".to_string());
    let mut bob = SessionManager::new("bob".to_string());

    // Handshake
    let alice_msg = alice.initiate_session().unwrap();
    let bob_msg = bob.initiate_session().unwrap();
    alice.complete_key_exchange(&bob_msg).unwrap();
    bob.complete_key_exchange(&alice_msg).unwrap();

    let plaintext = b"Test message for benchmarking encryption and decryption performance";
    let iterations = 1000;
    let mut encrypt_durations = Vec::new();
    let mut decrypt_durations = Vec::new();

    for _ in 0..iterations {
        let start = Instant::now();
        let (ciphertext, nonce) = alice.encrypt(plaintext).unwrap();
        encrypt_durations.push(start.elapsed().as_micros());

        let start = Instant::now();
        let _decrypted = bob.decrypt(&ciphertext, &nonce).unwrap();
        decrypt_durations.push(start.elapsed().as_micros());
    }

    encrypt_durations.sort();
    decrypt_durations.sort();

    let encrypt_median = encrypt_durations[iterations / 2];
    let decrypt_median = decrypt_durations[iterations / 2];

    println!("Encrypt: median={}μs", encrypt_median);
    println!("Decrypt: median={}μs", decrypt_median);

    // ChaCha20-Poly1305 should be fast (<200μs per operation in debug builds)
    // In release builds, this would be <20μs typically
    assert!(
        encrypt_median < 300,
        "Encryption too slow: {}μs",
        encrypt_median
    );
    assert!(
        decrypt_median < 300,
        "Decryption too slow: {}μs",
        decrypt_median
    );
}
