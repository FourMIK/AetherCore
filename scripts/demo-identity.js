#!/usr/bin/env node

/**
 * Quick demo of the cross-platform identity system
 */

const { createIdentityBlock, generateGenesisHash } = require('../packages/shared/dist/identity');

async function demo() {
  console.log('=== AetherCore Cross-Platform Identity Demo ===\n');
  
  // Test vector
  const testVector = {
    hardware_id: 'AA:BB:CC:DD:EE:FF',
    public_key: 'a'.repeat(64),
    salt: 'test-salt-12345',
  };
  
  console.log('Test Vector:');
  console.log('  Hardware ID:', testVector.hardware_id);
  console.log('  Public Key:', testVector.public_key);
  console.log('  Salt:', testVector.salt);
  console.log();
  
  // Generate genesis hash
  const hash = await generateGenesisHash(testVector);
  console.log('Generated Genesis Hash:');
  console.log(' ', hash);
  console.log();
  
  // Create MCU identity
  const mcuIdentity = await createIdentityBlock(
    testVector.hardware_id,
    testVector.public_key,
    testVector.salt,
    'MCU'
  );
  
  console.log('MCU Identity Block:');
  console.log(JSON.stringify(mcuIdentity, null, 2));
  console.log();
  
  // Create SBC identity
  const sbcIdentity = await createIdentityBlock(
    testVector.hardware_id,
    testVector.public_key,
    testVector.salt,
    'SBC'
  );
  
  console.log('SBC Identity Block:');
  console.log(JSON.stringify(sbcIdentity, null, 2));
  console.log();
  
  // Verify they match
  const match = mcuIdentity.genesis_hash === sbcIdentity.genesis_hash;
  console.log('Cross-Platform Verification:');
  console.log('  MCU and SBC hashes match:', match ? '✓ YES' : '✗ NO');
  console.log();
  
  if (!match) {
    console.error('CRITICAL: Cross-platform protocol is broken!');
    process.exit(1);
  }
  
  console.log('✓ Cross-platform identity system working correctly!');
}

demo().catch(console.error);
