import type {
  AethercoreVerificationOverlayV1,
  LatticeEntityDisplayV1,
  LatticeIntegrationMode,
  LatticeInputMode,
  LatticeModeStatusV1,
  LatticeBridgeStatusV1,
  LatticeEntityProjectionV1,
  LatticeInboundEventV1,
  LatticeObjectRecordV1,
  LatticeScenarioControlRequestV1,
  LatticeScenarioControlResponseV1,
  LatticeScenarioStatusV1,
  LatticeStealthProfile,
  LatticeTaskInboxItemV1,
  LatticeVerificationStatus,
} from '@aethercore/shared';

export type {
  AethercoreVerificationOverlayV1,
  LatticeBridgeStatusV1,
  LatticeEntityDisplayV1,
  LatticeEntityProjectionV1,
  LatticeInboundEventV1,
  LatticeInputMode,
  LatticeModeStatusV1,
  LatticeObjectRecordV1,
  LatticeScenarioControlRequestV1,
  LatticeScenarioControlResponseV1,
  LatticeScenarioStatusV1,
  LatticeStealthProfile,
  LatticeTaskInboxItemV1,
  LatticeVerificationStatus,
};

export type ProtocolName = 'rest' | 'grpc' | 'synthetic';
export type GrpcTransportMode = 'insecure' | 'tls' | 'mtls';
export type { LatticeIntegrationMode };

export interface BridgeConfig {
  port: number;
  dataDir: string;
  integrationMode: LatticeIntegrationMode;
  defaultInputMode: LatticeInputMode;
  allowOutboundWrites: boolean;
  protocolMode: 'rest' | 'grpc' | 'hybrid';
  isProduction: boolean;
  sandboxMode: boolean;
  latticeBaseUrl?: string;
  latticeClientId?: string;
  latticeClientSecret?: string;
  latticeAgentId?: string;
  sandboxesToken?: string;
  grpcTarget?: string;
  grpcInsecure: boolean;
  grpcCaCertPath?: string;
  grpcClientCertPath?: string;
  grpcClientKeyPath?: string;
  grpcServerNameOverride?: string;
  grpcPollWindowMs: number;
  grpcMaxEvents: number;
  grpcTransportMode: GrpcTransportMode;
  syntheticScenario: string;
  syntheticSeed: string;
  syntheticTimeline: 'dual' | 'realtime';
  syntheticReplayHours: number;
  syntheticIngestIntervalMs: number;
  pollIntervalMs: number;
  gatewayInternalUrl: string;
  gatewayInternalToken?: string;
}

export interface RuntimeModeState {
  inputMode: LatticeInputMode;
  changedAtMs: number;
  changedByAdminNodeId?: string;
  reason?: string;
}

export interface EffectiveModeState extends RuntimeModeState {
  integrationMode: LatticeIntegrationMode;
  effectiveProfile: LatticeStealthProfile;
}

export interface RuntimeMetrics {
  streamReconnects: number;
  tokenRefreshSuccess: number;
  tokenRefreshFailures: number;
  mismatches: number;
  invalidSignatures: number;
  deadLetters: number;
}

export interface AdapterPullResult {
  events: LatticeInboundEventV1[];
  cursorHint?: string;
  serverTimestampMs?: number;
}

export interface AdapterHealth {
  healthy: boolean;
  lastSuccessAtMs: number | null;
  lastFailureAtMs: number | null;
  lastError?: string;
}

export interface LatticeScenarioPhaseDefinition {
  phaseId: string;
  phaseLabel: string;
  summary: string;
}

export interface LatticeScenarioRuntimeState {
  scenarioId: string;
  phaseId: string;
  phaseIndex: number;
  runState: 'ready' | 'active';
  activeFaults: string[];
  lastTransitionAtMs: number | null;
  runStartedAtMs: number | null;
  lastEventAtMs: number | null;
}
