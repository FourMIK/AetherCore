import fs from 'node:fs';
import path from 'node:path';
import express, { type Request, type Response } from 'express';
import dotenv from 'dotenv';
import pino from 'pino';
import { blake3 } from 'hash-wasm';
import { z } from 'zod';
import type {
  AethercoreVerificationOverlayV1,
  AdapterPullResult,
  AdapterHealth,
  BridgeConfig,
  EffectiveModeState,
  GrpcTransportMode,
  LatticeBridgeStatusV1,
  LatticeEntityDisplayV1,
  LatticeInputMode,
  LatticeModeStatusV1,
  LatticeScenarioControlRequestV1,
  LatticeScenarioControlResponseV1,
  LatticeScenarioStatusV1,
  LatticeScenarioRuntimeState,
  LatticeStealthProfile,
  LatticeEntityProjectionV1,
  LatticeInboundEventV1,
  LatticeObjectRecordV1,
  LatticeTaskInboxItemV1,
  RuntimeModeState,
  RuntimeMetrics,
} from './types';
import { loadConfig } from './config';
import { LatticeStateStore } from './store';
import { OAuthTokenManager } from './token-manager';
import { LatticeRestAdapter } from './rest-adapter';
import { LatticeGrpcAdapter } from './grpc-adapter';
import { LatticeSyntheticAdapter } from './synthetic-adapter';

dotenv.config();

const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  formatters: {
    level: (label: string) => ({ level: label }),
  },
  ...(process.env.NODE_ENV === 'production'
    ? {}
    : { transport: { target: 'pino-pretty', options: { colorize: true } } }),
});

const OverlaySchema = z.object({
  schema: z.literal('aethercore.verification.v1'),
  entity_id: z.string().min(1),
  verification_status: z.enum(['VERIFIED', 'STATUS_UNVERIFIED', 'SPOOFED']),
  trust_score: z.number().min(0).max(1),
  byzantine_faults: z.array(z.string()),
  merkle_event_hash: z.string().min(1),
  merkle_prev_hash: z.string().min(1),
  signature_valid: z.boolean(),
  evaluated_at_ms: z.number().int().positive(),
  evidence_object_ids: z.array(z.string()),
  aethercore_version: z.string().min(1),
  source: z.literal('aethercore'),
});

const OverlayPublishRequestSchema = z.object({
  source_update_time_ms: z.number().int().positive(),
  overlay: OverlaySchema,
});

const ObjectRegisterSchema = z.object({
  object_id: z.string().min(1),
  entity_id: z.string().min(1),
  object_key: z.string().optional(),
  media_type: z.string().optional(),
  ttl_seconds: z.number().int().positive().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

const ObjectUploadSchema = ObjectRegisterSchema.extend({
  content_base64: z.string().min(1).optional(),
  filename: z.string().min(1).optional(),
});

const LatticeInputModeSchema = z.enum(['synthetic', 'live']);
const LatticeStealthProfileSchema = z.enum(['stealth_readonly_synthetic', 'stealth_readonly_live']);
const LatticeScenarioControlActionSchema = z.enum([
  'set_phase',
  'advance',
  'revert',
  'reset',
  'inject_fault',
  'clear_fault',
]);

const SetModeRequestSchema = z
  .object({
    profile: LatticeStealthProfileSchema.optional(),
    input_mode: LatticeInputModeSchema.optional(),
    changed_by_admin_node_id: z.string().trim().min(1).optional(),
    reason: z.string().trim().min(1).max(256).optional(),
  })
  .refine((value) => value.profile !== undefined || value.input_mode !== undefined, {
    message: 'Either profile or input_mode is required',
    path: ['profile'],
  });

const ScenarioControlRequestSchema = z.object({
  schema_version: z.literal('lattice.scenario.control.request.v1').optional(),
  action: LatticeScenarioControlActionSchema,
  phase_id: z.string().trim().min(1).optional(),
  fault_id: z.string().trim().min(1).optional(),
  changed_by_admin_node_id: z.string().trim().min(1).optional(),
  reason: z.string().trim().min(1).max(256).optional(),
});

const STEALTH_PROFILES: LatticeStealthProfile[] = ['stealth_readonly_synthetic', 'stealth_readonly_live'];

const latticeStateByEntity = new Map<string, {
  lastHash: string;
  lastSourceUpdateTimeMs: number;
}>();

function profileForInputMode(inputMode: LatticeInputMode): LatticeStealthProfile {
  return inputMode === 'live' ? 'stealth_readonly_live' : 'stealth_readonly_synthetic';
}

function inputModeFromProfile(profile: LatticeStealthProfile): LatticeInputMode {
  return profile === 'stealth_readonly_live' ? 'live' : 'synthetic';
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b));
  return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`).join(',')}}`;
}

function pickString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === 'string' && value.trim().length > 0) {
      return value.trim();
    }
  }
  return undefined;
}

function pickNumber(...values: unknown[]): number | undefined {
  for (const value of values) {
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value;
    }
    if (typeof value === 'string' && value.trim().length > 0) {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) {
        return parsed;
      }
    }
  }
  return undefined;
}

function trustScoreFromOverlay(overlay: AethercoreVerificationOverlayV1 | undefined): number {
  if (!overlay) {
    return 0.35;
  }
  if (typeof overlay.trust_score === 'number' && Number.isFinite(overlay.trust_score)) {
    return Math.max(0, Math.min(1, overlay.trust_score));
  }
  return overlay.verification_status === 'VERIFIED'
    ? 0.92
    : overlay.verification_status === 'SPOOFED'
      ? 0.01
      : 0.35;
}

function sourceBadgeFromSource(source: string): 'Lattice Synthetic' | 'Lattice Live' | 'Gateway Telemetry' {
  const normalized = source.toLowerCase();
  if (normalized.includes('synthetic')) {
    return 'Lattice Synthetic';
  }
  if (normalized.includes('lattice')) {
    return 'Lattice Live';
  }
  return 'Gateway Telemetry';
}

function toEntityDisplay(
  projection: LatticeEntityProjectionV1,
  evidence: LatticeObjectRecordV1[],
): LatticeEntityDisplayV1 {
  const raw = projection.raw_entity || {};
  const location =
    (raw.location && typeof raw.location === 'object'
      ? (raw.location as Record<string, unknown>)
      : undefined) || raw;
  const lat = pickNumber(location.lat, location.latitude);
  const lon = pickNumber(location.lon, location.longitude, location.lng);
  const altitude = pickNumber(location.altitude_m, location.alt_m, location.altitude);
  const source = projection.source || 'lattice';
  const overlay = projection.overlay;
  const evidenceObjectIds = overlay?.evidence_object_ids?.length
    ? overlay.evidence_object_ids
    : evidence.map((record) => record.object_id);

  return {
    schema_version: 'lattice.entity.display.v1',
    entity_id: projection.entity_id,
    title: pickString(raw.title, raw.name, raw.callsign, projection.entity_id) || projection.entity_id,
    domain: pickString(raw.domain, raw.classification, 'unknown') || 'unknown',
    entity_type: pickString(raw.type, raw.entity_type, raw.entityType, 'UNKNOWN') || 'UNKNOWN',
    source,
    source_badge: sourceBadgeFromSource(source),
    verification_status: projection.verification_status,
    trust_score: trustScoreFromOverlay(overlay),
    freshness_ms: Math.max(0, Date.now() - projection.source_update_time_ms),
    last_update_ms: projection.source_update_time_ms,
    position:
      typeof lat === 'number' && typeof lon === 'number'
        ? {
            lat,
            lon,
            altitude_m: altitude,
          }
        : undefined,
    speed_mps: pickNumber(raw.speed_mps, raw.speedMps),
    heading_deg: pickNumber(raw.heading_deg, raw.headingDeg),
    status_label: pickString(raw.status, raw.track_status, raw.trackStatus),
    read_only_actions: true,
    overlay,
    evidence_object_ids: evidenceObjectIds,
    raw_entity: raw,
  };
}

function ensureDirectoryExists(directoryPath: string): void {
  fs.mkdirSync(directoryPath, { recursive: true });
}

function deriveVerificationStatus(
  projection: LatticeEntityProjectionV1,
  metrics: RuntimeMetrics,
): {
  status: 'VERIFIED' | 'STATUS_UNVERIFIED' | 'SPOOFED';
  signatureValid: boolean;
  byzantineFaults: string[];
} {
  const entity = projection.raw_entity;
  const signatureValid =
    typeof entity.signature_valid === 'boolean'
      ? entity.signature_valid
      : typeof entity.signatureValid === 'boolean'
        ? entity.signatureValid
        : typeof entity.signature === 'string' && entity.signature.trim().length > 0;

  if (!signatureValid) {
    metrics.invalidSignatures += 1;
    return {
      status: 'SPOOFED',
      signatureValid: false,
      byzantineFaults: ['InvalidSignature'],
    };
  }

  if (projection.verification_status === 'SPOOFED') {
    return {
      status: 'SPOOFED',
      signatureValid: true,
      byzantineFaults: ['ExternalSpoofSignal'],
    };
  }

  if (projection.verification_status === 'VERIFIED') {
    return {
      status: 'VERIFIED',
      signatureValid: true,
      byzantineFaults: [],
    };
  }

  return {
    status: 'STATUS_UNVERIFIED',
    signatureValid: true,
    byzantineFaults: [],
  };
}

async function computeMerkleHash(payload: Record<string, unknown>, prevHash: string): Promise<string> {
  const canonical = stableStringify({ payload, prev_hash: prevHash });
  return blake3(canonical);
}

function normalizeOverlay(
  projection: LatticeEntityProjectionV1,
  verificationStatus: 'VERIFIED' | 'STATUS_UNVERIFIED' | 'SPOOFED',
  signatureValid: boolean,
  byzantineFaults: string[],
  merkleEventHash: string,
  merklePrevHash: string,
): AethercoreVerificationOverlayV1 {
  const existing = projection.overlay;
  if (existing && existing.schema === 'aethercore.verification.v1') {
    return {
      ...existing,
      verification_status: verificationStatus,
      signature_valid: signatureValid,
      byzantine_faults: byzantineFaults,
      merkle_event_hash: merkleEventHash,
      merkle_prev_hash: merklePrevHash,
      evaluated_at_ms: Date.now(),
      source: 'aethercore',
    };
  }

  return {
    schema: 'aethercore.verification.v1',
    entity_id: projection.entity_id,
    verification_status: verificationStatus,
    trust_score: verificationStatus === 'VERIFIED' ? 0.92 : verificationStatus === 'SPOOFED' ? 0.0 : 0.35,
    byzantine_faults: byzantineFaults,
    merkle_event_hash: merkleEventHash,
    merkle_prev_hash: merklePrevHash,
    signature_valid: signatureValid,
    evaluated_at_ms: Date.now(),
    evidence_object_ids: [],
    aethercore_version: '0.2.0',
    source: 'aethercore',
  };
}

function getEventKey(event: LatticeInboundEventV1): string {
  switch (event.event.kind) {
    case 'entity':
      return `entity:${event.event.projection.entity_id}:${event.event.projection.source_update_time_ms}`;
    case 'task':
      return `task:${event.event.task.task_id}:${event.event.task.status_version}`;
    case 'object':
      return `object:${event.event.object.object_id}:${event.event.object.created_at_ms}`;
    default:
      return event.event_id;
  }
}

async function postToGateway(config: BridgeConfig, event: LatticeInboundEventV1): Promise<void> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (config.gatewayInternalToken) {
    headers['x-aethercore-lattice-token'] = config.gatewayInternalToken;
  }

  const response = await fetch(config.gatewayInternalUrl, {
    method: 'POST',
    headers,
    body: JSON.stringify(event),
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Gateway ingest failed (${response.status}): ${text.slice(0, 256)}`);
  }
}

function missingLiveConfig(config: BridgeConfig): string[] {
  const missing: string[] = [];
  if (!config.latticeBaseUrl) {
    missing.push('LATTICE_BASE_URL');
  }
  if (!config.latticeClientId) {
    missing.push('LATTICE_CLIENT_ID');
  }
  if (!config.latticeClientSecret) {
    missing.push('LATTICE_CLIENT_SECRET');
  }
  if (!config.latticeAgentId) {
    missing.push('LATTICE_AGENT_ID');
  }
  if (config.sandboxMode && !config.sandboxesToken) {
    missing.push('SANDBOXES_TOKEN');
  }
  return missing;
}

async function bootstrap(): Promise<void> {
  const config = loadConfig();
  ensureDirectoryExists(config.dataDir);

  const store = new LatticeStateStore(config.dataDir, logger);
  const persistedRuntimeMode = store.getRuntimeMode();
  const persistedScenarioState = store.getScenarioState();
  let runtimeMode: RuntimeModeState =
    persistedRuntimeMode || {
      inputMode: config.defaultInputMode,
      changedAtMs: Date.now(),
      reason: 'bootstrap_default',
    };
  if (!persistedRuntimeMode) {
    store.setRuntimeMode(runtimeMode);
  }

  if (runtimeMode.inputMode === 'live') {
    const missing = missingLiveConfig(config);
    if (missing.length > 0) {
      throw new Error(`Cannot start in live input mode without credentials: ${missing.join(', ')}`);
    }
  }

  const metrics: RuntimeMetrics = {
    streamReconnects: 0,
    tokenRefreshSuccess: 0,
    tokenRefreshFailures: 0,
    mismatches: 0,
    invalidSignatures: 0,
    deadLetters: 0,
  };

  const tokenManager = new OAuthTokenManager(
    config,
    logger,
    () => {
      metrics.tokenRefreshSuccess += 1;
    },
    () => {
      metrics.tokenRefreshFailures += 1;
    },
  );

  const syntheticAdapter = new LatticeSyntheticAdapter(
    config,
    logger.child({ adapter: 'synthetic' }),
    persistedScenarioState || undefined,
  );
  if (!persistedScenarioState) {
    store.setScenarioState(syntheticAdapter.state);
  }
  const restAdapter = new LatticeRestAdapter(config, tokenManager, logger.child({ adapter: 'rest' }));
  const grpcAdapter =
    config.protocolMode === 'grpc' || config.protocolMode === 'hybrid'
      ? new LatticeGrpcAdapter(config, tokenManager, logger.child({ adapter: 'grpc' }))
      : null;
  const app = express();
  app.use(express.json({ limit: '2mb' }));

  let lastSyncAtMs: number | null = null;
  let syncInFlight = false;
  const grpcDisabledHealth: AdapterHealth = {
    healthy: false,
    lastSuccessAtMs: null,
    lastFailureAtMs: null,
    lastError: 'gRPC adapter disabled',
  };

  const currentGrpcHealth = (): AdapterHealth => grpcAdapter?.health || grpcDisabledHealth;
  const currentRestHealth = (): AdapterHealth =>
    currentEffectiveMode().inputMode === 'synthetic' ? syntheticAdapter.health : restAdapter.health;
  const currentGrpcTransportMode = (): GrpcTransportMode | undefined =>
    grpcAdapter ? grpcAdapter.transportMode : undefined;
  const currentGrpcTargetConfigured = (): boolean => !!config.grpcTarget;
  const currentEffectiveMode = (): EffectiveModeState => ({
    integrationMode: config.integrationMode,
    inputMode: runtimeMode.inputMode,
    changedAtMs: runtimeMode.changedAtMs,
    changedByAdminNodeId: runtimeMode.changedByAdminNodeId,
    reason: runtimeMode.reason,
    effectiveProfile: profileForInputMode(runtimeMode.inputMode),
  });
  const currentModeStatus = (): LatticeModeStatusV1 => {
    const effective = currentEffectiveMode();
    return {
      schema_version: 'lattice.mode.status.v1',
      integration_mode: effective.integrationMode,
      input_mode: effective.inputMode,
      effective_profile: effective.effectiveProfile,
      allowed_profiles: STEALTH_PROFILES,
      last_mode_change_at_ms: effective.changedAtMs,
      read_only: true,
      changed_by_admin_node_id: effective.changedByAdminNodeId,
      reason: effective.reason,
    };
  };

  const currentScenarioState = (): LatticeScenarioRuntimeState => syntheticAdapter.state;

  const currentScenarioStatus = (): LatticeScenarioStatusV1 => {
    const effective = currentEffectiveMode();
    const scenarioState = currentScenarioState();
    const scenarioPhase = syntheticAdapter.phases[scenarioState.phaseIndex] || syntheticAdapter.phases[0];
    const freshnessMs = lastSyncAtMs ? Date.now() - lastSyncAtMs : Number.POSITIVE_INFINITY;
    const servicesHealthy = currentRestHealth().healthy;
    const ingestActive = Number.isFinite(freshnessMs) && freshnessMs <= config.pollIntervalMs * 6;
    const freshnessWithinThreshold = Number.isFinite(freshnessMs) && freshnessMs <= config.pollIntervalMs * 4;
    const checklist = [
      {
        id: 'bridge_sync',
        label: 'Bridge ingest loop active',
        ok: ingestActive,
        detail: ingestActive ? 'Event ingest is active.' : 'No recent ingest heartbeat observed.',
      },
      {
        id: 'rest_health',
        label: 'REST adapter health',
        ok: servicesHealthy,
        detail: servicesHealthy
          ? 'REST ingress path is healthy.'
          : currentRestHealth().lastError || 'REST path degraded.',
      },
      {
        id: 'stealth_posture',
        label: 'Stealth read-only posture',
        ok: config.integrationMode === 'stealth_readonly' && !config.allowOutboundWrites,
        detail: config.integrationMode === 'stealth_readonly'
          ? 'Outbound writes hard-blocked.'
          : 'Integration mode is not stealth_readonly.',
      },
      {
        id: 'manual_phase_control',
        label: 'Manual phase control engaged',
        ok: true,
        detail: `Current phase ${scenarioPhase.phaseLabel}.`,
      },
    ];

    return {
      schema_version: 'lattice.scenario.status.v1',
      scenario_id: scenarioState.scenarioId,
      phase_id: scenarioState.phaseId,
      phase_label: scenarioPhase.phaseLabel,
      phase_index: scenarioState.phaseIndex,
      manual_mode: true,
      run_state: scenarioState.runState,
      scenario_ready:
        effective.inputMode === 'synthetic' &&
        checklist.every((item) => item.ok) &&
        freshnessWithinThreshold,
      integration_mode: effective.integrationMode,
      input_mode: effective.inputMode,
      effective_profile: effective.effectiveProfile,
      active_faults: [...scenarioState.activeFaults],
      deterministic_seed: config.syntheticSeed,
      last_transition_at_ms: scenarioState.lastTransitionAtMs,
      run_started_at_ms: scenarioState.runStartedAtMs,
      last_event_at_ms: scenarioState.lastEventAtMs,
      preflight: {
        services_healthy: servicesHealthy,
        ingest_active: ingestActive,
        freshness_within_threshold: freshnessWithinThreshold,
        checklist,
      },
    };
  };

  const persistScenarioState = (): void => {
    store.setScenarioState(currentScenarioState());
  };

  const requireInternalToken = (req: Request, res: Response): boolean => {
    if (!config.gatewayInternalToken) {
      return true;
    }
    const presented = req.headers['x-aethercore-lattice-token'];
    const headerToken = Array.isArray(presented) ? presented[0] : presented;
    if (headerToken === config.gatewayInternalToken) {
      return true;
    }
    res.status(401).json({
      status: 'error',
      code: 'UNAUTHORIZED',
      message: 'Invalid lattice internal token',
    });
    return false;
  };

  const blockStealthWrite = (
    res: Response,
    operation: string,
    message: string,
    eventId?: string,
  ): boolean => {
    if (config.allowOutboundWrites) {
      return false;
    }

    const reason = `${operation}_blocked:stealth_readonly`;
    store.recordSyncAudit('outbound', operation, 'rest', 'error', reason, eventId);
    res.status(403).json({
      status: 'error',
      code: 'STEALTH_READ_ONLY',
      message,
    });
    return true;
  };

  const updateCursor = (protocol: 'rest' | 'grpc' | 'synthetic', streamName: string, cursorHint?: string): void => {
    if (!cursorHint) {
      return;
    }
    const existing = store.getStreamCursor(protocol, streamName);
    const next = {
      cursor: cursorHint,
      lastEventTsMs: Date.now(),
      lastHash: existing?.lastHash || null,
    };
    store.upsertStreamCursor(protocol, streamName, next);
  };

  const processInboundEvent = async (event: LatticeInboundEventV1): Promise<void> => {
    if (event.event.kind === 'entity') {
      const projection = event.event.projection;
      const dedupeSource = projection.source || 'lattice';
      const seen = store.hasEntityUpdate(projection.entity_id, projection.source_update_time_ms, dedupeSource);
      if (seen) {
        const reason = `duplicate_entity_update:${projection.entity_id}:${projection.source_update_time_ms}:${dedupeSource}`;
        store.recordSyncAudit('inbound', 'entity_dedupe', event.source_protocol, 'error', reason, event.event_id);
        store.recordDeadLetter('entity', reason, projection);
        metrics.deadLetters += 1;
        return;
      }

      const lastSourceUpdate = store.getLatestEntitySourceUpdateTime(projection.entity_id, dedupeSource);
      if (lastSourceUpdate !== null && projection.source_update_time_ms < lastSourceUpdate) {
        const reason = `stale_or_out_of_order_update:${projection.source_update_time_ms}<${lastSourceUpdate}:${dedupeSource}`;
        store.recordSyncAudit('inbound', 'entity_dedupe', event.source_protocol, 'error', reason, event.event_id);
        store.recordDeadLetter('entity', reason, projection);
        metrics.deadLetters += 1;
        return;
      }

      const state = latticeStateByEntity.get(projection.entity_id);
      const prevHash = state?.lastHash || 'GENESIS';
      const verification = deriveVerificationStatus(projection, metrics);
      const eventHash = await computeMerkleHash(projection.raw_entity, prevHash);
      const overlay = normalizeOverlay(
        projection,
        verification.status,
        verification.signatureValid,
        verification.byzantineFaults,
        eventHash,
        prevHash,
      );

      const projected: LatticeEntityProjectionV1 = {
        ...projection,
        verification_status: verification.status,
        overlay,
      };

      store.upsertEntityBinding(projected);
      latticeStateByEntity.set(projected.entity_id, {
        lastHash: eventHash,
        lastSourceUpdateTimeMs: projected.source_update_time_ms,
      });
      store.recordSyncAudit('inbound', 'entity_projection', event.source_protocol, 'ok', 'entity processed', event.event_id);

      await postToGateway(config, {
        ...event,
        event: { kind: 'entity', projection: projected },
      });
      store.recordEntityUpdate(projected.entity_id, projected.source_update_time_ms, dedupeSource);
      return;
    }

    if (event.event.kind === 'task') {
      const task = event.event.task;
      const normalizedTask: LatticeTaskInboxItemV1 = {
        ...task,
        read_only: true,
      };
      store.upsertTask(normalizedTask);
      store.recordSyncAudit('inbound', 'task_inbox', event.source_protocol, 'ok', 'task ingested', event.event_id);
      await postToGateway(config, {
        ...event,
        event: { kind: 'task', task: normalizedTask },
      });
      return;
    }

    const objectRecord = event.event.object;
    store.upsertObjectRecord(objectRecord);
    store.recordSyncAudit('inbound', 'object_registry', event.source_protocol, 'ok', 'object ingested', event.event_id);
    await postToGateway(config, event);
  };

  const runSyncCycle = async (): Promise<void> => {
    if (syncInFlight) {
      return;
    }
    syncInFlight = true;
    try {
      const results: AdapterPullResult[] = [];
      let restEntityResult: AdapterPullResult | null = null;
      let restTaskResult: AdapterPullResult | null = null;
      let restObjectResult: AdapterPullResult | null = null;
      let grpcEntityResult: AdapterPullResult | null = null;
      let grpcTaskResult: AdapterPullResult | null = null;
      const effectiveMode = currentEffectiveMode();

      const handlePullFailure = (
        protocol: 'rest' | 'grpc' | 'synthetic',
        streamName: 'entity' | 'task' | 'object',
        error: unknown,
      ): void => {
        metrics.streamReconnects += 1;
        const message = error instanceof Error ? error.message : String(error);
        store.recordSyncAudit('inbound', `${protocol}_${streamName}_pull`, protocol, 'error', message);
        logger.error({ protocol, stream: streamName, error: message }, 'Lattice adapter pull failed');
      };

      if (effectiveMode.inputMode === 'synthetic') {
        const entityCursor = store.getStreamCursor('synthetic', 'entity')?.cursor || null;
        const taskCursor = store.getStreamCursor('synthetic', 'task')?.cursor || null;
        const objectCursor = store.getStreamCursor('synthetic', 'object')?.cursor || null;
        const [entityResult, taskResult, objectResult] = await Promise.allSettled([
          syntheticAdapter.pullEntities(entityCursor),
          syntheticAdapter.pullTasks(taskCursor),
          syntheticAdapter.pullObjects(objectCursor),
        ]);

        if (entityResult.status === 'fulfilled') {
          restEntityResult = {
            ...entityResult.value,
            events: entityResult.value.events.filter((event) => event.event.kind === 'entity'),
          };
          results.push(restEntityResult);
          updateCursor('synthetic', 'entity', entityResult.value.cursorHint);
        } else {
          handlePullFailure('synthetic', 'entity', entityResult.reason);
        }

        if (taskResult.status === 'fulfilled') {
          restTaskResult = {
            ...taskResult.value,
            events: taskResult.value.events.filter((event) => event.event.kind === 'task'),
          };
          results.push(restTaskResult);
          updateCursor('synthetic', 'task', taskResult.value.cursorHint);
        } else {
          handlePullFailure('synthetic', 'task', taskResult.reason);
        }

        if (objectResult.status === 'fulfilled') {
          restObjectResult = {
            ...objectResult.value,
            events: objectResult.value.events.filter((event) => event.event.kind === 'object'),
          };
          results.push(restObjectResult);
          updateCursor('synthetic', 'object', objectResult.value.cursorHint);
        } else {
          handlePullFailure('synthetic', 'object', objectResult.reason);
        }

        persistScenarioState();
      } else {
        const missing = missingLiveConfig(config);
        if (missing.length > 0) {
          throw new Error(`Live input mode missing configuration: ${missing.join(', ')}`);
        }

        if (config.protocolMode === 'rest' || config.protocolMode === 'hybrid') {
          const entityCursor = store.getStreamCursor('rest', 'entity')?.cursor || null;
          const taskCursor = store.getStreamCursor('rest', 'task')?.cursor || null;
          const objectCursor = store.getStreamCursor('rest', 'object')?.cursor || null;
          const [entityResult, taskResult, objectResult] = await Promise.allSettled([
            restAdapter.pullEntities(entityCursor),
            restAdapter.pullTasks(taskCursor),
            restAdapter.pullObjects(objectCursor),
          ]);
          if (entityResult.status === 'fulfilled') {
            restEntityResult = {
              ...entityResult.value,
              events: entityResult.value.events.filter((event) => event.event.kind === 'entity'),
            };
            results.push(restEntityResult);
            updateCursor('rest', 'entity', entityResult.value.cursorHint);
          } else {
            handlePullFailure('rest', 'entity', entityResult.reason);
          }

          if (taskResult.status === 'fulfilled') {
            restTaskResult = {
              ...taskResult.value,
              events: taskResult.value.events.filter((event) => event.event.kind === 'task'),
            };
            results.push(restTaskResult);
            updateCursor('rest', 'task', taskResult.value.cursorHint);
          } else {
            handlePullFailure('rest', 'task', taskResult.reason);
          }

          if (objectResult.status === 'fulfilled') {
            restObjectResult = {
              ...objectResult.value,
              events: objectResult.value.events.filter((event) => event.event.kind === 'object'),
            };
            results.push(restObjectResult);
            updateCursor('rest', 'object', objectResult.value.cursorHint);
          } else {
            handlePullFailure('rest', 'object', objectResult.reason);
          }
        }

        if ((config.protocolMode === 'grpc' || config.protocolMode === 'hybrid') && grpcAdapter) {
          const entityCursor = store.getStreamCursor('grpc', 'entity')?.cursor || null;
          const taskCursor = store.getStreamCursor('grpc', 'task')?.cursor || null;
          const [entityResult, taskResult] = await Promise.allSettled([
            grpcAdapter.pullEntities(entityCursor),
            grpcAdapter.pullTasks(taskCursor),
          ]);
          if (entityResult.status === 'fulfilled') {
            grpcEntityResult = {
              ...entityResult.value,
              events: entityResult.value.events.filter((event) => event.event.kind === 'entity'),
            };
            results.push(grpcEntityResult);
            updateCursor('grpc', 'entity', entityResult.value.cursorHint);
          } else {
            handlePullFailure('grpc', 'entity', entityResult.reason);
          }

          if (taskResult.status === 'fulfilled') {
            grpcTaskResult = {
              ...taskResult.value,
              events: taskResult.value.events.filter((event) => event.event.kind === 'task'),
            };
            results.push(grpcTaskResult);
            updateCursor('grpc', 'task', taskResult.value.cursorHint);
          } else {
            handlePullFailure('grpc', 'task', taskResult.reason);
          }
        }
      }

      const hasParityMismatch = (left: AdapterPullResult, right: AdapterPullResult): boolean => {
        const leftKeys = new Set(left.events.map(getEventKey));
        const rightKeys = new Set(right.events.map(getEventKey));
        return leftKeys.size !== rightKeys.size || [...leftKeys].some((key) => !rightKeys.has(key));
      };

      if (effectiveMode.inputMode === 'live' && config.protocolMode === 'hybrid') {
        if (restEntityResult && grpcEntityResult && hasParityMismatch(restEntityResult, grpcEntityResult)) {
          metrics.mismatches += 1;
          store.recordSyncAudit(
            'inbound',
            'protocol_parity',
            'hybrid',
            'error',
            'REST/GRPC entity parity mismatch',
          );
        }

        if (restTaskResult && grpcTaskResult && hasParityMismatch(restTaskResult, grpcTaskResult)) {
          metrics.mismatches += 1;
          store.recordSyncAudit(
            'inbound',
            'protocol_parity',
            'hybrid',
            'error',
            'REST/GRPC task parity mismatch',
          );
        }
      }

      const seen = new Set<string>();
      for (const result of results) {
        for (const event of result.events) {
          const key = getEventKey(event);
          if (seen.has(key)) {
            continue;
          }
          seen.add(key);
          try {
            await processInboundEvent(event);
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            store.recordSyncAudit('inbound', 'event_process', event.source_protocol, 'error', message, event.event_id);
            store.recordDeadLetter('event', message, event);
            metrics.deadLetters += 1;
            logger.error({ event_id: event.event_id, error: message }, 'Failed to process inbound lattice event');
          }
        }
      }

      if (results.length > 0) {
        lastSyncAtMs = Date.now();
      }
    } catch (error) {
      metrics.streamReconnects += 1;
      const modeProtocol = currentEffectiveMode().inputMode === 'synthetic' ? 'synthetic' : config.protocolMode;
      store.recordSyncAudit('inbound', 'sync_cycle', modeProtocol, 'error', String(error));
      logger.error({ error: String(error) }, 'Lattice sync cycle failed');
    } finally {
      syncInFlight = false;
    }
  };

  app.get('/health', (_req: Request, res: Response) => {
    const snapshot = tokenManager.getSnapshot();
    const lag = lastSyncAtMs ? Date.now() - lastSyncAtMs : null;
    const healthy = lag !== null && lag < config.pollIntervalMs * 6;
    const mode = currentEffectiveMode();
    const scenarioStatus = currentScenarioStatus();
    res.status(healthy ? 200 : 503).json({
      status: healthy ? 'ok' : 'degraded',
      service: 'lattice-bridge',
      integration_mode: mode.integrationMode,
      input_mode: mode.inputMode,
      effective_profile: mode.effectiveProfile,
      last_mode_change_at_ms: mode.changedAtMs,
      protocol_mode: config.protocolMode,
      grpc_transport_mode: currentGrpcTransportMode(),
      grpc_target_configured: currentGrpcTargetConfigured(),
      last_sync_at_ms: lastSyncAtMs,
      sync_lag_ms: lag,
      token_expires_at_ms: snapshot.expiresAtMs,
      rest_healthy: currentRestHealth().healthy,
      grpc_healthy: currentGrpcHealth().healthy,
      scenario_id: scenarioStatus.scenario_id,
      phase_id: scenarioStatus.phase_id,
      phase_label: scenarioStatus.phase_label,
      manual_mode: scenarioStatus.manual_mode,
      scenario_ready: scenarioStatus.scenario_ready,
    });
  });

  app.get('/api/lattice/status', (_req: Request, res: Response) => {
    const tokenSnapshot = tokenManager.getSnapshot();
    const mode = currentEffectiveMode();
    const scenarioStatus = currentScenarioStatus();
    const status: LatticeBridgeStatusV1 = {
      schema_version: 'lattice.bridge.status.v1',
      integration_mode: mode.integrationMode,
      input_mode: mode.inputMode,
      effective_profile: mode.effectiveProfile,
      last_mode_change_at_ms: mode.changedAtMs,
      healthy: !!lastSyncAtMs && Date.now() - lastSyncAtMs < config.pollIntervalMs * 6,
      protocol_mode: config.protocolMode,
      rest_healthy: currentRestHealth().healthy,
      grpc_healthy: currentGrpcHealth().healthy,
      grpc_transport_mode: currentGrpcTransportMode(),
      grpc_target_configured: currentGrpcTargetConfigured(),
      sandbox_mode: config.sandboxMode,
      scenario_id: scenarioStatus.scenario_id,
      phase_id: scenarioStatus.phase_id,
      phase_label: scenarioStatus.phase_label,
      manual_mode: scenarioStatus.manual_mode,
      scenario_ready: scenarioStatus.scenario_ready,
      scenario_health: {
        active_faults: [...scenarioStatus.active_faults],
        last_transition_at_ms: scenarioStatus.last_transition_at_ms,
        preflight_ok:
          scenarioStatus.preflight.services_healthy &&
          scenarioStatus.preflight.ingest_active &&
          scenarioStatus.preflight.freshness_within_threshold,
      },
      last_sync_at_ms: lastSyncAtMs,
      sync_lag_ms: lastSyncAtMs ? Date.now() - lastSyncAtMs : null,
      token_expires_at_ms: tokenSnapshot.expiresAtMs,
      metrics: {
        stream_reconnects: metrics.streamReconnects,
        token_refresh_success: metrics.tokenRefreshSuccess,
        token_refresh_failures: metrics.tokenRefreshFailures,
        mismatches: metrics.mismatches,
        invalid_signatures: metrics.invalidSignatures,
        dead_letters: Math.max(metrics.deadLetters, store.getDeadLetterCount()),
      },
    };
    res.status(200).json(status);
  });

  app.get('/api/lattice/mode', (_req: Request, res: Response) => {
    res.status(200).json(currentModeStatus());
  });

  app.post('/api/lattice/mode', (req: Request, res: Response) => {
    if (!requireInternalToken(req, res)) {
      return;
    }

    if (config.integrationMode !== 'stealth_readonly') {
      const reason = 'mode_change_blocked:integration_mode_not_stealth_readonly';
      store.recordSyncAudit('inbound', 'mode_change', 'internal', 'error', reason);
      res.status(409).json({
        status: 'error',
        code: 'UNSUPPORTED_INTEGRATION_MODE',
        message: 'Input mode switching is only supported in stealth_readonly integration mode.',
      });
      return;
    }

    const parsed = SetModeRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      store.recordSyncAudit('inbound', 'mode_change', 'internal', 'error', 'mode_change_invalid_payload');
      res.status(400).json({
        status: 'error',
        code: 'INVALID_MODE_REQUEST',
        details: parsed.error.flatten(),
      });
      return;
    }

    const payload = parsed.data;
    const requestedViaInputMode =
      payload.input_mode === 'live' ? 'live' : payload.input_mode ? 'synthetic' : undefined;
    const requestedViaProfile = payload.profile ? inputModeFromProfile(payload.profile) : undefined;
    if (
      requestedViaInputMode &&
      requestedViaProfile &&
      requestedViaInputMode !== requestedViaProfile
    ) {
      const reason = `mode_change_rejected:mismatched_profile_and_input_mode:${payload.profile}:${payload.input_mode}`;
      store.recordSyncAudit('inbound', 'mode_change', 'internal', 'error', reason);
      res.status(400).json({
        status: 'error',
        code: 'MODE_CONFLICT',
        message: 'profile and input_mode must resolve to the same runtime mode',
      });
      return;
    }

    const nextInputMode: LatticeInputMode = requestedViaInputMode || requestedViaProfile || 'synthetic';
    if (nextInputMode === 'live') {
      const missing = missingLiveConfig(config);
      if (missing.length > 0) {
        const reason = `mode_change_rejected:live_config_missing:${missing.join(',')}`;
        store.recordSyncAudit('inbound', 'mode_change', 'internal', 'error', reason);
        res.status(409).json({
          status: 'error',
          code: 'LIVE_CONFIG_MISSING',
          message: `Cannot switch to live mode. Missing: ${missing.join(', ')}`,
          missing,
          mode: currentModeStatus(),
        });
        return;
      }
    }

    const previousMode = runtimeMode.inputMode;
    runtimeMode = {
      inputMode: nextInputMode,
      changedAtMs: Date.now(),
      changedByAdminNodeId: payload.changed_by_admin_node_id,
      reason: payload.reason,
    };
    store.setRuntimeMode(runtimeMode);
    store.recordSyncAudit(
      'inbound',
      'mode_change',
      'internal',
      'ok',
      `mode_changed:${previousMode}->${nextInputMode}`,
    );

    res.status(200).json({
      status: 'ok',
      mode: currentModeStatus(),
    });
  });

  app.get('/api/lattice/tasks', (req: Request, res: Response) => {
    const limit = Math.max(1, Math.min(500, Number.parseInt(String(req.query.limit || '100'), 10) || 100));
    const tasks = store.listTasks(limit);
    res.status(200).json({
      status: 'ok',
      count: tasks.length,
      tasks,
      read_only: true,
      timestamp: Date.now(),
    });
  });

  app.get('/api/lattice/entities', (req: Request, res: Response) => {
    const limit = Math.max(1, Math.min(500, Number.parseInt(String(req.query.limit || '250'), 10) || 250));
    const projections = store.listEntityBindings(limit);
    const entities = projections.map((projection) =>
      toEntityDisplay(projection, store.listObjectsForEntity(projection.entity_id)),
    );
    res.status(200).json({
      status: 'ok',
      count: entities.length,
      entities,
      timestamp: Date.now(),
    });
  });

  app.get('/api/lattice/entities/:entityId', (req: Request, res: Response) => {
    const entityIdParam = req.params.entityId;
    const entityId = Array.isArray(entityIdParam) ? entityIdParam[0] : entityIdParam;
    if (!entityId) {
      res.status(400).json({
        status: 'error',
        code: 'INVALID_ENTITY_ID',
      });
      return;
    }

    const projection = store.getEntityBinding(entityId);
    if (!projection) {
      res.status(404).json({
        status: 'not_found',
        code: 'ENTITY_NOT_FOUND',
        message: `No lattice entity projection found for ${entityId}`,
      });
      return;
    }

    const entity = toEntityDisplay(projection, store.listObjectsForEntity(entityId));
    res.status(200).json({
      status: 'ok',
      entity,
      timestamp: Date.now(),
    });
  });

  app.get('/api/lattice/scenario/status', (_req: Request, res: Response) => {
    res.status(200).json(currentScenarioStatus());
  });

  app.get('/api/lattice/scenario/preflight', (_req: Request, res: Response) => {
    const status = currentScenarioStatus();
    res.status(200).json({
      status: status.scenario_ready ? 'ok' : 'degraded',
      scenario_id: status.scenario_id,
      phase_id: status.phase_id,
      phase_label: status.phase_label,
      checklist: status.preflight.checklist,
      services_healthy: status.preflight.services_healthy,
      ingest_active: status.preflight.ingest_active,
      freshness_within_threshold: status.preflight.freshness_within_threshold,
      timestamp: Date.now(),
    });
  });

  app.post('/api/lattice/scenario/control', (req: Request, res: Response) => {
    if (!requireInternalToken(req, res)) {
      return;
    }

    const parsed = ScenarioControlRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      store.recordSyncAudit('inbound', 'scenario_control', 'internal', 'error', 'invalid_scenario_control_payload');
      res.status(400).json({
        status: 'error',
        code: 'INVALID_SCENARIO_CONTROL_REQUEST',
        details: parsed.error.flatten(),
      });
      return;
    }

    const request = parsed.data as LatticeScenarioControlRequestV1;
    if (currentEffectiveMode().inputMode !== 'synthetic') {
      const response: LatticeScenarioControlResponseV1 = {
        schema_version: 'lattice.scenario.control.response.v1',
        status: 'error',
        code: 'SCENARIO_CONTROL_UNAVAILABLE',
        message: 'Scenario control is only available in stealth synthetic mode.',
        scenario: currentScenarioStatus(),
      };
      store.recordSyncAudit('inbound', 'scenario_control', 'internal', 'error', 'scenario_control_unavailable');
      res.status(409).json(response);
      return;
    }

    let operation: string = request.action;
    let result: { ok: boolean; code?: string; message?: string } = { ok: true };
    if (request.action === 'set_phase') {
      if (!request.phase_id) {
        result = { ok: false, code: 'PHASE_REQUIRED', message: 'phase_id is required for set_phase' };
      } else {
        result = syntheticAdapter.setPhase(request.phase_id);
      }
    } else if (request.action === 'advance') {
      result = syntheticAdapter.advancePhase();
    } else if (request.action === 'revert') {
      result = syntheticAdapter.revertPhase();
    } else if (request.action === 'reset') {
      syntheticAdapter.resetScenario();
    } else if (request.action === 'inject_fault') {
      if (!request.fault_id) {
        result = { ok: false, code: 'FAULT_REQUIRED', message: 'fault_id is required for inject_fault' };
      } else {
        result = syntheticAdapter.injectFault(request.fault_id);
      }
    } else if (request.action === 'clear_fault') {
      result = syntheticAdapter.clearFault(request.fault_id);
    } else {
      operation = 'unknown_action';
      result = { ok: false, code: 'UNKNOWN_ACTION', message: `Unsupported action: ${request.action}` };
    }

    persistScenarioState();

    if (!result.ok) {
      const response: LatticeScenarioControlResponseV1 = {
        schema_version: 'lattice.scenario.control.response.v1',
        status: 'error',
        code: result.code || 'SCENARIO_CONTROL_FAILED',
        message: result.message || 'Scenario control request failed',
        scenario: currentScenarioStatus(),
      };
      store.recordSyncAudit(
        'inbound',
        'scenario_control',
        'internal',
        'error',
        `${operation}_rejected:${response.code}`,
      );
      res.status(409).json(response);
      return;
    }

    store.recordSyncAudit(
      'inbound',
      'scenario_control',
      'internal',
      'ok',
      `${operation}:phase=${currentScenarioState().phaseId}:faults=${currentScenarioState().activeFaults.join('|')}`,
    );
    void runSyncCycle();
    const response: LatticeScenarioControlResponseV1 = {
      schema_version: 'lattice.scenario.control.response.v1',
      status: 'ok',
      scenario: currentScenarioStatus(),
    };
    res.status(200).json(response);
  });

  app.get('/api/lattice/entities/:entityId/verification', (req: Request, res: Response) => {
    const entityIdParam = req.params.entityId;
    const entityId = Array.isArray(entityIdParam) ? entityIdParam[0] : entityIdParam;
    if (!entityId) {
      res.status(400).json({
        status: 'error',
        code: 'INVALID_ENTITY_ID',
      });
      return;
    }
    const overlay = store.getEntityOverlay(entityId);
    if (!overlay) {
      res.status(404).json({
        status: 'not_found',
        message: `No verification overlay found for entity ${entityId}`,
      });
      return;
    }
    const evidence = store.listObjectsForEntity(entityId);
    res.status(200).json({
      status: 'ok',
      entity_id: entityId,
      overlay,
      evidence_objects: evidence,
      timestamp: Date.now(),
    });
  });

  app.post('/api/lattice/entities/:entityId/overlay', async (req: Request, res: Response) => {
    if (
      blockStealthWrite(
        res,
        'overlay_publish',
        'Stealth read-only mode is active. Outbound Lattice overlay publish is disabled.',
      )
    ) {
      return;
    }

    const entityIdParam = req.params.entityId;
    const entityId = Array.isArray(entityIdParam) ? entityIdParam[0] : entityIdParam;
    if (!entityId) {
      res.status(400).json({
        status: 'error',
        code: 'INVALID_ENTITY_ID',
      });
      return;
    }
    const parsed = OverlayPublishRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        status: 'error',
        code: 'INVALID_OVERLAY',
        details: parsed.error.flatten(),
      });
      return;
    }

    const body = parsed.data;
    if (body.overlay.entity_id !== entityId) {
      res.status(400).json({
        status: 'error',
        code: 'ENTITY_MISMATCH',
        message: 'overlay.entity_id must match URL entityId',
      });
      return;
    }

    const current = store.getEntitySourceUpdateTime(entityId);
    if (current !== null && body.source_update_time_ms <= current) {
      const reason = `non_monotonic_source_update_time:${body.source_update_time_ms}<=${current}`;
      store.recordSyncAudit('outbound', 'overlay_publish', 'rest', 'error', reason);
      store.recordDeadLetter('overlay', reason, body);
      metrics.deadLetters += 1;
      res.status(409).json({
        status: 'error',
        code: 'STALE_SOURCE_UPDATE_TIME',
        message: reason,
      });
      return;
    }

    try {
      await restAdapter.publishVerificationOverlay(entityId, body.overlay, body.source_update_time_ms);
      const projection: LatticeEntityProjectionV1 = {
        schema_version: 'lattice.entity.projection.v1',
        entity_id: entityId,
        source: 'aethercore',
        source_update_time_ms: body.source_update_time_ms,
        event_type: 'UPSERT',
        verification_status: body.overlay.verification_status,
        received_at_ms: Date.now(),
        raw_entity: {
          entity_id: entityId,
          components: {
            'aethercore.verification.v1': body.overlay,
          },
        },
        overlay: body.overlay,
      };
      store.upsertEntityBinding(projection);
      store.recordSyncAudit('outbound', 'overlay_publish', 'rest', 'ok', 'overlay published', `overlay:${entityId}`);
      res.status(200).json({
        status: 'ok',
        entity_id: entityId,
        source_update_time_ms: body.source_update_time_ms,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      store.recordSyncAudit('outbound', 'overlay_publish', 'rest', 'error', message, `overlay:${entityId}`);
      store.recordDeadLetter('overlay', message, body);
      metrics.deadLetters += 1;
      res.status(502).json({
        status: 'error',
        code: 'PUBLISH_FAILED',
        message,
      });
    }
  });

  app.get('/api/lattice/objects', async (req: Request, res: Response) => {
    const entityIdQuery = req.query.entity_id ?? req.query.entityId;
    const entityId =
      typeof entityIdQuery === 'string' && entityIdQuery.trim().length > 0 ? entityIdQuery.trim() : undefined;
    const limit = Math.max(1, Math.min(500, Number.parseInt(String(req.query.limit || '100'), 10) || 100));
    const effectiveMode = currentEffectiveMode();

    if (effectiveMode.inputMode === 'synthetic') {
      const records = entityId ? store.listObjectsForEntity(entityId).slice(0, limit) : store.listObjects(limit);
      res.status(200).json({
        status: 'ok',
        source: 'lattice.synthetic',
        count: records.length,
        objects: records,
        timestamp: Date.now(),
      });
      return;
    }

    try {
      const records = await restAdapter.listObjects(entityId, limit);
      records.forEach((record) => store.upsertObjectRecord(record));
      res.status(200).json({
        status: 'ok',
        source: 'lattice',
        count: records.length,
        objects: records,
        timestamp: Date.now(),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const fallback = entityId ? store.listObjectsForEntity(entityId).slice(0, limit) : store.listObjects(limit);
      store.recordSyncAudit('inbound', 'object_list', 'rest', 'error', message);
      res.status(502).json({
        status: 'error',
        code: 'OBJECT_LIST_FAILED',
        message,
        cached_count: fallback.length,
        cached_objects: fallback,
      });
    }
  });

  app.get('/api/lattice/objects/:objectId', async (req: Request, res: Response) => {
    const objectIdParam = req.params.objectId;
    const objectId = Array.isArray(objectIdParam) ? objectIdParam[0] : objectIdParam;
    if (!objectId) {
      res.status(400).json({
        status: 'error',
        code: 'INVALID_OBJECT_ID',
      });
      return;
    }

    const effectiveMode = currentEffectiveMode();
    if (effectiveMode.inputMode === 'synthetic') {
      const object = store.getObjectById(objectId);
      if (!object) {
        res.status(404).json({
          status: 'not_found',
          code: 'OBJECT_NOT_FOUND',
          message: `No cached synthetic object found for ${objectId}`,
        });
        return;
      }
      res.status(200).json({
        status: 'ok',
        object,
        timestamp: Date.now(),
      });
      return;
    }

    try {
      const object = await restAdapter.getObject(objectId);
      res.status(200).json({
        status: 'ok',
        object,
        timestamp: Date.now(),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      store.recordSyncAudit('inbound', 'object_get', 'rest', 'error', message, objectId);
      const cachedObject = store.getObjectById(objectId);
      if (cachedObject) {
        res.status(200).json({
          status: 'ok',
          source: 'cache',
          object: cachedObject,
          warning: message,
          timestamp: Date.now(),
        });
        return;
      }
      res.status(502).json({
        status: 'error',
        code: 'OBJECT_GET_FAILED',
        message,
      });
    }
  });

  app.post('/api/lattice/objects/upload', async (req: Request, res: Response) => {
    if (
      blockStealthWrite(
        res,
        'object_upload',
        'Stealth read-only mode is active. Outbound Lattice object upload is disabled.',
      )
    ) {
      return;
    }

    const parsed = ObjectUploadSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        status: 'error',
        code: 'INVALID_OBJECT_UPLOAD',
        details: parsed.error.flatten(),
      });
      return;
    }

    const body = parsed.data;
    const record: LatticeObjectRecordV1 = {
      schema_version: 'lattice.object.record.v1',
      object_id: body.object_id,
      entity_id: body.entity_id,
      object_key: body.object_key,
      media_type: body.media_type,
      ttl_seconds: body.ttl_seconds,
      metadata: body.metadata,
      created_at_ms: Date.now(),
    };

    const payload: Record<string, unknown> = {
      objectId: body.object_id,
      object_id: body.object_id,
      entityId: body.entity_id,
      entity_id: body.entity_id,
      objectKey: body.object_key,
      object_key: body.object_key,
      mediaType: body.media_type,
      media_type: body.media_type,
      ttlSeconds: body.ttl_seconds,
      ttl_seconds: body.ttl_seconds,
      metadata: body.metadata || {},
      filename: body.filename,
      contentBase64: body.content_base64,
      content_base64: body.content_base64,
    };

    try {
      const response = await restAdapter.uploadObjectPayload(payload);
      store.upsertObjectRecord(record);
      store.recordSyncAudit('outbound', 'object_upload', 'rest', 'ok', 'object uploaded', record.object_id);
      res.status(201).json({
        status: 'ok',
        record,
        upload_response: response,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      store.recordSyncAudit('outbound', 'object_upload', 'rest', 'error', message, record.object_id);
      store.recordDeadLetter('object', message, payload);
      metrics.deadLetters += 1;
      res.status(502).json({
        status: 'error',
        code: 'OBJECT_UPLOAD_FAILED',
        message,
      });
    }
  });

  app.post('/api/lattice/objects/register', async (req: Request, res: Response) => {
    if (
      blockStealthWrite(
        res,
        'object_register',
        'Stealth read-only mode is active. Outbound Lattice object register is disabled.',
      )
    ) {
      return;
    }

    const parsed = ObjectRegisterSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        status: 'error',
        code: 'INVALID_OBJECT_RECORD',
        details: parsed.error.flatten(),
      });
      return;
    }

    const record: LatticeObjectRecordV1 = {
      schema_version: 'lattice.object.record.v1',
      object_id: parsed.data.object_id,
      entity_id: parsed.data.entity_id,
      object_key: parsed.data.object_key,
      media_type: parsed.data.media_type,
      ttl_seconds: parsed.data.ttl_seconds,
      metadata: parsed.data.metadata,
      created_at_ms: Date.now(),
    };

    try {
      await restAdapter.registerObject(record);
      store.upsertObjectRecord(record);
      store.recordSyncAudit('outbound', 'object_register', 'rest', 'ok', 'object registered', record.object_id);
      res.status(200).json({
        status: 'ok',
        record,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      store.recordSyncAudit('outbound', 'object_register', 'rest', 'error', message, record.object_id);
      store.recordDeadLetter('object', message, record);
      metrics.deadLetters += 1;
      res.status(502).json({
        status: 'error',
        code: 'OBJECT_REGISTER_FAILED',
        message,
      });
    }
  });

  app.post('/internal/lattice/sync', async (req: Request, res: Response) => {
    if (!requireInternalToken(req, res)) {
      return;
    }
    await runSyncCycle();
    res.status(202).json({
      status: 'accepted',
      last_sync_at_ms: lastSyncAtMs,
    });
  });

  setInterval(() => {
    void runSyncCycle();
  }, config.pollIntervalMs);

  void runSyncCycle();

  const dataRoot = path.resolve(config.dataDir);
  const dbPath = path.join(dataRoot, 'lattice-bridge.db');
  app.listen(config.port, () => {
    const mode = currentEffectiveMode();
    logger.info(
      {
        port: config.port,
        integration_mode: mode.integrationMode,
        input_mode: mode.inputMode,
        effective_profile: mode.effectiveProfile,
        allow_outbound_writes: config.allowOutboundWrites,
        protocol_mode: config.protocolMode,
        lattice_base_url: config.latticeBaseUrl || null,
        sandbox_mode: config.sandboxMode,
        data_dir: dataRoot,
        db_path: dbPath,
      },
      'AetherCore Lattice bridge online',
    );
  });
}

bootstrap().catch((error) => {
  logger.fatal({ error: String(error) }, 'Lattice bridge bootstrap failed');
  process.exit(1);
});

