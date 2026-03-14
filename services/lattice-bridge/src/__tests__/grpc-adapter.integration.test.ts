import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer as createHttpServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { createServer as createTcpServer } from 'node:net';
import path from 'node:path';
import * as grpc from '@grpc/grpc-js';
import * as protoLoader from '@grpc/proto-loader';
import pino from 'pino';
import { OAuthTokenManager } from '../token-manager';
import { LatticeRestAdapter } from '../rest-adapter';
import { LatticeGrpcAdapter } from '../grpc-adapter';
import type { BridgeConfig } from '../types';
import type { LatticeInboundEventV1 } from '@aethercore/shared';

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
        reject(new Error('Failed to allocate free port'));
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

function buildConfig(baseUrl: string, grpcTarget: string): BridgeConfig {
  return {
    port: 3010,
    dataDir: './tmp',
    integrationMode: 'standard',
    defaultInputMode: 'live',
    allowOutboundWrites: true,
    protocolMode: 'hybrid',
    isProduction: false,
    sandboxMode: true,
    latticeBaseUrl: baseUrl,
    latticeClientId: 'client-id',
    latticeClientSecret: 'client-secret',
    latticeAgentId: 'agent-01',
    sandboxesToken: 'sandbox-token',
    grpcTarget,
    grpcInsecure: true,
    grpcCaCertPath: undefined,
    grpcClientCertPath: undefined,
    grpcClientKeyPath: undefined,
    grpcServerNameOverride: undefined,
    grpcPollWindowMs: 1000,
    grpcMaxEvents: 64,
    grpcTransportMode: 'insecure',
    syntheticScenario: 'joint_multidomain',
    syntheticSeed: 'seed',
    syntheticTimeline: 'dual',
    syntheticReplayHours: 24,
    syntheticIngestIntervalMs: 5000,
    pollIntervalMs: 5000,
    gatewayInternalUrl: 'http://127.0.0.1:65535/internal/lattice/events',
    gatewayInternalToken: undefined,
  };
}

type RestCapture = {
  oauthHeaders: Array<Record<string, string | string[] | undefined>>;
  entitiesHeaders: Array<Record<string, string | string[] | undefined>>;
  tasksHeaders: Array<Record<string, string | string[] | undefined>>;
  objectsHeaders: Array<Record<string, string | string[] | undefined>>;
};

async function startMockRestServer(capture: RestCapture): Promise<{
  baseUrl: string;
  stop: () => Promise<void>;
}> {
  const port = await getAvailablePort();
  const server = createHttpServer(async (req: IncomingMessage, res: ServerResponse) => {
    if (req.method === 'POST' && req.url === '/api/v2/oauth/token') {
      capture.oauthHeaders.push(req.headers);
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ access_token: 'test-token', expires_in: 1800 }));
      return;
    }

    if (req.method === 'GET' && req.url?.startsWith('/api/v2/entities')) {
      capture.entitiesHeaders.push(req.headers);
      res.setHeader('content-type', 'application/json');
      res.end(
        JSON.stringify({
          entities: [
            {
              entity_id: 'entity-1',
              source: 'lattice',
              source_update_time_ms: 101,
              signature_valid: true,
              verification_status: 'VERIFIED',
              components: {},
            },
          ],
        }),
      );
      return;
    }

    if (req.method === 'GET' && req.url?.startsWith('/api/v2/tasks/listen-as-agent-stream')) {
      capture.tasksHeaders.push(req.headers);
      res.setHeader('content-type', 'application/json');
      res.end(
        JSON.stringify({
          tasks: [
            {
              task_id: 'task-1',
              assigned_agent_id: 'agent-01',
              status: 'QUEUED',
              status_version: 7,
              updated_at_ms: Date.now() - 5,
              trust_posture: 'trusted',
            },
          ],
        }),
      );
      return;
    }

    if (req.method === 'GET' && req.url?.startsWith('/api/v2/objects')) {
      capture.objectsHeaders.push(req.headers);
      res.setHeader('content-type', 'application/json');
      res.end(
        JSON.stringify({
          objects: [
            {
              object_id: 'obj-1',
              entity_id: 'entity-1',
              media_type: 'application/json',
              metadata: { type: 'evidence' },
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

async function startMockGrpcServer(): Promise<{
  target: string;
  metadataCapture: { auth: string[]; sandbox: string[] };
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
    throw new Error('Unable to resolve mock lattice grpc services');
  }

  const metadataCapture = { auth: [] as string[], sandbox: [] as string[] };
  const server = new grpc.Server();
  server.addService(entityCtor.service, {
    StreamEntities(
      call: grpc.ServerWritableStream<Record<string, unknown>, Record<string, unknown>>,
    ): void {
      const headers = call.metadata.getMap();
      metadataCapture.auth.push(String(headers.authorization || ''));
      metadataCapture.sandbox.push(String(headers['anduril-sandbox-authorization'] || ''));
      call.write({
        entity: {
          entity_id: 'entity-1',
          source: 'lattice',
          source_update_time_ms: '101',
          signature_valid: true,
          verification_status: 'VERIFIED',
          raw_entity_json: JSON.stringify({ entity_id: 'entity-1', signature_valid: true }),
        },
        cursor: '101',
        server_timestamp_ms: String(Date.now()),
      });
      call.end();
    },
  });
  server.addService(taskCtor.service, {
    ListenAsAgent(
      call: grpc.ServerWritableStream<Record<string, unknown>, Record<string, unknown>>,
    ): void {
      const headers = call.metadata.getMap();
      metadataCapture.auth.push(String(headers.authorization || ''));
      metadataCapture.sandbox.push(String(headers['anduril-sandbox-authorization'] || ''));
      call.write({
        task: {
          task_id: 'task-1',
          assigned_agent_id: 'agent-01',
          status: 'QUEUED',
          status_version: '7',
          updated_at_ms: String(Date.now() - 5),
          trust_posture: 'trusted',
          raw_task_json: JSON.stringify({ task_id: 'task-1' }),
        },
        cursor: '7',
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
    metadataCapture,
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

function entityKey(event: LatticeInboundEventV1): string {
  if (event.event.kind !== 'entity') {
    throw new Error(`Expected entity event, received ${event.event.kind}`);
  }
  return `${event.event.kind}:${event.event.projection.entity_id}:${event.event.projection.source_update_time_ms}`;
}

function taskKey(event: LatticeInboundEventV1): string {
  if (event.event.kind !== 'task') {
    throw new Error(`Expected task event, received ${event.event.kind}`);
  }
  return `${event.event.kind}:${event.event.task.task_id}:${event.event.task.status_version}`;
}

test('grpc adapter injects auth metadata and normalizes entity/task streams with parity vs REST fixtures', async () => {
  const capture: RestCapture = {
    oauthHeaders: [],
    entitiesHeaders: [],
    tasksHeaders: [],
    objectsHeaders: [],
  };
  const restServer = await startMockRestServer(capture);
  const grpcServer = await startMockGrpcServer();
  const logger = pino({ enabled: false });
  const config = buildConfig(restServer.baseUrl, grpcServer.target);
  const tokenManager = new OAuthTokenManager(config, logger, () => undefined, () => undefined);
  const restAdapter = new LatticeRestAdapter(config, tokenManager, logger);
  const grpcAdapter = new LatticeGrpcAdapter(config, tokenManager, logger);

  try {
    const [restEntities, restTasks, grpcEntities, grpcTasks, objects] = await Promise.all([
      restAdapter.pullEntities(null),
      restAdapter.pullTasks(null),
      grpcAdapter.pullEntities(null),
      grpcAdapter.pullTasks(null),
      restAdapter.listObjects('entity-1', 10),
    ]);

    assert.equal(grpcAdapter.health.healthy, true);
    assert.equal(grpcAdapter.transportMode, 'insecure');
    assert.equal(grpcAdapter.isTargetConfigured, true);

    assert.ok(capture.oauthHeaders.length >= 1);
    assert.ok(capture.entitiesHeaders.length >= 1);
    assert.ok(capture.tasksHeaders.length >= 1);
    assert.ok(capture.objectsHeaders.length >= 1);
    assert.match(String(capture.oauthHeaders[0]['anduril-sandbox-authorization']), /Bearer sandbox-token/i);
    assert.match(String(capture.entitiesHeaders[0].authorization), /Bearer test-token/i);
    assert.match(String(capture.tasksHeaders[0].authorization), /Bearer test-token/i);

    assert.ok(grpcServer.metadataCapture.auth.length >= 2);
    assert.ok(grpcServer.metadataCapture.sandbox.length >= 2);
    assert.match(grpcServer.metadataCapture.auth[0], /Bearer test-token/i);
    assert.match(grpcServer.metadataCapture.sandbox[0], /Bearer sandbox-token/i);

    const restEntityKeys = restEntities.events.map(entityKey);
    const grpcEntityKeys = grpcEntities.events.map(entityKey);
    assert.deepEqual(grpcEntityKeys, restEntityKeys);

    const restTaskKeys = restTasks.events.map(taskKey);
    const grpcTaskKeys = grpcTasks.events.map(taskKey);
    assert.deepEqual(grpcTaskKeys, restTaskKeys);

    const firstGrpcTaskEvent = grpcTasks.events[0];
    const firstRestTaskEvent = restTasks.events[0];
    assert.ok(firstGrpcTaskEvent && firstGrpcTaskEvent.event.kind === 'task');
    assert.ok(firstRestTaskEvent && firstRestTaskEvent.event.kind === 'task');
    assert.equal(firstGrpcTaskEvent.event.task.read_only, true);
    assert.equal(firstRestTaskEvent.event.task.read_only, true);
    assert.equal(objects[0]?.entity_id, 'entity-1');
  } finally {
    grpcAdapter.close();
    await grpcServer.stop();
    await restServer.stop();
    await wait(25);
  }
});
