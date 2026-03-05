import test from 'node:test';
import assert from 'node:assert/strict';
import * as crypto from 'node:crypto';
import { spawn, type ChildProcess } from 'node:child_process';
import * as fs from 'node:fs';
import { createServer as createTcpServer } from 'node:net';
import { createServer as createHttpServer, type IncomingMessage, type ServerResponse } from 'node:http';
import * as path from 'node:path';
import {
  createMessageEnvelope,
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
    const server = createTcpServer();
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

async function startGatewayProcess(
  envOverrides: Record<string, string> = {},
): Promise<{ child: ChildProcess; baseUrl: string }> {
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
      ...envOverrides,
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

type IdentityRegistryMockConfig = {
  enrolledNodeIds?: string[];
  adminPublicKeyPem?: string;
  failEnrollmentRpc?: boolean;
  forceRevocationFailure?: boolean;
};

type IdentityRegistryMock = {
  baseUrl: string;
  revocationCalls: Array<{ nodeId: string; reason: string; timestampMs: number }>;
  stop: () => Promise<void>;
};

function sendMockJson(res: ServerResponse, statusCode: number, payload: unknown): void {
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(payload));
}

async function readJsonBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  if (chunks.length === 0) {
    return {};
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>;
}

async function startIdentityRegistryMock(
  config: IdentityRegistryMockConfig = {},
): Promise<IdentityRegistryMock> {
  const port = await getAvailablePort();
  const enrolledNodeIds = new Set(config.enrolledNodeIds ?? []);
  const revocationCalls: Array<{ nodeId: string; reason: string; timestampMs: number }> = [];

  const server = createHttpServer(async (req, res) => {
    if (req.method !== 'POST' || !req.url) {
      sendMockJson(res, 404, { success: false, error_message: 'not found' });
      return;
    }

    if (req.url === '/aethercore.identity.IdentityRegistry/IsNodeEnrolled') {
      if (config.failEnrollmentRpc) {
        sendMockJson(res, 503, { success: false, error_message: 'identity backend unavailable' });
        return;
      }
      const body = await readJsonBody(req);
      const nodeId = typeof body.node_id === 'string' ? body.node_id : '';
      sendMockJson(res, 200, {
        success: true,
        is_enrolled: enrolledNodeIds.has(nodeId),
        timestamp_ms: Date.now(),
      });
      return;
    }

    if (req.url === '/aethercore.identity.IdentityRegistry/RevokeNode') {
      const body = await readJsonBody(req);
      const nodeId = typeof body.node_id === 'string' ? body.node_id : '';
      const reason = typeof body.reason === 'string' ? body.reason : '';
      const timestampMs =
        typeof body.timestamp_ms === 'number' && Number.isFinite(body.timestamp_ms)
          ? Math.trunc(body.timestamp_ms)
          : Date.now();
      const authoritySignatureHex =
        typeof body.authority_signature_hex === 'string' ? body.authority_signature_hex : '';

      if (config.forceRevocationFailure) {
        sendMockJson(res, 200, {
          success: false,
          error_message: 'revocation rejected by identity backend',
          timestamp_ms: Date.now(),
        });
        return;
      }

      if (!config.adminPublicKeyPem) {
        sendMockJson(res, 200, {
          success: false,
          error_message: 'admin public key unavailable in mock',
          timestamp_ms: Date.now(),
        });
        return;
      }

      const payload = `${nodeId}${reason}${timestampMs}`;
      let verified = false;
      try {
        const signatureBuffer = Buffer.from(authoritySignatureHex, 'hex');
        verified = crypto.verify(
          null,
          Buffer.from(payload, 'utf-8'),
          config.adminPublicKeyPem,
          signatureBuffer,
        );
      } catch {
        verified = false;
      }

      if (!verified) {
        sendMockJson(res, 200, {
          success: false,
          error_message: 'Invalid authority signature: Revocation must be signed by an admin node',
          timestamp_ms: Date.now(),
        });
        return;
      }

      revocationCalls.push({ nodeId, reason, timestampMs });
      sendMockJson(res, 200, {
        success: true,
        error_message: '',
        timestamp_ms: Date.now(),
      });
      return;
    }

    sendMockJson(res, 404, { success: false, error_message: 'not found' });
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => resolve());
  });

  return {
    baseUrl: `http://127.0.0.1:${port}`,
    revocationCalls,
    stop: async () => {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      });
    },
  };
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

test('shared schema default chat envelope includes direct transport and sms fallback metadata', () => {
  const envelope = createMessageEnvelope('chat', 'sender-chat-default', {
    content: 'Mesh fallback message',
    recipientId: 'recipient-chat-default',
  });

  const chatPayload = envelope.payload as {
    sms_fallback?: {
      segment_count?: number;
      segment_index?: number;
      encoding?: string;
      max_chars_per_segment?: number;
    };
  };

  assert.equal(envelope.transport?.mode, 'direct');
  assert.equal(envelope.transport?.qos, 'at_least_once');
  assert.equal(chatPayload.sms_fallback?.segment_count, 1);
  assert.equal(chatPayload.sms_fallback?.segment_index, 0);
});

test('shared schema rejects non-chat store-forward sms transport envelopes', () => {
  assert.throws(
    () =>
      parseMessageEnvelope({
        schema_version: '1.0',
        message_id: '550e8400-e29b-41d4-a716-446655440010',
        timestamp: Date.now(),
        type: 'call_invite',
        from: 'sender-gossip',
        payload: { callId: 'call-001', recipientId: 'operator-002' },
        transport: {
          mode: 'store_forward_sms',
          ttl_ms: 60000,
          hop_count: 0,
          qos: 'at_least_once',
        },
      }),
    /store_forward_sms transport is only valid for chat/,
  );
});

test('shared schema rejects gossip envelopes with ttl above hard cap', () => {
  assert.throws(
    () =>
      parseMessageEnvelope({
        schema_version: '1.0',
        message_id: '550e8400-e29b-41d4-a716-446655440011',
        timestamp: Date.now(),
        type: 'call_invite',
        from: 'sender-gossip',
        payload: { callId: 'call-002', recipientId: 'operator-003' },
        transport: {
          mode: 'gossip',
          ttl_ms: 300001,
          hop_count: 0,
          qos: 'at_least_once',
        },
      }),
    /gossip ttl_ms exceeds maximum 300000ms/,
  );
});

test('shared schema rejects MerkleVine metadata anchored before message timestamp', () => {
  const timestamp = Date.now();
  assert.throws(
    () =>
      parseMessageEnvelope({
        schema_version: '1.0',
        message_id: '550e8400-e29b-41d4-a716-446655440012',
        timestamp,
        type: 'chat',
        from: 'sender-vine',
        payload: { content: 'anchor test', recipientId: 'operator-004' },
        nonce: '00112233445566778899aabbccddeeff',
        sequence: 1,
        transport: {
          mode: 'direct',
          ttl_ms: 60000,
          hop_count: 0,
          qos: 'at_least_once',
        },
        vine: {
          stream_id: 'message-stream:sender-vine',
          leaf_hash: 'a'.repeat(64),
          leaf_index: 0,
          anchored_at_ms: timestamp - 1,
        },
      }),
    /vine\.anchored_at_ms cannot precede message timestamp/,
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

test('gateway call signaling path uses gossip routing and MerkleVine anchoring', () => {
  const gatewayIndex = readRepoFile('services/gateway/src/index.ts');

  assert.match(gatewayIndex, /async function anchorEnvelopeInMerkleVine/);
  assert.match(gatewayIndex, /case 'call_invite':[\s\S]*routeEnvelopeViaGossip/);
  assert.match(gatewayIndex, /const ttlMs = envelope\.transport\?\.ttl_ms/);
  assert.match(gatewayIndex, /vine:\s*{/);
});

test('gateway chat routing applies store-forward buffering for offline recipients', () => {
  const gatewayIndex = readRepoFile('services/gateway/src/index.ts');

  assert.match(gatewayIndex, /function queueStoreForwardMessage/);
  assert.match(gatewayIndex, /STORE_FORWARD_TTL_MS/);
  assert.match(gatewayIndex, /recipient_offline_buffered/);
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

test('admin privileges endpoint authorizes configured and enrolled admin node', async () => {
  const adminNodeId = 'admin-node-01';
  const identityMock = await startIdentityRegistryMock({
    enrolledNodeIds: [adminNodeId],
  });

  const { child, baseUrl } = await startGatewayProcess({
    AETHERCORE_ADMIN_NODE_IDS: adminNodeId,
    IDENTITY_REGISTRY_HTTP_ENDPOINT: identityMock.baseUrl,
  });

  try {
    const response = await fetch(`${baseUrl}/api/admin/privileges/${adminNodeId}`);
    const body = (await response.json()) as { authorized?: unknown };
    assert.equal(response.status, 200);
    assert.equal(body.authorized, true);
  } finally {
    await stopGatewayProcess(child);
    await identityMock.stop();
  }
});

test('admin privileges endpoint rejects node ids outside allowlist', async () => {
  const identityMock = await startIdentityRegistryMock({
    enrolledNodeIds: ['admin-node-01'],
  });
  const { child, baseUrl } = await startGatewayProcess({
    AETHERCORE_ADMIN_NODE_IDS: 'admin-node-01',
    IDENTITY_REGISTRY_HTTP_ENDPOINT: identityMock.baseUrl,
  });

  try {
    const response = await fetch(`${baseUrl}/api/admin/privileges/non-admin-node`);
    const body = (await response.json()) as { authorized?: unknown; reason?: unknown };
    assert.equal(response.status, 200);
    assert.equal(body.authorized, false);
    assert.equal(body.reason, 'not_in_admin_allowlist');
  } finally {
    await stopGatewayProcess(child);
    await identityMock.stop();
  }
});

test('admin privileges endpoint fails closed when identity backend is unavailable', async () => {
  const adminNodeId = 'admin-node-01';
  const unavailablePort = await getAvailablePort();
  const unavailableEndpoint = `http://127.0.0.1:${unavailablePort}`;
  const { child, baseUrl } = await startGatewayProcess({
    AETHERCORE_ADMIN_NODE_IDS: adminNodeId,
    IDENTITY_REGISTRY_HTTP_ENDPOINT: unavailableEndpoint,
  });

  try {
    const response = await fetch(`${baseUrl}/api/admin/privileges/${adminNodeId}`);
    const body = (await response.json()) as { authorized?: unknown; reason?: unknown };
    assert.equal(response.status, 503);
    assert.equal(body.authorized, false);
    assert.equal(body.reason, 'identity_backend_unavailable');
  } finally {
    await stopGatewayProcess(child);
  }
});

test('admin revocation endpoint accepts valid authority signature and evicts target telemetry', async () => {
  const adminNodeId = 'admin-node-01';
  const targetNodeId = 'revoked-node-01';
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  const adminPublicKeyPem = publicKey.export({ format: 'pem', type: 'spki' }).toString();

  const identityMock = await startIdentityRegistryMock({
    enrolledNodeIds: [adminNodeId],
    adminPublicKeyPem,
  });
  const { child, baseUrl } = await startGatewayProcess({
    AETHERCORE_ADMIN_NODE_IDS: adminNodeId,
    IDENTITY_REGISTRY_HTTP_ENDPOINT: identityMock.baseUrl,
  });

  try {
    const telemetryResponse = await fetch(`${baseUrl}/api/telemetry`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-node-id': targetNodeId,
      },
      body: JSON.stringify({
        node_id: targetNodeId,
        platform: 'ios',
        overlay: 'ios-overlay',
        trust: {
          self_score: 0.93,
        },
      }),
    });
    assert.equal(telemetryResponse.status, 200);

    const nodesBefore = await fetch(`${baseUrl}/api/nodes`);
    const nodesBeforeBody = (await nodesBefore.json()) as {
      nodes?: Array<{ node_id?: string }>;
    };
    assert.equal(
      nodesBeforeBody.nodes?.some((node) => node.node_id === targetNodeId),
      true,
    );

    const timestampMs = Date.now();
    const canonicalPayload = `${targetNodeId}Compromised field unit${timestampMs}`;
    const authoritySignatureHex = crypto
      .sign(null, Buffer.from(canonicalPayload, 'utf-8'), privateKey)
      .toString('hex');

    const revokeResponse = await fetch(`${baseUrl}/api/admin/revoke`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        admin_node_id: adminNodeId,
        node_id: targetNodeId,
        reason: 'Compromised field unit',
        timestamp_ms: timestampMs,
        authority_signature_hex: authoritySignatureHex,
      }),
    });
    const revokeBody = (await revokeResponse.json()) as { status?: unknown; node_id?: unknown };
    assert.equal(revokeResponse.status, 200);
    assert.equal(revokeBody.status, 'ok');
    assert.equal(revokeBody.node_id, targetNodeId);
    assert.equal(identityMock.revocationCalls.length, 1);

    const nodesAfter = await fetch(`${baseUrl}/api/nodes`);
    const nodesAfterBody = (await nodesAfter.json()) as {
      nodes?: Array<{ node_id?: string }>;
    };
    assert.equal(
      nodesAfterBody.nodes?.some((node) => node.node_id === targetNodeId),
      false,
    );
  } finally {
    await stopGatewayProcess(child);
    await identityMock.stop();
  }
});

test('admin revocation endpoint rejects invalid authority signatures', async () => {
  const adminNodeId = 'admin-node-01';
  const { publicKey } = crypto.generateKeyPairSync('ed25519');
  const adminPublicKeyPem = publicKey.export({ format: 'pem', type: 'spki' }).toString();

  const identityMock = await startIdentityRegistryMock({
    enrolledNodeIds: [adminNodeId],
    adminPublicKeyPem,
  });
  const { child, baseUrl } = await startGatewayProcess({
    AETHERCORE_ADMIN_NODE_IDS: adminNodeId,
    IDENTITY_REGISTRY_HTTP_ENDPOINT: identityMock.baseUrl,
  });

  try {
    const response = await fetch(`${baseUrl}/api/admin/revoke`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        admin_node_id: adminNodeId,
        node_id: 'revoked-node-02',
        reason: 'Signature mismatch test',
        timestamp_ms: Date.now(),
        authority_signature_hex: '11'.repeat(64),
      }),
    });
    const body = (await response.json()) as { status?: unknown; code?: unknown };
    assert.equal(response.status, 400);
    assert.equal(body.status, 'error');
    assert.equal(body.code, 'REVOCATION_REJECTED');
  } finally {
    await stopGatewayProcess(child);
    await identityMock.stop();
  }
});

test('admin revocation endpoint fails closed when identity backend is unavailable', async () => {
  const adminNodeId = 'admin-node-01';
  const unavailablePort = await getAvailablePort();
  const unavailableEndpoint = `http://127.0.0.1:${unavailablePort}`;
  const { child, baseUrl } = await startGatewayProcess({
    AETHERCORE_ADMIN_NODE_IDS: adminNodeId,
    IDENTITY_REGISTRY_HTTP_ENDPOINT: unavailableEndpoint,
  });

  try {
    const response = await fetch(`${baseUrl}/api/admin/revoke`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        admin_node_id: adminNodeId,
        node_id: 'revoked-node-03',
        reason: 'Backend unavailable test',
        timestamp_ms: Date.now(),
        authority_signature_hex: '22'.repeat(64),
      }),
    });
    const body = (await response.json()) as { status?: unknown; code?: unknown };
    assert.equal(response.status, 503);
    assert.equal(body.status, 'error');
    assert.equal(body.code, 'IDENTITY_REGISTRY_UNREACHABLE');
  } finally {
    await stopGatewayProcess(child);
  }
});

test('admin fleet attestation endpoint returns merged node states with fail-visible defaults', async () => {
  const nodeA = 'fleet-node-a';
  const nodeB = 'fleet-node-b';
  const { child, baseUrl } = await startGatewayProcess();

  try {
    const telemetryA = await fetch(`${baseUrl}/api/telemetry`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-node-id': nodeA,
      },
      body: JSON.stringify({
        node_id: nodeA,
        trust: { self_score: 0.91 },
        security: {
          hardware_backed: true,
          tpm_attestation_valid: true,
          merkle_vine_synced: true,
        },
      }),
    });
    assert.equal(telemetryA.status, 200);

    const telemetryB = await fetch(`${baseUrl}/api/telemetry`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-node-id': nodeB,
      },
      body: JSON.stringify({
        node_id: nodeB,
      }),
    });
    assert.equal(telemetryB.status, 200);

    const fleet = await fetch(`${baseUrl}/api/admin/fleet-attestation`);
    const body = (await fleet.json()) as {
      status?: unknown;
      nodes?: Array<Record<string, unknown>>;
    };
    assert.equal(fleet.status, 200);
    assert.equal(body.status, 'ok');
    assert.equal(Array.isArray(body.nodes), true);

    const stateA = body.nodes?.find((entry) => entry.node_id === nodeA);
    const stateB = body.nodes?.find((entry) => entry.node_id === nodeB);
    assert.equal(Boolean(stateA), true);
    assert.equal(Boolean(stateB), true);

    assert.equal(stateA?.hardware_backed, true);
    assert.equal(stateA?.tpm_attestation_valid, true);
    assert.equal(stateA?.merkle_vine_synced, true);
    assert.equal(stateA?.trust_score, 91);

    assert.equal(stateB?.hardware_backed, false);
    assert.equal(stateB?.tpm_attestation_valid, false);
    assert.equal(stateB?.merkle_vine_synced, false);
    assert.equal(stateB?.trust_score, 0);
  } finally {
    await stopGatewayProcess(child);
  }
});
