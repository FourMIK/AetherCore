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
//! This module provides circomlib-compatible Poseidon hash functions for the
//! AuthynticProof circuit.

use super::error::ZkError;
use super::error::ZkResult;
use ark_bn254::Fr;
use ark_ff::{BigInteger, PrimeField};
use light_poseidon::{Poseidon, PoseidonHasher};

fn poseidon_hash(inputs: &[&[u8; 32]]) -> ZkResult<[u8; 32]> {
    let mut hasher = Poseidon::<Fr>::new_circom(inputs.len())
        .map_err(|err| ZkError::HashError(err.to_string()))?;
    let field_inputs: Vec<Fr> = inputs
        .iter()
        .map(|input| Fr::from_be_bytes_mod_order((*input).as_ref()))
        .collect();
    let hash = hasher
        .hash(&field_inputs)
        .map_err(|err| ZkError::HashError(err.to_string()))?;
    let hash_bytes = hash.into_bigint().to_bytes_be();
    if hash_bytes.len() > 32 {
        return Err(ZkError::HashError(
            "Poseidon output exceeds 32 bytes".to_string(),
        ));
    }
    let mut output = [0u8; 32];
    let offset = 32 - hash_bytes.len();
    output[offset..].copy_from_slice(&hash_bytes);
    Ok(output)
}

/// Hash two field elements together
pub fn poseidon_hash_2(a: &[u8; 32], b: &[u8; 32]) -> ZkResult<[u8; 32]> {
    poseidon_hash(&[a, b])
}

/// Hash four field elements together
pub fn poseidon_hash_4(inputs: &[[u8; 32]; 4]) -> ZkResult<[u8; 32]> {
    poseidon_hash(&[&inputs[0], &inputs[1], &inputs[2], &inputs[3]])
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
        let hash_repeat = poseidon_hash_2(&a, &b).unwrap();
        assert_eq!(hash, hash_repeat);
        assert_eq!(
            hash,
            [
                13, 84, 225, 147, 143, 138, 140, 28, 125, 235, 94, 3, 85, 242, 99, 25, 32, 123,
                132, 254, 156, 162, 206, 27, 38, 231, 53, 200, 41, 130, 25, 144
            ]
        );
    }

    #[test]
    fn test_poseidon_hash_4() {
        let inputs = [[1u8; 32], [2u8; 32], [3u8; 32], [4u8; 32]];
        let hash = poseidon_hash_4(&inputs).unwrap();
        let hash_repeat = poseidon_hash_4(&inputs).unwrap();
        assert_eq!(hash, hash_repeat);
        assert_eq!(
            hash,
            [
                4, 147, 140, 241, 54, 243, 173, 46, 71, 30, 224, 209, 216, 42, 247, 225, 213, 38,
                223, 85, 82, 208, 81, 152, 148, 194, 1, 203, 167, 182, 109, 245
            ]
        );
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
        assert_eq!(
            root,
            [
                4, 147, 140, 241, 54, 243, 173, 46, 71, 30, 224, 209, 216, 42, 247, 225, 213, 38,
                223, 85, 82, 208, 81, 152, 148, 194, 1, 203, 167, 182, 109, 245
            ]
        );
    }
}
