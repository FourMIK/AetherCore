/**
 * AetherCore Identity Protocol
 * 
 * Canonical definition of Node Identity across all hardware architectures.
 * A "Node" is defined by its ability to generate a Genesis Hash and sign a Merkle Stream.
 * 
 * INVARIANT: This definition must produce identical hashes across MCU (Arduino) and SBC (Pi).
 */

import { blake3 } from 'hash-wasm';

/**
 * Platform types supported by AetherCore
 */
export type PlatformType = 'MCU' | 'SBC';

/**
 * Canonical Identity Block
 * 
 * This structure defines the immutable identity of a node in the AetherCore network.
 * The genesis_hash serves as the cryptographic fingerprint that binds hardware to identity.
 */
export interface IdentityBlock {
  /** MAC Address - Hardware identifier */
  hardware_id: string;
  /** Ed25519 Public Key (hex-encoded) */
  public_key: string;
  /** BLAKE3(hardware_id + public_key + salt) - Genesis Hash */
  genesis_hash: string;
  /** Platform classification (metadata only, not part of hash) */
  platform_type: PlatformType;
}

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
 * Generate Genesis Hash using BLAKE3
 * 
 * PROTOCOL: The genesis hash is the cryptographic root of trust for a node.
 * It is computed as: BLAKE3(hardware_id + public_key + salt)
 * 
 * This function MUST produce identical output across all implementations:
 * - TypeScript (Node.js, Browser)
 * - C++ (Arduino, embedded systems)
 * - Rust (future edge devices)
 * 
 * @param input - Genesis hash input components
 * @returns Hex-encoded BLAKE3 hash
 */
export async function generateGenesisHash(input: GenesisHashInput): Promise<string> {
  // Concatenate components in canonical order
  const preimage = input.hardware_id + input.public_key + input.salt;
  
  // Hash with BLAKE3 (outputs 32-byte/256-bit hash)
  const hash = await blake3(preimage);
  
  return hash;
}

/**
 * Create an IdentityBlock from components
 * 
 * @param hardware_id - MAC address or hardware identifier
 * @param public_key - Ed25519 public key (hex string)
 * @param salt - Random salt for genesis hash
 * @param platform_type - MCU or SBC
 * @returns Complete IdentityBlock with genesis_hash computed
 */
export async function createIdentityBlock(
  hardware_id: string,
  public_key: string,
  salt: string,
  platform_type: PlatformType
): Promise<IdentityBlock> {
  const genesis_hash = await generateGenesisHash({
    hardware_id,
    public_key,
    salt,
  });

  return {
    hardware_id,
    public_key,
    genesis_hash,
    platform_type,
  };
}

/**
 * Verify that an IdentityBlock has a valid genesis_hash
 * 
 * @param block - IdentityBlock to verify
 * @param salt - Original salt used to generate the hash
 * @returns true if genesis_hash is valid
 */
export async function verifyIdentityBlock(
  block: IdentityBlock,
  salt: string
): Promise<boolean> {
  const expected_hash = await generateGenesisHash({
    hardware_id: block.hardware_id,
    public_key: block.public_key,
    salt,
  });

  return block.genesis_hash === expected_hash;
}
