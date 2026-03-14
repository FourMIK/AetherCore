import type {
  AethercoreVerificationOverlayV1,
  LatticeBridgeStatusV1,
  LatticeEntityDisplayV1,
  LatticeInputMode,
  LatticeModeStatusV1,
  LatticeScenarioStatusV1,
  LatticeStealthProfile,
  LatticeObjectRecordV1,
  LatticeTaskInboxItemV1,
} from '@aethercore/shared';
import { getRuntimeConfig } from '../../config/runtime';

export interface LatticeStatusResponse {
  status: 'ok' | 'degraded';
  integration_mode?: 'stealth_readonly' | 'standard' | 'unknown';
  input_mode?: LatticeInputMode | 'unknown';
  effective_profile?: LatticeStealthProfile | 'unknown';
  last_mode_change_at_ms?: number | null;
  scenario_id?: string | null;
  phase_id?: string | null;
  phase_label?: string | null;
  manual_mode?: boolean;
  scenario_ready?: boolean;
  last_event_at_ms: number | null;
  event_age_ms: number | null;
  bridge: LatticeBridgeStatusV1 | null;
  mode?: LatticeModeStatusV1 | null;
  scenario?: LatticeScenarioStatusV1 | null;
  tasks_cached: number;
  overlays_cached: number;
  objects_cached: number;
  entities_cached?: number;
  invalid_events_dropped?: number;
  last_invalid_event_at_ms?: number | null;
  last_invalid_event_reason?: string | null;
  timestamp: number;
}

export interface LatticeTaskResponse {
  status: 'ok';
  read_only: true;
  count: number;
  tasks: LatticeTaskInboxItemV1[];
  timestamp: number;
}

export interface LatticeVerificationResponse {
  status: 'ok';
  entity_id: string;
  overlay: AethercoreVerificationOverlayV1;
  evidence_objects: LatticeObjectRecordV1[];
  timestamp: number;
}

export interface LatticeModeResponse {
  status: 'ok' | 'stale';
  mode: LatticeModeStatusV1;
  warning?: string;
  timestamp?: number;
}

export interface LatticeModeMutationRequest {
  admin_node_id: string;
  profile?: LatticeStealthProfile;
  input_mode?: LatticeInputMode;
  reason?: string;
}

export interface LatticeModeMutationResponse {
  status: 'ok' | 'error';
  mode?: LatticeModeStatusV1 | null;
  message?: string;
  code?: string;
  reason?: string;
}

export interface LatticeEntitiesResponse {
  status: 'ok';
  count: number;
  entities: LatticeEntityDisplayV1[];
  timestamp: number;
}

export interface LatticeEntityResponse {
  status: 'ok';
  entity: LatticeEntityDisplayV1;
  timestamp: number;
}

export interface LatticeScenarioStatusResponse {
  status: 'ok' | 'error';
  scenario?: LatticeScenarioStatusV1;
  code?: string;
  message?: string;
  timestamp?: number;
}

export interface LatticeScenarioControlMutationRequest {
  admin_node_id: string;
  action: 'set_phase' | 'advance' | 'revert' | 'reset' | 'inject_fault' | 'clear_fault';
  phase_id?: string;
  fault_id?: string;
  reason?: string;
}

export interface LatticeScenarioControlMutationResponse {
  status: 'ok' | 'error';
  scenario?: LatticeScenarioStatusV1 | null;
  code?: string;
  message?: string;
}

async function fetchJson<T>(path: string, init?: RequestInit): Promise<T> {
  const { apiUrl } = getRuntimeConfig();
  const response = await fetch(`${apiUrl}${path}`, init);
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Request failed (${response.status}) for ${path}: ${body.slice(0, 256)}`);
  }
  return (await response.json()) as T;
}

export async function fetchLatticeStatus(): Promise<LatticeStatusResponse> {
  return fetchJson<LatticeStatusResponse>('/api/lattice/status');
}

export async function fetchLatticeTasks(limit = 25): Promise<LatticeTaskResponse> {
  return fetchJson<LatticeTaskResponse>(`/api/lattice/tasks?limit=${limit}`);
}

export async function fetchLatticeEntityVerification(entityId: string): Promise<LatticeVerificationResponse> {
  return fetchJson<LatticeVerificationResponse>(`/api/lattice/entities/${encodeURIComponent(entityId)}/verification`);
}

export async function fetchLatticeMode(): Promise<LatticeModeResponse> {
  return fetchJson<LatticeModeResponse>('/api/lattice/mode');
}

export async function updateLatticeMode(
  request: LatticeModeMutationRequest,
): Promise<LatticeModeMutationResponse> {
  return fetchJson<LatticeModeMutationResponse>('/api/lattice/mode', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(request),
  });
}

export async function fetchLatticeEntities(limit = 250): Promise<LatticeEntitiesResponse> {
  return fetchJson<LatticeEntitiesResponse>(`/api/lattice/entities?limit=${limit}`);
}

export async function fetchLatticeEntity(entityId: string): Promise<LatticeEntityResponse> {
  return fetchJson<LatticeEntityResponse>(`/api/lattice/entities/${encodeURIComponent(entityId)}`);
}

export async function fetchLatticeScenarioStatus(): Promise<LatticeScenarioStatusResponse> {
  return fetchJson<LatticeScenarioStatusResponse>('/api/lattice/scenario/status');
}

export async function controlLatticeScenario(
  request: LatticeScenarioControlMutationRequest,
): Promise<LatticeScenarioControlMutationResponse> {
  return fetchJson<LatticeScenarioControlMutationResponse>('/api/lattice/scenario/control', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(request),
  });
}
