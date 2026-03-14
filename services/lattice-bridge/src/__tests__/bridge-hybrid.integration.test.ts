import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createServer as createHttpServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { createServer as createTcpServer } from 'node:net';
import * as grpc from '@grpc/grpc-js';
import * as protoLoader from '@grpc/proto-loader';

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

type FixtureShape = {
  entityId: string;
  sourceUpdateTimeMs: number;
  taskId: string;
  taskStatusVersion: number;
};

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

async function startMockRestServer(
  fixture: FixtureShape,
  mode: 'healthy' | 'unavailable',
): Promise<{ baseUrl: string; stop: () => Promise<void> }> {
  const port = await getAvailablePort();
  const server = createHttpServer((req: IncomingMessage, res: ServerResponse) => {
    if (req.method === 'POST' && req.url === '/api/v2/oauth/token') {
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ access_token: 'integration-token', expires_in: 1800 }));
      return;
    }

    if (mode === 'unavailable' && req.url?.startsWith('/api/v2/')) {
      res.statusCode = 503;
      res.end('rest unavailable');
      return;
    }

    if (req.method === 'GET' && req.url?.startsWith('/api/v2/entities')) {
      res.setHeader('content-type', 'application/json');
      res.end(
        JSON.stringify({
          entities: [
            {
              entity_id: fixture.entityId,
              source: 'lattice',
              source_update_time_ms: fixture.sourceUpdateTimeMs,
              signature_valid: true,
              verification_status: 'VERIFIED',
              raw_entity: {
                entity_id: fixture.entityId,
                signature_valid: true,
              },
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
              task_id: fixture.taskId,
              assigned_agent_id: 'agent-01',
              status: 'QUEUED',
              status_version: fixture.taskStatusVersion,
              updated_at_ms: Date.now() - 5,
              trust_posture: 'trusted',
            },
          ],
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
              object_id: `${fixture.entityId}-obj-1`,
              entity_id: fixture.entityId,
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

async function startMockGrpcServer(fixture: FixtureShape): Promise<{
  target: string;
  stop: () => Promise<void>;
}> {
  const protoRoot = path.resolve(__dirname, '..', '..', 'proto', 'lattice-sdk');
  const definition = protoLoader.loadSync(
    [
      path.join(protoRoot, 'anduril', 'entitymanager', 'v1', 'entitymanager.proto'),
      path.join(protoRoot, 'anduril', 'taskmanager', 'v1', 'taskmanager.proto'),
    ],
    {
      keepCase: true,
      longs: String,
      enums: String,
      defaults: true,
      oneofs: true,
      includeDirs: [protoRoot],
    },
  );

  const bundle = grpc.loadPackageDefinition(definition) as grpc.GrpcObject & {
    anduril?: {
      entitymanager?: { v1?: { EntityManagerAPI?: grpc.ServiceClientConstructor } };
      taskmanager?: { v1?: { TaskManagerAPI?: grpc.ServiceClientConstructor } };
    };
  };

  const entityCtor = bundle.anduril?.entitymanager?.v1?.EntityManagerAPI;
  const taskCtor = bundle.anduril?.taskmanager?.v1?.TaskManagerAPI;
  if (!entityCtor || !taskCtor) {
    throw new Error('Unable to resolve grpc service constructors');
  }

  const server = new grpc.Server();
  server.addService(entityCtor.service, {
    StreamEntities(
      call: grpc.ServerWritableStream<Record<string, unknown>, Record<string, unknown>>,
    ): void {
      call.write({
        entity: {
          entity_id: fixture.entityId,
          source: 'lattice',
          source_update_time_ms: String(fixture.sourceUpdateTimeMs),
          signature_valid: true,
          verification_status: 'VERIFIED',
          raw_entity_json: JSON.stringify({
            entity_id: fixture.entityId,
            signature_valid: true,
          }),
        },
        cursor: String(fixture.sourceUpdateTimeMs),
        server_timestamp_ms: String(Date.now()),
      });
      call.end();
    },
  });
  server.addService(taskCtor.service, {
    ListenAsAgent(
      call: grpc.ServerWritableStream<Record<string, unknown>, Record<string, unknown>>,
    ): void {
      call.write({
        task: {
          task_id: fixture.taskId,
          assigned_agent_id: 'agent-01',
          status: 'QUEUED',
          status_version: String(fixture.taskStatusVersion),
          updated_at_ms: String(Date.now() - 5),
          trust_posture: 'trusted',
          raw_task_json: JSON.stringify({ task_id: fixture.taskId }),
        },
        cursor: String(fixture.taskStatusVersion),
        server_timestamp_ms: String(Date.now()),
      });
      call.end();
    },
  });

  const port = await getAvailablePort();
  await new Promise<void>((resolve, reject) => {
    server.bindAsync(`127.0.0.1:${port}`, grpc.ServerCredentials.createInsecure(), (error) => {
      if (error) {
        reject(error);
        return;
      }
      server.start();
      resolve();
    });
  });

  return {
    target: `127.0.0.1:${port}`,
    stop: async () => {
      await new Promise<void>((resolve) => {
        let finished = false;
        const timeoutHandle = setTimeout(() => {
          if (finished) {
            return;
          }
          finished = true;
          server.forceShutdown();
          resolve();
        }, 1000);

        server.tryShutdown(() => {
          if (finished) {
            return;
          }
          finished = true;
          clearTimeout(timeoutHandle);
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
      LATTICE_INTEGRATION_MODE: 'standard',
      LATTICE_PROTOCOL_MODE: 'hybrid',
      LATTICE_SANDBOX_MODE: 'false',
      LATTICE_GRPC_INSECURE: 'true',
      LATTICE_GRPC_POLL_WINDOW_MS: '600',
      LATTICE_GRPC_MAX_EVENTS: '64',
      LATTICE_POLL_INTERVAL_MS: '300',
      ...envOverrides,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const startupLogs: string[] = [];
  const appendLog = (prefix: string, chunk: Buffer | string): void => {
    startupLogs.push(`${prefix}${chunk.toString()}`.trimEnd());
    if (startupLogs.length > 80) {
      startupLogs.shift();
    }
  };
  child.stdout?.on('data', (chunk: Buffer | string) => appendLog('[stdout] ', chunk));
  child.stderr?.on('data', (chunk: Buffer | string) => appendLog('[stderr] ', chunk));

  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(
        `Bridge exited before startup (exit=${child.exitCode}). Logs:\n${startupLogs.join('\n') || '<none>'}`,
      );
    }
    try {
      const response = await fetch(`${baseUrl}/api/lattice/status`);
      if (response.ok) {
        return { child, baseUrl };
      }
    } catch {
      // wait for startup
    }
    await wait(100);
  }

  await stopBridgeProcess(child);
  throw new Error(`Bridge startup timeout. Logs:\n${startupLogs.join('\n') || '<none>'}`);
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

async function fetchBridgeStatus(baseUrl: string): Promise<Record<string, unknown>> {
  const response = await fetch(`${baseUrl}/api/lattice/status`);
  assert.equal(response.status, 200);
  return (await response.json()) as Record<string, unknown>;
}

test('hybrid failover: continues ingest when gRPC is unavailable and REST remains healthy', async () => {
  const restFixture: FixtureShape = {
    entityId: 'rest-entity-1',
    sourceUpdateTimeMs: 101,
    taskId: 'rest-task-1',
    taskStatusVersion: 8,
  };
  const restServer = await startMockRestServer(restFixture, 'healthy');
  const gatewaySink = await startGatewaySink();
  const unavailableGrpcPort = await getAvailablePort();
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aethercore-lattice-bridge-it-rest-'));

  const { child, baseUrl } = await startBridgeProcess({
    LATTICE_BASE_URL: restServer.baseUrl,
    LATTICE_CLIENT_ID: 'client-id',
    LATTICE_CLIENT_SECRET: 'client-secret',
    LATTICE_AGENT_ID: 'agent-01',
    LATTICE_GATEWAY_INTERNAL_URL: gatewaySink.url,
    LATTICE_GRPC_TARGET: `127.0.0.1:${unavailableGrpcPort}`,
    LATTICE_BRIDGE_DATA_DIR: dataDir,
  });

  try {
    await wait(1500);
    const status = await fetchBridgeStatus(baseUrl);
    assert.equal(status.rest_healthy, true);
    assert.equal(status.grpc_healthy, false);
    assert.ok((status.metrics as Record<string, unknown>).stream_reconnects as number >= 1);
    assert.ok(gatewaySink.receivedEvents.length >= 1);
  } finally {
    await stopBridgeProcess(child);
    await restServer.stop();
    await gatewaySink.stop();
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test('hybrid failover: continues ingest when REST is unavailable and gRPC remains healthy', async () => {
  const grpcFixture: FixtureShape = {
    entityId: 'grpc-entity-1',
    sourceUpdateTimeMs: 201,
    taskId: 'grpc-task-1',
    taskStatusVersion: 9,
  };
  const restServer = await startMockRestServer(grpcFixture, 'unavailable');
  const grpcServer = await startMockGrpcServer(grpcFixture);
  const gatewaySink = await startGatewaySink();
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aethercore-lattice-bridge-it-grpc-'));

  const { child, baseUrl } = await startBridgeProcess({
    LATTICE_BASE_URL: restServer.baseUrl,
    LATTICE_CLIENT_ID: 'client-id',
    LATTICE_CLIENT_SECRET: 'client-secret',
    LATTICE_AGENT_ID: 'agent-01',
    LATTICE_GATEWAY_INTERNAL_URL: gatewaySink.url,
    LATTICE_GRPC_TARGET: grpcServer.target,
    LATTICE_BRIDGE_DATA_DIR: dataDir,
  });

  try {
    await wait(1500);
    const status = await fetchBridgeStatus(baseUrl);
    assert.equal(status.rest_healthy, false);
    assert.equal(status.grpc_healthy, true);
    assert.ok(gatewaySink.receivedEvents.length >= 1);
  } finally {
    await stopBridgeProcess(child);
    await grpcServer.stop();
    await restServer.stop();
    await gatewaySink.stop();
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test('hybrid parity mismatch increments mismatch metric and records protocol parity audit', async () => {
  const restFixture: FixtureShape = {
    entityId: 'rest-entity-mismatch',
    sourceUpdateTimeMs: 301,
    taskId: 'rest-task-mismatch',
    taskStatusVersion: 13,
  };
  const grpcFixture: FixtureShape = {
    entityId: 'grpc-entity-mismatch',
    sourceUpdateTimeMs: 302,
    taskId: 'grpc-task-mismatch',
    taskStatusVersion: 14,
  };
  const restServer = await startMockRestServer(restFixture, 'healthy');
  const grpcServer = await startMockGrpcServer(grpcFixture);
  const gatewaySink = await startGatewaySink();
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aethercore-lattice-bridge-it-mismatch-'));

  const { child, baseUrl } = await startBridgeProcess({
    LATTICE_BASE_URL: restServer.baseUrl,
    LATTICE_CLIENT_ID: 'client-id',
    LATTICE_CLIENT_SECRET: 'client-secret',
    LATTICE_AGENT_ID: 'agent-01',
    LATTICE_GATEWAY_INTERNAL_URL: gatewaySink.url,
    LATTICE_GRPC_TARGET: grpcServer.target,
    LATTICE_BRIDGE_DATA_DIR: dataDir,
  });

  try {
    await wait(1800);
    const status = await fetchBridgeStatus(baseUrl);
    const metrics = status.metrics as Record<string, unknown>;
    assert.ok((metrics.mismatches as number) >= 1);

    // Validate audit persistence using the bridge DB file directly.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const sqlite = require('node:sqlite') as { DatabaseSync: new (path: string) => { prepare: (sql: string) => { all: (...params: unknown[]) => Array<Record<string, unknown>> }; close?: () => void } };
    const dbPath = path.join(dataDir, 'lattice-bridge.db');
    const db = new sqlite.DatabaseSync(dbPath);
    const parityRows = db
      .prepare(
        `SELECT operation, protocol, status, message
         FROM lattice_sync_audit
         WHERE operation = 'protocol_parity'
         ORDER BY audit_id DESC
         LIMIT 5`,
      )
      .all();
    db.close?.();
    assert.ok(parityRows.length >= 1);
    assert.equal(parityRows[0]?.protocol, 'hybrid');
    assert.equal(parityRows[0]?.status, 'error');
  } finally {
    await stopBridgeProcess(child);
    await grpcServer.stop();
    await restServer.stop();
    await gatewaySink.stop();
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});
