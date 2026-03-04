import test from 'node:test';
import assert from 'node:assert/strict';
import * as crypto from 'node:crypto';
import { spawn, type ChildProcess } from 'node:child_process';
import * as fs from 'node:fs';
import { createServer } from 'node:net';
import * as path from 'node:path';
import {
  parseMessageEnvelope,
  serializeForSigning,
} from '@aethercore/shared';
import { createC2RouterClient } from '../c2-client';

const repoRoot = path.resolve(process.cwd(), '../..');
const gatewayDistEntry = path.resolve(process.cwd(), 'dist/index.js');

type PresenceReason = 'startup' | 'heartbeat';
type PresenceIdentity = {
  device_id: string;
  public_key: string;
  chat_public_key?: string;
  hardware_serial: string;
  certificate_serial: string;
  trust_score: number;
  enrolled_at: number;
  tpm_backed: boolean;
};

type PresenceTelemetry = {
  device?: {
    model?: string;
    firmware?: string;
    transport?: string;
    role?: string;
  };
};

type PresenceUnsignedPayload = {
  type: 'RALPHIE_PRESENCE';
  reason: PresenceReason;
  timestamp: number;
  endpoint: string;
  last_disconnect_reason: string;
  identity: PresenceIdentity;
  telemetry?: PresenceTelemetry;
};

type PresenceSignedPayload = PresenceUnsignedPayload & {
  signature: string;
};

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

function stableJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => stableJsonValue(item));
  }
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
      a.localeCompare(b),
    );
    const normalized: Record<string, unknown> = {};
    for (const [key, entryValue] of entries) {
      normalized[key] = stableJsonValue(entryValue);
    }
    return normalized;
  }
  return value;
}

function stableStringify(value: unknown): string {
  return JSON.stringify(stableJsonValue(value));
}

async function getAvailablePort(): Promise<number> {
  return await new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        server.close();
        reject(new Error('Failed to allocate TCP port for gateway test'));
        return;
      }
      const { port } = address;
      server.close((closeError) => {
        if (closeError) {
          reject(closeError);
          return;
        }
        resolve(port);
      });
    });
  });
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForGatewayReady(baseUrl: string, timeoutMs = 15000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${baseUrl}/health`);
      if (response.ok) {
        return;
      }
    } catch {
      // Retry until timeout.
    }
    await wait(150);
  }
  throw new Error(`Gateway readiness timed out for ${baseUrl}`);
}

async function stopGatewayProcess(child: ChildProcess): Promise<void> {
  if (child.killed || child.exitCode !== null) {
    return;
  }

  const exited = new Promise<void>((resolve) => {
    child.once('exit', () => resolve());
  });
  child.kill('SIGTERM');
  const timeout = wait(5000).then(() => {
    if (child.exitCode === null && !child.killed) {
      child.kill('SIGKILL');
    }
  });
  await Promise.race([exited, timeout]);
}

async function startGatewayProcess(): Promise<{ child: ChildProcess; baseUrl: string }> {
  const port = await getAvailablePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, [gatewayDistEntry], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      PORT: String(port),
      NODE_ENV: 'test',
      LOG_LEVEL: 'error',
      AETHERCORE_PRODUCTION: '0',
      C2_GRPC_INSECURE: '1',
      C2_ADDR: '127.0.0.1:65534',
      AETHER_BUNKER_ENDPOINT: '127.0.0.1:65534',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  const startupLogs: string[] = [];
  child.stdout.on('data', (chunk) => startupLogs.push(String(chunk)));
  child.stderr.on('data', (chunk) => startupLogs.push(String(chunk)));

  try {
    await waitForGatewayReady(baseUrl);
  } catch (error) {
    await stopGatewayProcess(child);
    const details = startupLogs.join('');
    throw new Error(
      `Failed to start gateway process for integration test: ${error instanceof Error ? error.message : String(error)}\n${details}`,
    );
  }

  return { child, baseUrl };
}

function createPresenceIdentity(publicKeyPem: string): PresenceIdentity {
  const now = Date.now();
  return {
    device_id: 'ios-overlay-test-node-01',
    public_key: publicKeyPem,
    hardware_serial: 'ios-overlay-test-node-01',
    certificate_serial: 'cafebabefeedfacecafebabefeedface',
    trust_score: 0.8,
    enrolled_at: now,
    tpm_backed: false,
  };
}

function createPresenceUnsignedPayload(identity: PresenceIdentity): PresenceUnsignedPayload {
  return {
    type: 'RALPHIE_PRESENCE',
    reason: 'startup',
    timestamp: Date.now(),
    endpoint: 'wss://gateway.test/ios-overlay',
    last_disconnect_reason: 'none',
    identity,
    telemetry: {
      device: {
        model: 'iPhone',
        firmware: 'iOS',
        transport: 'wss',
        role: 'ios-overlay',
      },
    },
  };
}

function signPresence(privateKey: crypto.KeyObject, payload: PresenceUnsignedPayload): string {
  const canonicalPayload = stableStringify(payload);
  const signature = crypto.sign(null, Buffer.from(canonicalPayload, 'utf-8'), privateKey);
  return signature.toString('hex');
}

async function postPresence(baseUrl: string, payload: PresenceSignedPayload): Promise<{ status: number; body: any }> {
  const response = await fetch(`${baseUrl}/ralphie/presence`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });
  const body = await response.json();
  return { status: response.status, body };
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

test('gateway applies iOS overlay telemetry/presence stale handling', () => {
  const gatewayIndex = readRepoFile('services/gateway/src/index.ts');

  assert.match(gatewayIndex, /TELEMETRY_TTL_IOS_OVERLAY_MS\s*=\s*300000/);
  assert.match(gatewayIndex, /telemetryTtlMsForIngress/);
  assert.match(gatewayIndex, /PRESENCE_TTL_IOS_OVERLAY_MS\s*=\s*300000/);
  assert.match(gatewayIndex, /pruneStaleRalphiePresence/);
  assert.match(gatewayIndex, /RALPHIE_PRESENCE_EXPIRED/);
});

test('dashboard snapshot handling removes stale presence nodes', () => {
  const commStore = readRepoFile('packages/dashboard/src/store/useCommStore.ts');

  assert.match(commStore, /knownRalphiePresenceNodeIds/);
  assert.match(commStore, /tacticalStore\.removeNode/);
});

test('runtime presence signature verification accepts valid signatures and rejects tampered payloads', async () => {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  const publicKeyPem = publicKey.export({ format: 'pem', type: 'spki' }).toString();
  const identity = createPresenceIdentity(publicKeyPem);

  const { child, baseUrl } = await startGatewayProcess();
  try {
    const unsigned = createPresenceUnsignedPayload(identity);
    const signature = signPresence(privateKey, unsigned);
    const validPayload: PresenceSignedPayload = {
      ...unsigned,
      signature,
    };
    const accepted = await postPresence(baseUrl, validPayload);
    assert.equal(accepted.status, 202);
    assert.equal(accepted.body.status, 'accepted');
    assert.equal(accepted.body.node_id, identity.device_id);

    const tamperedPayload: PresenceSignedPayload = {
      ...validPayload,
      reason: 'heartbeat',
      timestamp: validPayload.timestamp + 1,
    };
    const rejected = await postPresence(baseUrl, tamperedPayload);
    assert.equal(rejected.status, 400);
    assert.equal(rejected.body.status, 'error');
    assert.match(String(rejected.body.message ?? ''), /invalid presence payload/i);
  } finally {
    await stopGatewayProcess(child);
  }
});
