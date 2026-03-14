import fs from 'node:fs';
import path from 'node:path';
import type pino from 'pino';
import type {
  AethercoreVerificationOverlayV1,
  LatticeInputMode,
  LatticeEntityProjectionV1,
  LatticeScenarioRuntimeState,
  LatticeObjectRecordV1,
  LatticeTaskInboxItemV1,
  ProtocolName,
  RuntimeModeState,
} from './types';

type SqliteDatabase = {
  exec: (sql: string) => void;
  close?: () => void;
  prepare: (sql: string) => {
    run: (...params: unknown[]) => { changes: number };
    get: (...params: unknown[]) => Record<string, unknown> | undefined;
    all: (...params: unknown[]) => Record<string, unknown>[];
  };
};

type SqliteModule = {
  DatabaseSync: new (file: string) => SqliteDatabase;
};

// Node 22 includes node:sqlite; type surface is intentionally narrowed above.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const sqlite = require('node:sqlite') as SqliteModule;

export interface StreamCursorState {
  cursor: string | null;
  lastEventTsMs: number;
  lastHash: string | null;
}

export class LatticeStateStore {
  private readonly db: SqliteDatabase;

  constructor(dataDir: string, logger: pino.Logger) {
    fs.mkdirSync(dataDir, { recursive: true });
    const dbPath = path.join(dataDir, 'lattice-bridge.db');
    this.db = new sqlite.DatabaseSync(dbPath);
    this.db.exec('PRAGMA journal_mode = WAL;');
    this.db.exec('PRAGMA synchronous = NORMAL;');
    this.ensureSchema();
    logger.info({ db_path: dbPath }, 'Lattice durable store initialized');
  }

  private ensureSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS lattice_entity_binding (
        entity_id TEXT PRIMARY KEY,
        lattice_entity_id TEXT NOT NULL,
        source TEXT NOT NULL,
        source_update_time_ms INTEGER NOT NULL,
        verification_status TEXT NOT NULL,
        raw_entity_json TEXT NOT NULL DEFAULT '{}',
        overlay_json TEXT NOT NULL,
        received_at_ms INTEGER NOT NULL DEFAULT 0,
        updated_at_ms INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS lattice_entity_dedupe (
        entity_id TEXT NOT NULL,
        source_update_time_ms INTEGER NOT NULL,
        source TEXT NOT NULL,
        created_at_ms INTEGER NOT NULL,
        PRIMARY KEY (entity_id, source_update_time_ms, source)
      );

      CREATE TABLE IF NOT EXISTS lattice_stream_cursor (
        protocol TEXT NOT NULL,
        stream_name TEXT NOT NULL,
        cursor TEXT,
        last_event_ts_ms INTEGER NOT NULL,
        last_hash TEXT,
        PRIMARY KEY (protocol, stream_name)
      );

      CREATE TABLE IF NOT EXISTS lattice_task_inbox (
        task_id TEXT PRIMARY KEY,
        assigned_agent_id TEXT NOT NULL,
        status TEXT NOT NULL,
        status_version INTEGER NOT NULL,
        trust_posture TEXT NOT NULL,
        freshness_ms INTEGER NOT NULL,
        payload_json TEXT NOT NULL,
        received_at_ms INTEGER NOT NULL,
        updated_at_ms INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS lattice_object_registry (
        object_id TEXT PRIMARY KEY,
        entity_id TEXT NOT NULL,
        object_key TEXT,
        media_type TEXT,
        ttl_seconds INTEGER,
        metadata_json TEXT NOT NULL,
        created_at_ms INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS lattice_sync_audit (
        audit_id INTEGER PRIMARY KEY AUTOINCREMENT,
        direction TEXT NOT NULL,
        operation TEXT NOT NULL,
        protocol TEXT NOT NULL,
        status TEXT NOT NULL,
        message TEXT NOT NULL,
        event_id TEXT,
        created_at_ms INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS lattice_dead_letter (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        source TEXT NOT NULL,
        reason TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        created_at_ms INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS lattice_runtime_mode (
        mode_id INTEGER PRIMARY KEY CHECK (mode_id = 1),
        input_mode TEXT NOT NULL,
        changed_at_ms INTEGER NOT NULL,
        changed_by_admin_node_id TEXT,
        reason TEXT
      );

      CREATE TABLE IF NOT EXISTS lattice_scenario_state (
        state_id INTEGER PRIMARY KEY CHECK (state_id = 1),
        scenario_id TEXT NOT NULL,
        phase_id TEXT NOT NULL,
        phase_index INTEGER NOT NULL,
        run_state TEXT NOT NULL,
        active_faults_json TEXT NOT NULL,
        last_transition_at_ms INTEGER,
        run_started_at_ms INTEGER,
        last_event_at_ms INTEGER,
        updated_at_ms INTEGER NOT NULL
      );
    `);

    this.addColumnIfMissing(
      'lattice_entity_binding',
      'raw_entity_json',
      `TEXT NOT NULL DEFAULT '{}'`,
    );
    this.addColumnIfMissing(
      'lattice_entity_binding',
      'received_at_ms',
      'INTEGER NOT NULL DEFAULT 0',
    );
  }

  private addColumnIfMissing(tableName: string, columnName: string, columnDefinition: string): void {
    const columns = this.db.prepare(`PRAGMA table_info(${tableName})`).all();
    const hasColumn = columns.some((column) => String(column.name) === columnName);
    if (!hasColumn) {
      this.db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${columnDefinition};`);
    }
  }

  upsertEntityBinding(projection: LatticeEntityProjectionV1): void {
    const overlay = projection.overlay || null;
    this.db
      .prepare(`
        INSERT INTO lattice_entity_binding (
          entity_id, lattice_entity_id, source, source_update_time_ms, verification_status, raw_entity_json, overlay_json, received_at_ms, updated_at_ms
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(entity_id) DO UPDATE SET
          lattice_entity_id=excluded.lattice_entity_id,
          source=excluded.source,
          source_update_time_ms=excluded.source_update_time_ms,
          verification_status=excluded.verification_status,
          raw_entity_json=excluded.raw_entity_json,
          overlay_json=excluded.overlay_json,
          received_at_ms=excluded.received_at_ms,
          updated_at_ms=excluded.updated_at_ms
      `)
      .run(
        projection.entity_id,
        projection.entity_id,
        projection.source,
        projection.source_update_time_ms,
        projection.verification_status,
        JSON.stringify(projection.raw_entity || {}),
        JSON.stringify(overlay),
        projection.received_at_ms,
        Date.now(),
      );
  }

  listEntityBindings(limit = 250): LatticeEntityProjectionV1[] {
    const rows = this.db
      .prepare(
        `
        SELECT
          entity_id,
          source,
          source_update_time_ms,
          verification_status,
          raw_entity_json,
          overlay_json,
          received_at_ms
        FROM lattice_entity_binding
        ORDER BY source_update_time_ms DESC
        LIMIT ?
      `,
      )
      .all(Math.max(1, Math.min(1000, limit)));

    return rows
      .map((row) => this.toEntityProjection(row))
      .filter((projection): projection is LatticeEntityProjectionV1 => projection !== null);
  }

  getEntityBinding(entityId: string): LatticeEntityProjectionV1 | null {
    const row = this.db
      .prepare(
        `
        SELECT
          entity_id,
          source,
          source_update_time_ms,
          verification_status,
          raw_entity_json,
          overlay_json,
          received_at_ms
        FROM lattice_entity_binding
        WHERE entity_id = ?
      `,
      )
      .get(entityId);
    return this.toEntityProjection(row || null);
  }

  getEntitySourceUpdateTime(entityId: string): number | null {
    const row = this.db
      .prepare('SELECT source_update_time_ms FROM lattice_entity_binding WHERE entity_id = ?')
      .get(entityId);
    if (!row || typeof row.source_update_time_ms !== 'number') {
      return null;
    }
    return row.source_update_time_ms;
  }

  getLatestEntitySourceUpdateTime(entityId: string, source: string): number | null {
    const row = this.db
      .prepare(
        `
        SELECT MAX(source_update_time_ms) AS max_source_update_time_ms
        FROM lattice_entity_dedupe
        WHERE entity_id = ? AND source = ?
      `,
      )
      .get(entityId, source);

    return typeof row?.max_source_update_time_ms === 'number' ? row.max_source_update_time_ms : null;
  }

  hasEntityUpdate(entityId: string, sourceUpdateTimeMs: number, source: string): boolean {
    const row = this.db
      .prepare(
        `
        SELECT 1 AS found
        FROM lattice_entity_dedupe
        WHERE entity_id = ? AND source_update_time_ms = ? AND source = ?
      `,
      )
      .get(entityId, sourceUpdateTimeMs, source);
    return row?.found === 1;
  }

  recordEntityUpdate(entityId: string, sourceUpdateTimeMs: number, source: string): void {
    this.db
      .prepare(
        `
        INSERT INTO lattice_entity_dedupe (entity_id, source_update_time_ms, source, created_at_ms)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(entity_id, source_update_time_ms, source) DO NOTHING
      `,
      )
      .run(entityId, sourceUpdateTimeMs, source, Date.now());
  }

  getEntityOverlay(entityId: string): AethercoreVerificationOverlayV1 | null {
    const row = this.db.prepare('SELECT overlay_json FROM lattice_entity_binding WHERE entity_id = ?').get(entityId);
    if (!row || typeof row.overlay_json !== 'string' || row.overlay_json === 'null') {
      return null;
    }
    try {
      return JSON.parse(row.overlay_json) as AethercoreVerificationOverlayV1;
    } catch {
      return null;
    }
  }

  upsertStreamCursor(protocol: ProtocolName, streamName: string, cursor: StreamCursorState): void {
    this.db
      .prepare(`
        INSERT INTO lattice_stream_cursor (protocol, stream_name, cursor, last_event_ts_ms, last_hash)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(protocol, stream_name) DO UPDATE SET
          cursor=excluded.cursor,
          last_event_ts_ms=excluded.last_event_ts_ms,
          last_hash=excluded.last_hash
      `)
      .run(protocol, streamName, cursor.cursor, cursor.lastEventTsMs, cursor.lastHash);
  }

  getStreamCursor(protocol: ProtocolName, streamName: string): StreamCursorState | null {
    const row = this.db
      .prepare('SELECT cursor, last_event_ts_ms, last_hash FROM lattice_stream_cursor WHERE protocol = ? AND stream_name = ?')
      .get(protocol, streamName);
    if (!row || typeof row.last_event_ts_ms !== 'number') {
      return null;
    }
    return {
      cursor: typeof row.cursor === 'string' ? row.cursor : null,
      lastEventTsMs: row.last_event_ts_ms,
      lastHash: typeof row.last_hash === 'string' ? row.last_hash : null,
    };
  }

  upsertTask(task: LatticeTaskInboxItemV1): void {
    this.db
      .prepare(`
        INSERT INTO lattice_task_inbox (
          task_id, assigned_agent_id, status, status_version, trust_posture, freshness_ms, payload_json, received_at_ms, updated_at_ms
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(task_id) DO UPDATE SET
          assigned_agent_id=excluded.assigned_agent_id,
          status=excluded.status,
          status_version=excluded.status_version,
          trust_posture=excluded.trust_posture,
          freshness_ms=excluded.freshness_ms,
          payload_json=excluded.payload_json,
          received_at_ms=excluded.received_at_ms,
          updated_at_ms=excluded.updated_at_ms
      `)
      .run(
        task.task_id,
        task.assigned_agent_id,
        task.status,
        task.status_version,
        task.trust_posture,
        task.freshness_ms,
        JSON.stringify(task),
        task.received_at_ms,
        Date.now(),
      );
  }

  listTasks(limit = 100): LatticeTaskInboxItemV1[] {
    const rows = this.db
      .prepare(`
        SELECT payload_json FROM lattice_task_inbox
        ORDER BY updated_at_ms DESC
        LIMIT ?
      `)
      .all(limit);
    return rows
      .map((row) => {
        if (typeof row.payload_json !== 'string') {
          return null;
        }
        try {
          return JSON.parse(row.payload_json) as LatticeTaskInboxItemV1;
        } catch {
          return null;
        }
      })
      .filter((task): task is LatticeTaskInboxItemV1 => task !== null);
  }

  upsertObjectRecord(record: LatticeObjectRecordV1): void {
    this.db
      .prepare(`
        INSERT INTO lattice_object_registry (
          object_id, entity_id, object_key, media_type, ttl_seconds, metadata_json, created_at_ms
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(object_id) DO UPDATE SET
          entity_id=excluded.entity_id,
          object_key=excluded.object_key,
          media_type=excluded.media_type,
          ttl_seconds=excluded.ttl_seconds,
          metadata_json=excluded.metadata_json
      `)
      .run(
        record.object_id,
        record.entity_id,
        record.object_key || null,
        record.media_type || null,
        record.ttl_seconds || null,
        JSON.stringify(record.metadata || {}),
        record.created_at_ms,
      );
  }

  listObjectsForEntity(entityId: string): LatticeObjectRecordV1[] {
    const rows = this.db
      .prepare(`
        SELECT object_id, entity_id, object_key, media_type, ttl_seconds, metadata_json, created_at_ms
        FROM lattice_object_registry
        WHERE entity_id = ?
        ORDER BY created_at_ms DESC
      `)
      .all(entityId);

    return rows.map((row) => this.toObjectRecord(row));
  }

  listObjects(limit = 100): LatticeObjectRecordV1[] {
    const rows = this.db
      .prepare(
        `
        SELECT object_id, entity_id, object_key, media_type, ttl_seconds, metadata_json, created_at_ms
        FROM lattice_object_registry
        ORDER BY created_at_ms DESC
        LIMIT ?
      `,
      )
      .all(Math.max(1, Math.min(500, limit)));

    return rows.map((row) => this.toObjectRecord(row));
  }

  getObjectById(objectId: string): LatticeObjectRecordV1 | null {
    const row = this.db
      .prepare(
        `
        SELECT object_id, entity_id, object_key, media_type, ttl_seconds, metadata_json, created_at_ms
        FROM lattice_object_registry
        WHERE object_id = ?
      `,
      )
      .get(objectId);

    if (!row) {
      return null;
    }
    return this.toObjectRecord(row);
  }

  setRuntimeMode(mode: RuntimeModeState): void {
    this.db
      .prepare(
        `
        INSERT INTO lattice_runtime_mode (
          mode_id, input_mode, changed_at_ms, changed_by_admin_node_id, reason
        ) VALUES (1, ?, ?, ?, ?)
        ON CONFLICT(mode_id) DO UPDATE SET
          input_mode=excluded.input_mode,
          changed_at_ms=excluded.changed_at_ms,
          changed_by_admin_node_id=excluded.changed_by_admin_node_id,
          reason=excluded.reason
      `,
      )
      .run(mode.inputMode, mode.changedAtMs, mode.changedByAdminNodeId || null, mode.reason || null);
  }

  getRuntimeMode(): RuntimeModeState | null {
    const row = this.db
      .prepare(
        `
        SELECT input_mode, changed_at_ms, changed_by_admin_node_id, reason
        FROM lattice_runtime_mode
        WHERE mode_id = 1
      `,
      )
      .get();

    if (!row || typeof row.changed_at_ms !== 'number') {
      return null;
    }

    const rawInputMode = String(row.input_mode).toLowerCase();
    const normalizedInputMode = rawInputMode === 'live' ? 'live' : 'synthetic';
    return {
      inputMode: normalizedInputMode as LatticeInputMode,
      changedAtMs: row.changed_at_ms,
      changedByAdminNodeId:
        typeof row.changed_by_admin_node_id === 'string' ? row.changed_by_admin_node_id : undefined,
      reason: typeof row.reason === 'string' ? row.reason : undefined,
    };
  }

  setScenarioState(state: LatticeScenarioRuntimeState): void {
    this.db
      .prepare(
        `
        INSERT INTO lattice_scenario_state (
          state_id,
          scenario_id,
          phase_id,
          phase_index,
          run_state,
          active_faults_json,
          last_transition_at_ms,
          run_started_at_ms,
          last_event_at_ms,
          updated_at_ms
        ) VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(state_id) DO UPDATE SET
          scenario_id=excluded.scenario_id,
          phase_id=excluded.phase_id,
          phase_index=excluded.phase_index,
          run_state=excluded.run_state,
          active_faults_json=excluded.active_faults_json,
          last_transition_at_ms=excluded.last_transition_at_ms,
          run_started_at_ms=excluded.run_started_at_ms,
          last_event_at_ms=excluded.last_event_at_ms,
          updated_at_ms=excluded.updated_at_ms
      `,
      )
      .run(
        state.scenarioId,
        state.phaseId,
        state.phaseIndex,
        state.runState,
        JSON.stringify(state.activeFaults || []),
        state.lastTransitionAtMs,
        state.runStartedAtMs,
        state.lastEventAtMs,
        Date.now(),
      );
  }

  getScenarioState(): LatticeScenarioRuntimeState | null {
    const row = this.db
      .prepare(
        `
        SELECT
          scenario_id,
          phase_id,
          phase_index,
          run_state,
          active_faults_json,
          last_transition_at_ms,
          run_started_at_ms,
          last_event_at_ms
        FROM lattice_scenario_state
        WHERE state_id = 1
      `,
      )
      .get();

    if (!row) {
      return null;
    }

    let faults: string[] = [];
    if (typeof row.active_faults_json === 'string') {
      try {
        const parsed = JSON.parse(row.active_faults_json) as unknown;
        if (Array.isArray(parsed)) {
          faults = parsed.filter((item): item is string => typeof item === 'string');
        }
      } catch {
        faults = [];
      }
    }

    return {
      scenarioId: String(row.scenario_id),
      phaseId: String(row.phase_id),
      phaseIndex: Number(row.phase_index),
      runState: String(row.run_state) === 'active' ? 'active' : 'ready',
      activeFaults: faults,
      lastTransitionAtMs: typeof row.last_transition_at_ms === 'number' ? row.last_transition_at_ms : null,
      runStartedAtMs: typeof row.run_started_at_ms === 'number' ? row.run_started_at_ms : null,
      lastEventAtMs: typeof row.last_event_at_ms === 'number' ? row.last_event_at_ms : null,
    };
  }

  private toObjectRecord(row: Record<string, unknown>): LatticeObjectRecordV1 {
    let metadata: Record<string, unknown> = {};
    if (typeof row.metadata_json === 'string') {
      try {
        metadata = JSON.parse(row.metadata_json) as Record<string, unknown>;
      } catch {
        metadata = {};
      }
    }

    return {
      schema_version: 'lattice.object.record.v1',
      object_id: String(row.object_id),
      entity_id: String(row.entity_id),
      object_key: typeof row.object_key === 'string' ? row.object_key : undefined,
      media_type: typeof row.media_type === 'string' ? row.media_type : undefined,
      ttl_seconds: typeof row.ttl_seconds === 'number' ? row.ttl_seconds : undefined,
      metadata,
      created_at_ms: Number(row.created_at_ms),
    };
  }

  private toEntityProjection(row: Record<string, unknown> | null): LatticeEntityProjectionV1 | null {
    if (!row) {
      return null;
    }

    let rawEntity: Record<string, unknown> = {};
    if (typeof row.raw_entity_json === 'string') {
      try {
        const parsed = JSON.parse(row.raw_entity_json) as unknown;
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          rawEntity = parsed as Record<string, unknown>;
        }
      } catch {
        rawEntity = {};
      }
    }

    let overlay: AethercoreVerificationOverlayV1 | undefined;
    if (typeof row.overlay_json === 'string' && row.overlay_json !== 'null') {
      try {
        const parsed = JSON.parse(row.overlay_json) as unknown;
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          overlay = parsed as AethercoreVerificationOverlayV1;
        }
      } catch {
        overlay = undefined;
      }
    }

    const verification = String(row.verification_status).toUpperCase();
    const verificationStatus =
      verification === 'VERIFIED' || verification === 'SPOOFED' ? verification : 'STATUS_UNVERIFIED';

    return {
      schema_version: 'lattice.entity.projection.v1',
      entity_id: String(row.entity_id),
      source: String(row.source || 'lattice'),
      source_update_time_ms: Number(row.source_update_time_ms || 0),
      event_type: 'UPSERT',
      verification_status: verificationStatus,
      received_at_ms: Number(row.received_at_ms || 0),
      raw_entity: rawEntity,
      overlay,
    };
  }

  recordSyncAudit(
    direction: 'inbound' | 'outbound',
    operation: string,
    protocol: string,
    status: 'ok' | 'error',
    message: string,
    eventId?: string,
  ): void {
    this.db
      .prepare(`
        INSERT INTO lattice_sync_audit (direction, operation, protocol, status, message, event_id, created_at_ms)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `)
      .run(direction, operation, protocol, status, message, eventId || null, Date.now());
  }

  recordDeadLetter(source: string, reason: string, payload: unknown): void {
    this.db
      .prepare(`
        INSERT INTO lattice_dead_letter (source, reason, payload_json, created_at_ms)
        VALUES (?, ?, ?, ?)
      `)
      .run(source, reason, JSON.stringify(payload), Date.now());
  }

  getDeadLetterCount(): number {
    const row = this.db.prepare('SELECT COUNT(*) AS count FROM lattice_dead_letter').get();
    return typeof row?.count === 'number' ? row.count : 0;
  }

  getLatestAuditTimestampMs(): number | null {
    const row = this.db.prepare('SELECT MAX(created_at_ms) AS max_ts FROM lattice_sync_audit').get();
    return typeof row?.max_ts === 'number' ? row.max_ts : null;
  }

  close(): void {
    this.db.close?.();
  }
}
