/**
 * Lattice integration contracts shared across AetherCore services.
 *
 * These are intentionally fail-visible: verification posture must always be explicit.
 */

export type LatticeVerificationStatus = 'VERIFIED' | 'STATUS_UNVERIFIED' | 'SPOOFED';
export type LatticeIntegrationMode = 'stealth_readonly' | 'standard';
export type LatticeInputMode = 'synthetic' | 'live';
export type LatticeStealthProfile = 'stealth_readonly_synthetic' | 'stealth_readonly_live';
export type LatticeScenarioControlAction =
  | 'set_phase'
  | 'advance'
  | 'revert'
  | 'reset'
  | 'inject_fault'
  | 'clear_fault';

export interface AethercoreVerificationOverlayV1 {
  schema: 'aethercore.verification.v1';
  entity_id: string;
  verification_status: LatticeVerificationStatus;
  trust_score: number;
  byzantine_faults: string[];
  merkle_event_hash: string;
  merkle_prev_hash: string;
  signature_valid: boolean;
  evaluated_at_ms: number;
  evidence_object_ids: string[];
  aethercore_version: string;
  source: 'aethercore';
}

export interface LatticeEntityProjectionV1 {
  schema_version: 'lattice.entity.projection.v1';
  entity_id: string;
  source: string;
  source_update_time_ms: number;
  event_type: 'UPSERT' | 'DELETE';
  verification_status: LatticeVerificationStatus;
  received_at_ms: number;
  raw_entity: Record<string, unknown>;
  overlay?: AethercoreVerificationOverlayV1;
}

export interface LatticeTaskInboxItemV1 {
  schema_version: 'lattice.task.inbox.v1';
  task_id: string;
  assigned_agent_id: string;
  status: string;
  status_version: number;
  freshness_ms: number;
  trust_posture: 'trusted' | 'degraded' | 'unknown';
  title?: string;
  description?: string;
  read_only: true;
  raw_task: Record<string, unknown>;
  received_at_ms: number;
}

export interface LatticeObjectRecordV1 {
  schema_version: 'lattice.object.record.v1';
  object_id: string;
  entity_id: string;
  object_key?: string;
  media_type?: string;
  ttl_seconds?: number;
  metadata?: Record<string, unknown>;
  created_at_ms: number;
}

export interface LatticeEntityDisplayV1 {
  schema_version: 'lattice.entity.display.v1';
  entity_id: string;
  title: string;
  domain: string;
  entity_type: string;
  source: string;
  source_badge: 'Lattice Synthetic' | 'Lattice Live' | 'Gateway Telemetry';
  verification_status: LatticeVerificationStatus;
  trust_score: number;
  freshness_ms: number;
  last_update_ms: number;
  position?: {
    lat: number;
    lon: number;
    altitude_m?: number;
  };
  speed_mps?: number;
  heading_deg?: number;
  status_label?: string;
  read_only_actions: true;
  overlay?: AethercoreVerificationOverlayV1;
  evidence_object_ids: string[];
  raw_entity: Record<string, unknown>;
}

export interface LatticeScenarioStatusV1 {
  schema_version: 'lattice.scenario.status.v1';
  scenario_id: string;
  phase_id: string;
  phase_label: string;
  phase_index: number;
  manual_mode: true;
  run_state: 'ready' | 'active';
  scenario_ready: boolean;
  integration_mode: LatticeIntegrationMode;
  input_mode: LatticeInputMode;
  effective_profile: LatticeStealthProfile;
  active_faults: string[];
  deterministic_seed: string;
  last_transition_at_ms: number | null;
  run_started_at_ms: number | null;
  last_event_at_ms: number | null;
  preflight: {
    services_healthy: boolean;
    ingest_active: boolean;
    freshness_within_threshold: boolean;
    checklist: Array<{
      id: string;
      label: string;
      ok: boolean;
      detail: string;
    }>;
  };
}

export interface LatticeScenarioControlRequestV1 {
  schema_version: 'lattice.scenario.control.request.v1';
  action: LatticeScenarioControlAction;
  phase_id?: string;
  fault_id?: string;
  reason?: string;
  changed_by_admin_node_id?: string;
}

export interface LatticeScenarioControlResponseV1 {
  schema_version: 'lattice.scenario.control.response.v1';
  status: 'ok' | 'error';
  code?: string;
  message?: string;
  scenario: LatticeScenarioStatusV1;
}

export interface LatticeInboundEventV1 {
  schema_version: 'lattice.inbound.event.v1';
  source_protocol: 'rest' | 'grpc';
  event_id: string;
  stream_id: string;
  received_at_ms: number;
  event:
    | { kind: 'entity'; projection: LatticeEntityProjectionV1 }
    | { kind: 'task'; task: LatticeTaskInboxItemV1 }
    | { kind: 'object'; object: LatticeObjectRecordV1 };
}

export interface LatticeModeStatusV1 {
  schema_version: 'lattice.mode.status.v1';
  integration_mode: LatticeIntegrationMode;
  input_mode: LatticeInputMode;
  effective_profile: LatticeStealthProfile;
  allowed_profiles: LatticeStealthProfile[];
  last_mode_change_at_ms: number | null;
  read_only: true;
  changed_by_admin_node_id?: string;
  reason?: string;
}

export interface LatticeBridgeStatusV1 {
  schema_version: 'lattice.bridge.status.v1';
  integration_mode: LatticeIntegrationMode;
  input_mode: LatticeInputMode;
  effective_profile: LatticeStealthProfile;
  last_mode_change_at_ms: number | null;
  healthy: boolean;
  protocol_mode: 'rest' | 'grpc' | 'hybrid';
  rest_healthy: boolean;
  grpc_healthy: boolean;
  grpc_transport_mode?: 'insecure' | 'tls' | 'mtls';
  grpc_target_configured?: boolean;
  synthetic_ingest_interval_ms?: number;
  effective_sync_interval_ms?: number;
  sandbox_mode: boolean;
  scenario_id?: string;
  phase_id?: string;
  phase_label?: string;
  manual_mode?: boolean;
  scenario_ready?: boolean;
  scenario_health?: {
    active_faults: string[];
    last_transition_at_ms: number | null;
    preflight_ok: boolean;
  };
  last_sync_at_ms: number | null;
  sync_lag_ms: number | null;
  token_expires_at_ms: number | null;
  metrics: {
    stream_reconnects: number;
    token_refresh_success: number;
    token_refresh_failures: number;
    mismatches: number;
    invalid_signatures: number;
    dead_letters: number;
  };
}
