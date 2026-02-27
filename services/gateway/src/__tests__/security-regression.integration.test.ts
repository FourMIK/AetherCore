import test from 'node:test';
import assert from 'node:assert/strict';
import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  parseMessageEnvelope,
  serializeForSigning,
} from '@aethercore/shared';
import { createC2RouterClient } from '../c2-client';

const repoRoot = path.resolve(process.cwd(), '../..');

function withTemporaryEnv(
  overrides: Record<string, string | undefined>,
  fn: () => void,
): void {
  const original: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(overrides)) {
    original[key] = process.env[key];
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }

  try {
    fn();
  } finally {
    for (const [key, value] of Object.entries(original)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
}

function readRepoFile(relativePath: string): string {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf-8');
}

test('production mode rejects insecure C2 gRPC transport', () => {
  withTemporaryEnv(
    {
      NODE_ENV: 'production',
      AETHERCORE_PRODUCTION: '1',
      C2_GRPC_INSECURE: '1',
    },
    () => {
      assert.throws(
        () => createC2RouterClient('localhost:50051'),
        /Refusing insecure C2 gRPC transport/,
      );
    },
  );
});

test('development mode permits insecure C2 gRPC transport only when requested', () => {
  withTemporaryEnv(
    {
      NODE_ENV: 'development',
      AETHERCORE_PRODUCTION: '0',
      C2_GRPC_INSECURE: '1',
    },
    () => {
      const client = createC2RouterClient('localhost:50051');
      assert.equal(typeof client.ExecuteUnitCommand, 'function');
      client.close();
    },
  );
});

test('replay regression check: sequence without nonce is rejected', () => {
  assert.throws(
    () =>
      parseMessageEnvelope({
        schema_version: '1.0',
        message_id: '550e8400-e29b-41d4-a716-446655440000',
        timestamp: Date.now(),
        type: 'chat',
        from: 'sender-replay',
        payload: { content: 'replay-attempt', recipientId: 'target-node' },
        sequence: 1,
      }),
    /sequence requires nonce/,
  );
});

test('spoof regression check: verified status without signature is rejected', () => {
  assert.throws(
    () =>
      parseMessageEnvelope({
        schema_version: '1.0',
        message_id: '550e8400-e29b-41d4-a716-446655440000',
        timestamp: Date.now(),
        type: 'chat',
        from: 'sender-spoof',
        payload: { content: 'spoof-attempt', recipientId: 'target-node' },
        nonce: '00112233445566778899aabbccddeeff',
        sequence: 1,
        verification_status: 'VERIFIED',
      }),
    /requires signature/,
  );
});

test('tamper regression check: payload mutation invalidates Ed25519 signature', () => {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519');

  const signedEnvelopeCore = {
    schema_version: '1.0',
    message_id: '550e8400-e29b-41d4-a716-446655440000',
    timestamp: Date.now(),
    type: 'chat' as const,
    from: 'sender-tamper',
    payload: { content: 'authenticated-message', recipientId: 'target-node' },
    nonce: '00112233445566778899aabbccddeeff',
    sequence: 7,
    previous_message_id: '550e8400-e29b-41d4-a716-446655440111',
  };

  const canonicalOriginal = serializeForSigning(signedEnvelopeCore);
  const signature = crypto.sign(null, Buffer.from(canonicalOriginal, 'utf-8'), privateKey);

  const originalValid = crypto.verify(
    null,
    Buffer.from(canonicalOriginal, 'utf-8'),
    publicKey,
    signature,
  );
  assert.equal(originalValid, true);

  const tamperedCore = {
    ...signedEnvelopeCore,
    payload: { content: 'tampered-message', recipientId: 'target-node' },
  };
  const canonicalTampered = serializeForSigning(tamperedCore);
  const tamperedValid = crypto.verify(
    null,
    Buffer.from(canonicalTampered, 'utf-8'),
    publicKey,
    signature,
  );
  assert.equal(tamperedValid, false);
});

test('active trust path has no placeholder signature implementation', () => {
  const activeTrustPathFiles = [
    'agent/linux/src/c2/mesh-client.ts',
    'packages/dashboard/src/services/c2/C2Client.ts',
    'services/gateway/src/index.ts',
    'services/gateway/src/c2-client.ts',
  ];

  for (const filePath of activeTrustPathFiles) {
    const source = readRepoFile(filePath);
    assert.equal(
      source.includes('placeholder:sha256'),
      false,
      `placeholder signing found in ${filePath}`,
    );
  }
});

test('active chat path enforces encrypted payload construction', () => {
  const dashboardClient = readRepoFile('packages/dashboard/src/services/c2/C2Client.ts');
  const meshClient = readRepoFile('agent/linux/src/c2/mesh-client.ts');

  assert.match(
    dashboardClient,
    /if \(type === 'chat'[\s\S]*outgoingPayload = await this\.encryptChatPayload/,
  );
  assert.match(dashboardClient, /encrypted:\s*true/);
  assert.match(dashboardClient, /cipher:\s*'AES-256-GCM'/);

  assert.match(meshClient, /const encryptedPayload = this\.encryptChatPayload\(recipientId, content\);/);
  assert.match(meshClient, /encrypted:\s*true/);
  assert.match(meshClient, /cipher:\s*'AES-256-GCM'/);
});

test('replay and ordering fields remain enforced in shared schema and gateway', () => {
  const sharedSchema = readRepoFile('packages/shared/src/c2-message-schema.ts');
  const gatewayIndex = readRepoFile('services/gateway/src/index.ts');

  assert.match(sharedSchema, /nonce:\s*z\.string\(\)\.regex/);
  assert.match(sharedSchema, /sequence:\s*z\.number\(\)\.int\(\)\.positive\(\)\.optional\(\)/);
  assert.match(sharedSchema, /previous_message_id:\s*z\.string\(\)\.uuid\(\)\.optional\(\)/);
  assert.match(sharedSchema, /sequence requires nonce/);

  assert.match(gatewayIndex, /function verifyAndTrackReplay/);
  assert.match(gatewayIndex, /REPLAY_DETECTED/);
});
