import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { SystemAdminView } from '../SystemAdminView';
import { useCommStore } from '../../../store/useCommStore';
import { useTacticalStore } from '../../../store/useTacticalStore';

const hasAdminPrivilegesMock = vi.fn();
const getFleetAttestationStateMock = vi.fn();
const fetchLatticeStatusMock = vi.fn();
const fetchLatticeTasksMock = vi.fn();
const fetchLatticeModeMock = vi.fn();
const updateLatticeModeMock = vi.fn();
const fetchLatticeScenarioStatusMock = vi.fn();
const controlLatticeScenarioMock = vi.fn();

vi.mock('../../../config/runtime', () => ({
  getRuntimeConfig: () => ({
    tpmEnabled: false,
    apiUrl: 'http://127.0.0.1:3000',
    wsUrl: 'ws://127.0.0.1:3000/ws',
    transportMode: 'web',
    runtimeEndpoints: {
      apiUrl: 'http://127.0.0.1:3000',
      wsUrl: 'ws://127.0.0.1:3000/ws',
      telemetryWebsocketUrl: 'ws://127.0.0.1:8080',
    },
  }),
  isTauriRuntime: () => false,
  isDemoMode: () => false,
}));

vi.mock('../../../services/identity/identityClient', () => ({
  IdentityClient: {
    hasAdminPrivileges: (...args: unknown[]) => hasAdminPrivilegesMock(...args),
    getFleetAttestationState: (...args: unknown[]) => getFleetAttestationStateMock(...args),
  },
}));

vi.mock('../../../services/lattice/latticeService', () => ({
  fetchLatticeStatus: (...args: unknown[]) => fetchLatticeStatusMock(...args),
  fetchLatticeTasks: (...args: unknown[]) => fetchLatticeTasksMock(...args),
  fetchLatticeMode: (...args: unknown[]) => fetchLatticeModeMock(...args),
  updateLatticeMode: (...args: unknown[]) => updateLatticeModeMock(...args),
  fetchLatticeScenarioStatus: (...args: unknown[]) => fetchLatticeScenarioStatusMock(...args),
  controlLatticeScenario: (...args: unknown[]) => controlLatticeScenarioMock(...args),
}));

vi.mock('../../../api/tauri-commands', () => ({
  TauriCommands: {
    diagnosticsReport: vi.fn(),
    repairInstallation: vi.fn(),
    resetLocalStack: vi.fn(),
    collectSupportBundle: vi.fn(),
  },
}));

const baseLatticeStatus = {
  status: 'ok' as const,
  integration_mode: 'stealth_readonly' as const,
  input_mode: 'synthetic' as const,
  effective_profile: 'stealth_readonly_synthetic' as const,
  last_mode_change_at_ms: null,
  last_event_at_ms: null,
  event_age_ms: null,
  bridge: {
    schema_version: 'lattice.bridge.status.v1' as const,
    integration_mode: 'stealth_readonly' as const,
    input_mode: 'synthetic' as const,
    effective_profile: 'stealth_readonly_synthetic' as const,
    last_mode_change_at_ms: null,
    healthy: true,
    protocol_mode: 'rest' as const,
    rest_healthy: true,
    grpc_healthy: false,
    sandbox_mode: true,
    last_sync_at_ms: Date.now(),
    sync_lag_ms: 250,
    token_expires_at_ms: null,
    metrics: {
      stream_reconnects: 0,
      token_refresh_success: 0,
      token_refresh_failures: 0,
      mismatches: 0,
      invalid_signatures: 0,
      dead_letters: 0,
    },
  },
  mode: {
    schema_version: 'lattice.mode.status.v1' as const,
    integration_mode: 'stealth_readonly' as const,
    input_mode: 'synthetic' as const,
    effective_profile: 'stealth_readonly_synthetic' as const,
    allowed_profiles: ['stealth_readonly_synthetic', 'stealth_readonly_live'] as const,
    last_mode_change_at_ms: null,
    read_only: true as const,
  },
  tasks_cached: 0,
  overlays_cached: 0,
  objects_cached: 0,
  timestamp: Date.now(),
};

const baseLatticeTasks = {
  status: 'ok' as const,
  read_only: true as const,
  count: 0,
  tasks: [],
  timestamp: Date.now(),
};

const baseLatticeMode = {
  status: 'ok' as const,
  mode: {
    schema_version: 'lattice.mode.status.v1' as const,
    integration_mode: 'stealth_readonly' as const,
    input_mode: 'synthetic' as const,
    effective_profile: 'stealth_readonly_synthetic' as const,
    allowed_profiles: ['stealth_readonly_synthetic', 'stealth_readonly_live'] as const,
    last_mode_change_at_ms: null,
    read_only: true as const,
  },
};

const baseLatticeScenario = {
  status: 'ok' as const,
  scenario: {
    schema_version: 'lattice.scenario.status.v1' as const,
    scenario_id: 'sf_bay_maritime_incursion_v1',
    phase_id: 'phase_0_baseline',
    phase_label: 'Phase 0 - Baseline Patrol',
    phase_index: 0,
    manual_mode: true as const,
    run_state: 'active' as const,
    scenario_ready: true,
    integration_mode: 'stealth_readonly' as const,
    input_mode: 'synthetic' as const,
    effective_profile: 'stealth_readonly_synthetic' as const,
    active_faults: [],
    deterministic_seed: 'AETHERCORE-STABLE-SEED-001',
    last_transition_at_ms: Date.now(),
    run_started_at_ms: Date.now(),
    last_event_at_ms: Date.now(),
    preflight: {
      services_healthy: true,
      ingest_active: true,
      freshness_within_threshold: true,
      checklist: [],
    },
  },
};

function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe('SystemAdminView Lattice mode controls', () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);

    hasAdminPrivilegesMock.mockResolvedValue(false);
    getFleetAttestationStateMock.mockResolvedValue([]);
    fetchLatticeStatusMock.mockResolvedValue(baseLatticeStatus);
    fetchLatticeTasksMock.mockResolvedValue(baseLatticeTasks);
    fetchLatticeModeMock.mockResolvedValue(baseLatticeMode);
    updateLatticeModeMock.mockResolvedValue({ status: 'ok' });
    fetchLatticeScenarioStatusMock.mockResolvedValue(baseLatticeScenario);
    controlLatticeScenarioMock.mockResolvedValue({ status: 'ok' });

    useCommStore.setState({ currentOperator: null });
    useTacticalStore.setState({ selectedNodeId: null });
  });

  afterEach(() => {
    document.body.removeChild(container);
    vi.clearAllMocks();
  });

  it('disables lattice profile controls for non-admin operators', async () => {
    const root = createRoot(container);
    await act(async () => {
      root.render(<SystemAdminView />);
      await flush();
      await flush();
    });

    const selector = container.querySelector('select') as HTMLSelectElement | null;
    expect(selector).not.toBeNull();
    expect(selector?.disabled).toBe(true);
    expect(container.textContent).toContain('Controls disabled');
  });

  it('enables lattice profile controls for authorized admins', async () => {
    useCommStore.getState().setCurrentOperator({
      id: 'admin-node-1',
      name: 'Admin One',
      role: 'admin',
      status: 'online',
      verified: true,
      trustScore: 100,
      lastSeen: new Date(),
    });
    hasAdminPrivilegesMock.mockResolvedValue(true);

    const root = createRoot(container);
    await act(async () => {
      root.render(<SystemAdminView />);
      await flush();
      await flush();
    });

    const selector = container.querySelector('select') as HTMLSelectElement | null;
    expect(selector).not.toBeNull();
    expect(selector?.disabled).toBe(false);

    const buttons = Array.from(container.querySelectorAll('button'));
    const apply = buttons.find((button) => button.textContent?.includes('Apply'));
    expect(apply).toBeDefined();
    expect(apply?.disabled).toBe(false);
  });
});
