import fs from 'node:fs';
import path from 'node:path';
import * as grpc from '@grpc/grpc-js';
import * as protoLoader from '@grpc/proto-loader';
import type pino from 'pino';
import type {
  AdapterHealth,
  AdapterPullResult,
  AethercoreVerificationOverlayV1,
  BridgeConfig,
  GrpcTransportMode,
  LatticeEntityProjectionV1,
  LatticeInboundEventV1,
  LatticeTaskInboxItemV1,
  LatticeVerificationStatus,
} from './types';
import { OAuthTokenManager } from './token-manager';

type GenericRecord = Record<string, unknown>;
type GenericGrpcClient = grpc.Client & Record<string, (...args: unknown[]) => unknown>;

const PROTO_ROOT = path.resolve(__dirname, '..', 'proto', 'lattice-sdk');
const ENTITY_PROTO_PATH = path.join(PROTO_ROOT, 'anduril', 'entitymanager', 'v1', 'entitymanager.proto');
const TASK_PROTO_PATH = path.join(PROTO_ROOT, 'anduril', 'taskmanager', 'v1', 'taskmanager.proto');

function asRecord(value: unknown): GenericRecord {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as GenericRecord;
  }
  return {};
}

function firstString(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === 'string' && value.trim().length > 0) {
      return value.trim();
    }
  }
  return null;
}

function firstNumber(...values: unknown[]): number | null {
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
  return null;
}

function parseJsonRecord(value: unknown): GenericRecord | null {
  if (typeof value !== 'string' || value.trim().length === 0) {
    return null;
  }
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as GenericRecord) : null;
  } catch {
    return null;
  }
}

function nowMs(): number {
  return Date.now();
}

function normalizeStatus(value: unknown): LatticeVerificationStatus {
  const normalized = typeof value === 'string' ? value.toUpperCase() : '';
  if (normalized === 'VERIFIED' || normalized === 'STATUS_UNVERIFIED' || normalized === 'SPOOFED') {
    return normalized;
  }
  return 'STATUS_UNVERIFIED';
}

function deriveTrustPosture(task: GenericRecord): 'trusted' | 'degraded' | 'unknown' {
  const status = firstString(task.trust_posture, task.trustPosture, task.verification_status, task.verificationStatus);
  const normalized = status?.toLowerCase();
  if (normalized === 'trusted' || normalized === 'verified') {
    return 'trusted';
  }
  if (normalized === 'degraded' || normalized === 'spoofed' || normalized === 'status_unverified') {
    return 'degraded';
  }
  return 'unknown';
}

function loadProtoBundle(): grpc.GrpcObject {
  if (!fs.existsSync(ENTITY_PROTO_PATH) || !fs.existsSync(TASK_PROTO_PATH)) {
    throw new Error(
      `Missing lattice proto snapshot. Expected files under ${PROTO_ROOT}. Run pnpm --filter @aethercore/lattice-bridge run proto:types`,
    );
  }

  const definition = protoLoader.loadSync([ENTITY_PROTO_PATH, TASK_PROTO_PATH], {
    keepCase: true,
    longs: String,
    enums: String,
    defaults: true,
    oneofs: true,
    includeDirs: [PROTO_ROOT],
  });

  return grpc.loadPackageDefinition(definition);
}

function readOptionalFile(filePath: string | undefined): Buffer | undefined {
  if (!filePath) {
    return undefined;
  }
  return fs.readFileSync(filePath);
}

function resolveServiceClientCtor(
  bundle: grpc.GrpcObject,
  servicePath: string[],
): grpc.ServiceClientConstructor {
  let cursor: unknown = bundle;
  for (const segment of servicePath) {
    cursor = asRecord(cursor)[segment];
  }
  if (typeof cursor !== 'function') {
    throw new Error(`Unable to resolve gRPC service constructor at ${servicePath.join('.')}`);
  }
  return cursor as grpc.ServiceClientConstructor;
}

interface StreamCollectResult {
  messages: GenericRecord[];
  cursorHint?: string;
  serverTimestampMs?: number;
}

export class LatticeGrpcAdapter {
  private readonly healthState: AdapterHealth = {
    healthy: false,
    lastSuccessAtMs: null,
    lastFailureAtMs: null,
  };
  private readonly targetConfigured: boolean;
  private readonly entityClient: GenericGrpcClient | null;
  private readonly taskClient: GenericGrpcClient | null;

  constructor(
    private readonly config: BridgeConfig,
    private readonly tokenManager: OAuthTokenManager,
    private readonly logger: pino.Logger,
  ) {
    this.targetConfigured = !!config.grpcTarget;
    if (!this.targetConfigured || (config.protocolMode !== 'grpc' && config.protocolMode !== 'hybrid')) {
      this.entityClient = null;
      this.taskClient = null;
      return;
    }

    const { credentials, options } = this.createChannelCredentials();
    const bundle = loadProtoBundle();
    const entityCtor = resolveServiceClientCtor(bundle, ['anduril', 'entitymanager', 'v1', 'EntityManagerAPI']);
    const taskCtor = resolveServiceClientCtor(bundle, ['anduril', 'taskmanager', 'v1', 'TaskManagerAPI']);

    this.entityClient = new entityCtor(config.grpcTarget!, credentials, options) as unknown as GenericGrpcClient;
    this.taskClient = new taskCtor(config.grpcTarget!, credentials, options) as unknown as GenericGrpcClient;
  }

  get health(): AdapterHealth {
    return { ...this.healthState };
  }

  get transportMode(): GrpcTransportMode {
    return this.config.grpcTransportMode;
  }

  get isTargetConfigured(): boolean {
    return this.targetConfigured;
  }

  private markSuccess(): void {
    this.healthState.healthy = true;
    this.healthState.lastSuccessAtMs = nowMs();
    this.healthState.lastError = undefined;
  }

  private markFailure(error: unknown): void {
    this.healthState.healthy = false;
    this.healthState.lastFailureAtMs = nowMs();
    this.healthState.lastError = error instanceof Error ? error.message : String(error);
  }

  private createChannelCredentials(): {
    credentials: grpc.ChannelCredentials;
    options: grpc.ChannelOptions;
  } {
    if (this.config.grpcInsecure) {
      if (this.config.isProduction) {
        throw new Error('Refusing insecure lattice gRPC transport in production mode');
      }
      return {
        credentials: grpc.credentials.createInsecure(),
        options: {},
      };
    }

    const caCert = readOptionalFile(this.config.grpcCaCertPath);
    const clientCert = readOptionalFile(this.config.grpcClientCertPath);
    const clientKey = readOptionalFile(this.config.grpcClientKeyPath);
    const hasClientMaterial = !!clientCert || !!clientKey;
    if (hasClientMaterial && (!clientCert || !clientKey)) {
      throw new Error('Both LATTICE_GRPC_CLIENT_CERT_PATH and LATTICE_GRPC_CLIENT_KEY_PATH are required for mTLS');
    }

    const options: grpc.ChannelOptions = {};
    if (this.config.grpcServerNameOverride) {
      options['grpc.ssl_target_name_override'] = this.config.grpcServerNameOverride;
      options['grpc.default_authority'] = this.config.grpcServerNameOverride;
    }

    return {
      credentials: grpc.credentials.createSsl(caCert ?? undefined, clientKey ?? undefined, clientCert ?? undefined),
      options,
    };
  }

  private async probeGrpcReachability(client: grpc.Client): Promise<void> {
    const deadline = new Date(Date.now() + Math.max(1000, this.config.grpcPollWindowMs));
    await new Promise<void>((resolve, reject) => {
      client.waitForReady(deadline, (error?: Error | null) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });
  }

  private openStream(
    client: GenericGrpcClient,
    methodCandidates: string[],
    request: GenericRecord,
    metadata: grpc.Metadata,
  ): grpc.ClientReadableStream<GenericRecord> {
    for (const method of methodCandidates) {
      const candidate = client[method];
      if (typeof candidate !== 'function') {
        continue;
      }
      return candidate.call(client, request, metadata) as grpc.ClientReadableStream<GenericRecord>;
    }

    throw new Error(`No supported stream method found (${methodCandidates.join(', ')})`);
  }

  private async collectStream(
    client: GenericGrpcClient,
    methodCandidates: string[],
    request: GenericRecord,
  ): Promise<StreamCollectResult> {
    const metadata = await this.tokenManager.buildGrpcMetadata();
    const stream = this.openStream(client, methodCandidates, request, metadata);
    const messages: GenericRecord[] = [];
    let cursorHint: string | undefined;
    let serverTimestampMs: number | undefined;
    let timeoutTriggered = false;
    let settled = false;

    return await new Promise<StreamCollectResult>((resolve, reject) => {
      const timeoutHandle = setTimeout(() => {
        timeoutTriggered = true;
        stream.cancel();
      }, this.config.grpcPollWindowMs);

      const complete = (error?: unknown) => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timeoutHandle);
        if (error) {
          reject(error);
          return;
        }
        resolve({
          messages,
          cursorHint,
          serverTimestampMs,
        });
      };

      stream.on('data', (message: unknown) => {
        const record = asRecord(message);
        if (Object.keys(record).length === 0) {
          return;
        }
        messages.push(record);

        const nextCursor = firstString(record.cursor, record.next_cursor);
        if (nextCursor) {
          cursorHint = nextCursor;
        }
        const timestamp = firstNumber(record.server_timestamp_ms, record.serverTimestampMs);
        if (timestamp !== null) {
          serverTimestampMs = timestamp;
        }
      });

      stream.on('end', () => complete());
      stream.on('error', (error: grpc.ServiceError) => {
        if (
          timeoutTriggered &&
          (error.code === grpc.status.CANCELLED || error.code === grpc.status.DEADLINE_EXCEEDED)
        ) {
          complete();
          return;
        }
        complete(error);
      });
    });
  }

  async pullEntities(cursor: string | null): Promise<AdapterPullResult> {
    if (!this.entityClient) {
      throw new Error('gRPC entity client is not configured');
    }

    try {
      await this.probeGrpcReachability(this.entityClient);
      const response = await this.collectStream(
        this.entityClient,
        ['StreamEntities', 'WatchEntities', 'StreamEntityEvents'],
        {
          since: cursor || '',
          max_events: this.config.grpcMaxEvents,
          source: 'aethercore-bridge',
        },
      );

      const events: LatticeInboundEventV1[] = [];
      let maxUpdateMs = 0;
      for (const chunk of response.messages) {
        const entity = asRecord(chunk.entity ?? chunk.event ?? chunk.payload ?? chunk);
        const entityId = firstString(entity.entity_id, entity.entityId, entity.id);
        if (!entityId) {
          continue;
        }

        const sourceUpdateTimeMs =
          firstNumber(entity.source_update_time_ms, entity.sourceUpdateTime, entity.updated_at_ms, entity.updatedAt) ||
          nowMs();
        maxUpdateMs = Math.max(maxUpdateMs, sourceUpdateTimeMs);

        const source = firstString(entity.source, entity.provenance, entity.owner) || 'lattice';
        const rawEntity =
          parseJsonRecord(entity.raw_entity_json) ||
          parseJsonRecord(entity.rawEntityJson) ||
          parseJsonRecord(firstString(chunk.raw_entity_json, chunk.rawEntityJson)) || {
            ...entity,
          };

        const overlayRecord =
          parseJsonRecord(entity.overlay_json) ||
          parseJsonRecord(entity.overlayJson) ||
          parseJsonRecord(firstString(chunk.overlay_json, chunk.overlayJson));

        const projection: LatticeEntityProjectionV1 = {
          schema_version: 'lattice.entity.projection.v1',
          entity_id: entityId,
          source,
          source_update_time_ms: sourceUpdateTimeMs,
          event_type: String(entity.deleted).toLowerCase() === 'true' ? 'DELETE' : 'UPSERT',
          verification_status: normalizeStatus(entity.verification_status),
          received_at_ms: nowMs(),
          raw_entity: rawEntity,
          overlay: overlayRecord ? (overlayRecord as unknown as AethercoreVerificationOverlayV1) : undefined,
        };

        events.push({
          schema_version: 'lattice.inbound.event.v1',
          source_protocol: 'grpc',
          event_id: `grpc:entity:${entityId}:${sourceUpdateTimeMs}`,
          stream_id: `lattice:entity:${entityId}`,
          received_at_ms: projection.received_at_ms,
          event: { kind: 'entity', projection },
        });
      }

      this.markSuccess();
      return {
        events,
        cursorHint: response.cursorHint || (maxUpdateMs > 0 ? String(maxUpdateMs) : cursor || undefined),
        serverTimestampMs: response.serverTimestampMs || nowMs(),
      };
    } catch (error) {
      this.markFailure(error);
      throw error;
    }
  }

  async pullTasks(cursor: string | null): Promise<AdapterPullResult> {
    if (!this.taskClient) {
      throw new Error('gRPC task client is not configured');
    }
    if (!this.config.latticeAgentId) {
      throw new Error('Live lattice configuration missing: LATTICE_AGENT_ID');
    }

    try {
      await this.probeGrpcReachability(this.taskClient);
      const response = await this.collectStream(
        this.taskClient,
        ['ListenAsAgent', 'ListenAsAgentStream', 'StreamTasks'],
        {
          agent_id: this.config.latticeAgentId,
          since: cursor || '',
          max_events: this.config.grpcMaxEvents,
        },
      );

      const events: LatticeInboundEventV1[] = [];
      let maxStatusVersion = 0;
      for (const chunk of response.messages) {
        const task = asRecord(chunk.task ?? chunk.event ?? chunk.payload ?? chunk);
        const taskId = firstString(task.task_id, task.taskId, task.id);
        if (!taskId) {
          continue;
        }

        const statusVersion = firstNumber(task.status_version, task.statusVersion, task.version, 0) || 0;
        maxStatusVersion = Math.max(maxStatusVersion, statusVersion);
        const receivedAtMs = nowMs();
        const updatedAtMs = firstNumber(task.updated_at_ms, task.updatedAt, task.timestamp) || receivedAtMs;
        const rawTask =
          parseJsonRecord(task.raw_task_json) ||
          parseJsonRecord(task.rawTaskJson) ||
          parseJsonRecord(firstString(chunk.raw_task_json, chunk.rawTaskJson)) || {
            ...task,
          };

        const inbox: LatticeTaskInboxItemV1 = {
          schema_version: 'lattice.task.inbox.v1',
          task_id: taskId,
          assigned_agent_id:
            firstString(task.assigned_agent_id, task.assignedAgentId, task.assigned_to, this.config.latticeAgentId) ||
            this.config.latticeAgentId,
          status: firstString(task.status, task.state) || 'UNKNOWN',
          status_version: statusVersion,
          freshness_ms: Math.max(0, receivedAtMs - updatedAtMs),
          trust_posture: deriveTrustPosture(task),
          title: firstString(task.title, task.name) || undefined,
          description: firstString(task.description, task.summary) || undefined,
          read_only: true,
          raw_task: rawTask,
          received_at_ms: receivedAtMs,
        };

        events.push({
          schema_version: 'lattice.inbound.event.v1',
          source_protocol: 'grpc',
          event_id: `grpc:task:${taskId}:${statusVersion}`,
          stream_id: `lattice:task:${inbox.assigned_agent_id}`,
          received_at_ms: inbox.received_at_ms,
          event: { kind: 'task', task: inbox },
        });
      }

      this.markSuccess();
      return {
        events,
        cursorHint: response.cursorHint || (maxStatusVersion > 0 ? String(maxStatusVersion) : cursor || undefined),
        serverTimestampMs: response.serverTimestampMs || nowMs(),
      };
    } catch (error) {
      this.markFailure(error);
      throw error;
    }
  }

  close(): void {
    this.entityClient?.close();
    this.taskClient?.close();
  }
}
