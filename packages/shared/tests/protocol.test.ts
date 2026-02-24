/**
 * Protocol Test Suite
 * 
 * Tests for AetherCore protocol implementation against canonical test vectors.
 * These tests verify that the protocol implementation produces correct and consistent results.
 */

import { describe, it, expect } from '@jest/globals';
import { 
  calculateGenesisHash, 
  verifyGenesisHash,
  validateProtocolInputs,
  PROTOCOL_CONSTANTS,
  type GenesisHashInput 
} from '../src/protocol';
import * as fs from 'fs';
import * as path from 'path';

// Load test vectors from canonical source
const vectorsPath = path.join(__dirname, '../../../tests/vectors.json');
const testVectors = JSON.parse(fs.readFileSync(vectorsPath, 'utf-8'));

describe('AetherCore Protocol', () => {
  describe('calculateGenesisHash', () => {
    it('should match canonical test vector', async () => {
      const primaryVector = testVectors.vectors.find(
        (v: any) => v.name === 'primary_test_vector'
      );
      
      const hash = await calculateGenesisHash(primaryVector.inputs);
      
      expect(hash).toBe(primaryVector.expected.genesis_hash);
      expect(hash.length).toBe(PROTOCOL_CONSTANTS.HASH_OUTPUT_LENGTH_HEX);
    });

    it('should produce deterministic output', async () => {
      const inputs: GenesisHashInput = {
        hardware_id: 'AA:BB:CC:DD:EE:FF',
        public_key: 'a'.repeat(64),
        salt: 'test-salt-12345',
      };

      const hash1 = await calculateGenesisHash(inputs);
      const hash2 = await calculateGenesisHash(inputs);

      expect(hash1).toBe(hash2);
    });

    it('should produce different hashes for different inputs', async () => {
      const inputs1: GenesisHashInput = {
        hardware_id: 'AA:BB:CC:DD:EE:FF',
        public_key: 'a'.repeat(64),
        salt: 'salt1',
      };

      const inputs2: GenesisHashInput = {
        hardware_id: 'AA:BB:CC:DD:EE:FF',
        public_key: 'a'.repeat(64),
        salt: 'salt2',
      };

      const hash1 = await calculateGenesisHash(inputs1);
      const hash2 = await calculateGenesisHash(inputs2);

      expect(hash1).not.toBe(hash2);
    });

    it('should handle empty salt', async () => {
      const inputs: GenesisHashInput = {
        hardware_id: 'AA:BB:CC:DD:EE:FF',
        public_key: 'a'.repeat(64),
        salt: '',
      };

      const hash = await calculateGenesisHash(inputs);
      
      expect(hash.length).toBe(PROTOCOL_CONSTANTS.HASH_OUTPUT_LENGTH_HEX);
      expect(hash).toMatch(/^[0-9a-f]{64}$/);
    });

    it('should satisfy concatenation order invariant', async () => {
      // Verify that order matters
      const inputs1: GenesisHashInput = {
        hardware_id: 'ABC',
        public_key: 'DEF',
        salt: 'GHI',
      };

      // Swap components to verify order matters
      const inputs2: GenesisHashInput = {
        hardware_id: 'DEF',
        public_key: 'ABC',
        salt: 'GHI',
      };

      // Note: inputs2 has invalid public_key length, but that's okay for this test
      // We're just verifying order matters
      const hash1 = await calculateGenesisHash(inputs1);
      const hash2 = await calculateGenesisHash(inputs2);

      expect(hash1).not.toBe(hash2);
    });
  });

  describe('verifyGenesisHash', () => {
    it('should return true for matching hashes', () => {
      const hash = 'a'.repeat(64);
      expect(verifyGenesisHash(hash, hash)).toBe(true);
    });

    it('should return false for non-matching hashes', () => {
      const hash1 = 'a'.repeat(64);
      const hash2 = 'b'.repeat(64);
      expect(verifyGenesisHash(hash1, hash2)).toBe(false);
    });

    it('should be case-sensitive', () => {
      const hash1 = 'a'.repeat(64);
      const hash2 = 'A'.repeat(64);
      expect(verifyGenesisHash(hash1, hash2)).toBe(false);
    });
  });

  describe('validateProtocolInputs', () => {
    it('should accept valid inputs', () => {
      const validInputs: GenesisHashInput = {
        hardware_id: 'AA:BB:CC:DD:EE:FF',
        public_key: 'a'.repeat(64),
        salt: 'test-salt',
      };

      expect(() => validateProtocolInputs(validInputs)).not.toThrow();
    });

    it('should reject missing hardware_id', () => {
      const invalidInputs: any = {
        hardware_id: '',
        public_key: 'a'.repeat(64),
        salt: 'test-salt',
      };

      expect(() => validateProtocolInputs(invalidInputs)).toThrow('hardware_id is required');
    });

    it('should reject missing public_key', () => {
      const invalidInputs: any = {
        hardware_id: 'AA:BB:CC:DD:EE:FF',
        public_key: '',
        salt: 'test-salt',
      };

      expect(() => validateProtocolInputs(invalidInputs)).toThrow('public_key is required');
    });

    it('should reject invalid public_key length', () => {
      const invalidInputs: GenesisHashInput = {
        hardware_id: 'AA:BB:CC:DD:EE:FF',
        public_key: 'a'.repeat(32), // Wrong length
        salt: 'test-salt',
      };

      expect(() => validateProtocolInputs(invalidInputs)).toThrow('must be 64 hex characters');
    });

    it('should reject non-hex public_key', () => {
      const invalidInputs: GenesisHashInput = {
        hardware_id: 'AA:BB:CC:DD:EE:FF',
        public_key: 'g'.repeat(64), // 'g' is not hex
        salt: 'test-salt',
      };

      expect(() => validateProtocolInputs(invalidInputs)).toThrow('must contain only hexadecimal characters');
    });

    it('should accept empty salt', () => {
      const validInputs: GenesisHashInput = {
        hardware_id: 'AA:BB:CC:DD:EE:FF',
        public_key: 'a'.repeat(64),
        salt: '',
      };

      expect(() => validateProtocolInputs(validInputs)).not.toThrow();
    });

    it('should reject undefined salt', () => {
      const invalidInputs: any = {
        hardware_id: 'AA:BB:CC:DD:EE:FF',
        public_key: 'a'.repeat(64),
      };

      expect(() => validateProtocolInputs(invalidInputs)).toThrow('salt must be defined');
    });
  });

  describe('PROTOCOL_CONSTANTS', () => {
    it('should define correct hash algorithm', () => {
      expect(PROTOCOL_CONSTANTS.HASH_ALGORITHM).toBe('BLAKE3');
    });

    it('should define correct hash output length', () => {
      expect(PROTOCOL_CONSTANTS.HASH_OUTPUT_LENGTH_BYTES).toBe(32);
      expect(PROTOCOL_CONSTANTS.HASH_OUTPUT_LENGTH_HEX).toBe(64);
    });

    it('should define correct concatenation order', () => {
      expect(PROTOCOL_CONSTANTS.CONCATENATION_ORDER).toEqual([
        'hardware_id',
        'public_key',
        'salt',
      ]);
    });

    it('should define correct public key length', () => {
      expect(PROTOCOL_CONSTANTS.PUBLIC_KEY_LENGTH_BYTES).toBe(32);
      expect(PROTOCOL_CONSTANTS.PUBLIC_KEY_LENGTH_HEX).toBe(64);
    });
  });

  describe('Cross-Platform Vector Compliance', () => {
    it('should match all test vectors', async () => {
      for (const vector of testVectors.vectors) {
        if (vector.expected.genesis_hash === 'COMPUTE_ON_FIRST_RUN') {
          // Skip vectors that need computation
          continue;
        }

        const hash = await calculateGenesisHash(vector.inputs);
        
        expect(hash).toBe(vector.expected.genesis_hash);
        console.log(`✓ Vector "${vector.name}" passed: ${hash}`);
      }
    });

    it('should verify protocol invariants', () => {
      const invariants = testVectors.protocol_invariants;
      
      expect(invariants.hash_algorithm).toBe(PROTOCOL_CONSTANTS.HASH_ALGORITHM);
      expect(invariants.hash_output_length_bytes).toBe(PROTOCOL_CONSTANTS.HASH_OUTPUT_LENGTH_BYTES);
      expect(invariants.hash_output_length_hex).toBe(PROTOCOL_CONSTANTS.HASH_OUTPUT_LENGTH_HEX);
      expect(invariants.concatenation_order).toEqual(PROTOCOL_CONSTANTS.CONCATENATION_ORDER);
    });
  });
});
