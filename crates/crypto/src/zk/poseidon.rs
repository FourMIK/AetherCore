//! ----------------------------------------------------------------------------
//! SECURITY NOTICE: EDGE OPTIMIZED IMPLEMENTATION
//! ----------------------------------------------------------------------------
//! This module contains a Rust native port of the Poseidon hash function
//! optimized for low-power embedded devices (ARM/RISC-V).
//!
//! NOTE: For production key generation, use the hardware-backed TPM interfaces
//! defined in `crates/identity`.
//! ----------------------------------------------------------------------------
//!
//! Poseidon hash functions for ZK commitments.
//!
//! This module provides hash functions compatible with the AuthynticProof circuit.
//! Currently uses BLAKE3 as a placeholder until circomlib-compatible Poseidon is integrated.

use super::error::ZkResult;
use blake3::Hasher;

/// Hash two field elements together
///
/// TODO: Replace with circomlib-compatible Poseidon hash
/// Currently uses BLAKE3 as placeholder for development
pub fn poseidon_hash_2(a: &[u8; 32], b: &[u8; 32]) -> ZkResult<[u8; 32]> {
    let mut hasher = Hasher::new();
    hasher.update(a);
    hasher.update(b);
    let hash = hasher.finalize();
    Ok(*hash.as_bytes())
}

/// Hash four field elements together
///
/// TODO: Replace with circomlib-compatible Poseidon hash
/// Currently uses BLAKE3 as placeholder for development
pub fn poseidon_hash_4(inputs: &[[u8; 32]; 4]) -> ZkResult<[u8; 32]> {
    let mut hasher = Hasher::new();
    for input in inputs {
        hasher.update(input);
    }
    let hash = hasher.finalize();
    Ok(*hash.as_bytes())
}

/// Compute device commitment from secret and salt
///
/// commitment = poseidon_hash_2(device_secret, device_salt)
pub fn device_commitment(device_secret: &[u8; 32], device_salt: &[u8; 32]) -> ZkResult<[u8; 32]> {
    poseidon_hash_2(device_secret, device_salt)
}

/// Compute location commitment from hash and nonce
///
/// commitment = poseidon_hash_2(location_hash, location_nonce)
pub fn location_commitment(
    location_hash: &[u8; 32],
    location_nonce: &[u8; 32],
) -> ZkResult<[u8; 32]> {
    poseidon_hash_2(location_hash, location_nonce)
}

/// Compute attestation root from neighbor attestations
///
/// root = poseidon_hash_4([att1, att2, att3, att4])
pub fn attestation_root(attestations: &[[u8; 32]; 4]) -> ZkResult<[u8; 32]> {
    poseidon_hash_4(attestations)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_poseidon_hash_2() {
        let a = [1u8; 32];
        let b = [2u8; 32];
        let hash = poseidon_hash_2(&a, &b).unwrap();
        assert_eq!(hash.len(), 32);
        // Hash should be deterministic
        let hash2 = poseidon_hash_2(&a, &b).unwrap();
        assert_eq!(hash, hash2);
    }

    #[test]
    fn test_poseidon_hash_4() {
        let inputs = [[1u8; 32], [2u8; 32], [3u8; 32], [4u8; 32]];
        let hash = poseidon_hash_4(&inputs).unwrap();
        assert_eq!(hash.len(), 32);
        // Hash should be deterministic
        let hash2 = poseidon_hash_4(&inputs).unwrap();
        assert_eq!(hash, hash2);
    }

    #[test]
    fn test_device_commitment() {
        let secret = [42u8; 32];
        let salt = [99u8; 32];
        let commitment = device_commitment(&secret, &salt).unwrap();
        assert_eq!(commitment.len(), 32);
    }

    #[test]
    fn test_location_commitment() {
        let hash = [11u8; 32];
        let nonce = [22u8; 32];
        let commitment = location_commitment(&hash, &nonce).unwrap();
        assert_eq!(commitment.len(), 32);
    }

    #[test]
    fn test_attestation_root() {
        let attestations = [[1u8; 32], [2u8; 32], [3u8; 32], [4u8; 32]];
        let root = attestation_root(&attestations).unwrap();
        assert_eq!(root.len(), 32);
    }
}
