export type RevocationCertificate = {
  node_id: string;
  revocation_reason?: string;
  issuer_id?: string;
  timestamp_ns?: number;
  signature?: string;
  merkle_root?: string;
  certificate_serial?: string | null;
};

export type RevocationSyncSummary = {
  sourceUrl: string;
  revokedNodeCount: number;
  revokedCertificateCount: number;
  lastUpdatedNs: number | null;
};

export type RevocationLookup =
  | {
      revoked: false;
    }
  | {
      revoked: true;
      certificate: RevocationCertificate;
      matchedBy: 'node_id' | 'certificate_serial';
    };

type RevocationPayloadMetadata = {
  lastUpdatedNs: number | null;
};

function asObject(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function normalizeNodeId(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function normalizeCertificateSerial(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const normalized = value.replace(/[^a-fA-F0-9]/g, '').toLowerCase();
  return normalized.length > 0 ? normalized : null;
}

function parseRevocationCertificate(
  value: unknown,
  fallbackNodeId?: string,
): RevocationCertificate | null {
  const record = asObject(value);
  if (!record) {
    return null;
  }
  const nodeId = normalizeNodeId(record.node_id ?? record.nodeId ?? fallbackNodeId);
  if (!nodeId) {
    return null;
  }

  const certificateSerial = normalizeCertificateSerial(
    record.certificate_serial ?? record.certificateSerial ?? record.serial,
  );
  const timestampRaw = record.timestamp_ns ?? record.timestampNs;
  const timestampNs =
    typeof timestampRaw === 'number' && Number.isFinite(timestampRaw) && timestampRaw > 0
      ? Math.trunc(timestampRaw)
      : undefined;

  return {
    node_id: nodeId,
    revocation_reason:
      typeof record.revocation_reason === 'string'
        ? record.revocation_reason
        : typeof record.revocationReason === 'string'
          ? record.revocationReason
          : undefined,
    issuer_id:
      typeof record.issuer_id === 'string'
        ? record.issuer_id
        : typeof record.issuerId === 'string'
          ? record.issuerId
          : undefined,
    timestamp_ns: timestampNs,
    signature: typeof record.signature === 'string' ? record.signature : undefined,
    merkle_root:
      typeof record.merkle_root === 'string'
        ? record.merkle_root
        : typeof record.merkleRoot === 'string'
          ? record.merkleRoot
          : undefined,
    certificate_serial: certificateSerial,
  };
}

function parseLastUpdatedNs(raw: unknown): number | null {
  if (typeof raw === 'number' && Number.isFinite(raw) && raw > 0) {
    return Math.trunc(raw);
  }
  return null;
}

function parseRevocationPayload(raw: unknown): {
  certificates: RevocationCertificate[];
  metadata: RevocationPayloadMetadata;
} {
  const metadata: RevocationPayloadMetadata = {
    lastUpdatedNs: null,
  };

  if (Array.isArray(raw)) {
    const certificates = raw
      .map((entry) => parseRevocationCertificate(entry))
      .filter((entry): entry is RevocationCertificate => !!entry);
    return { certificates, metadata };
  }

  const root = asObject(raw);
  if (!root) {
    return { certificates: [], metadata };
  }

  metadata.lastUpdatedNs = parseLastUpdatedNs(
    root.last_updated_ns ?? root.lastUpdatedNs ?? root.updated_at_ns ?? root.updatedAtNs,
  );

  const revokedNodes = asObject(root.revoked_nodes ?? root.revokedNodes);
  if (revokedNodes) {
    const certificates: RevocationCertificate[] = [];
    for (const [nodeId, certValue] of Object.entries(revokedNodes)) {
      const cert = parseRevocationCertificate(certValue, nodeId);
      if (cert) {
        certificates.push(cert);
      }
    }
    return { certificates, metadata };
  }

  const revocations = root.revocations;
  if (Array.isArray(revocations)) {
    const certificates = revocations
      .map((entry) => parseRevocationCertificate(entry))
      .filter((entry): entry is RevocationCertificate => !!entry);
    return { certificates, metadata };
  }

  const single = parseRevocationCertificate(root);
  if (single) {
    return { certificates: [single], metadata };
  }
  return { certificates: [], metadata };
}

export class DistributedRevocationRegistry {
  private readonly sourceUrl: string | null;

  private readonly refreshIntervalMs: number;

  private readonly requestTimeoutMs: number;

  private refreshTimer: NodeJS.Timeout | null = null;

  private revokedByNodeId = new Map<string, RevocationCertificate>();

  private revokedByCertificateSerial = new Map<string, RevocationCertificate>();

  private hasSuccessfulSync = false;

  private lastSyncAtMs: number | null = null;

  private lastSyncError: string | null = null;

  private lastUpdatedNs: number | null = null;

  constructor(config: {
    sourceUrl?: string | null;
    refreshIntervalMs: number;
    requestTimeoutMs: number;
  }) {
    const trimmed = config.sourceUrl?.trim() ?? '';
    this.sourceUrl = trimmed.length > 0 ? trimmed : null;
    this.refreshIntervalMs = Math.max(1000, Math.trunc(config.refreshIntervalMs));
    this.requestTimeoutMs = Math.max(500, Math.trunc(config.requestTimeoutMs));
  }

  isConfigured(): boolean {
    return !!this.sourceUrl;
  }

  hasSynced(): boolean {
    return this.hasSuccessfulSync;
  }

  getLastSyncAtMs(): number | null {
    return this.lastSyncAtMs;
  }

  getLastSyncError(): string | null {
    return this.lastSyncError;
  }

  getRevokedNodeCount(): number {
    return this.revokedByNodeId.size;
  }

  getSnapshot(): {
    sourceUrl: string | null;
    hasSynced: boolean;
    lastSyncAtMs: number | null;
    lastSyncError: string | null;
    revokedNodeCount: number;
    revokedCertificateCount: number;
    lastUpdatedNs: number | null;
  } {
    return {
      sourceUrl: this.sourceUrl,
      hasSynced: this.hasSuccessfulSync,
      lastSyncAtMs: this.lastSyncAtMs,
      lastSyncError: this.lastSyncError,
      revokedNodeCount: this.revokedByNodeId.size,
      revokedCertificateCount: this.revokedByCertificateSerial.size,
      lastUpdatedNs: this.lastUpdatedNs,
    };
  }

  checkIdentity(nodeId: string, certificateSerial?: string | null): RevocationLookup {
    const normalizedNodeId = normalizeNodeId(nodeId);
    if (normalizedNodeId) {
      const byNodeId = this.revokedByNodeId.get(normalizedNodeId);
      if (byNodeId) {
        return {
          revoked: true,
          certificate: byNodeId,
          matchedBy: 'node_id',
        };
      }
    }

    const normalizedSerial = normalizeCertificateSerial(certificateSerial);
    if (normalizedSerial) {
      const bySerial = this.revokedByCertificateSerial.get(normalizedSerial);
      if (bySerial) {
        return {
          revoked: true,
          certificate: bySerial,
          matchedBy: 'certificate_serial',
        };
      }
    }

    return { revoked: false };
  }

  async refresh(): Promise<RevocationSyncSummary | null> {
    if (!this.sourceUrl) {
      return null;
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.requestTimeoutMs);
    try {
      const response = await fetch(this.sourceUrl, {
        method: 'GET',
        signal: controller.signal,
        headers: { Accept: 'application/json' },
      });
      if (!response.ok) {
        throw new Error(`Revocation source returned HTTP ${response.status}`);
      }

      const payload = await response.json();
      const { certificates, metadata } = parseRevocationPayload(payload);

      const nextByNodeId = new Map<string, RevocationCertificate>();
      const nextBySerial = new Map<string, RevocationCertificate>();
      for (const cert of certificates) {
        nextByNodeId.set(cert.node_id, cert);
        if (cert.certificate_serial) {
          const normalizedSerial = normalizeCertificateSerial(cert.certificate_serial);
          if (normalizedSerial) {
            nextBySerial.set(normalizedSerial, cert);
          }
        }
      }

      this.revokedByNodeId = nextByNodeId;
      this.revokedByCertificateSerial = nextBySerial;
      this.lastUpdatedNs = metadata.lastUpdatedNs;
      this.hasSuccessfulSync = true;
      this.lastSyncAtMs = Date.now();
      this.lastSyncError = null;

      return {
        sourceUrl: this.sourceUrl,
        revokedNodeCount: this.revokedByNodeId.size,
        revokedCertificateCount: this.revokedByCertificateSerial.size,
        lastUpdatedNs: this.lastUpdatedNs,
      };
    } catch (error) {
      this.lastSyncError = error instanceof Error ? error.message : String(error);
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }

  startPolling(onRefresh?: (summary: RevocationSyncSummary) => void, onError?: (error: unknown) => void): void {
    if (!this.sourceUrl) {
      return;
    }
    if (this.refreshTimer) {
      return;
    }

    this.refreshTimer = setInterval(() => {
      void this.refresh()
        .then((summary) => {
          if (summary && onRefresh) {
            onRefresh(summary);
          }
        })
        .catch((error) => {
          if (onError) {
            onError(error);
          }
        });
    }, this.refreshIntervalMs);
  }

  stopPolling(): void {
    if (!this.refreshTimer) {
      return;
    }
    clearInterval(this.refreshTimer);
    this.refreshTimer = null;
  }
}

export type RevocationGateResult =
  | { ok: true }
  | { ok: false; code: 'REVOCATION_UNAVAILABLE' | 'IDENTITY_REVOKED'; message: string; details?: unknown };

export function evaluateRevocationGate(
  registry: DistributedRevocationRegistry,
  input: {
    nodeId: string;
    certificateSerial?: string | null;
    failClosed: boolean;
  },
): RevocationGateResult {
  if (!registry.isConfigured()) {
    return { ok: true };
  }

  if (input.failClosed && !registry.hasSynced()) {
    return {
      ok: false,
      code: 'REVOCATION_UNAVAILABLE',
      message: 'Revocation registry is not synchronized',
      details: registry.getSnapshot(),
    };
  }

  const lookup = registry.checkIdentity(input.nodeId, input.certificateSerial);
  if (!lookup.revoked) {
    return { ok: true };
  }

  return {
    ok: false,
    code: 'IDENTITY_REVOKED',
    message: `Identity ${input.nodeId} is revoked by sovereign trust ledger`,
    details: {
      matched_by: lookup.matchedBy,
      certificate: lookup.certificate,
    },
  };
}
