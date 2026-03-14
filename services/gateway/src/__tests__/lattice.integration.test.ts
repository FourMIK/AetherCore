import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { createServer as createHttpServer } from 'node:http';
import { createServer as createTcpServer } from 'node:net';
import * as path from 'node:path';

const gatewayDistEntry = path.resolve(process.cwd(), 'dist/index.js');

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

async function waitForGatewayReady(baseUrl: string, timeoutMs = 15000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${baseUrl}/health`);
      if (response.ok) {
        return;
      }
    } catch {
      // retry
    }
    await wait(100);
  }
  throw new Error('Gateway readiness timeout');
}

async function stopGatewayProcess(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.killed) {
    return;
  }
  const exited = new Promise<void>((resolve) => child.once('exit', () => resolve()));
  child.kill('SIGTERM');
  await Promise.race([exited, wait(5000)]);
  if (child.exitCode === null && !child.killed) {
    child.kill('SIGKILL');
  }
}

async function startGateway(
  token: string,
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
      LATTICE_GATEWAY_INTERNAL_TOKEN: token,
      ...envOverrides,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  await waitForGatewayReady(baseUrl);
  return { child, baseUrl };
}

async function startIdentityRegistryServer(): Promise<{
  baseUrl: string;
  stop: () => Promise<void>;
}> {
  const port = await getAvailablePort();
  const httpServer = createHttpServer(async (req, res) => {
    if (req.method === 'POST' && req.url === '/aethercore.identity.IdentityRegistry/IsNodeEnrolled') {
      res.statusCode = 200;
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ success: true, is_enrolled: true }));
      return;
    }
    res.statusCode = 404;
    res.end('not found');
  });

  await new Promise<void>((resolve, reject) => {
    httpServer.once('error', reject);
    httpServer.listen(port, '127.0.0.1', () => resolve());
  });

  return {
    baseUrl: `http://127.0.0.1:${port}`,
    stop: async () => {
      await new Promise<void>((resolve, reject) => {
        httpServer.close((error) => {
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

async function startBridgeModeServer(internalToken: string): Promise<{
  modeUrl: string;
  scenarioStatusUrl: string;
  scenarioControlUrl: string;
  stop: () => Promise<void>;
}> {
  const port = await getAvailablePort();
  let mode: Record<string, unknown> = {
    schema_version: 'lattice.mode.status.v1',
    integration_mode: 'stealth_readonly',
    input_mode: 'synthetic',
    effective_profile: 'stealth_readonly_synthetic',
    allowed_profiles: ['stealth_readonly_synthetic', 'stealth_readonly_live'],
    last_mode_change_at_ms: Date.now(),
    read_only: true,
  };
  let scenario: Record<string, unknown> = {
    schema_version: 'lattice.scenario.status.v1',
    scenario_id: 'sf_bay_maritime_incursion_v1',
    phase_id: 'phase_0_baseline',
    phase_label: 'Phase 0 - Baseline Patrol',
    phase_index: 0,
    manual_mode: true,
    run_state: 'active',
    scenario_ready: true,
    integration_mode: 'stealth_readonly',
    input_mode: 'synthetic',
    effective_profile: 'stealth_readonly_synthetic',
    active_faults: [],
    deterministic_seed: 'AETHERCORE-STABLE-SEED-001',
    last_transition_at_ms: Date.now(),
    run_started_at_ms: Date.now(),
    last_event_at_ms: Date.now(),
    preflight: {
      services_healthy: true,
      ingest_active: true,
      freshness_within_threshold: true,
      checklist: [],
    },
  };

  const server = createHttpServer(async (req, res) => {
    if (req.url === '/api/lattice/mode' && req.method === 'GET') {
      res.statusCode = 200;
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify(mode));
      return;
    }

    if (req.url === '/api/lattice/mode' && req.method === 'POST') {
      const token = req.headers['x-aethercore-lattice-token'];
      const headerToken = Array.isArray(token) ? token[0] : token;
      if (headerToken !== internalToken) {
        res.statusCode = 401;
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ status: 'error', code: 'UNAUTHORIZED' }));
        return;
      }

      const chunks: Buffer[] = [];
      for await (const chunk of req) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      }
      const bodyText = Buffer.concat(chunks).toString('utf8');
      const body = bodyText ? (JSON.parse(bodyText) as Record<string, unknown>) : {};
      const profile =
        body.profile === 'stealth_readonly_live' ? 'stealth_readonly_live' : 'stealth_readonly_synthetic';
      mode = {
        ...mode,
        input_mode: profile === 'stealth_readonly_live' ? 'live' : 'synthetic',
        effective_profile: profile,
        changed_by_admin_node_id:
          typeof body.changed_by_admin_node_id === 'string' ? body.changed_by_admin_node_id : undefined,
        reason: typeof body.reason === 'string' ? body.reason : undefined,
        last_mode_change_at_ms: Date.now(),
      };

      res.statusCode = 200;
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ status: 'ok', mode }));
      return;
    }

    if (req.url === '/api/lattice/scenario/status' && req.method === 'GET') {
      res.statusCode = 200;
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify(scenario));
      return;
    }

    if (req.url === '/api/lattice/scenario/control' && req.method === 'POST') {
      const token = req.headers['x-aethercore-lattice-token'];
      const headerToken = Array.isArray(token) ? token[0] : token;
      if (headerToken !== internalToken) {
        res.statusCode = 401;
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ status: 'error', code: 'UNAUTHORIZED' }));
        return;
      }

      const chunks: Buffer[] = [];
      for await (const chunk of req) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      }
      const bodyText = Buffer.concat(chunks).toString('utf8');
      const body = bodyText ? (JSON.parse(bodyText) as Record<string, unknown>) : {};
      const action = typeof body.action === 'string' ? body.action : '';
      const phaseId = typeof body.phase_id === 'string' ? body.phase_id : undefined;
      const faultId = typeof body.fault_id === 'string' ? body.fault_id : undefined;
      if (action === 'set_phase' && phaseId) {
        scenario = {
          ...scenario,
          phase_id: phaseId,
          phase_label: phaseId,
          last_transition_at_ms: Date.now(),
        };
      }
      if (action === 'inject_fault' && faultId) {
        const faults = new Set<string>((scenario.active_faults as string[]) || []);
        faults.add(faultId);
        scenario = {
          ...scenario,
          active_faults: Array.from(faults),
          last_transition_at_ms: Date.now(),
        };
      }

      if (action === 'clear_fault') {
        scenario = {
          ...scenario,
          active_faults: [],
          last_transition_at_ms: Date.now(),
        };
      }

      res.statusCode = 200;
      res.setHeader('content-type', 'application/json');
      res.end(
        JSON.stringify({
          schema_version: 'lattice.scenario.control.response.v1',
          status: 'ok',
          scenario,
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
    modeUrl: `http://127.0.0.1:${port}/api/lattice/mode`,
    scenarioStatusUrl: `http://127.0.0.1:${port}/api/lattice/scenario/status`,
    scenarioControlUrl: `http://127.0.0.1:${port}/api/lattice/scenario/control`,
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

test('ingests lattice event and exposes read-only lattice APIs', async () => {
  const token = 'lattice-token-test';
  const { child, baseUrl } = await startGateway(token);

  try {
    const inboundEvent = {
      schema_version: 'lattice.inbound.event.v1',
      source_protocol: 'rest',
      event_id: 'rest:entity:entity-1:101',
      stream_id: 'lattice:entity:entity-1',
      received_at_ms: Date.now(),
      event: {
        kind: 'entity',
        projection: {
          schema_version: 'lattice.entity.projection.v1',
          entity_id: 'entity-1',
          source: 'lattice',
          source_update_time_ms: 101,
          event_type: 'UPSERT',
          verification_status: 'VERIFIED',
          received_at_ms: Date.now(),
          raw_entity: { id: 'entity-1' },
          overlay: {
            schema: 'aethercore.verification.v1',
            entity_id: 'entity-1',
            verification_status: 'VERIFIED',
            trust_score: 0.95,
            byzantine_faults: [],
            merkle_event_hash: 'abc',
            merkle_prev_hash: 'genesis',
            signature_valid: true,
            evaluated_at_ms: Date.now(),
            evidence_object_ids: ['obj-1'],
            aethercore_version: '0.2.0',
            source: 'aethercore',
          },
        },
      },
    };

    const ingestResponse = await fetch(`${baseUrl}/internal/lattice/events`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-aethercore-lattice-token': token,
      },
      body: JSON.stringify(inboundEvent),
    });
    assert.equal(ingestResponse.status, 202);

    const taskEvent = {
      schema_version: 'lattice.inbound.event.v1',
      source_protocol: 'rest',
      event_id: 'rest:task:task-1:7',
      stream_id: 'lattice:task:agent-1',
      received_at_ms: Date.now(),
      event: {
        kind: 'task',
        task: {
          schema_version: 'lattice.task.inbox.v1',
          task_id: 'task-1',
          assigned_agent_id: 'agent-1',
          status: 'QUEUED',
          status_version: 7,
          freshness_ms: 5,
          trust_posture: 'trusted',
          read_only: true,
          raw_task: { id: 'task-1' },
          received_at_ms: Date.now(),
        },
      },
    };

    const taskResponse = await fetch(`${baseUrl}/internal/lattice/events`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-aethercore-lattice-token': token,
      },
      body: JSON.stringify(taskEvent),
    });
    assert.equal(taskResponse.status, 202);

    const tasks = await fetch(`${baseUrl}/api/lattice/tasks`);
    assert.equal(tasks.status, 200);
    const tasksBody = (await tasks.json()) as { count: number; tasks: Array<{ task_id: string; read_only: boolean }> };
    assert.equal(tasksBody.count, 1);
    assert.equal(tasksBody.tasks[0].task_id, 'task-1');
    assert.equal(tasksBody.tasks[0].read_only, true);

    const verification = await fetch(`${baseUrl}/api/lattice/entities/entity-1/verification`);
    assert.equal(verification.status, 200);
    const verificationBody = (await verification.json()) as { overlay: { verification_status: string } };
    assert.equal(verificationBody.overlay.verification_status, 'VERIFIED');

    const status = await fetch(`${baseUrl}/api/lattice/status`);
    assert.equal(status.status, 200);
    const statusBody = (await status.json()) as { tasks_cached: number; integration_mode: string };
    assert.equal(typeof statusBody.tasks_cached, 'number');
    assert.ok(statusBody.tasks_cached >= 1);
    assert.equal(typeof statusBody.integration_mode, 'string');
  } finally {
    await stopGatewayProcess(child);
  }
});

test('rejects lattice ingest when internal token is missing', async () => {
  const token = 'lattice-token-test';
  const { child, baseUrl } = await startGateway(token);
  try {
    const response = await fetch(`${baseUrl}/internal/lattice/events`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        schema_version: 'lattice.inbound.event.v1',
        source_protocol: 'rest',
        event_id: 'event',
        stream_id: 'stream',
        received_at_ms: Date.now(),
        event: {
          kind: 'task',
          task: {
            schema_version: 'lattice.task.inbox.v1',
            task_id: 'task-1',
            assigned_agent_id: 'agent-1',
            status: 'QUEUED',
            status_version: 1,
            freshness_ms: 0,
            trust_posture: 'unknown',
            read_only: true,
            raw_task: {},
            received_at_ms: Date.now(),
          },
        },
      }),
    });
    assert.equal(response.status, 401);
  } finally {
    await stopGatewayProcess(child);
  }
});

test('lattice mode mutation is admin-only and fail-visible', async () => {
  const token = 'lattice-token-test';
  const identity = await startIdentityRegistryServer();
  const bridgeMode = await startBridgeModeServer(token);
  const { child, baseUrl } = await startGateway(token, {
    AETHERCORE_ADMIN_NODE_IDS: 'admin-node-1',
    IDENTITY_REGISTRY_HTTP_ENDPOINT: identity.baseUrl,
    LATTICE_BRIDGE_MODE_URL: bridgeMode.modeUrl,
  });

  try {
    const unauthorized = await fetch(`${baseUrl}/api/lattice/mode`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        admin_node_id: 'not-admin',
        profile: 'stealth_readonly_live',
        reason: 'unauthorized-attempt',
      }),
    });
    assert.equal(unauthorized.status, 403);
    const unauthorizedBody = (await unauthorized.json()) as { code?: string };
    assert.equal(unauthorizedBody.code, 'ADMIN_UNAUTHORIZED');
  } finally {
    await stopGatewayProcess(child);
    await bridgeMode.stop();
    await identity.stop();
  }
});

test('lattice mode mutation proxies to bridge for authorized admins', async () => {
  const token = 'lattice-token-test';
  const identity = await startIdentityRegistryServer();
  const bridgeMode = await startBridgeModeServer(token);
  const { child, baseUrl } = await startGateway(token, {
    AETHERCORE_ADMIN_NODE_IDS: 'admin-node-1',
    IDENTITY_REGISTRY_HTTP_ENDPOINT: identity.baseUrl,
    LATTICE_BRIDGE_MODE_URL: bridgeMode.modeUrl,
  });

  try {
    const switchResponse = await fetch(`${baseUrl}/api/lattice/mode`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        admin_node_id: 'admin-node-1',
        profile: 'stealth_readonly_live',
        reason: 'authorized-switch',
      }),
    });
    assert.equal(switchResponse.status, 200);
    const switchBody = (await switchResponse.json()) as {
      status: string;
      mode?: { effective_profile?: string; input_mode?: string };
    };
    assert.equal(switchBody.status, 'ok');
    assert.equal(switchBody.mode?.effective_profile, 'stealth_readonly_live');
    assert.equal(switchBody.mode?.input_mode, 'live');

    const modeResponse = await fetch(`${baseUrl}/api/lattice/mode`);
    assert.equal(modeResponse.status, 200);
    const modeBody = (await modeResponse.json()) as {
      status: string;
      mode?: { effective_profile?: string };
    };
    assert.equal(modeBody.status, 'ok');
    assert.equal(modeBody.mode?.effective_profile, 'stealth_readonly_live');
  } finally {
    await stopGatewayProcess(child);
    await bridgeMode.stop();
    await identity.stop();
  }
});

test('lattice scenario status and preflight expose bridge-backed readiness state', async () => {
  const token = 'lattice-token-test';
  const bridgeMode = await startBridgeModeServer(token);
  const { child, baseUrl } = await startGateway(token, {
    LATTICE_BRIDGE_SCENARIO_STATUS_URL: bridgeMode.scenarioStatusUrl,
  });

  try {
    const scenarioStatus = await fetch(`${baseUrl}/api/lattice/scenario/status`);
    assert.equal(scenarioStatus.status, 200);
    const scenarioBody = (await scenarioStatus.json()) as {
      status: string;
      scenario?: { scenario_id?: string; phase_id?: string; scenario_ready?: boolean };
    };
    assert.equal(scenarioBody.status, 'ok');
    assert.equal(scenarioBody.scenario?.scenario_id, 'sf_bay_maritime_incursion_v1');
    assert.equal(scenarioBody.scenario?.phase_id, 'phase_0_baseline');
    assert.equal(scenarioBody.scenario?.scenario_ready, true);

    const preflight = await fetch(`${baseUrl}/api/lattice/scenario/preflight`);
    assert.equal(preflight.status, 200);
    const preflightBody = (await preflight.json()) as {
      status: string;
      scenario_ready?: boolean;
      preflight?: { services_healthy?: boolean; ingest_active?: boolean; freshness_within_threshold?: boolean };
    };
    assert.equal(preflightBody.status, 'ok');
    assert.equal(preflightBody.scenario_ready, true);
    assert.equal(preflightBody.preflight?.services_healthy, true);
    assert.equal(preflightBody.preflight?.ingest_active, true);
    assert.equal(preflightBody.preflight?.freshness_within_threshold, true);
  } finally {
    await stopGatewayProcess(child);
    await bridgeMode.stop();
  }
});
