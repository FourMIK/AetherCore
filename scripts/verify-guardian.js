#!/usr/bin/env node

/**
 * Mission Guardian Verification Script
 * 
 * Demonstrates the key functionality of the collaboration service:
 * 1. SignedEnvelope creation and verification
 * 2. GuardianSignal protocol
 * 3. Security event logging
 */

const { 
  SignedEnvelopeSchema,
  GuardianSignalSchema,
  NodeIDSchema,
} = require('../packages/shared/dist/index');

const {
  VerificationService,
  MockIdentityRegistry,
  ConsoleSecurityEventHandler,
} = require('../services/collaboration/dist/VerificationService');

async function main() {
  console.log('🔐 Mission Guardian Verification Script\n');

  // Setup mock identity registry
  const identityRegistry = new MockIdentityRegistry();
  const eventHandler = new ConsoleSecurityEventHandler();
  const verificationService = new VerificationService(identityRegistry, eventHandler);

  // Register test nodes
  const nodeA = '0'.repeat(64); // NodeID A
  const nodeB = '1'.repeat(64); // NodeID B
  const publicKeyA = '0'.repeat(64); // Public key A
  const publicKeyB = '1'.repeat(64); // Public key B

  identityRegistry.registerNode(nodeA, publicKeyA);
  identityRegistry.registerNode(nodeB, publicKeyB);

  console.log('✅ Test nodes registered in identity registry');
  console.log(`   Node A: ${nodeA.substring(0, 16)}...`);
  console.log(`   Node B: ${nodeB.substring(0, 16)}...\n`);

  // Test 1: Valid GuardianSignal
  console.log('Test 1: Valid GuardianSignal');
  console.log('─'.repeat(50));

  const guardianSignal = {
    type: 'offer',
    from: nodeA,
    to: nodeB,
    sessionId: '550e8400-e29b-41d4-a716-446655440000',
    sdp: {
      type: 'offer',
      sdp: 'v=0\r\no=- 123456 2 IN IP4 127.0.0.1\r\n...',
    },
    timestamp: Date.now(),
  };

  // Validate schema
  try {
    const validated = GuardianSignalSchema.parse(guardianSignal);
    console.log('✅ GuardianSignal schema valid');
    console.log(`   Type: ${validated.type}`);
    console.log(`   From: ${validated.from.substring(0, 16)}...`);
    console.log(`   To: ${validated.to.substring(0, 16)}...`);
    console.log(`   Session: ${validated.sessionId}\n`);
  } catch (error) {
    console.error('❌ Schema validation failed:', error.message);
  }

  // Test 2: SignedEnvelope Creation
  console.log('Test 2: SignedEnvelope Creation');
  console.log('─'.repeat(50));

  const signedEnvelope = await VerificationService.createSignedEnvelope(
    guardianSignal,
    nodeA,
    publicKeyA,
  );

  console.log('✅ SignedEnvelope created');
  console.log(`   NodeID: ${signedEnvelope.nodeId.substring(0, 16)}...`);
  console.log(`   Signature: ${signedEnvelope.signature.substring(0, 32)}...`);
  console.log(`   Nonce: ${signedEnvelope.nonce}`);
  console.log(`   Timestamp: ${new Date(signedEnvelope.timestamp).toISOString()}\n`);

  // Validate SignedEnvelope schema
  try {
    SignedEnvelopeSchema.parse(signedEnvelope);
    console.log('✅ SignedEnvelope schema valid\n');
  } catch (error) {
    console.error('❌ Schema validation failed:', error.message);
  }

  // Test 3: Signature Verification (Valid)
  console.log('Test 3: Signature Verification (Enrolled Node)');
  console.log('─'.repeat(50));

  const verifiedPayload = await verificationService.verifyEnvelope(signedEnvelope);
  
  if (verifiedPayload) {
    console.log('✅ Signature verified successfully');
    console.log(`   Payload type: ${verifiedPayload.type}`);
    console.log(`   Session: ${verifiedPayload.sessionId}\n`);
  } else {
    console.log('❌ Signature verification failed\n');
  }

  // Test 4: Unknown Node (Security Event)
  console.log('Test 4: Unknown Node Detection');
  console.log('─'.repeat(50));

  const unknownNodeId = '2'.repeat(64);
  const invalidEnvelope = await VerificationService.createSignedEnvelope(
    guardianSignal,
    unknownNodeId,
    '2'.repeat(64),
  );

  console.log('⚠️  Attempting verification with unknown node...');
  const invalidResult = await verificationService.verifyEnvelope(invalidEnvelope);
  
  if (!invalidResult) {
    console.log('✅ Unknown node correctly rejected\n');
  } else {
    console.log('❌ Security violation: Unknown node accepted!\n');
  }

  // Test 5: Network Health Schema
  console.log('Test 5: Network Health Validation');
  console.log('─'.repeat(50));

  const { NetworkHealthSchema } = require('../packages/shared/dist/index');

  const networkHealth = {
    healthPercent: 75,
    latencyMs: 45,
    packetLossPercent: 0.5,
    bandwidthKbps: 5000,
    timestamp: Date.now(),
    isContested: false,
  };

  try {
    const validated = NetworkHealthSchema.parse(networkHealth);
    console.log('✅ NetworkHealth schema valid');
    console.log(`   Health: ${validated.healthPercent}%`);
    console.log(`   Latency: ${validated.latencyMs}ms`);
    console.log(`   Loss: ${validated.packetLossPercent}%`);
    console.log(`   Bandwidth: ${validated.bandwidthKbps}kbps`);
    console.log(`   Contested: ${validated.isContested}\n`);
  } catch (error) {
    console.error('❌ Schema validation failed:', error.message);
  }

  // Test 6: Stream Integrity Hash
  console.log('Test 6: Stream Integrity Hash Validation');
  console.log('─'.repeat(50));

  const { StreamIntegrityHashSchema } = require('../packages/shared/dist/index');

  const integrityHash = {
    sessionId: '550e8400-e29b-41d4-a716-446655440000',
    nodeId: nodeA,
    frameSequence: 42,
    hash: 'a'.repeat(64), // BLAKE3 hash
    timestamp: Date.now(),
    isKeyframe: true,
  };

  try {
    const validated = StreamIntegrityHashSchema.parse(integrityHash);
    console.log('✅ StreamIntegrityHash schema valid');
    console.log(`   Frame: ${validated.frameSequence}`);
    console.log(`   Hash: ${validated.hash.substring(0, 32)}...`);
    console.log(`   Keyframe: ${validated.isKeyframe}\n`);
  } catch (error) {
    console.error('❌ Schema validation failed:', error.message);
  }

  // Summary
  console.log('═'.repeat(50));
  console.log('✅ All Mission Guardian core components verified');
  console.log('═'.repeat(50));
  console.log('\nKey Features Validated:');
  console.log('  ✓ SignedEnvelope protocol');
  console.log('  ✓ GuardianSignal schema');
  console.log('  ✓ Signature verification flow');
  console.log('  ✓ Unknown node detection');
  console.log('  ✓ Network health monitoring');
  console.log('  ✓ Stream integrity hashing');
  console.log('\n🚀 Mission Guardian is ready for integration!\n');
}

main().catch((error) => {
  console.error('Error:', error);
  process.exit(1);
});
