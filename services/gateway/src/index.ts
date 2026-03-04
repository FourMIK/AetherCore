import express from 'express';
import { createServer } from 'http';
import * as crypto from 'node:crypto';
import { WebSocketServer, WebSocket, type RawData } from 'ws';
import { z } from 'zod';
import cors from 'cors';
import dotenv from 'dotenv';
import pino from 'pino';
import { blake3 } from 'hash-wasm';
import { parseTpmEnabled } from './tpm';
import { createC2RouterClient, dispatchCommand } from './c2-client';
import {
  DistributedRevocationRegistry,
  evaluateRevocationGate,
  type RevocationSyncSummary,
} from './revocation';
import {
  isRunningInContainer,
  getDefaultC2Endpoint,
  isLocalhostTarget,
  createMessageEnvelope,
  parseMessageEnvelope,
  serializeForSigning,
  setEnvelopeVerificationStatus,
  type MessageEnvelope,
} from '@aethercore/shared';

dotenv.config();

// Initialize structured logger
const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  formatters: {
    level: (label) => {
      return { level: label };
    },
  },
  ...(process.env.NODE_ENV === 'production'
    ? {}
    : { transport: { target: 'pino-pretty', options: { colorize: true } } }),
});

const parsedTpmEnabled = parseTpmEnabled(process.env.TPM_ENABLED);
if (parsedTpmEnabled.warning) {
  logger.warn({ tpm_enabled_value: process.env.TPM_ENABLED }, parsedTpmEnabled.warning);
}
const TPM_ENABLED = parsedTpmEnabled.value;

function parsePositiveIntEnv(name: string, defaultValue: number): number {
  const raw = process.env[name];
  if (!raw) {
    return defaultValue;
  }
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < 1) {
    logger.warn({ variable: name, value: raw, default_value: defaultValue }, 'Invalid integer env value');
    return defaultValue;
  }
  return parsed;
}

function parseBooleanEnv(name: string, defaultValue: boolean): boolean {
  const raw = process.env[name];
  if (!raw) {
    return defaultValue;
  }
  const normalized = raw.trim().toLowerCase();
  if (normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on') {
    return true;
  }
  if (normalized === '0' || normalized === 'false' || normalized === 'no' || normalized === 'off') {
    return false;
  }
  logger.warn({ variable: name, value: raw, default_value: defaultValue }, 'Invalid boolean env value');
  return defaultValue;
}

function parseDelimitedEnvSet(value: string | undefined): Set<string> {
  if (!value) {
    return new Set<string>();
  }
  return new Set(
    value
      .split(',')
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0),
  );
}

function isProductionMode(): boolean {
  const flag = process.env.AETHERCORE_PRODUCTION;
  return process.env.NODE_ENV === 'production' || flag === '1' || flag === 'true';
}

const PORT = process.env.PORT || 3000;
const C2_GRPC_TARGET = process.env.C2_ADDR || getDefaultC2Endpoint();
// Backend endpoint for future integration with AetherBunker services
const AETHER_BUNKER_ENDPOINT = process.env.AETHER_BUNKER_ENDPOINT || process.env.C2_ADDR || getDefaultC2Endpoint();
const REVOCATION_SOURCE_URL = process.env.AETHERCORE_REVOCATION_SOURCE_URL?.trim() || '';
const REVOCATION_REFRESH_INTERVAL_MS = parsePositiveIntEnv('AETHERCORE_REVOCATION_REFRESH_INTERVAL_MS', 30000);
const REVOCATION_REQUEST_TIMEOUT_MS = parsePositiveIntEnv('AETHERCORE_REVOCATION_REQUEST_TIMEOUT_MS', 5000);
const REVOCATION_FAIL_CLOSED = parseBooleanEnv('AETHERCORE_REVOCATION_FAIL_CLOSED', isProductionMode());
const IDENTITY_REGISTRY_HTTP_ENDPOINT = process.env.IDENTITY_REGISTRY_HTTP_ENDPOINT?.trim() || '';
const IDENTITY_REGISTRY_TIMEOUT_MS = parsePositiveIntEnv('IDENTITY_REGISTRY_TIMEOUT_MS', 5000);
const AETHERCORE_ADMIN_NODE_IDS = parseDelimitedEnvSet(process.env.AETHERCORE_ADMIN_NODE_IDS);

function warnOnLocalhostTargetInContainer(target: string, variableName: string): void {
  if (isRunningInContainer() && isLocalhostTarget(target)) {
    logger.warn(
      {
        variable: variableName,
        configured_target: target,
        recommended_target: 'c2-router:50051',
      },
      `Containerized gateway is configured with ${variableName}=${target}. Use Docker service DNS (for example c2-router:50051) instead of localhost to reach sibling containers.`,
    );
  }
}
logger.info({
  port: PORT,
  c2_target: C2_GRPC_TARGET,
  bunker_endpoint: AETHER_BUNKER_ENDPOINT,
  identity_registry_http_endpoint: IDENTITY_REGISTRY_HTTP_ENDPOINT || null,
  configured_admin_node_count: AETHERCORE_ADMIN_NODE_IDS.size,
  tpm_enabled: TPM_ENABLED,
}, 'Gateway service configuration loaded');

warnOnLocalhostTargetInContainer(C2_GRPC_TARGET, 'C2_ADDR');
warnOnLocalhostTargetInContainer(AETHER_BUNKER_ENDPOINT, 'AETHER_BUNKER_ENDPOINT');

if (!TPM_ENABLED) {
  logger.warn('TPM is DISABLED - Hardware-rooted trust features are not active. Security guarantees reduced.');
}

const CommandSchema = z.object({
  id: z.string().uuid(),
  type: z.enum(['PURGE_NODE', 'OVERRIDE_AUTH', 'SWARM_RECONFIG', 'MARK_HOSTILE']),
  target: z.string(),
  payload: z.record(z.string(), z.any()).optional(),
  signature: z.string().min(1, "Operator signature required"), 
});

const AdminRevocationRequestSchema = z.object({
  admin_node_id: z.string().min(1),
  node_id: z.string().min(1),
  reason: z.string().trim().min(1).max(1024),
  timestamp_ms: z.number().int().positive(),
  authority_signature_hex: z.string().regex(/^[0-9a-fA-F]{128}$/),
});

const RalphieTelemetrySchema = z
  .object({
    gps: z
      .object({
        lat: z.number().min(-90).max(90).optional(),
        lon: z.number().min(-180).max(180).optional(),
        latitude: z.number().min(-90).max(90).optional(),
        longitude: z.number().min(-180).max(180).optional(),
        alt_m: z.number().optional(),
        altitude_m: z.number().optional(),
        fix: z.boolean().optional(),
        sats: z.number().int().nonnegative().optional(),
        hdop: z.number().nonnegative().optional(),
        speed_mps: z.number().nonnegative().optional(),
        course_deg: z.number().min(0).max(360).optional(),
        timestamp: z.number().int().positive().optional(),
        source: z.string().min(1).optional(),
      })
      .optional(),
    power: z
      .object({
        battery_pct: z.number().min(0).max(100).optional(),
        voltage_v: z.number().positive().optional(),
        charging: z.boolean().optional(),
        external_power: z.boolean().optional(),
      })
      .optional(),
    radio: z
      .object({
        snr_db: z.number().optional(),
        rssi_dbm: z.number().optional(),
        lora_snr_db: z.number().optional(),
        lora_rssi_dbm: z.number().optional(),
      })
      .optional(),
    device: z
      .object({
        model: z.string().min(1).optional(),
        firmware: z.string().min(1).optional(),
        transport: z.string().min(1).optional(),
        role: z.string().min(1).optional(),
      })
      .optional(),
  })
  .optional();

const RalphiePresenceSchema = z.object({
  type: z.literal('RALPHIE_PRESENCE'),
  reason: z.enum(['startup', 'heartbeat']),
  timestamp: z.number().int().positive(),
  endpoint: z.string().min(1),
  last_disconnect_reason: z.string().optional().default('unknown'),
  signature: z.string().min(1),
  identity: z.object({
    device_id: z.string().min(1),
    public_key: z.string().min(1).optional(),
    chat_public_key: z.string().min(1).optional(),
    hardware_serial: z.string().min(1),
    certificate_serial: z.string().min(1),
    trust_score: z.number().min(0).max(1),
    enrolled_at: z.number().int().positive(),
    tpm_backed: z.boolean(),
  }),
  telemetry: RalphieTelemetrySchema,
});

type RalphiePresence = z.infer<typeof RalphiePresenceSchema>;
type VerificationKeySource = 'bound' | 'payload';
type PresenceVerificationProvenance = {
  signature_verified: true;
  replay_verified: boolean;
  key_source: VerificationKeySource;
  trust_derivation: 'gateway-v1';
  evaluated_at: number;
};
type RalphiePresenceRecord = RalphiePresence & {
  received_at: number;
  verification: PresenceVerificationProvenance;
};
type OperatorPresenceStatus = 'online' | 'offline' | 'busy' | 'away';
type OperatorSession = {
  clientId: string | null;
  publicKeyPem: string | null;
  status: OperatorPresenceStatus;
  trustScore: number;
  verified: boolean;
  lastSeen: number;
};

type SenderReplayState = {
  lastSequence: number;
  lastMessageId: string | null;
  seenNonces: Set<string>;
  nonceWindow: string[];
};

type MerkleVineHeadState = {
  streamId: string;
  lastLeafHash: string | null;
  nextLeafIndex: number;
};

type StoreForwardEntry = {
  envelope: MessageEnvelope;
  queued_at_ms: number;
  expires_at_ms: number;
};

const client = createC2RouterClient(C2_GRPC_TARGET);
const ralphiePresenceByNode = new Map<string, RalphiePresenceRecord>();
const operatorSessionBySocket = new Map<WebSocket, OperatorSession>();
const socketsByOperatorId = new Map<string, Set<WebSocket>>();
const operatorPresenceById = new Map<string, MessageEnvelope>();
const senderPublicKeysById = new Map<string, string>();
const replayStateBySenderId = new Map<string, SenderReplayState>();
const merkleVineHeadBySender = new Map<string, MerkleVineHeadState>();
const storeForwardQueueByRecipient = new Map<string, StoreForwardEntry[]>();
const MAX_REPLAY_NONCE_WINDOW = 2048;
const STORE_FORWARD_TTL_MS = parsePositiveIntEnv('AETHERCORE_SMS_STORE_FORWARD_TTL_MS', 4 * 60 * 60 * 1000);
const STORE_FORWARD_MAX_PER_RECIPIENT = parsePositiveIntEnv('AETHERCORE_SMS_STORE_FORWARD_MAX_PER_RECIPIENT', 256);
const GOSSIP_MAX_TTL_MS = 300000;
const revocationRegistry = new DistributedRevocationRegistry({
  sourceUrl: REVOCATION_SOURCE_URL,
  refreshIntervalMs: REVOCATION_REFRESH_INTERVAL_MS,
  requestTimeoutMs: REVOCATION_REQUEST_TIMEOUT_MS,
});

const app = express();
app.use(cors());
app.use(express.json());

type TelemetryStoreEntry = {
  data: any;
  timestamp: number;
  ttl_ms: number;
};

type NodeAttestationState = {
  node_id: string;
  hardware_backed: boolean;
  tpm_attestation_valid: boolean;
  merkle_vine_synced: boolean;
  byzantine_detected: boolean;
  revoked: boolean;
  revocation_reason?: string;
  trust_score: number;
  timestamp_ms: number;
};

// In-memory telemetry storage with platform-aware TTL.
const telemetryStore = new Map<string, TelemetryStoreEntry>();
const TELEMETRY_TTL_DEFAULT_MS = 30000; // 30 seconds
const TELEMETRY_TTL_IOS_OVERLAY_MS = 300000; // 5 minutes
const PRESENCE_TTL_IOS_OVERLAY_MS = 300000; // 5 minutes
const PRESENCE_STALE_SCAN_INTERVAL_MS = 15000;

function toObjectRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function readBooleanCandidate(...values: unknown[]): boolean | undefined {
  for (const value of values) {
    if (typeof value === 'boolean') {
      return value;
    }
  }
  return undefined;
}

function readNumberCandidate(...values: unknown[]): number | undefined {
  for (const value of values) {
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value;
    }
  }
  return undefined;
}

function normalizeTrustScore(value: unknown, fallback: number): number {
  const numeric = typeof value === 'number' && Number.isFinite(value) ? value : fallback;
  const percent = numeric <= 1 ? numeric * 100 : numeric;
  return Math.max(0, Math.min(100, Number(percent.toFixed(2))));
}

function revocationReasonFromDetails(details: unknown): string | undefined {
  const record = toObjectRecord(details);
  if (!record) {
    return undefined;
  }
  const certificate = toObjectRecord(record.certificate);
  const reason =
    certificate?.revocation_reason ??
    certificate?.revocationReason ??
    record.revocation_reason ??
    record.revocationReason;
  return typeof reason === 'string' && reason.trim().length > 0 ? reason.trim() : undefined;
}

function mergeFleetAttestationState(now: number): NodeAttestationState[] {
  const nodeIds = new Set<string>();
  telemetryStore.forEach((_value, nodeId) => nodeIds.add(nodeId));
  ralphiePresenceByNode.forEach((_value, nodeId) => nodeIds.add(nodeId));
  operatorPresenceById.forEach((_value, nodeId) => nodeIds.add(nodeId));

  const states: NodeAttestationState[] = [];

  for (const nodeId of nodeIds) {
    const telemetryEntry = telemetryStore.get(nodeId);
    const telemetry = toObjectRecord(telemetryEntry?.data);
    const telemetryTrust = toObjectRecord(telemetry?.trust);
    const telemetrySecurity = toObjectRecord(telemetry?.security);
    const telemetryIdentity = toObjectRecord(telemetry?.identity);
    const telemetryIntegrity = toObjectRecord(telemetry?.integrity);

    const presence = ralphiePresenceByNode.get(nodeId);
    const revocationGate = evaluateRevocationGate(revocationRegistry, {
      nodeId,
      certificateSerial: presence?.identity.certificate_serial,
      failClosed: REVOCATION_FAIL_CLOSED,
    });
    const revoked = !revocationGate.ok && revocationGate.code === 'IDENTITY_REVOKED';

    const hardwareBacked =
      readBooleanCandidate(
        telemetrySecurity?.hardware_backed,
        telemetrySecurity?.tpm_backed,
        telemetryIdentity?.hardware_backed,
        telemetryIdentity?.tpm_backed,
        presence?.identity.tpm_backed,
      ) ?? false;

    const tpmAttestationValid =
      readBooleanCandidate(
        telemetrySecurity?.attestation_valid,
        telemetrySecurity?.tpm_attestation_valid,
        telemetrySecurity?.hardware_evidence_valid,
      ) ?? hardwareBacked;

    const merkleVineSynced =
      readBooleanCandidate(
        telemetrySecurity?.merkle_vine_synced,
        telemetryIntegrity?.merkle_vine_synced,
        telemetry?.merkle_vine_synced,
      ) ?? false;

    const byzantineDetected =
      readBooleanCandidate(
        telemetryTrust?.byzantine_detected,
        telemetrySecurity?.byzantine_detected,
      ) ?? false;

    const trustScore = normalizeTrustScore(
      readNumberCandidate(
        telemetryTrust?.self_score,
        telemetryTrust?.score,
        telemetry?.trust_score,
        telemetryIdentity?.trust_score,
        presence?.identity.trust_score,
      ),
      0,
    );

    const timestampMs = Math.round(
      readNumberCandidate(
        telemetryEntry?.timestamp,
        presence?.received_at,
        presence?.timestamp,
      ) ?? now,
    );

    const state: NodeAttestationState = {
      node_id: nodeId,
      hardware_backed: hardwareBacked && tpmAttestationValid,
      tpm_attestation_valid: tpmAttestationValid,
      merkle_vine_synced: merkleVineSynced,
      byzantine_detected: byzantineDetected,
      revoked,
      trust_score: revoked ? 0 : trustScore,
      timestamp_ms: timestampMs,
    };

    const reason = revocationReasonFromDetails(revocationGate.ok ? undefined : revocationGate.details);
    if (reason) {
      state.revocation_reason = reason;
    }

    states.push(state);
  }

  states.sort((a, b) => a.node_id.localeCompare(b.node_id));
  return states;
}

type IdentityRpcOk<T extends Record<string, unknown>> = {
  ok: true;
  data: T;
};

type IdentityRpcError = {
  ok: false;
  code: string;
  message: string;
  status?: number;
  details?: unknown;
};

type IdentityRpcResult<T extends Record<string, unknown>> = IdentityRpcOk<T> | IdentityRpcError;

async function callIdentityRegistryRpc<TRequest extends Record<string, unknown>, TResponse extends Record<string, unknown>>(
  method: string,
  request: TRequest,
): Promise<IdentityRpcResult<TResponse>> {
  if (!IDENTITY_REGISTRY_HTTP_ENDPOINT) {
    return {
      ok: false,
      code: 'IDENTITY_REGISTRY_UNCONFIGURED',
      message: 'Identity registry HTTP endpoint is not configured',
    };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), IDENTITY_REGISTRY_TIMEOUT_MS);
  const url = `${IDENTITY_REGISTRY_HTTP_ENDPOINT.replace(/\/$/, '')}/aethercore.identity.IdentityRegistry/${method}`;

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      signal: controller.signal,
      body: JSON.stringify(request),
    });

    if (!response.ok) {
      return {
        ok: false,
        code: 'IDENTITY_REGISTRY_RPC_FAILED',
        message: `Identity registry RPC failed (${response.status})`,
        status: response.status,
      };
    }

    const data = (await response.json()) as TResponse;
    return { ok: true, data };
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      return {
        ok: false,
        code: 'IDENTITY_REGISTRY_TIMEOUT',
        message: `Identity registry RPC timeout after ${IDENTITY_REGISTRY_TIMEOUT_MS}ms`,
      };
    }
    return {
      ok: false,
      code: 'IDENTITY_REGISTRY_UNREACHABLE',
      message: error instanceof Error ? error.message : String(error),
    };
  } finally {
    clearTimeout(timeout);
  }
}

function normalizePlatformHint(value: unknown): string {
  if (Array.isArray(value) && value.length > 0) {
    return normalizePlatformHint(value[0]);
  }
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

function telemetryTtlMsForIngress(telemetry: any, platformHeader: unknown, overlayHeader: unknown): number {
  const overlay = normalizePlatformHint(overlayHeader);
  const payloadOverlay = normalizePlatformHint(telemetry?.overlay);
  const platform = normalizePlatformHint(platformHeader) || normalizePlatformHint(telemetry?.platform);
  const explicitlyOverlay =
    overlay === 'ios' || overlay === 'ios-overlay' || payloadOverlay === 'ios' || payloadOverlay === 'ios-overlay';
  if (platform === 'ios' && explicitlyOverlay) {
    return TELEMETRY_TTL_IOS_OVERLAY_MS;
  }
  return TELEMETRY_TTL_DEFAULT_MS;
}

// Clean up old telemetry periodically
setInterval(() => {
  const now = Date.now();
  for (const [nodeId, entry] of telemetryStore.entries()) {
    if (now - entry.timestamp > entry.ttl_ms) {
      telemetryStore.delete(nodeId);
      logger.debug({ node_id: nodeId, ttl_ms: entry.ttl_ms }, 'Telemetry expired');
    }
  }
}, 10000); // Clean every 10 seconds

// Health check endpoint for Docker/Kubernetes readiness probes
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok' });
});

// GET endpoint to retrieve current nodes
app.get('/api/nodes', (req, res) => {
  try {
    const nodes = Array.from(telemetryStore.entries()).map(([nodeId, entry]) => ({
      node_id: nodeId,
      ...entry.data,
      last_seen: entry.timestamp,
      age_ms: Date.now() - entry.timestamp,
    }));

    res.status(200).json({
      status: 'ok',
      count: nodes.length,
      nodes: nodes,
      timestamp: Date.now(),
    });
  } catch (error) {
    logger.error({ error }, 'Failed to retrieve nodes');
    res.status(500).json({ status: 'error', message: 'Failed to retrieve nodes' });
  }
});

// Telemetry endpoint for edge devices
app.post('/api/telemetry', (req, res) => {
  try {
    const telemetry = req.body;
    const nodeId = req.headers['x-node-id'] || telemetry.node_id || 'unknown';
    const ttlMs = telemetryTtlMsForIngress(
      telemetry,
      req.headers['x-platform'],
      req.headers['x-aethercore-overlay'],
    );

    // Store telemetry
    telemetryStore.set(nodeId, {
      data: telemetry,
      timestamp: Date.now(),
      ttl_ms: ttlMs,
    });

    logger.info({
      node_id: nodeId,
      platform: req.headers['x-platform'] || telemetry.platform,
      node_type: telemetry.node_type,
      timestamp: telemetry.timestamp,
      trust_score: telemetry.trust?.self_score,
      hardware: telemetry.hardware?.model,
      ttl_ms: ttlMs,
    }, 'Telemetry received from edge node');

    // Broadcast to WebSocket clients if any
    wss.clients.forEach((client) => {
      if (client.readyState === 1) { // WebSocket.OPEN
        client.send(JSON.stringify({
          type: 'telemetry',
          payload: telemetry,
          timestamp: Date.now(),
        }));
      }
    });

    res.status(200).json({
      status: 'accepted',
      node_id: nodeId,
      timestamp: Date.now(),
      message: 'Telemetry received by AetherCore Gateway'
    });
  } catch (error) {
    logger.error({ error }, 'Failed to process telemetry');
    res.status(400).json({ status: 'error', message: 'Invalid telemetry payload' });
  }
});

app.get('/api/admin/privileges/:nodeId', async (req, res) => {
  const evaluatedAt = Date.now();
  const nodeId = typeof req.params.nodeId === 'string' ? req.params.nodeId.trim() : '';

  if (!nodeId) {
    res.status(400).json({
      authorized: false,
      reason: 'invalid_node_id',
      evaluated_at: evaluatedAt,
    });
    return;
  }

  if (!AETHERCORE_ADMIN_NODE_IDS.has(nodeId)) {
    res.status(200).json({
      authorized: false,
      reason: 'not_in_admin_allowlist',
      evaluated_at: evaluatedAt,
    });
    return;
  }

  const revocationCheck = verifySenderNotRevoked(nodeId);
  if (!revocationCheck.ok) {
    res.status(200).json({
      authorized: false,
      reason: 'identity_revoked',
      evaluated_at: evaluatedAt,
    });
    return;
  }

  const enrollment = await callIdentityRegistryRpc<{ node_id: string }, { success?: unknown; is_enrolled?: unknown; error_message?: unknown }>(
    'IsNodeEnrolled',
    { node_id: nodeId },
  );

  if (!enrollment.ok) {
    logger.error(
      {
        node_id: nodeId,
        code: enrollment.code,
        message: enrollment.message,
        details: enrollment.details,
      },
      'Failed to evaluate admin privileges against identity registry',
    );
    res.status(503).json({
      authorized: false,
      reason: 'identity_backend_unavailable',
      evaluated_at: evaluatedAt,
    });
    return;
  }

  const rpcSuccess = enrollment.data.success === true;
  const enrolled = enrollment.data.is_enrolled === true;

  if (!rpcSuccess || !enrolled) {
    res.status(200).json({
      authorized: false,
      reason: rpcSuccess ? 'admin_not_enrolled' : 'identity_registry_rejected',
      evaluated_at: evaluatedAt,
    });
    return;
  }

  res.status(200).json({
    authorized: true,
    evaluated_at: evaluatedAt,
  });
});

app.post('/api/admin/revoke', async (req, res) => {
  const parsed = AdminRevocationRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      status: 'error',
      code: 'INVALID_REQUEST',
      message: 'Invalid revocation request payload',
      details: parsed.error.flatten(),
    });
    return;
  }

  const body = parsed.data;

  if (!AETHERCORE_ADMIN_NODE_IDS.has(body.admin_node_id)) {
    res.status(403).json({
      status: 'error',
      node_id: body.node_id,
      code: 'ADMIN_UNAUTHORIZED',
      message: 'Requesting node is not authorized for revocation',
    });
    return;
  }

  const adminRevocation = verifySenderNotRevoked(body.admin_node_id);
  if (!adminRevocation.ok) {
    res.status(403).json({
      status: 'error',
      node_id: body.node_id,
      code: adminRevocation.code,
      message: adminRevocation.message,
      details: adminRevocation.details,
    });
    return;
  }

  const rpc = await callIdentityRegistryRpc<
    {
      node_id: string;
      reason: string;
      authority_signature_hex: string;
      timestamp_ms: number;
    },
    { success?: unknown; error_message?: unknown; timestamp_ms?: unknown }
  >('RevokeNode', {
    node_id: body.node_id,
    reason: body.reason,
    authority_signature_hex: body.authority_signature_hex,
    timestamp_ms: body.timestamp_ms,
  });

  if (!rpc.ok) {
    logger.error(
      {
        node_id: body.node_id,
        admin_node_id: body.admin_node_id,
        code: rpc.code,
        message: rpc.message,
        details: rpc.details,
      },
      'Revocation failed: identity registry unavailable',
    );
    res.status(503).json({
      status: 'error',
      node_id: body.node_id,
      code: rpc.code,
      message: 'Identity registry revocation path unavailable',
    });
    return;
  }

  if (rpc.data.success !== true) {
    const errorMessage =
      typeof rpc.data.error_message === 'string'
        ? rpc.data.error_message
        : 'Identity registry rejected revocation request';
    logger.warn(
      {
        node_id: body.node_id,
        admin_node_id: body.admin_node_id,
        error: errorMessage,
      },
      'Revocation rejected by identity registry',
    );
    res.status(400).json({
      status: 'error',
      node_id: body.node_id,
      code: 'REVOCATION_REJECTED',
      message: errorMessage,
    });
    return;
  }

  telemetryStore.delete(body.node_id);
  const presenceRemoved = ralphiePresenceByNode.delete(body.node_id);
  senderPublicKeysById.delete(body.node_id);
  replayStateBySenderId.delete(body.node_id);
  operatorPresenceById.delete(body.node_id);

  const sockets = socketsByOperatorId.get(body.node_id);
  if (sockets) {
    sockets.forEach((socket) => {
      sendGatewayError(socket, 'IDENTITY_REVOKED', 'Identity revoked by admin action');
      if (socket.readyState === WebSocket.OPEN) {
        socket.close(4003, 'identity_revoked');
      }
    });
    socketsByOperatorId.delete(body.node_id);
  }

  const revokedAtMs =
    typeof rpc.data.timestamp_ms === 'number' && Number.isFinite(rpc.data.timestamp_ms)
      ? Math.trunc(rpc.data.timestamp_ms)
      : Date.now();

  broadcast({
    type: 'REVOCATION_EVENT',
    node_id: body.node_id,
    reason: body.reason,
    revoked_at_ms: revokedAtMs,
    revoked_by: body.admin_node_id,
  });

  if (presenceRemoved) {
    broadcast({
      type: 'RALPHIE_PRESENCE_EXPIRED',
      node_id: body.node_id,
      expired_at: revokedAtMs,
    });
  }

  broadcast({
    type: 'RALPHIE_PRESENCE_SNAPSHOT',
    nodes: Array.from(ralphiePresenceByNode.values()),
  });

  logger.warn(
    {
      node_id: body.node_id,
      admin_node_id: body.admin_node_id,
      reason: body.reason,
      revoked_at_ms: revokedAtMs,
    },
    'Node identity revoked through admin API',
  );

  res.status(200).json({
    status: 'ok',
    node_id: body.node_id,
    revoked_at_ms: revokedAtMs,
  });
});

app.get('/api/admin/fleet-attestation', (req, res) => {
  const now = Date.now();
  const nodes = mergeFleetAttestationState(now);
  res.status(200).json({
    status: 'ok',
    nodes,
    timestamp: now,
  });
});

app.post('/ralphie/presence', (req, res) => {
  const record = upsertRalphiePresence(req.body);
  if (!record) {
    res.status(400).json({ status: 'error', message: 'invalid presence payload' });
    return;
  }
  res.status(202).json({ status: 'accepted', node_id: record.identity.device_id });
});

const server = createServer(app);
const wss = new WebSocketServer({ server });

let backendHealthy = false;

if (revocationRegistry.isConfigured()) {
  logger.info(
    {
      source: REVOCATION_SOURCE_URL,
      refresh_interval_ms: REVOCATION_REFRESH_INTERVAL_MS,
      request_timeout_ms: REVOCATION_REQUEST_TIMEOUT_MS,
      fail_closed: REVOCATION_FAIL_CLOSED,
    },
    'Distributed revocation source enabled',
  );

  void revocationRegistry
    .refresh()
    .then((summary) => {
      if (summary) {
        enforceRevocationAcrossActiveSessions(summary);
      }
    })
    .catch((error) => {
      logger.error(
        {
          source: REVOCATION_SOURCE_URL,
          error: error instanceof Error ? error.message : String(error),
        },
        'Initial revocation sync failed',
      );
    });

  revocationRegistry.startPolling(
    (summary) => {
      enforceRevocationAcrossActiveSessions(summary);
    },
    (error) => {
      logger.warn(
        {
          source: REVOCATION_SOURCE_URL,
          error: error instanceof Error ? error.message : String(error),
        },
        'Revocation sync attempt failed',
      );
    },
  );
} else {
  logger.info('No distributed revocation source configured; revocation gate disabled');
}

function sendWsJson(ws: WebSocket, payload: unknown): void {
  if (ws.readyState !== WebSocket.OPEN) {
    return;
  }
  ws.send(JSON.stringify(payload));
}

function isIosOverlayPresence(record: RalphiePresenceRecord): boolean {
  const role = normalizePlatformHint(record.telemetry?.device?.role);
  const endpoint = normalizePlatformHint(record.endpoint);
  return role === 'ios-overlay' || endpoint.includes('ios-overlay');
}

function pruneStaleRalphiePresence(now: number): void {
  let changed = false;
  for (const [nodeId, record] of ralphiePresenceByNode.entries()) {
    if (!isIosOverlayPresence(record)) {
      continue;
    }
    const ageMs = now - record.received_at;
    if (ageMs <= PRESENCE_TTL_IOS_OVERLAY_MS) {
      continue;
    }
    ralphiePresenceByNode.delete(nodeId);
    senderPublicKeysById.delete(nodeId);
    replayStateBySenderId.delete(nodeId);
    changed = true;
    logger.info(
      {
        node_id: nodeId,
        age_ms: ageMs,
        ttl_ms: PRESENCE_TTL_IOS_OVERLAY_MS,
      },
      'Expired stale iOS overlay RALPHIE_PRESENCE record',
    );
    broadcast({ type: 'RALPHIE_PRESENCE_EXPIRED', node_id: nodeId, expired_at: now });
  }

  if (changed) {
    broadcast({
      type: 'RALPHIE_PRESENCE_SNAPSHOT',
      nodes: Array.from(ralphiePresenceByNode.values()),
    });
  }
}

function sendGatewayError(ws: WebSocket, code: string, message: string, details?: unknown): void {
  sendWsJson(ws, { type: 'ERROR', code, message, details });
}

function extractRecipientId(payload: unknown): string | null {
  if (typeof payload !== 'object' || payload === null) {
    return null;
  }
  const value = (payload as { recipientId?: unknown }).recipientId;
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function isChatEnvelopeType(type: MessageEnvelope['type']): boolean {
  return type === 'chat';
}

function streamIdForSender(senderId: string): string {
  return `message-stream:${senderId}`;
}

async function anchorEnvelopeInMerkleVine(envelope: MessageEnvelope): Promise<MessageEnvelope> {
  const current = merkleVineHeadBySender.get(envelope.from);
  const parentHash = current?.lastLeafHash ?? undefined;
  const leafIndex = current?.nextLeafIndex ?? 0;
  const streamId = current?.streamId ?? streamIdForSender(envelope.from);

  const leafPreimage = stableStringify({
    schema_version: envelope.schema_version,
    message_id: envelope.message_id,
    timestamp: envelope.timestamp,
    type: envelope.type,
    from: envelope.from,
    payload: envelope.payload,
    nonce: envelope.nonce,
    sequence: envelope.sequence,
    previous_message_id: envelope.previous_message_id,
    transport: envelope.transport,
    signature: envelope.signature,
    parent_hash: parentHash,
    stream_id: streamId,
    leaf_index: leafIndex,
  });
  const leafHash = await blake3(leafPreimage);
  const anchoredAtMs = Date.now();

  const anchoredEnvelope: MessageEnvelope = {
    ...envelope,
    vine: {
      stream_id: streamId,
      leaf_hash: leafHash,
      parent_hash: parentHash,
      leaf_index: leafIndex,
      anchored_at_ms: anchoredAtMs,
    },
  };

  merkleVineHeadBySender.set(envelope.from, {
    streamId,
    lastLeafHash: leafHash,
    nextLeafIndex: leafIndex + 1,
  });

  return anchoredEnvelope;
}

function queueStoreForwardMessage(recipientId: string, envelope: MessageEnvelope): void {
  const now = Date.now();
  const currentQueue = storeForwardQueueByRecipient.get(recipientId) ?? [];
  const filtered = currentQueue.filter((entry) => entry.expires_at_ms > now);

  if (filtered.length >= STORE_FORWARD_MAX_PER_RECIPIENT) {
    filtered.shift();
  }

  filtered.push({
    // Preserve sender-signed envelope bytes; store-forward metadata stays server-side only.
    envelope,
    queued_at_ms: now,
    expires_at_ms: now + STORE_FORWARD_TTL_MS,
  });

  storeForwardQueueByRecipient.set(recipientId, filtered);
}

function flushStoreForwardQueue(recipientId: string): number {
  const queue = storeForwardQueueByRecipient.get(recipientId);
  if (!queue || queue.length === 0) {
    return 0;
  }

  const recipientSockets = socketsByOperatorId.get(recipientId);
  if (!recipientSockets || recipientSockets.size === 0) {
    return 0;
  }

  const now = Date.now();
  const pending: StoreForwardEntry[] = [];
  let delivered = 0;

  for (const entry of queue) {
    if (entry.expires_at_ms <= now) {
      continue;
    }

    let sent = false;
    recipientSockets.forEach((socket) => {
      if (!sent && socket.readyState === WebSocket.OPEN) {
        sendWsJson(socket, entry.envelope);
        sent = true;
      }
    });

    if (sent) {
      delivered += 1;
      continue;
    }

    pending.push(entry);
  }

  if (pending.length > 0) {
    storeForwardQueueByRecipient.set(recipientId, pending);
  } else {
    storeForwardQueueByRecipient.delete(recipientId);
  }

  return delivered;
}

function normalizePresenceStatus(status: unknown): OperatorPresenceStatus {
  return status === 'online' || status === 'offline' || status === 'busy' || status === 'away'
    ? status
    : 'online';
}

function clampTrustScore(value: number): number {
  return Math.max(0, Math.min(1, Number(value.toFixed(2))));
}

function deriveServerTrustScore(input: {
  signatureVerified: boolean;
  replayVerified: boolean;
  keyPreviouslyBound: boolean;
  tpmBacked: boolean;
}): number {
  let score = 0.2;
  if (input.signatureVerified) {
    score += 0.45;
  }
  if (input.replayVerified) {
    score += 0.15;
  }
  if (input.keyPreviouslyBound) {
    score += 0.1;
  }
  if (input.tpmBacked) {
    score += 0.1;
  }
  return clampTrustScore(score);
}

function normalizePublicKeyPem(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function publicKeyFromEnvelopePayload(envelope: MessageEnvelope): string | null {
  if (typeof envelope.payload !== 'object' || envelope.payload === null) {
    return null;
  }
  const payload = envelope.payload as Record<string, unknown>;
  return normalizePublicKeyPem(payload.public_key ?? payload.publicKey);
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

function senderBoundPublicKey(from: string): string | null {
  const fromPresence = normalizePublicKeyPem(ralphiePresenceByNode.get(from)?.identity.public_key);
  if (fromPresence) {
    return fromPresence;
  }
  const mapped = senderPublicKeysById.get(from);
  return mapped ? normalizePublicKeyPem(mapped) : null;
}

type EnvelopeVerificationResult =
  | { ok: true; verifiedWithKeyPem: string; keySource: VerificationKeySource }
  | { ok: false; code: string; message: string; details?: unknown };

function verifyEnvelopeSignature(envelope: MessageEnvelope): EnvelopeVerificationResult {
  if (typeof envelope.signature !== 'string' || envelope.signature.length === 0) {
    return {
      ok: false,
      code: 'SIGNATURE_REQUIRED',
      message: 'Authenticated messaging requires a message signature',
    };
  }

  const signatureHex = envelope.signature.trim();
  if (!/^[0-9a-fA-F]{128}$/.test(signatureHex)) {
    return {
      ok: false,
      code: 'SIGNATURE_INVALID',
      message: 'Signature must be a 64-byte hex Ed25519 signature',
    };
  }

  const payloadPublicKey = publicKeyFromEnvelopePayload(envelope);
  const boundPublicKey = senderBoundPublicKey(envelope.from);
  const verificationKey = boundPublicKey ?? payloadPublicKey;

  if (!verificationKey) {
    return {
      ok: false,
      code: 'UNKNOWN_SENDER_KEY',
      message: 'No enrolled or announced public key for sender',
    };
  }

  if (boundPublicKey && payloadPublicKey && boundPublicKey !== payloadPublicKey) {
    return {
      ok: false,
      code: 'PUBLIC_KEY_MISMATCH',
      message: 'Envelope payload public key does not match enrolled sender key',
    };
  }

  try {
    const canonicalPayload = serializeForSigning({
      schema_version: envelope.schema_version,
      message_id: envelope.message_id,
      timestamp: envelope.timestamp,
      type: envelope.type,
      from: envelope.from,
      payload: envelope.payload,
      nonce: envelope.nonce,
      sequence: envelope.sequence,
      previous_message_id: envelope.previous_message_id,
      transport: envelope.transport,
    });
    const data = Buffer.from(canonicalPayload, 'utf-8');
    const signatureBytes = Buffer.from(signatureHex, 'hex');
    const publicKey = crypto.createPublicKey(verificationKey);
    const verified = crypto.verify(null, data, publicKey, signatureBytes);
    if (!verified) {
      return {
        ok: false,
        code: 'SIGNATURE_INVALID',
        message: 'Signature verification failed',
      };
    }
  } catch (error) {
    return {
      ok: false,
      code: 'SIGNATURE_INVALID',
      message: 'Failed to verify signature with sender public key',
      details: error instanceof Error ? error.message : String(error),
    };
  }

  return {
    ok: true,
    verifiedWithKeyPem: verificationKey,
    keySource: boundPublicKey ? 'bound' : 'payload',
  };
}

function verifyRalphiePresenceSignature(presence: RalphiePresence): EnvelopeVerificationResult {
  const signatureHex = presence.signature.trim();
  if (!/^[0-9a-fA-F]{128}$/.test(signatureHex)) {
    return {
      ok: false,
      code: 'PRESENCE_SIGNATURE_INVALID',
      message: 'Presence signature must be a 64-byte hex Ed25519 signature',
    };
  }

  const payloadPublicKey = normalizePublicKeyPem(presence.identity.public_key);
  const boundPublicKey = senderBoundPublicKey(presence.identity.device_id);
  const verificationKey = boundPublicKey ?? payloadPublicKey;
  if (!verificationKey) {
    return {
      ok: false,
      code: 'PRESENCE_UNKNOWN_SENDER_KEY',
      message: 'Presence signature requires an enrolled or announced sender public key',
    };
  }

  if (boundPublicKey && payloadPublicKey && boundPublicKey !== payloadPublicKey) {
    return {
      ok: false,
      code: 'PRESENCE_PUBLIC_KEY_MISMATCH',
      message: 'Presence payload public key does not match enrolled sender key',
    };
  }

  const payloadForSignature: Omit<RalphiePresence, 'signature'> = {
    type: presence.type,
    reason: presence.reason,
    timestamp: presence.timestamp,
    endpoint: presence.endpoint,
    last_disconnect_reason: presence.last_disconnect_reason,
    identity: presence.identity,
    telemetry: presence.telemetry,
  };

  try {
    const canonicalPayload = stableStringify(payloadForSignature);
    const data = Buffer.from(canonicalPayload, 'utf-8');
    const signatureBytes = Buffer.from(signatureHex, 'hex');
    const publicKey = crypto.createPublicKey(verificationKey);
    const verified = crypto.verify(null, data, publicKey, signatureBytes);
    if (!verified) {
      return {
        ok: false,
        code: 'PRESENCE_SIGNATURE_INVALID',
        message: 'Presence signature verification failed',
      };
    }
  } catch (error) {
    return {
      ok: false,
      code: 'PRESENCE_SIGNATURE_INVALID',
      message: 'Failed to verify presence signature with sender public key',
      details: error instanceof Error ? error.message : String(error),
    };
  }

  return {
    ok: true,
    verifiedWithKeyPem: verificationKey,
    keySource: boundPublicKey ? 'bound' : 'payload',
  };
}

type RevocationVerificationResult =
  | { ok: true }
  | { ok: false; code: 'REVOCATION_UNAVAILABLE' | 'IDENTITY_REVOKED'; message: string; details?: unknown };

function verifySenderNotRevoked(nodeId: string, certificateSerial?: string | null): RevocationVerificationResult {
  const revocationGate = evaluateRevocationGate(revocationRegistry, {
    nodeId,
    certificateSerial,
    failClosed: REVOCATION_FAIL_CLOSED,
  });

  if (!revocationGate.ok) {
    logger.warn(
      {
        node_id: nodeId,
        certificate_serial: certificateSerial ?? null,
        code: revocationGate.code,
        details: revocationGate.details,
      },
      'Rejected revoked identity in active verification path',
    );
    return revocationGate;
  }
  return { ok: true };
}

function disconnectRevokedOperators(): void {
  for (const [operatorId, sockets] of socketsByOperatorId.entries()) {
    const gate = verifySenderNotRevoked(operatorId);
    if (gate.ok) {
      continue;
    }
    sockets.forEach((operatorSocket) => {
      sendGatewayError(operatorSocket, gate.code, gate.message, gate.details);
      if (operatorSocket.readyState === WebSocket.OPEN) {
        operatorSocket.close(4003, 'identity_revoked');
      }
    });
  }
}

function evictRevokedRalphiePresence(): void {
  for (const [nodeId, record] of ralphiePresenceByNode.entries()) {
    const gate = verifySenderNotRevoked(nodeId, record.identity.certificate_serial);
    if (gate.ok) {
      continue;
    }
    ralphiePresenceByNode.delete(nodeId);
    broadcast({
      type: 'REVOCATION_EVENT',
      node_id: nodeId,
      code: gate.code,
      details: gate.details,
    });
  }
}

function enforceRevocationAcrossActiveSessions(summary: RevocationSyncSummary): void {
  logger.info(
    {
      source: summary.sourceUrl,
      revoked_nodes: summary.revokedNodeCount,
      revoked_certificates: summary.revokedCertificateCount,
      last_updated_ns: summary.lastUpdatedNs,
    },
    'Revocation ledger synchronized from distributed source',
  );
  disconnectRevokedOperators();
  evictRevokedRalphiePresence();
}

type ReplayVerificationResult =
  | { ok: true }
  | { ok: false; code: string; message: string; details?: unknown };

function verifyAndTrackReplay(envelope: MessageEnvelope): ReplayVerificationResult {
  if (typeof envelope.sequence !== 'number' || !Number.isInteger(envelope.sequence) || envelope.sequence <= 0) {
    return {
      ok: false,
      code: 'REPLAY_SEQUENCE_REQUIRED',
      message: 'Envelope sequence must be a positive integer',
    };
  }

  if (typeof envelope.nonce !== 'string' || envelope.nonce.trim().length < 16) {
    return {
      ok: false,
      code: 'REPLAY_NONCE_REQUIRED',
      message: 'Envelope nonce must be present for replay defense',
    };
  }

  let state = replayStateBySenderId.get(envelope.from);
  if (!state) {
    state = {
      lastSequence: 0,
      lastMessageId: null,
      seenNonces: new Set<string>(),
      nonceWindow: [],
    };
    replayStateBySenderId.set(envelope.from, state);
  }

  if (state.seenNonces.has(envelope.nonce)) {
    return {
      ok: false,
      code: 'REPLAY_DETECTED',
      message: 'Duplicate nonce detected for sender',
    };
  }

  if (envelope.sequence <= state.lastSequence) {
    return {
      ok: false,
      code: 'REPLAY_DETECTED',
      message: 'Out-of-order or duplicate sequence detected for sender',
      details: {
        sequence: envelope.sequence,
        last_sequence: state.lastSequence,
      },
    };
  }

  if (
    envelope.previous_message_id &&
    state.lastMessageId &&
    envelope.previous_message_id !== state.lastMessageId
  ) {
    return {
      ok: false,
      code: 'REPLAY_CHAIN_MISMATCH',
      message: 'previous_message_id does not match sender chain head',
      details: {
        previous_message_id: envelope.previous_message_id,
        expected_previous_message_id: state.lastMessageId,
      },
    };
  }

  state.lastSequence = envelope.sequence;
  state.lastMessageId = envelope.message_id;
  state.seenNonces.add(envelope.nonce);
  state.nonceWindow.push(envelope.nonce);
  if (state.nonceWindow.length > MAX_REPLAY_NONCE_WINDOW) {
    const removed = state.nonceWindow.shift();
    if (removed) {
      state.seenNonces.delete(removed);
    }
  }

  return { ok: true };
}

function bindOperatorSession(ws: WebSocket, operatorId: string): void {
  const session = operatorSessionBySocket.get(ws);
  if (session?.clientId && session.clientId !== operatorId) {
    const previousSockets = socketsByOperatorId.get(session.clientId);
    if (previousSockets) {
      previousSockets.delete(ws);
      if (previousSockets.size === 0) {
        socketsByOperatorId.delete(session.clientId);
        replayStateBySenderId.delete(session.clientId);
      }
    }
  }

  let operatorSockets = socketsByOperatorId.get(operatorId);
  if (!operatorSockets) {
    operatorSockets = new Set<WebSocket>();
    socketsByOperatorId.set(operatorId, operatorSockets);
  }
  operatorSockets.add(ws);

  if (session) {
    session.clientId = operatorId;
    session.lastSeen = Date.now();
  }

  const deliveredBuffered = flushStoreForwardQueue(operatorId);
  if (deliveredBuffered > 0) {
    logger.info(
      {
        node_id: operatorId,
        delivered_count: deliveredBuffered,
      },
      'Delivered buffered store-forward messages to reconnected operator',
    );
  }
}

function buildAckEnvelope(
  recipientId: string,
  originalMessageId: string,
  delivered: boolean,
  reason?: string,
): MessageEnvelope {
  const ack = createMessageEnvelope('ack', 'gateway', {
    recipientId,
    originalMessageId,
    delivered,
    reason,
  });
  return setEnvelopeVerificationStatus(ack, 'STATUS_UNVERIFIED');
}

function handleOperatorPresenceEnvelope(ws: WebSocket, envelope: MessageEnvelope): void {
  const session = operatorSessionBySocket.get(ws);
  if (!session) {
    return;
  }

  if (session.clientId && session.clientId !== envelope.from) {
    sendGatewayError(ws, 'AUTH_MISMATCH', 'Envelope sender does not match authenticated operator');
    return;
  }

  const revocationCheck = verifySenderNotRevoked(envelope.from);
  if (!revocationCheck.ok) {
    sendGatewayError(ws, revocationCheck.code, revocationCheck.message, revocationCheck.details);
    return;
  }

  const signatureCheck = verifyEnvelopeSignature(envelope);
  if (!signatureCheck.ok) {
    sendGatewayError(ws, signatureCheck.code, signatureCheck.message, signatureCheck.details);
    return;
  }

  const replayCheck = verifyAndTrackReplay(envelope);
  if (!replayCheck.ok) {
    sendGatewayError(ws, replayCheck.code, replayCheck.message, replayCheck.details);
    return;
  }

  if (!senderPublicKeysById.has(envelope.from)) {
    senderPublicKeysById.set(envelope.from, signatureCheck.verifiedWithKeyPem);
  }

  if (!session.clientId) {
    bindOperatorSession(ws, envelope.from);
  }

  const payload =
    typeof envelope.payload === 'object' && envelope.payload !== null
      ? (envelope.payload as Record<string, unknown>)
      : {};
  const payloadPublicKey = normalizePublicKeyPem(payload.public_key ?? payload.publicKey);
  if (payloadPublicKey) {
    senderPublicKeysById.set(envelope.from, payloadPublicKey);
    session.publicKeyPem = payloadPublicKey;
  } else {
    session.publicKeyPem = signatureCheck.verifiedWithKeyPem;
  }
  const trustProvenance: PresenceVerificationProvenance = {
    signature_verified: true,
    replay_verified: true,
    key_source: signatureCheck.keySource,
    trust_derivation: 'gateway-v1',
    evaluated_at: Date.now(),
  };
  const derivedTrustScore = deriveServerTrustScore({
    signatureVerified: true,
    replayVerified: true,
    keyPreviouslyBound: signatureCheck.keySource === 'bound',
    tpmBacked: false,
  });
  session.status = normalizePresenceStatus(payload.status);
  session.trustScore = derivedTrustScore;
  session.verified = true;
  session.lastSeen = trustProvenance.evaluated_at;

  const outboundPresence = {
    ...envelope,
    payload: {
      ...payload,
      status: session.status,
      trustScore: session.trustScore,
      verified: session.verified,
      trust_source: 'server_derived',
      verification: trustProvenance,
    },
  };
  setEnvelopeVerificationStatus(outboundPresence, session.verified ? 'VERIFIED' : 'STATUS_UNVERIFIED');

  operatorPresenceById.set(envelope.from, outboundPresence);
  broadcast(outboundPresence);
}

async function routeEnvelopeByRecipient(ws: WebSocket, envelope: MessageEnvelope): Promise<void> {
  const session = operatorSessionBySocket.get(ws);
  if (!session?.clientId) {
    sendGatewayError(ws, 'AUTH_REQUIRED', 'Presence handshake required before sending messages');
    return;
  }

  if (envelope.from !== session.clientId) {
    sendGatewayError(ws, 'AUTH_MISMATCH', 'Envelope sender does not match authenticated operator');
    return;
  }

  const revocationCheck = verifySenderNotRevoked(envelope.from);
  if (!revocationCheck.ok) {
    sendGatewayError(ws, revocationCheck.code, revocationCheck.message, revocationCheck.details);
    return;
  }

  const signatureCheck = verifyEnvelopeSignature(envelope);
  if (!signatureCheck.ok) {
    sendGatewayError(ws, signatureCheck.code, signatureCheck.message, signatureCheck.details);
    return;
  }

  const replayCheck = verifyAndTrackReplay(envelope);
  if (!replayCheck.ok) {
    sendGatewayError(ws, replayCheck.code, replayCheck.message, replayCheck.details);
    return;
  }

  const recipientId = extractRecipientId(envelope.payload);
  if (!recipientId) {
    sendGatewayError(ws, 'INVALID_PAYLOAD', 'recipientId is required');
    return;
  }

  const routedEnvelope = await anchorEnvelopeInMerkleVine(envelope);
  setEnvelopeVerificationStatus(routedEnvelope, 'VERIFIED');

  const recipientSockets = socketsByOperatorId.get(recipientId);
  let delivered = false;
  if (recipientSockets && recipientSockets.size > 0) {
    recipientSockets.forEach((recipientSocket) => {
      if (recipientSocket.readyState === WebSocket.OPEN) {
        sendWsJson(recipientSocket, routedEnvelope);
        delivered = true;
      }
    });
  }

  if (delivered) {
    sendWsJson(ws, buildAckEnvelope(recipientId, envelope.message_id, true));
  } else {
    if (isChatEnvelopeType(envelope.type)) {
      queueStoreForwardMessage(recipientId, routedEnvelope);
      sendWsJson(ws, buildAckEnvelope(recipientId, envelope.message_id, false, 'recipient_offline_buffered'));
      return;
    }
    sendWsJson(ws, buildAckEnvelope(recipientId, envelope.message_id, false, 'recipient_offline'));
  }
}

async function routeEnvelopeViaGossip(ws: WebSocket, envelope: MessageEnvelope): Promise<void> {
  const session = operatorSessionBySocket.get(ws);
  if (!session?.clientId) {
    sendGatewayError(ws, 'AUTH_REQUIRED', 'Presence handshake required before sending messages');
    return;
  }

  if (envelope.from !== session.clientId) {
    sendGatewayError(ws, 'AUTH_MISMATCH', 'Envelope sender does not match authenticated operator');
    return;
  }

  const revocationCheck = verifySenderNotRevoked(envelope.from);
  if (!revocationCheck.ok) {
    sendGatewayError(ws, revocationCheck.code, revocationCheck.message, revocationCheck.details);
    return;
  }

  const signatureCheck = verifyEnvelopeSignature(envelope);
  if (!signatureCheck.ok) {
    sendGatewayError(ws, signatureCheck.code, signatureCheck.message, signatureCheck.details);
    return;
  }

  const replayCheck = verifyAndTrackReplay(envelope);
  if (!replayCheck.ok) {
    sendGatewayError(ws, replayCheck.code, replayCheck.message, replayCheck.details);
    return;
  }

  const recipientId = extractRecipientId(envelope.payload);
  if (!recipientId) {
    sendGatewayError(ws, 'INVALID_PAYLOAD', 'recipientId is required');
    return;
  }

  const ttlMs = envelope.transport?.ttl_ms ?? 15_000;
  if (ttlMs > GOSSIP_MAX_TTL_MS) {
    sendGatewayError(ws, 'INVALID_TRANSPORT', `gossip ttl exceeds ${GOSSIP_MAX_TTL_MS}ms`);
    return;
  }

  const gossipEnvelope = await anchorEnvelopeInMerkleVine(envelope);
  setEnvelopeVerificationStatus(gossipEnvelope, 'VERIFIED');

  let recipientDelivered = false;
  for (const [socket, client] of operatorSessionBySocket.entries()) {
    if (!client.clientId) {
      continue;
    }
    if (socket.readyState !== WebSocket.OPEN || socket === ws) {
      continue;
    }
    sendWsJson(socket, gossipEnvelope);
    if (client.clientId === recipientId) {
      recipientDelivered = true;
    }
  }

  if (recipientDelivered) {
    sendWsJson(ws, buildAckEnvelope(recipientId, envelope.message_id, true));
    return;
  }

  if (isChatEnvelopeType(envelope.type)) {
    queueStoreForwardMessage(recipientId, gossipEnvelope);
    sendWsJson(ws, buildAckEnvelope(recipientId, envelope.message_id, false, 'recipient_offline_buffered'));
    return;
  }

  sendWsJson(ws, buildAckEnvelope(recipientId, envelope.message_id, false, 'recipient_offline_gossip'));
}

async function handleC2Envelope(ws: WebSocket, envelope: MessageEnvelope): Promise<void> {
  switch (envelope.type) {
    case 'presence':
      handleOperatorPresenceEnvelope(ws, envelope);
      break;
    case 'chat':
      if (envelope.transport?.mode === 'gossip') {
        await routeEnvelopeViaGossip(ws, envelope);
      } else {
        await routeEnvelopeByRecipient(ws, envelope);
      }
      break;
    case 'call_invite':
    case 'call_accept':
    case 'call_reject':
    case 'call_end':
      await routeEnvelopeViaGossip(ws, envelope);
      break;
    case 'heartbeat': {
      const heartbeat = createMessageEnvelope('heartbeat', 'gateway', {
        timestamp: Date.now(),
      });
      setEnvelopeVerificationStatus(heartbeat, 'STATUS_UNVERIFIED');
      sendWsJson(ws, heartbeat);
      break;
    }
    case 'ack':
    case 'control':
      sendGatewayError(ws, 'UNSUPPORTED_MESSAGE', `Message type ${envelope.type} is not supported by gateway`);
      break;
    default:
      sendGatewayError(ws, 'UNSUPPORTED_MESSAGE', 'Unsupported message type');
  }
}

wss.on('connection', (ws: WebSocket) => {
  logger.info('Tactical Glass operator connected');
  operatorSessionBySocket.set(ws, {
    clientId: null,
    publicKeyPem: null,
    status: 'offline',
    trustScore: 0.5,
    verified: false,
    lastSeen: Date.now(),
  });

  sendWsJson(ws, {
    type: 'SYSTEM_STATUS',
    status: backendHealthy ? 'ONLINE' : 'DEGRADED',
    backend: backendHealthy ? 'CONNECTED' : 'UNREACHABLE',
  });
  if (ralphiePresenceByNode.size > 0) {
    sendWsJson(ws, {
      type: 'RALPHIE_PRESENCE_SNAPSHOT',
      nodes: Array.from(ralphiePresenceByNode.values()),
    });
  }

  if (operatorPresenceById.size > 0) {
    operatorPresenceById.forEach((presenceEnvelope) => {
      sendWsJson(ws, presenceEnvelope);
    });
  }

  ws.on('message', (message: RawData) => {
    try {
      const raw = JSON.parse(message.toString());
      if (raw.type === 'RALPHIE_PRESENCE') {
        const record = upsertRalphiePresence(raw);
        if (!record) {
          sendGatewayError(ws, 'INVALID_SCHEMA', 'Invalid RALPHIE_PRESENCE frame');
          return;
        }
        sendWsJson(ws, { type: 'RALPHIE_PRESENCE_ACK', node_id: record.identity.device_id });
        return;
      }
      if (raw.type === 'COMMAND_FRAME') {
        const validation = CommandSchema.safeParse(raw.data);
        if (!validation.success) {
          logger.warn({ validation_error: validation.error }, 'Invalid command schema');
          sendGatewayError(ws, 'INVALID_SCHEMA', 'Invalid COMMAND_FRAME schema', validation.error);
          return;
        }
        const cmd = validation.data;
        logger.info({ command_type: cmd.type, target: cmd.target, command_id: cmd.id }, 'Dispatching command');
        dispatchCommand(client, cmd, (err, response) => {
          if (err) {
            logger.error({ error: err.message, command_id: cmd.id }, 'C2 RPC error');
            sendWsJson(ws, { type: 'COMMAND_ACK', status: 'FAILED', error: err.message });
          } else {
            logger.info({ unit_id: response.unit_id, command_id: cmd.id }, 'Command dispatched successfully');
            sendWsJson(ws, {
              type: 'COMMAND_ACK',
              status: response.success ? 'SENT' : 'FAILED',
              unit_id: response.unit_id,
              message: response.message,
            });
          }
        });
        return;
      }

      const envelope = parseMessageEnvelope(raw);
      void handleC2Envelope(ws, envelope).catch((error) => {
        logger.error(
          { error: error instanceof Error ? error.message : String(error) },
          'Failed to handle authenticated C2 envelope',
        );
        sendGatewayError(ws, 'ROUTING_ERROR', 'Failed to route envelope');
      });
    } catch (e) {
      logger.error({ error: e instanceof Error ? e.message : String(e) }, 'Message parse error');
      sendGatewayError(ws, 'PARSE_ERROR', 'Invalid JSON format');
    }
  });

  ws.on('close', () => {
    const session = operatorSessionBySocket.get(ws);
    if (session?.clientId) {
      const operatorSockets = socketsByOperatorId.get(session.clientId);
      if (operatorSockets) {
        operatorSockets.delete(ws);
        if (operatorSockets.size === 0) {
          socketsByOperatorId.delete(session.clientId);
          replayStateBySenderId.delete(session.clientId);
          const previousPresence = operatorPresenceById.get(session.clientId);
          const payload =
            previousPresence && typeof previousPresence.payload === 'object' && previousPresence.payload !== null
              ? (previousPresence.payload as Record<string, unknown>)
              : {};
          const offlinePresence = createMessageEnvelope('presence', session.clientId, {
            ...payload,
            status: 'offline',
            trustScore: session.trustScore,
            verified: session.verified,
          });
          setEnvelopeVerificationStatus(offlinePresence, 'STATUS_UNVERIFIED');
          operatorPresenceById.set(session.clientId, offlinePresence);
          broadcast(offlinePresence);
        }
      }
    }
    operatorSessionBySocket.delete(ws);
  });

  ws.on('error', (error) => {
    logger.warn({ error: error.message }, 'WebSocket client error');
  });
});

setInterval(() => {
  const deadline = new Date();
  deadline.setSeconds(deadline.getSeconds() + 5);
  client.waitForReady(deadline, (err?: Error) => {
    if (err) {
      if (backendHealthy && err) {
        logger.error({ error: err.message }, 'CRITICAL: Backend unreachable');
        backendHealthy = false;
        broadcast({ type: 'SYSTEM_ALERT', level: 'CRITICAL', message: 'BACKEND_CONNECTION_LOST' });
      }
    } else if (!backendHealthy) {
      logger.info('Backend connection restored');
      backendHealthy = true;
      broadcast({ type: 'SYSTEM_STATUS', status: 'ONLINE', backend: 'CONNECTED' });
    }
  });
}, 5000);

setInterval(() => {
  pruneStaleRalphiePresence(Date.now());
}, PRESENCE_STALE_SCAN_INTERVAL_MS);

function broadcast(data: unknown) {
  const msg = JSON.stringify(data);
  wss.clients.forEach((clientSocket) => {
    if (clientSocket.readyState === WebSocket.OPEN) {
      clientSocket.send(msg);
    }
  });
}

function upsertRalphiePresence(payload: unknown): RalphiePresenceRecord | null {
  const parsed = RalphiePresenceSchema.safeParse(payload);
  if (!parsed.success) {
    logger.warn({ validation_error: parsed.error.flatten() }, 'Rejected invalid RALPHIE_PRESENCE payload');
    return null;
  }

  const revocationCheck = verifySenderNotRevoked(
    parsed.data.identity.device_id,
    parsed.data.identity.certificate_serial,
  );
  if (!revocationCheck.ok) {
    logger.warn(
      {
        node_id: parsed.data.identity.device_id,
        certificate_serial: parsed.data.identity.certificate_serial,
        code: revocationCheck.code,
      },
      'Rejected revoked RALPHIE_PRESENCE payload',
    );
    return null;
  }

  const signatureCheck = verifyRalphiePresenceSignature(parsed.data);
  if (!signatureCheck.ok) {
    logger.warn(
      {
        code: signatureCheck.code,
        message: signatureCheck.message,
        details: signatureCheck.details,
        node_id: parsed.data.identity.device_id,
      },
      'Rejected unauthenticated RALPHIE_PRESENCE payload',
    );
    return null;
  }

  const normalizedPublicKey =
    normalizePublicKeyPem(parsed.data.identity.public_key) ?? signatureCheck.verifiedWithKeyPem;
  const trustProvenance: PresenceVerificationProvenance = {
    signature_verified: true,
    replay_verified: true,
    key_source: signatureCheck.keySource,
    trust_derivation: 'gateway-v1',
    evaluated_at: Date.now(),
  };
  const derivedTrustScore = deriveServerTrustScore({
    signatureVerified: true,
    replayVerified: true,
    keyPreviouslyBound: signatureCheck.keySource === 'bound',
    tpmBacked: parsed.data.identity.tpm_backed,
  });

  const record: RalphiePresenceRecord = {
    ...parsed.data,
    identity: {
      ...parsed.data.identity,
      public_key: normalizedPublicKey,
      trust_score: derivedTrustScore,
    },
    received_at: trustProvenance.evaluated_at,
    verification: trustProvenance,
  };

  ralphiePresenceByNode.set(record.identity.device_id, record);
  senderPublicKeysById.set(record.identity.device_id, normalizedPublicKey);
  logger.info(
    {
      node_id: record.identity.device_id,
      reason: record.reason,
      endpoint: record.endpoint,
      trust_score: record.identity.trust_score,
      trust_source: 'server_derived',
      verification_key_source: record.verification.key_source,
      tpm_backed: record.identity.tpm_backed,
      has_public_key: !!record.identity.public_key,
      has_telemetry: !!record.telemetry,
      has_gps: !!record.telemetry?.gps,
    },
    'CodeRalphie presence accepted',
  );

  broadcast({ type: 'RALPHIE_PRESENCE', data: record });
  return record;
}

process.on('SIGTERM', () => {
  revocationRegistry.stopPolling();
});

process.on('SIGINT', () => {
  revocationRegistry.stopPolling();
});

server.listen(PORT, () => {
  logger.info({ port: PORT, c2_core: C2_GRPC_TARGET }, '4MIK Gateway active');
});
