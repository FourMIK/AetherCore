import express from 'express';
import { createServer } from 'http';
import * as crypto from 'node:crypto';
import { WebSocketServer, WebSocket, type RawData } from 'ws';
import { z } from 'zod';
import cors from 'cors';
import dotenv from 'dotenv';
import pino from 'pino';
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
const EXPOSE_PRESENCE_REJECT_DETAILS = parseBooleanEnv(
  'AETHERCORE_DEBUG_PRESENCE_ERRORS',
  !isProductionMode(),
);

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
type RalphiePresenceUpsertSuccess = {
  ok: true;
  record: RalphiePresenceRecord;
};
type RalphiePresenceUpsertFailure = {
  ok: false;
  code: string;
  message: string;
  details?: unknown;
  httpStatus: number;
};
type RalphiePresenceUpsertResult = RalphiePresenceUpsertSuccess | RalphiePresenceUpsertFailure;
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

const client = createC2RouterClient(C2_GRPC_TARGET);
const ralphiePresenceByNode = new Map<string, RalphiePresenceRecord>();
const operatorSessionBySocket = new Map<WebSocket, OperatorSession>();
const socketsByOperatorId = new Map<string, Set<WebSocket>>();
const operatorPresenceById = new Map<string, MessageEnvelope>();
const senderPublicKeysById = new Map<string, string>();
const replayStateBySenderId = new Map<string, SenderReplayState>();
const MAX_REPLAY_NONCE_WINDOW = 2048;
const revocationRegistry = new DistributedRevocationRegistry({
  sourceUrl: REVOCATION_SOURCE_URL,
  refreshIntervalMs: REVOCATION_REFRESH_INTERVAL_MS,
  requestTimeoutMs: REVOCATION_REQUEST_TIMEOUT_MS,
});

const app = express();
app.use(cors());
app.use(express.json());

// Health check endpoint for Docker/Kubernetes readiness probes
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok' });
});

app.post('/ralphie/presence', (req, res) => {
  const result = upsertRalphiePresence(req.body);
  if (!result.ok) {
    const responsePayload: {
      status: 'error';
      code: string;
      message: string;
      details?: unknown;
    } = {
      status: 'error',
      code: result.code,
      message: result.message,
    };
    if (EXPOSE_PRESENCE_REJECT_DETAILS && result.details !== undefined) {
      responsePayload.details = result.details;
    }
    res.status(result.httpStatus).json(responsePayload);
    return;
  }
  res.status(202).json({ status: 'accepted', node_id: result.record.identity.device_id });
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

function routeEnvelopeByRecipient(ws: WebSocket, envelope: MessageEnvelope): void {
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

  const routedEnvelope: MessageEnvelope = { ...envelope };
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
    sendWsJson(ws, buildAckEnvelope(recipientId, envelope.message_id, false, 'recipient_offline'));
  }
}

function handleC2Envelope(ws: WebSocket, envelope: MessageEnvelope): void {
  switch (envelope.type) {
    case 'presence':
      handleOperatorPresenceEnvelope(ws, envelope);
      break;
    case 'chat':
    case 'call_invite':
    case 'call_accept':
    case 'call_reject':
    case 'call_end':
      routeEnvelopeByRecipient(ws, envelope);
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
        const result = upsertRalphiePresence(raw);
        if (!result.ok) {
          sendGatewayError(
            ws,
            result.code,
            result.message,
            EXPOSE_PRESENCE_REJECT_DETAILS ? result.details : undefined,
          );
          return;
        }
        sendWsJson(ws, { type: 'RALPHIE_PRESENCE_ACK', node_id: result.record.identity.device_id });
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
      handleC2Envelope(ws, envelope);
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

function broadcast(data: unknown) {
  const msg = JSON.stringify(data);
  wss.clients.forEach((clientSocket) => {
    if (clientSocket.readyState === WebSocket.OPEN) {
      clientSocket.send(msg);
    }
  });
}

function upsertRalphiePresence(payload: unknown): RalphiePresenceUpsertResult {
  const parsed = RalphiePresenceSchema.safeParse(payload);
  if (!parsed.success) {
    logger.warn({ validation_error: parsed.error.flatten() }, 'Rejected invalid RALPHIE_PRESENCE payload');
    return {
      ok: false,
      code: 'PRESENCE_SCHEMA_INVALID',
      message: 'Presence payload failed schema validation',
      details: parsed.error.flatten(),
      httpStatus: 400,
    };
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
    return {
      ok: false,
      code: revocationCheck.code,
      message: revocationCheck.message,
      details: revocationCheck.details,
      httpStatus: revocationCheck.code === 'IDENTITY_REVOKED' ? 403 : 503,
    };
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
    return {
      ok: false,
      code: signatureCheck.code,
      message: signatureCheck.message,
      details: signatureCheck.details,
      httpStatus: 401,
    };
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
  return {
    ok: true,
    record,
  };
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
