import assert from 'node:assert/strict';
import * as http from 'node:http';
import { after, before, beforeEach, describe, it } from 'node:test';

import {
  DistributedRevocationRegistry,
  evaluateRevocationGate,
} from '../revocation';

let server: http.Server;
let baseUrl = '';
let currentPayload: unknown = {};

describe('distributed revocation registry', () => {
  before(async () => {
    server = http.createServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(currentPayload));
    });

    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', () => resolve());
    });

    const address = server.address();
    if (!address || typeof address === 'string') {
      throw new Error('Failed to bind revocation test server');
    }
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  after(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  });

  beforeEach(() => {
    currentPayload = {
      revoked_nodes: {},
      last_updated_ns: Date.now() * 1_000_000,
    };
  });

  it('loads sovereign revocation certificates from gospel-state payload', async () => {
    currentPayload = {
      revoked_nodes: {
        'ralphie-node-1': {
          node_id: 'ralphie-node-1',
          certificate_serial: 'AA:BB:CC:11',
          revocation_reason: 'ByzantineDetection',
          issuer_id: 'federation-1',
          timestamp_ns: 123456,
          signature: 'deadbeef',
          merkle_root: 'cafebabe',
        },
      },
      last_updated_ns: 123456,
    };

    const registry = new DistributedRevocationRegistry({
      sourceUrl: `${baseUrl}/revocations`,
      refreshIntervalMs: 15000,
      requestTimeoutMs: 2000,
    });

    const summary = await registry.refresh();
    assert.ok(summary);
    assert.equal(summary.revokedNodeCount, 1);
    assert.equal(summary.revokedCertificateCount, 1);

    const byNode = registry.checkIdentity('ralphie-node-1');
    assert.equal(byNode.revoked, true);

    const bySerial = registry.checkIdentity('another-node', 'aabbcc11');
    assert.equal(bySerial.revoked, true);
  });

  it('tracks propagation updates after source changes', async () => {
    const registry = new DistributedRevocationRegistry({
      sourceUrl: `${baseUrl}/revocations`,
      refreshIntervalMs: 15000,
      requestTimeoutMs: 2000,
    });

    currentPayload = {
      revoked_nodes: {},
      last_updated_ns: 1000,
    };
    await registry.refresh();
    assert.equal(registry.checkIdentity('ralphie-node-2').revoked, false);

    currentPayload = {
      revocations: [
        {
          node_id: 'ralphie-node-2',
          revocation_reason: 'OperatorOverride',
          certificate_serial: '99ff01',
        },
      ],
      last_updated_ns: 2000,
    };
    const summary = await registry.refresh();
    assert.ok(summary);
    assert.equal(summary.revokedNodeCount, 1);
    assert.equal(registry.checkIdentity('ralphie-node-2').revoked, true);
  });

  it('rejects identities across simulated process restarts after sync', async () => {
    currentPayload = {
      revoked_nodes: {
        'ralphie-node-3': {
          node_id: 'ralphie-node-3',
          revocation_reason: 'IdentityCollapse',
        },
      },
      last_updated_ns: 3000,
    };

    const firstRegistry = new DistributedRevocationRegistry({
      sourceUrl: `${baseUrl}/revocations`,
      refreshIntervalMs: 15000,
      requestTimeoutMs: 2000,
    });
    await firstRegistry.refresh();
    assert.equal(firstRegistry.checkIdentity('ralphie-node-3').revoked, true);

    const restartedRegistry = new DistributedRevocationRegistry({
      sourceUrl: `${baseUrl}/revocations`,
      refreshIntervalMs: 15000,
      requestTimeoutMs: 2000,
    });
    await restartedRegistry.refresh();
    assert.equal(restartedRegistry.checkIdentity('ralphie-node-3').revoked, true);
  });

  it('fails closed when revocation source is configured but unsynchronized', () => {
    const registry = new DistributedRevocationRegistry({
      sourceUrl: `${baseUrl}/revocations`,
      refreshIntervalMs: 15000,
      requestTimeoutMs: 2000,
    });

    const gate = evaluateRevocationGate(registry, {
      nodeId: 'ralphie-node-4',
      failClosed: true,
    });

    assert.equal(gate.ok, false);
    if (!gate.ok) {
      assert.equal(gate.code, 'REVOCATION_UNAVAILABLE');
    }
  });
});
