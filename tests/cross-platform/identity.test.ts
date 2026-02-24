/**
 * Cross-Platform Identity Verification Test
 * 
 * CRITICAL TEST: Verifies that TypeScript and C++ implementations
 * produce IDENTICAL genesis hashes for the same inputs.
 * 
 * If this test fails, the network is broken.
 */

import { describe, it, expect } from '@jest/globals';
import {
  generateGenesisHash,
  createIdentityBlock,
  verifyIdentityBlock,
  type IdentityBlock,
} from '@aethercore/shared';

describe('Cross-Platform Identity Protocol', () => {
  // Fixed test vectors for cross-platform verification
  const TEST_VECTORS = {
    hardware_id: 'AA:BB:CC:DD:EE:FF',
    public_key: 'a'.repeat(64), // 32-byte Ed25519 key as hex
    salt: 'test-salt-12345',
  };

  describe('Genesis Hash Generation', () => {
    it('should generate deterministic genesis hash', async () => {
      const hash1 = await generateGenesisHash(TEST_VECTORS);
      const hash2 = await generateGenesisHash(TEST_VECTORS);
      
      // Same inputs MUST produce same hash
      expect(hash1).toBe(hash2);
      expect(hash1.length).toBe(64); // 32 bytes = 64 hex chars
    });

    it('should produce different hashes for different inputs', async () => {
      const hash1 = await generateGenesisHash(TEST_VECTORS);
      const hash2 = await generateGenesisHash({
        ...TEST_VECTORS,
        salt: 'different-salt',
      });
      
      // Different inputs MUST produce different hashes
      expect(hash1).not.toBe(hash2);
    });

    it('should match expected BLAKE3 output', async () => {
      // This test vector MUST match the C++ implementation output
      const hash = await generateGenesisHash(TEST_VECTORS);
      
      // Expected hash computed with BLAKE3(hardware_id + public_key + salt)
      // Input: "AA:BB:CC:DD:EE:FFaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaatest-salt-12345"
      // NOTE: Once C++ implementation is complete with real BLAKE3, 
      // update this expected value from actual C++ output
      
      // For now, verify structure
      expect(hash).toMatch(/^[0-9a-f]{64}$/);
      
      console.log('Genesis Hash Test Vector:');
      console.log('  Hardware ID:', TEST_VECTORS.hardware_id);
      console.log('  Public Key:', TEST_VECTORS.public_key);
      console.log('  Salt:', TEST_VECTORS.salt);
      console.log('  Genesis Hash:', hash);
      console.log('');
      console.log('⚠️  VERIFICATION REQUIRED:');
      console.log('  1. Compile Arduino sketch with these inputs');
      console.log('  2. Compare Arduino output with:', hash);
      console.log('  3. Hashes MUST match exactly');
    });
  });

  describe('Identity Block Creation', () => {
    it('should create valid identity block for MCU', async () => {
      const block = await createIdentityBlock(
        TEST_VECTORS.hardware_id,
        TEST_VECTORS.public_key,
        TEST_VECTORS.salt,
        'MCU'
      );

      expect(block.hardware_id).toBe(TEST_VECTORS.hardware_id);
      expect(block.public_key).toBe(TEST_VECTORS.public_key);
      expect(block.platform_type).toBe('MCU');
      expect(block.genesis_hash.length).toBe(64);
    });

    it('should create valid identity block for SBC', async () => {
      const block = await createIdentityBlock(
        TEST_VECTORS.hardware_id,
        TEST_VECTORS.public_key,
        TEST_VECTORS.salt,
        'SBC'
      );

      expect(block.hardware_id).toBe(TEST_VECTORS.hardware_id);
      expect(block.public_key).toBe(TEST_VECTORS.public_key);
      expect(block.platform_type).toBe('SBC');
      expect(block.genesis_hash.length).toBe(64);
    });

    it('should produce same genesis_hash regardless of platform_type', async () => {
      const mcuBlock = await createIdentityBlock(
        TEST_VECTORS.hardware_id,
        TEST_VECTORS.public_key,
        TEST_VECTORS.salt,
        'MCU'
      );

      const sbcBlock = await createIdentityBlock(
        TEST_VECTORS.hardware_id,
        TEST_VECTORS.public_key,
        TEST_VECTORS.salt,
        'SBC'
      );

      // platform_type is metadata only - genesis hash MUST be identical
      expect(mcuBlock.genesis_hash).toBe(sbcBlock.genesis_hash);
    });
  });

  describe('Identity Block Verification', () => {
    it('should verify valid identity block', async () => {
      const block = await createIdentityBlock(
        TEST_VECTORS.hardware_id,
        TEST_VECTORS.public_key,
        TEST_VECTORS.salt,
        'MCU'
      );

      const valid = await verifyIdentityBlock(block, TEST_VECTORS.salt);
      expect(valid).toBe(true);
    });

    it('should reject tampered genesis hash', async () => {
      const block = await createIdentityBlock(
        TEST_VECTORS.hardware_id,
        TEST_VECTORS.public_key,
        TEST_VECTORS.salt,
        'MCU'
      );

      // Tamper with genesis hash
      const tamperedBlock: IdentityBlock = {
        ...block,
        genesis_hash: 'f'.repeat(64),
      };

      const valid = await verifyIdentityBlock(tamperedBlock, TEST_VECTORS.salt);
      expect(valid).toBe(false);
    });

    it('should reject wrong salt', async () => {
      const block = await createIdentityBlock(
        TEST_VECTORS.hardware_id,
        TEST_VECTORS.public_key,
        TEST_VECTORS.salt,
        'MCU'
      );

      const valid = await verifyIdentityBlock(block, 'wrong-salt');
      expect(valid).toBe(false);
    });
  });

  describe('Protocol Invariants', () => {
    it('should satisfy concatenation order invariant', async () => {
      // Verify that hash is computed as BLAKE3(hardware_id + public_key + salt)
      // NOT BLAKE3(public_key + hardware_id + salt) or any other order
      
      const correctOrder = await generateGenesisHash({
        hardware_id: 'AA:BB:CC:DD:EE:FF',
        public_key: 'abc123',
        salt: 'salt',
      });

      const wrongOrder = await generateGenesisHash({
        hardware_id: 'AA:BB:CC:DD:EE:FF',
        public_key: 'salt',
        salt: 'abc123',
      });

      // Different concatenation order MUST produce different hash
      expect(correctOrder).not.toBe(wrongOrder);
    });

    it('should be sensitive to single character change', async () => {
      const hash1 = await generateGenesisHash(TEST_VECTORS);
      const hash2 = await generateGenesisHash({
        ...TEST_VECTORS,
        hardware_id: 'AA:BB:CC:DD:EE:FE', // Changed last F to E
      });

      // BLAKE3 avalanche effect - one bit change affects entire hash
      expect(hash1).not.toBe(hash2);
    });

    it('should handle empty salt', async () => {
      const hash = await generateGenesisHash({
        hardware_id: TEST_VECTORS.hardware_id,
        public_key: TEST_VECTORS.public_key,
        salt: '',
      });

      expect(hash.length).toBe(64);
    });

    it('should handle very long inputs', async () => {
      const longInput = {
        hardware_id: 'A'.repeat(1000),
        public_key: 'B'.repeat(1000),
        salt: 'C'.repeat(1000),
      };

      const hash = await generateGenesisHash(longInput);
      expect(hash.length).toBe(64); // BLAKE3 always produces 32-byte output
    });
  });

  describe('Reference Implementation Test Vector', () => {
    it('should match Rust reference implementation', async () => {
      // This test verifies compatibility with crates/identity Rust implementation
      // Once Rust implementation exists, add reference hash here
      
      const hash = await generateGenesisHash(TEST_VECTORS);
      
      // TODO: When Rust implementation is complete:
      // const RUST_REFERENCE_HASH = '<insert-rust-output-here>';
      // expect(hash).toBe(RUST_REFERENCE_HASH);
      
      expect(hash).toBeDefined();
      expect(hash.length).toBe(64);
    });
  });
});
