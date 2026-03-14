import type pino from 'pino';
import type {
  AdapterHealth,
  AdapterPullResult,
  AethercoreVerificationOverlayV1,
  BridgeConfig,
  LatticeEntityProjectionV1,
  LatticeInboundEventV1,
  LatticeObjectRecordV1,
  LatticeTaskInboxItemV1,
  LatticeVerificationStatus,
} from './types';
import { OAuthTokenManager } from './token-manager';

function normalizeStatus(value: unknown): LatticeVerificationStatus {
  const normalized = typeof value === 'string' ? value.toUpperCase() : '';
  if (normalized === 'VERIFIED' || normalized === 'STATUS_UNVERIFIED' || normalized === 'SPOOFED') {
    return normalized;
  }
  return 'STATUS_UNVERIFIED';
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
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

function extractArray(payload: unknown): Record<string, unknown>[] {
  if (Array.isArray(payload)) {
    return payload.filter((item): item is Record<string, unknown> => !!item && typeof item === 'object');
  }

  const record = asRecord(payload);
  const candidates = [record.entities, record.tasks, record.objects, record.items, record.data];
  for (const candidate of candidates) {
    if (Array.isArray(candidate)) {
      return candidate.filter((item): item is Record<string, unknown> => !!item && typeof item === 'object');
    }
  }
  return [];
}

function deriveTrustPosture(task: Record<string, unknown>): 'trusted' | 'degraded' | 'unknown' {
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

function nowMs(): number {
  return Date.now();
}

function toObjectRecord(payload: Record<string, unknown>): LatticeObjectRecordV1 | null {
  const objectId = firstString(payload.object_id, payload.objectId, payload.id);
  const entityId = firstString(payload.entity_id, payload.entityId, payload.track_id, payload.trackId);
  if (!objectId || !entityId) {
    return null;
  }

  return {
    schema_version: 'lattice.object.record.v1',
    object_id: objectId,
    entity_id: entityId,
    object_key: firstString(payload.object_key, payload.objectKey, payload.key) || undefined,
    media_type: firstString(payload.media_type, payload.mediaType, payload.mime_type, payload.mimeType) || undefined,
    ttl_seconds: firstNumber(payload.ttl_seconds, payload.ttlSeconds) || undefined,
    metadata: asRecord(payload.metadata),
    created_at_ms: firstNumber(payload.created_at_ms, payload.createdAt, payload.updated_at_ms, payload.updatedAt) || nowMs(),
  };
}

export class LatticeRestAdapter {
  private readonly baseUrl: string;
  private readonly apiPrefix = '/api/v2';
  private readonly healthState: AdapterHealth = {
    healthy: false,
    lastSuccessAtMs: null,
    lastFailureAtMs: null,
  };

  constructor(
    private readonly config: BridgeConfig,
    private readonly tokenManager: OAuthTokenManager,
    private readonly logger: pino.Logger,
  ) {
    this.baseUrl = (config.latticeBaseUrl || '').replace(/\/$/, '');
  }

  get health(): AdapterHealth {
    return { ...this.healthState };
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

  private assertLiveConfigured(requireAgent = false): void {
    const missing: string[] = [];
    if (!this.config.latticeBaseUrl) {
      missing.push('LATTICE_BASE_URL');
    }
    if (!this.config.latticeClientId) {
      missing.push('LATTICE_CLIENT_ID');
    }
    if (!this.config.latticeClientSecret) {
      missing.push('LATTICE_CLIENT_SECRET');
    }
    if (requireAgent && !this.config.latticeAgentId) {
      missing.push('LATTICE_AGENT_ID');
    }
    if (missing.length > 0) {
      throw new Error(`Live lattice configuration missing: ${missing.join(', ')}`);
    }
  }

  private async requestJson<T>(path: string, init?: RequestInit): Promise<T> {
    this.assertLiveConfigured();
    const token = await this.tokenManager.getAccessToken();
    const headers: Record<string, string> = {
      Authorization: `Bearer ${token}`,
      ...(init?.headers as Record<string, string> | undefined),
    };

    if (this.config.sandboxMode && this.config.sandboxesToken) {
      headers['Anduril-Sandbox-Authorization'] = `Bearer ${this.config.sandboxesToken}`;
    }

    const response = await fetch(`${this.baseUrl}${path}`, {
      ...init,
      headers,
    });
    if (!response.ok) {
      const body = await response.text();
      throw new Error(`REST request failed (${response.status}) for ${path}: ${body.slice(0, 384)}`);
    }
    return (await response.json()) as T;
  }

  async pullEntities(cursor: string | null): Promise<AdapterPullResult> {
    try {
      const query = cursor ? `?since=${encodeURIComponent(cursor)}` : '';
      const payload = await this.requestJson<unknown>(`${this.apiPrefix}/entities${query}`, { method: 'GET' });
      const entities = extractArray(payload);
      const events: LatticeInboundEventV1[] = [];
      let maxUpdateMs = 0;

      for (const entity of entities) {
        const entityId = firstString(entity.entity_id, entity.entityId, entity.id);
        if (!entityId) {
          continue;
        }
        const sourceUpdateTimeMs =
          firstNumber(
            entity.source_update_time_ms,
            entity.source_update_time,
            entity.sourceUpdateTime,
            entity.updated_at_ms,
            entity.updatedAt,
          ) ||
          nowMs();
        maxUpdateMs = Math.max(maxUpdateMs, sourceUpdateTimeMs);
        const source = firstString(entity.source, entity.provenance, entity.owner) || 'lattice';
        const overlayComponent = asRecord(entity.components)?.['aethercore.verification.v1'];
        const overlayRecord = asRecord(overlayComponent);
        const verificationStatus = normalizeStatus(
          overlayRecord.verification_status ?? entity.verification_status ?? entity.verificationStatus,
        );

        const projection: LatticeEntityProjectionV1 = {
          schema_version: 'lattice.entity.projection.v1',
          entity_id: entityId,
          source,
          source_update_time_ms: sourceUpdateTimeMs,
          event_type: String(entity.deleted).toLowerCase() === 'true' ? 'DELETE' : 'UPSERT',
          verification_status: verificationStatus,
          received_at_ms: nowMs(),
          raw_entity: entity,
          overlay:
            overlayRecord && Object.keys(overlayRecord).length > 0
              ? (overlayRecord as unknown as AethercoreVerificationOverlayV1)
              : undefined,
        };

        events.push({
          schema_version: 'lattice.inbound.event.v1',
          source_protocol: 'rest',
          event_id: `rest:entity:${entityId}:${sourceUpdateTimeMs}`,
          stream_id: `lattice:entity:${entityId}`,
          received_at_ms: projection.received_at_ms,
          event: { kind: 'entity', projection },
        });
      }

      this.markSuccess();
      return {
        events,
        cursorHint: maxUpdateMs > 0 ? String(maxUpdateMs) : cursor || undefined,
        serverTimestampMs: nowMs(),
      };
    } catch (error) {
      this.markFailure(error);
      throw error;
    }
  }

  async pullTasks(cursor: string | null): Promise<AdapterPullResult> {
    try {
      this.assertLiveConfigured(true);
      // Use v2 listen-as-agent stream endpoint for read-only task inbox ingestion.
      const agentId = this.config.latticeAgentId as string;
      const queryParts = [
        `agentId=${encodeURIComponent(agentId)}`,
        `agent_id=${encodeURIComponent(agentId)}`,
      ];
      if (cursor) {
        queryParts.push(`since=${encodeURIComponent(cursor)}`);
      }
      const payload = await this.requestJson<unknown>(
        `${this.apiPrefix}/tasks/listen-as-agent-stream?${queryParts.join('&')}`,
        { method: 'GET' },
      );
      const tasks = extractArray(payload);
      const events: LatticeInboundEventV1[] = [];
      let maxStatusVersion = 0;

      for (const task of tasks) {
        const taskId = firstString(task.task_id, task.taskId, task.id);
        if (!taskId) {
          continue;
        }
        const statusVersion = firstNumber(task.status_version, task.statusVersion, task.version, 0) || 0;
        maxStatusVersion = Math.max(maxStatusVersion, statusVersion);
        const receivedAt = nowMs();

        const item: LatticeTaskInboxItemV1 = {
          schema_version: 'lattice.task.inbox.v1',
          task_id: taskId,
          assigned_agent_id:
            firstString(task.assigned_agent_id, task.assignedAgentId, task.assigned_to, agentId) || agentId,
          status: firstString(task.status, task.state) || 'UNKNOWN',
          status_version: statusVersion,
          freshness_ms: Math.max(0, receivedAt - (firstNumber(task.updated_at_ms, task.updatedAt, task.timestamp) || receivedAt)),
          trust_posture: deriveTrustPosture(task),
          title: firstString(task.title, task.name) || undefined,
          description: firstString(task.description, task.summary) || undefined,
          read_only: true,
          raw_task: task,
          received_at_ms: receivedAt,
        };

        events.push({
          schema_version: 'lattice.inbound.event.v1',
          source_protocol: 'rest',
          event_id: `rest:task:${taskId}:${statusVersion}`,
          stream_id: `lattice:task:${item.assigned_agent_id}`,
          received_at_ms: item.received_at_ms,
          event: { kind: 'task', task: item },
        });
      }

      this.markSuccess();
      return {
        events,
        cursorHint: maxStatusVersion > 0 ? String(maxStatusVersion) : cursor || undefined,
        serverTimestampMs: nowMs(),
      };
    } catch (error) {
      this.markFailure(error);
      throw error;
    }
  }

  async pullObjects(cursor: string | null): Promise<AdapterPullResult> {
    try {
      this.assertLiveConfigured();
      const queryParts: string[] = ['limit=200'];
      if (cursor) {
        queryParts.push(`since=${encodeURIComponent(cursor)}`);
      }
      const suffix = queryParts.length > 0 ? `?${queryParts.join('&')}` : '';
      const payload = await this.requestJson<unknown>(`${this.apiPrefix}/objects${suffix}`, { method: 'GET' });
      const records = extractArray(payload)
        .map((item) => toObjectRecord(item))
        .filter((item): item is LatticeObjectRecordV1 => item !== null);
      const events: LatticeInboundEventV1[] = records.map((record) => ({
        schema_version: 'lattice.inbound.event.v1',
        source_protocol: 'rest',
        event_id: `rest:object:${record.object_id}:${record.created_at_ms}`,
        stream_id: `lattice:object:${record.entity_id}`,
        received_at_ms: nowMs(),
        event: {
          kind: 'object',
          object: record,
        },
      }));
      const maxCreatedAt = records.reduce((max, record) => Math.max(max, record.created_at_ms), 0);
      this.markSuccess();
      return {
        events,
        cursorHint: maxCreatedAt > 0 ? String(maxCreatedAt) : cursor || undefined,
        serverTimestampMs: nowMs(),
      };
    } catch (error) {
      this.markFailure(error);
      throw error;
    }
  }

  async publishVerificationOverlay(
    entityId: string,
    overlay: AethercoreVerificationOverlayV1,
    sourceUpdateTimeMs: number,
  ): Promise<Record<string, unknown>> {
    this.assertLiveConfigured();
    const payload = {
      entityId,
      sourceUpdateTime: sourceUpdateTimeMs,
      components: {
        'aethercore.verification.v1': overlay,
      },
    };

    const response = await this.requestJson<Record<string, unknown>>(`${this.apiPrefix}/entities`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    this.markSuccess();
    return response;
  }

  async registerObject(record: LatticeObjectRecordV1): Promise<Record<string, unknown>> {
    this.assertLiveConfigured();
    const payload = {
      objectId: record.object_id,
      entityId: record.entity_id,
      objectKey: record.object_key,
      mediaType: record.media_type,
      ttlSeconds: record.ttl_seconds,
      metadata: record.metadata || {},
    };
    const response = await this.uploadObjectPayload(payload);
    this.markSuccess();
    return response;
  }

  async uploadObjectPayload(payload: Record<string, unknown>): Promise<Record<string, unknown>> {
    this.assertLiveConfigured();
    try {
      const response = await this.requestJson<Record<string, unknown>>(`${this.apiPrefix}/objects/upload`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      this.markSuccess();
      return response;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!message.includes('(404)') && !message.includes('(405)')) {
        this.markFailure(error);
        throw error;
      }
      this.logger.warn('Objects upload endpoint not available; falling back to /objects create route');
    }

    const response = await this.requestJson<Record<string, unknown>>(`${this.apiPrefix}/objects`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    this.markSuccess();
    return response;
  }

  async listObjects(entityId?: string, limit = 100): Promise<LatticeObjectRecordV1[]> {
    this.assertLiveConfigured();
    const queryParts: string[] = [];
    if (entityId) {
      queryParts.push(`entityId=${encodeURIComponent(entityId)}`);
      queryParts.push(`entity_id=${encodeURIComponent(entityId)}`);
    }
    queryParts.push(`limit=${Math.max(1, Math.min(500, limit))}`);
    const suffix = queryParts.length > 0 ? `?${queryParts.join('&')}` : '';
    const payload = await this.requestJson<unknown>(`${this.apiPrefix}/objects${suffix}`, { method: 'GET' });
    const records = extractArray(payload)
      .map((item) => toObjectRecord(item))
      .filter((item): item is LatticeObjectRecordV1 => item !== null);
    this.markSuccess();
    return records;
  }

  async getObject(objectId: string): Promise<Record<string, unknown>> {
    this.assertLiveConfigured();
    const encodedId = encodeURIComponent(objectId);
    try {
      const response = await this.requestJson<Record<string, unknown>>(`${this.apiPrefix}/objects/${encodedId}`, {
        method: 'GET',
      });
      this.markSuccess();
      return response;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!message.includes('(404)') && !message.includes('(405)')) {
        this.markFailure(error);
        throw error;
      }
      this.logger.warn({ object_id: objectId }, 'Object metadata endpoint not available; falling back to download path');
    }

    const response = await this.requestJson<Record<string, unknown>>(`${this.apiPrefix}/objects/${encodedId}/download`, {
      method: 'GET',
    });
    this.markSuccess();
    return response;
  }
}
