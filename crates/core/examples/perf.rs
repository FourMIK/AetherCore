//! Quick, self-contained performance pulse for AetherCore primitives.
//!
//! Measures:
//! - BLAKE3 hashing throughput (1 MiB blocks)
//! - Ed25519 signing + verification throughput
//! - Merkle Vine append throughput (512-byte leaves)
//! - Combined E2E path: sign + verify + Merkle append
//!
//! This is intentionally dependency-light (no Criterion) to keep build times low
//! and to align with the Fail-Visible doctrine: any failure surfaces explicitly.

use aethercore_core::merkle_vine::MerkleVine;
use anyhow::Context;
use blake3::Hasher;
use ed25519_dalek::{Signature, Signer, SigningKey, Verifier, VerifyingKey};
use hex::ToHex;
use rand::{rngs::StdRng, RngCore, SeedableRng};
use std::time::Instant;

const HASH_BLOCK_BYTES: usize = 1 * 1024 * 1024; // 1 MiB
const HASH_ITERS: usize = 200;
const SIGN_ITERS: usize = 10_000;
const MERKLE_LEAVES: usize = 4_000;
const MERKLE_LEAF_BYTES: usize = 512;
const E2E_ITERS: usize = 2_000;
const E2E_MSG_BYTES: usize = 256;

fn main() -> anyhow::Result<()> {
    let mut rng = StdRng::seed_from_u64(0xA37E_2026);
    println!("AetherCore performance snapshot (release build recommended)");
    println!("----------------------------------------------------------");

    run_blake3_hashing(&mut rng)?;
    run_ed25519_sign_verify(&mut rng)?;
    run_merkle_vine(&mut rng)?;
    run_full_e2e(&mut rng)?;

    Ok(())
}

fn random_signing_key(rng: &mut StdRng) -> SigningKey {
    let mut seed = [0u8; 32];
    rng.fill_bytes(&mut seed);
    SigningKey::from_bytes(&seed)
}

fn run_blake3_hashing(rng: &mut StdRng) -> anyhow::Result<()> {
    let mut block = vec![0u8; HASH_BLOCK_BYTES];
    rng.fill_bytes(&mut block);

    let start = Instant::now();
    let mut sink = 0u8; // prevents optimizer from discarding work
    for _ in 0..HASH_ITERS {
        let mut hasher = Hasher::new();
        hasher.update(&block);
        let digest = hasher.finalize();
        sink ^= digest.as_bytes()[0];
    }
    let elapsed = start.elapsed();
    // Use sink so compiler keeps the loop
    if sink == 0xFF {
        println!("(noop to keep optimizer honest)");
    }

    let total_bytes = (HASH_BLOCK_BYTES * HASH_ITERS) as f64;
    let mb_per_s = total_bytes / elapsed.as_secs_f64() / 1_000_000.0;

    println!(
        "BLAKE3 hashing : {:>7.2} MB/s ({} x 1 MiB, {:.3}s)",
        mb_per_s, HASH_ITERS, elapsed.as_secs_f64()
    );
    Ok(())
}

fn run_ed25519_sign_verify(rng: &mut StdRng) -> anyhow::Result<()> {
    let signing_key = random_signing_key(rng);
    let verifying_key: VerifyingKey = signing_key.verifying_key();

    let mut messages: Vec<Vec<u8>> = Vec::with_capacity(SIGN_ITERS);
    let mut signatures: Vec<Signature> = Vec::with_capacity(SIGN_ITERS);

    // Signing
    let start_sign = Instant::now();
    for i in 0..SIGN_ITERS {
        let mut msg = vec![0u8; 96];
        rng.fill_bytes(&mut msg);
        msg[0] = (i & 0xFF) as u8; // small variation to avoid identical messages
        let sig = signing_key.sign(&msg);
        messages.push(msg);
        signatures.push(sig);
    }
    let sign_elapsed = start_sign.elapsed();

    // Verification
    let start_verify = Instant::now();
    for (msg, sig) in messages.iter().zip(signatures.iter()) {
        verifying_key
            .verify(msg, sig)
            .with_context(|| "Ed25519 verification failed")?;
    }
    let verify_elapsed = start_verify.elapsed();

    let sign_ops = SIGN_ITERS as f64 / sign_elapsed.as_secs_f64();
    let verify_ops = SIGN_ITERS as f64 / verify_elapsed.as_secs_f64();

    println!(
        "Ed25519 sign   : {:>7.0} ops/s ({} msgs, {:.3}s)",
        sign_ops, SIGN_ITERS, sign_elapsed.as_secs_f64()
    );
    println!(
        "Ed25519 verify : {:>7.0} ops/s ({} sigs, {:.3}s)",
        verify_ops, SIGN_ITERS, verify_elapsed.as_secs_f64()
    );
    Ok(())
}

fn run_merkle_vine(rng: &mut StdRng) -> anyhow::Result<()> {
    let mut vine = MerkleVine::new("perf-merkle");
    let mut leaf_buf = vec![0u8; MERKLE_LEAF_BYTES];

    let start = Instant::now();
    for i in 0..MERKLE_LEAVES {
        rng.fill_bytes(&mut leaf_buf);
        let timestamp = i as u64;
        vine.add_leaf(leaf_buf.clone(), timestamp)
            .with_context(|| "MerkleVine append failed")?;
    }
    let elapsed = start.elapsed();
    let ops_per_s = MERKLE_LEAVES as f64 / elapsed.as_secs_f64();

    let root_hex = vine
        .get_root()
        .map(|r| r.encode_hex::<String>())
        .unwrap_or_else(|| "none".to_string());

    println!(
        "Merkle append  : {:>7.0} ops/s ({} leaves @ {} bytes, {:.3}s) | root {}",
        ops_per_s,
        MERKLE_LEAVES,
        MERKLE_LEAF_BYTES,
        elapsed.as_secs_f64(),
        root_hex
    );
    Ok(())
}

fn run_full_e2e(rng: &mut StdRng) -> anyhow::Result<()> {
    let signing_key = random_signing_key(rng);
    let verifying_key = signing_key.verifying_key();
    let mut vine = MerkleVine::new("perf-e2e");

    let start = Instant::now();
    for seq in 0..E2E_ITERS {
        let mut msg = vec![0u8; E2E_MSG_BYTES];
        rng.fill_bytes(&mut msg);
        // Encode a sequence byte to avoid identical messages
        msg[0] = (seq & 0xFF) as u8;

        let sig = signing_key.sign(&msg);
        verifying_key
            .verify(&msg, &sig)
            .with_context(|| "E2E verification failed")?;

        // Combine message + signature to approximate telemetry bundle
        let mut bundle = msg;
        bundle.extend_from_slice(&sig.to_bytes());

        vine.add_leaf(bundle, seq as u64)
            .with_context(|| "E2E Merkle append failed")?;
    }
    let elapsed = start.elapsed();
    let ops_per_s = E2E_ITERS as f64 / elapsed.as_secs_f64();
    let root_hex = vine
        .get_root()
        .map(|r| r.encode_hex::<String>())
        .unwrap_or_else(|| "none".to_string());

    println!(
        "Full E2E (sign+verify+Merkle) : {:>7.0} ops/s ({} events, {:.3}s) | root {}",
        ops_per_s,
        E2E_ITERS,
        elapsed.as_secs_f64(),
        root_hex
    );
    Ok(())
}
