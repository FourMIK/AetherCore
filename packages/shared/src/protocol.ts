/**
 * AetherCore Protocol Implementation
 * 
 * Canonical protocol definitions and utilities for cross-platform identity verification.
 * This module ensures protocol coherence between TypeScript, C++, and Rust implementations.
 * 
 * PROTOCOL INVARIANT: genesis_hash = BLAKE3(hardware_id + public_key + salt)
 */

import { blake3 } from 'hash-wasm';

/**
 * Genesis Hash Input
 * 
 * Raw materials for generating the cryptographic identity.
 */
export interface GenesisHashInput {
  hardware_id: string;
  public_key: string;
  salt: string;
}

/**
 * Calculate Genesis Hash using BLAKE3
 * 
 * This is the canonical implementation for generating node identity hashes.
 * All cross-platform implementations (C++, Rust) MUST produce identical output.
 * 
 * PROTOCOL:
 * - Concatenate: hardware_id + public_key + salt
 * - Hash with BLAKE3
 * - Output: 32-byte (64 hex char) hash
 * 
 * @param inputs - Genesis hash input components
 * @returns Hex-encoded BLAKE3 hash (64 characters)
 * 
 * @example
 * ```typescript
 * const hash = await calculateGenesisHash({
 *   hardware_id: 'AA:BB:CC:DD:EE:FF',
 *   public_key: 'aaaa...aaaa', // 64 hex chars
 *   salt: 'test-salt-12345'
 * });
 * // Returns: '5aa61945715d82358e2f53fc4f86f5a34b0d54b2408b7aed07f1266e34f9725e'
 * ```
 */
export async function calculateGenesisHash(inputs: GenesisHashInput): Promise<string> {
  // Concatenate inputs in canonical order
  // CRITICAL: This order MUST match C++ and Rust implementations
  const preimage = inputs.hardware_id + inputs.public_key + inputs.salt;
  
  // Hash with BLAKE3 (outputs 32-byte/256-bit hash as hex string)
  const hash = await blake3(preimage);
  
  return hash;
}

/**
 * Verify that a genesis hash matches expected value
 * 
 * @param computed_hash - Hash computed from inputs
 * @param expected_hash - Expected hash value
 * @returns true if hashes match exactly
 */
export function verifyGenesisHash(computed_hash: string, expected_hash: string): boolean {
  return computed_hash === expected_hash;
}

/**
 * Protocol Constants
 * 
 * These values define the AetherCore identity protocol specification.
 */
export const PROTOCOL_CONSTANTS = {
  /** Hash algorithm used for genesis hash */
  HASH_ALGORITHM: 'BLAKE3',
  
  /** Output length of genesis hash in bytes */
  HASH_OUTPUT_LENGTH_BYTES: 32,
  
  /** Output length of genesis hash as hex string */
  HASH_OUTPUT_LENGTH_HEX: 64,
  
  /** Concatenation order for genesis hash computation */
  CONCATENATION_ORDER: ['hardware_id', 'public_key', 'salt'] as const,
  
  /** Character encoding for text inputs */
  CHARACTER_ENCODING: 'UTF-8',
  
  /** Ed25519 public key length in bytes */
  PUBLIC_KEY_LENGTH_BYTES: 32,
  
  /** Ed25519 public key length as hex string */
  PUBLIC_KEY_LENGTH_HEX: 64,
} as const;

/**
 * Validate protocol inputs
 * 
 * @param inputs - Genesis hash inputs to validate
 * @throws Error if inputs are invalid
 */
export function validateProtocolInputs(inputs: GenesisHashInput): void {
  if (!inputs.hardware_id) {
    throw new Error('hardware_id is required');
  }
  
  if (!inputs.public_key) {
    throw new Error('public_key is required');
  }
  
  if (inputs.public_key.length !== PROTOCOL_CONSTANTS.PUBLIC_KEY_LENGTH_HEX) {
    throw new Error(
      `public_key must be ${PROTOCOL_CONSTANTS.PUBLIC_KEY_LENGTH_HEX} hex characters, got ${inputs.public_key.length}`
    );
  }
  
  // Verify public_key is valid hex
  if (!/^[0-9a-fA-F]+$/.test(inputs.public_key)) {
    throw new Error('public_key must contain only hexadecimal characters');
  }
  
  // salt can be empty string, but must be defined
  if (inputs.salt === undefined || inputs.salt === null) {
    throw new Error('salt must be defined (can be empty string)');
  }
}
