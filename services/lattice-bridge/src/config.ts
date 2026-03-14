import fs from 'node:fs';
import path from 'node:path';
import type {
  BridgeConfig,
  GrpcTransportMode,
  LatticeIntegrationMode,
  LatticeInputMode,
} from './types';

function parseBoolean(value: string | undefined, fallback: boolean): boolean {
  if (!value) {
    return fallback;
  }
  const normalized = value.trim().toLowerCase();
  if (normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on') {
    return true;
  }
  if (normalized === '0' || normalized === 'false' || normalized === 'no' || normalized === 'off') {
    return false;
  }
  return fallback;
}

function parsePositiveInt(value: string | undefined, fallback: number): number {
  if (!value) {
    return fallback;
  }
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return parsed;
}

function parseProtocolMode(value: string | undefined): 'rest' | 'grpc' | 'hybrid' {
  const normalized = (value || 'hybrid').trim().toLowerCase();
  if (normalized === 'rest' || normalized === 'grpc' || normalized === 'hybrid') {
    return normalized;
  }
  return 'hybrid';
}

function parseIntegrationMode(value: string | undefined): LatticeIntegrationMode {
  const normalized = (value || 'stealth_readonly').trim().toLowerCase();
  if (normalized === 'standard') {
    return 'standard';
  }
  return 'stealth_readonly';
}

function parseInputMode(
  value: string | undefined,
  integrationMode: LatticeIntegrationMode,
): LatticeInputMode {
  const fallback: LatticeInputMode = integrationMode === 'stealth_readonly' ? 'synthetic' : 'live';
  const normalized = (value || fallback).trim().toLowerCase();
  if (normalized === 'live') {
    return 'live';
  }
  return 'synthetic';
}

function optional(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value && value.length > 0 ? value : undefined;
}

function parseOptionalPath(name: string): string | undefined {
  const raw = process.env[name]?.trim();
  if (!raw) {
    return undefined;
  }
  const resolved = path.resolve(raw);
  if (!fs.existsSync(resolved)) {
    throw new Error(`${name} path does not exist: ${resolved}`);
  }
  return resolved;
}

function deriveGrpcTransportMode(
  insecure: boolean,
  clientCertPath: string | undefined,
  clientKeyPath: string | undefined,
): GrpcTransportMode {
  if (insecure) {
    return 'insecure';
  }
  if (clientCertPath && clientKeyPath) {
    return 'mtls';
  }
  return 'tls';
}

export function loadConfig(): BridgeConfig {
  const integrationMode = parseIntegrationMode(process.env.LATTICE_INTEGRATION_MODE);
  const defaultInputMode = parseInputMode(process.env.LATTICE_INPUT_MODE, integrationMode);
  const requestedProtocolMode = parseProtocolMode(process.env.LATTICE_PROTOCOL_MODE);
  const protocolMode = integrationMode === 'stealth_readonly' ? 'rest' : requestedProtocolMode;
  const allowOutboundWrites = integrationMode !== 'stealth_readonly';

  const isProduction =
    process.env.NODE_ENV === 'production' || parseBoolean(process.env.AETHERCORE_PRODUCTION, false);
  const sandboxMode = parseBoolean(process.env.LATTICE_SANDBOX_MODE, true);

  const grpcEnabled = protocolMode === 'grpc' || protocolMode === 'hybrid';
  const grpcTarget = grpcEnabled ? process.env.LATTICE_GRPC_TARGET?.trim() : undefined;
  const grpcInsecure = grpcEnabled ? parseBoolean(process.env.LATTICE_GRPC_INSECURE, false) : false;
  const grpcCaCertPath = grpcEnabled ? parseOptionalPath('LATTICE_GRPC_CA_CERT_PATH') : undefined;
  const grpcClientCertPath = grpcEnabled ? parseOptionalPath('LATTICE_GRPC_CLIENT_CERT_PATH') : undefined;
  const grpcClientKeyPath = grpcEnabled ? parseOptionalPath('LATTICE_GRPC_CLIENT_KEY_PATH') : undefined;

  if (grpcEnabled && !grpcTarget) {
    throw new Error('LATTICE_GRPC_TARGET is required when LATTICE_PROTOCOL_MODE is grpc or hybrid');
  }

  if (grpcEnabled && isProduction && grpcInsecure) {
    throw new Error('Refusing insecure lattice gRPC transport in production mode');
  }

  const hasClientCert = !!grpcClientCertPath;
  const hasClientKey = !!grpcClientKeyPath;
  if (grpcEnabled && hasClientCert !== hasClientKey) {
    throw new Error('Both LATTICE_GRPC_CLIENT_CERT_PATH and LATTICE_GRPC_CLIENT_KEY_PATH are required for mTLS');
  }

  if (grpcEnabled && isProduction && !grpcInsecure) {
    if (!grpcCaCertPath) {
      throw new Error('LATTICE_GRPC_CA_CERT_PATH is required in production mode');
    }
    if (!hasClientCert || !hasClientKey) {
      throw new Error(
        'mTLS is required in production mode (set LATTICE_GRPC_CLIENT_CERT_PATH and LATTICE_GRPC_CLIENT_KEY_PATH)',
      );
    }
  }

  const latticeBaseUrl = optional('LATTICE_BASE_URL');
  const latticeClientId = optional('LATTICE_CLIENT_ID');
  const latticeClientSecret = optional('LATTICE_CLIENT_SECRET');
  const latticeAgentId = optional('LATTICE_AGENT_ID');
  const sandboxesToken = optional('SANDBOXES_TOKEN');
  const liveCredentialRequired = integrationMode === 'standard' || defaultInputMode === 'live';
  const requiredLiveCredentialNames: string[] = [];

  if (liveCredentialRequired && !latticeBaseUrl) {
    requiredLiveCredentialNames.push('LATTICE_BASE_URL');
  }
  if (liveCredentialRequired && !latticeClientId) {
    requiredLiveCredentialNames.push('LATTICE_CLIENT_ID');
  }
  if (liveCredentialRequired && !latticeClientSecret) {
    requiredLiveCredentialNames.push('LATTICE_CLIENT_SECRET');
  }
  if (liveCredentialRequired && !latticeAgentId) {
    requiredLiveCredentialNames.push('LATTICE_AGENT_ID');
  }
  if (requiredLiveCredentialNames.length > 0) {
    throw new Error(
      `Missing required environment variables for live lattice ingest: ${requiredLiveCredentialNames.join(', ')}`,
    );
  }
  if (liveCredentialRequired && sandboxMode && !sandboxesToken) {
    throw new Error('SANDBOXES_TOKEN is required when LATTICE_SANDBOX_MODE=true and live ingest is enabled');
  }

  const config: BridgeConfig = {
    port: parsePositiveInt(process.env.PORT, 3010),
    dataDir: process.env.LATTICE_BRIDGE_DATA_DIR?.trim() || './data',
    integrationMode,
    defaultInputMode,
    allowOutboundWrites,
    protocolMode,
    isProduction,
    sandboxMode,
    latticeBaseUrl,
    latticeClientId,
    latticeClientSecret,
    latticeAgentId,
    sandboxesToken,
    grpcTarget,
    grpcInsecure,
    grpcCaCertPath,
    grpcClientCertPath,
    grpcClientKeyPath,
    grpcServerNameOverride: process.env.LATTICE_GRPC_SERVER_NAME_OVERRIDE?.trim(),
    grpcPollWindowMs: parsePositiveInt(process.env.LATTICE_GRPC_POLL_WINDOW_MS, 1500),
    grpcMaxEvents: parsePositiveInt(process.env.LATTICE_GRPC_MAX_EVENTS, 256),
    grpcTransportMode: deriveGrpcTransportMode(grpcInsecure, grpcClientCertPath, grpcClientKeyPath),
    syntheticScenario: process.env.LATTICE_SYNTHETIC_SCENARIO?.trim() || 'sf_bay_maritime_incursion_v1',
    syntheticSeed: process.env.LATTICE_SYNTHETIC_SEED?.trim() || 'AETHERCORE-STABLE-SEED-001',
    syntheticTimeline:
      ((process.env.LATTICE_SYNTHETIC_TIMELINE?.trim().toLowerCase()) as 'dual' | 'realtime' | undefined) ===
      'realtime'
        ? 'realtime'
        : 'dual',
    syntheticReplayHours: parsePositiveInt(process.env.LATTICE_SYNTHETIC_REPLAY_HOURS, 24),
    pollIntervalMs: parsePositiveInt(
      process.env.LATTICE_POLL_INTERVAL_MS,
      integrationMode === 'stealth_readonly' ? 15000 : 5000,
    ),
    gatewayInternalUrl:
      process.env.LATTICE_GATEWAY_INTERNAL_URL?.trim() || 'http://gateway:3000/internal/lattice/events',
    gatewayInternalToken: process.env.LATTICE_GATEWAY_INTERNAL_TOKEN?.trim(),
  };

  return config;
}
