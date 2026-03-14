import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import pino from 'pino';
import { LatticeStateStore } from '../store';
import type { LatticeEntityProjectionV1 } from '../types';

function createStore(): { store: LatticeStateStore; dataDir: string; cleanup: () => void } {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aethercore-lattice-bridge-test-'));
  const logger = pino({ enabled: false });
  const store = new LatticeStateStore(dataDir, logger);
  return {
    store,
    dataDir,
    cleanup: () => {
      store.close();
      fs.rmSync(dataDir, { recursive: true, force: true });
    },
  };
}

test('entity dedupe key is scoped by (entity_id, source_update_time, source)', () => {
  const { store, cleanup } = createStore();
  try {
    assert.equal(store.hasEntityUpdate('entity-1', 100, 'rest:lattice'), false);
    store.recordEntityUpdate('entity-1', 100, 'rest:lattice');
    assert.equal(store.hasEntityUpdate('entity-1', 100, 'rest:lattice'), true);
    assert.equal(store.hasEntityUpdate('entity-1', 100, 'grpc:lattice'), false);

    assert.equal(store.getLatestEntitySourceUpdateTime('entity-1', 'rest:lattice'), 100);
    assert.equal(store.getLatestEntitySourceUpdateTime('entity-1', 'grpc:lattice'), null);

    store.recordEntityUpdate('entity-1', 120, 'grpc:lattice');
    assert.equal(store.getLatestEntitySourceUpdateTime('entity-1', 'grpc:lattice'), 120);
    assert.equal(store.getLatestEntitySourceUpdateTime('entity-1', 'rest:lattice'), 100);
  } finally {
    cleanup();
  }
});

test('entity overlay round-trips through durable store', () => {
  const { store, cleanup } = createStore();
  try {
    const projection: LatticeEntityProjectionV1 = {
      schema_version: 'lattice.entity.projection.v1',
      entity_id: 'entity-overlay-1',
      source: 'lattice',
      source_update_time_ms: 200,
      event_type: 'UPSERT',
      verification_status: 'STATUS_UNVERIFIED',
      received_at_ms: Date.now(),
      raw_entity: { id: 'entity-overlay-1' },
      overlay: {
        schema: 'aethercore.verification.v1',
        entity_id: 'entity-overlay-1',
        verification_status: 'STATUS_UNVERIFIED',
        trust_score: 0.4,
        byzantine_faults: [],
        merkle_event_hash: 'hash-1',
        merkle_prev_hash: 'GENESIS',
        signature_valid: true,
        evaluated_at_ms: Date.now(),
        evidence_object_ids: [],
        aethercore_version: '0.2.0',
        source: 'aethercore',
      },
    };

    store.upsertEntityBinding(projection);
    const savedOverlay = store.getEntityOverlay('entity-overlay-1');

    assert.ok(savedOverlay);
    assert.equal(savedOverlay?.entity_id, 'entity-overlay-1');
    assert.equal(savedOverlay?.verification_status, 'STATUS_UNVERIFIED');
    assert.equal(savedOverlay?.signature_valid, true);
  } finally {
    cleanup();
  }
});

test('runtime mode state persists and updates in durable store', () => {
  const { store, cleanup } = createStore();
  try {
    assert.equal(store.getRuntimeMode(), null);

    store.setRuntimeMode({
      inputMode: 'synthetic',
      changedAtMs: 1700000000000,
      changedByAdminNodeId: 'admin-node-a',
      reason: 'initial_bootstrap',
    });

    const first = store.getRuntimeMode();
    assert.ok(first);
    assert.equal(first?.inputMode, 'synthetic');
    assert.equal(first?.changedAtMs, 1700000000000);
    assert.equal(first?.changedByAdminNodeId, 'admin-node-a');
    assert.equal(first?.reason, 'initial_bootstrap');

    store.setRuntimeMode({
      inputMode: 'live',
      changedAtMs: 1700000000100,
      changedByAdminNodeId: 'admin-node-b',
      reason: 'operator_switch',
    });

    const second = store.getRuntimeMode();
    assert.ok(second);
    assert.equal(second?.inputMode, 'live');
    assert.equal(second?.changedAtMs, 1700000000100);
    assert.equal(second?.changedByAdminNodeId, 'admin-node-b');
    assert.equal(second?.reason, 'operator_switch');
  } finally {
    cleanup();
  }
});
