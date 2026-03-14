import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createServer as createHttpServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { createServer as createTcpServer } from 'node:net';

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function getAvailablePort(): Promise<number> {
  return await new Promise((resolve, reject) => {
    const server = createTcpServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        server.close();
        reject(new Error('Failed to allocate port'));
        return;
      }
      const selectedPort = address.port;
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(selectedPort);
      });
    });
  });
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

async function startGatewaySink(): Promise<{
  url: string;
  receivedEvents: unknown[];
  stop: () => Promise<void>;
}> {
  const receivedEvents: unknown[] = [];
  const port = await getAvailablePort();
  const server = createHttpServer(async (req: IncomingMessage, res: ServerResponse) => {
    if (req.method === 'POST' && req.url === '/internal/lattice/events') {
      const body = await readJsonBody(req);
      receivedEvents.push(body);
      res.statusCode = 202;
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ status: 'accepted' }));
      return;
    }
    res.statusCode = 404;
    res.end('not found');
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => resolve());
  });

  return {
    url: `http://127.0.0.1:${port}/internal/lattice/events`,
    receivedEvents,
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

async function startMockRestServer(): Promise<{ baseUrl: string; stop: () => Promise<void> }> {
  const port = await getAvailablePort();
  const server = createHttpServer((req: IncomingMessage, res: ServerResponse) => {
    if (req.method === 'POST' && req.url === '/api/v2/oauth/token') {
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ access_token: 'stealth-token', expires_in: 1800 }));
      return;
    }

    if (req.method === 'GET' && req.url?.startsWith('/api/v2/entities')) {
      res.setHeader('content-type', 'application/json');
      res.end(
        JSON.stringify({
          entities: [
            {
              entity_id: 'stealth-entity-1',
              source: 'lattice',
              source_update_time_ms: 111,
              signature_valid: true,
              verification_status: 'VERIFIED',
            },
          ],
        }),
      );
      return;
    }

    if (req.method === 'GET' && req.url?.startsWith('/api/v2/tasks/listen-as-agent-stream')) {
      res.setHeader('content-type', 'application/json');
      res.end(
        JSON.stringify({
          tasks: [
            {
              task_id: 'stealth-task-1',
              assigned_agent_id: 'agent-01',
              status: 'QUEUED',
              status_version: 1,
              updated_at_ms: Date.now(),
              trust_posture: 'trusted',
            },
          ],
        }),
      );
      return;
    }

    if (req.method === 'GET' && req.url?.startsWith('/api/v2/objects/stealth-object-1')) {
      res.setHeader('content-type', 'application/json');
      res.end(
        JSON.stringify({
          object_id: 'stealth-object-1',
          entity_id: 'stealth-entity-1',
          media_type: 'application/json',
        }),
      );
      return;
    }

    if (req.method === 'GET' && req.url?.startsWith('/api/v2/objects')) {
      res.setHeader('content-type', 'application/json');
      res.end(
        JSON.stringify({
          objects: [
            {
              object_id: 'stealth-object-1',
              entity_id: 'stealth-entity-1',
              media_type: 'application/json',
              metadata: { source: 'fixture' },
              created_at_ms: Date.now(),
            },
          ],
        }),
      );
      return;
    }

    res.statusCode = 404;
    res.end('not found');
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => resolve());
  });

  return {
    baseUrl: `http://127.0.0.1:${port}`,
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

async function startBridgeProcess(envOverrides: Record<string, string>): Promise<{
  child: ChildProcess;
  baseUrl: string;
}> {
  const port = await getAvailablePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const bridgeEntryCandidates = [
    path.resolve(__dirname, '..', 'index.js'),
    path.resolve(process.cwd(), 'dist', 'index.js'),
    path.resolve(process.cwd(), 'services', 'lattice-bridge', 'dist', 'index.js'),
  ];
  const bridgeEntry = bridgeEntryCandidates.find((candidate) => fs.existsSync(candidate));
  if (!bridgeEntry) {
    throw new Error(`Unable to locate bridge entrypoint. Checked: ${bridgeEntryCandidates.join(', ')}`);
  }
  const child = spawn(process.execPath, [bridgeEntry], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      PORT: String(port),
      NODE_ENV: 'test',
      LOG_LEVEL: 'error',
      AETHERCORE_PRODUCTION: '0',
      LATTICE_PROTOCOL_MODE: 'hybrid',
      LATTICE_SANDBOX_MODE: 'false',
      LATTICE_POLL_INTERVAL_MS: '300',
      ...envOverrides,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${baseUrl}/api/lattice/status`);
      if (response.ok) {
        return { child, baseUrl };
      }
    } catch {
      // wait for startup
    }
    if (child.exitCode !== null) {
      throw new Error(`Bridge exited before startup (exit=${child.exitCode})`);
    }
    await wait(100);
  }

  await stopBridgeProcess(child);
  throw new Error('Bridge startup timeout');
}

async function stopBridgeProcess(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.killed) {
    return;
  }
  const exited = new Promise<void>((resolve) => {
    child.once('exit', () => resolve());
  });
  child.kill('SIGTERM');
  await Promise.race([exited, wait(2000)]);
  if (child.exitCode === null) {
    child.kill('SIGKILL');
    await Promise.race([exited, wait(1000)]);
  }
}

test('stealth read-only mode forces REST ingest and blocks outbound writes with explicit audit', async () => {
  const restServer = await startMockRestServer();
  const gatewaySink = await startGatewaySink();
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aethercore-lattice-bridge-stealth-it-'));

  const { child, baseUrl } = await startBridgeProcess({
    LATTICE_BASE_URL: restServer.baseUrl,
    LATTICE_CLIENT_ID: 'client-id',
    LATTICE_CLIENT_SECRET: 'client-secret',
    LATTICE_AGENT_ID: 'agent-01',
    LATTICE_INPUT_MODE: 'live',
    LATTICE_GATEWAY_INTERNAL_URL: gatewaySink.url,
    LATTICE_BRIDGE_DATA_DIR: dataDir,
  });

  try {
    await wait(1500);

    const statusResponse = await fetch(`${baseUrl}/api/lattice/status`);
    assert.equal(statusResponse.status, 200);
    const status = (await statusResponse.json()) as Record<string, unknown>;
    assert.equal(status.integration_mode, 'stealth_readonly');
    assert.equal(status.input_mode, 'live');
    assert.equal(status.effective_profile, 'stealth_readonly_live');
    assert.equal(status.protocol_mode, 'rest');
    assert.equal(status.rest_healthy, true);
    assert.equal(status.grpc_healthy, false);
    assert.equal(status.grpc_target_configured, false);
    assert.ok(gatewaySink.receivedEvents.length >= 1);

    const objectsResponse = await fetch(`${baseUrl}/api/lattice/objects?entity_id=stealth-entity-1`);
    assert.equal(objectsResponse.status, 200);
    const objectsBody = (await objectsResponse.json()) as { count: number };
    assert.ok(objectsBody.count >= 1);

    const overlayResponse = await fetch(`${baseUrl}/api/lattice/entities/stealth-entity-1/overlay`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        source_update_time_ms: Date.now(),
        overlay: {
          schema: 'aethercore.verification.v1',
          entity_id: 'stealth-entity-1',
          verification_status: 'VERIFIED',
          trust_score: 0.95,
          byzantine_faults: [],
          merkle_event_hash: 'hash-a',
          merkle_prev_hash: 'hash-b',
          signature_valid: true,
          evaluated_at_ms: Date.now(),
          evidence_object_ids: [],
          aethercore_version: '0.2.0',
          source: 'aethercore',
        },
      }),
    });
    assert.equal(overlayResponse.status, 403);
    const overlayBody = (await overlayResponse.json()) as { code: string };
    assert.equal(overlayBody.code, 'STEALTH_READ_ONLY');

    const uploadResponse = await fetch(`${baseUrl}/api/lattice/objects/upload`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        object_id: 'blocked-object-1',
        entity_id: 'stealth-entity-1',
      }),
    });
    assert.equal(uploadResponse.status, 403);
    const uploadBody = (await uploadResponse.json()) as { code: string };
    assert.equal(uploadBody.code, 'STEALTH_READ_ONLY');

    const registerResponse = await fetch(`${baseUrl}/api/lattice/objects/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        object_id: 'blocked-object-2',
        entity_id: 'stealth-entity-1',
      }),
    });
    assert.equal(registerResponse.status, 403);
    const registerBody = (await registerResponse.json()) as { code: string };
    assert.equal(registerBody.code, 'STEALTH_READ_ONLY');

    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const sqlite = require('node:sqlite') as {
      DatabaseSync: new (path: string) => {
        prepare: (sql: string) => { all: (...params: unknown[]) => Array<Record<string, unknown>> };
        close?: () => void;
      };
    };

    const dbPath = path.join(dataDir, 'lattice-bridge.db');
    const db = new sqlite.DatabaseSync(dbPath);
    const blockedRows = db
      .prepare(
        `SELECT operation, status, message
         FROM lattice_sync_audit
         WHERE direction = 'outbound'
           AND operation IN ('overlay_publish', 'object_upload', 'object_register')
         ORDER BY audit_id DESC`,
      )
      .all();
    db.close?.();

    assert.ok(blockedRows.length >= 3);
    assert.ok(blockedRows.every((row) => row.status === 'error'));
    assert.ok(blockedRows.every((row) => String(row.message).includes('stealth_readonly')));
  } finally {
    await stopBridgeProcess(child);
    await restServer.stop();
    await gatewaySink.stop();
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test('stealth synthetic profile boots without live credentials and enforces fail-visible mode switching', async () => {
  const gatewaySink = await startGatewaySink();
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aethercore-lattice-bridge-stealth-synthetic-it-'));

  const { child, baseUrl } = await startBridgeProcess({
    LATTICE_BASE_URL: '',
    LATTICE_CLIENT_ID: '',
    LATTICE_CLIENT_SECRET: '',
    LATTICE_AGENT_ID: '',
    LATTICE_GATEWAY_INTERNAL_URL: gatewaySink.url,
    LATTICE_GATEWAY_INTERNAL_TOKEN: 'internal-lattice-token',
    LATTICE_BRIDGE_DATA_DIR: dataDir,
  });

  try {
    await wait(1500);

    const statusResponse = await fetch(`${baseUrl}/api/lattice/status`);
    assert.equal(statusResponse.status, 200);
    const status = (await statusResponse.json()) as Record<string, unknown>;
    assert.equal(status.integration_mode, 'stealth_readonly');
    assert.equal(status.input_mode, 'synthetic');
    assert.equal(status.effective_profile, 'stealth_readonly_synthetic');
    assert.equal(status.protocol_mode, 'rest');
    assert.equal(status.grpc_healthy, false);
    assert.equal(status.grpc_target_configured, false);
    assert.ok(gatewaySink.receivedEvents.length >= 1);

    const modeResponse = await fetch(`${baseUrl}/api/lattice/mode`);
    assert.equal(modeResponse.status, 200);
    const modeBody = (await modeResponse.json()) as Record<string, unknown>;
    assert.equal(modeBody.input_mode, 'synthetic');
    assert.equal(modeBody.effective_profile, 'stealth_readonly_synthetic');

    const unauthorizedSwitch = await fetch(`${baseUrl}/api/lattice/mode`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        profile: 'stealth_readonly_live',
        changed_by_admin_node_id: 'admin-1',
      }),
    });
    assert.equal(unauthorizedSwitch.status, 401);

    const rejectedSwitch = await fetch(`${baseUrl}/api/lattice/mode`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-aethercore-lattice-token': 'internal-lattice-token',
      },
      body: JSON.stringify({
        profile: 'stealth_readonly_live',
        changed_by_admin_node_id: 'admin-1',
        reason: 'test-live-switch',
      }),
    });
    assert.equal(rejectedSwitch.status, 409);
    const rejectedBody = (await rejectedSwitch.json()) as { code: string; mode?: { input_mode: string } };
    assert.equal(rejectedBody.code, 'LIVE_CONFIG_MISSING');
    assert.equal(rejectedBody.mode?.input_mode, 'synthetic');

    const objectsResponse = await fetch(`${baseUrl}/api/lattice/objects?limit=20`);
    assert.equal(objectsResponse.status, 200);
    const objectsBody = (await objectsResponse.json()) as { count: number; source: string };
    assert.ok(objectsBody.count > 0);
    assert.equal(objectsBody.source, 'lattice.synthetic');
  } finally {
    await stopBridgeProcess(child);
    await gatewaySink.stop();
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});
