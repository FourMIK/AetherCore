/**
 * SystemAdminView
 * Configuration and system management workspace
 *
 * Design Doctrine:
 * - All administrative actions bound to physical silicon (TPM 2.0 / Secure Enclave)
 * - Byzantine nodes MUST be fail-visible (quarantine UI state)
 * - Revocations are CanonicalEvents broadcast to The Great Gospel ledger
 */

import React, { useEffect, useState } from 'react';
import type {
  LatticeModeStatusV1,
  LatticeScenarioStatusV1,
  LatticeStealthProfile,
  LatticeTaskInboxItemV1,
} from '@aethercore/shared';
import { GlassPanel } from '../hud/GlassPanel';
import {
  Settings,
  Database,
  Server,
  HardDrive,
  Cpu,
  Wrench,
  RotateCcw,
  Archive,
  ShieldAlert,
  Shield,
  AlertTriangle,
} from 'lucide-react';
import { getRuntimeConfig, isTauriRuntime } from '../../config/runtime';
import { ServiceUnavailablePanel } from '../health/ServiceUnavailablePanel';
import {
  DiagnosticsReport,
  SupportBundleSummary,
  TauriCommands,
} from '../../api/tauri-commands';
import { IdentityClient } from '../../services/identity/identityClient';
import { useTacticalStore } from '../../store/useTacticalStore';
import { useCommStore } from '../../store/useCommStore';
import { NodeListPanel } from '../panels/NodeListPanel';
import { AuditLogViewer } from '../compliance/AuditLogViewer';
import {
  controlLatticeScenario,
  fetchLatticeMode,
  fetchLatticeScenarioStatus,
  fetchLatticeStatus,
  fetchLatticeTasks,
  updateLatticeMode,
  type LatticeStatusResponse,
} from '../../services/lattice/latticeService';

function isLatticeStealthProfile(value: unknown): value is LatticeStealthProfile {
  return value === 'stealth_readonly_synthetic' || value === 'stealth_readonly_live';
}

export const SystemAdminView: React.FC = () => {
  const { tpmEnabled } = getRuntimeConfig();
  const isDesktop = isTauriRuntime();
  const [diagnostics, setDiagnostics] = useState<DiagnosticsReport | null>(null);
  const [bundle, setBundle] = useState<SupportBundleSummary | null>(null);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [latticeStatus, setLatticeStatus] = useState<LatticeStatusResponse | null>(null);
  const [latticeTasks, setLatticeTasks] = useState<LatticeTaskInboxItemV1[]>([]);
  const [latticeMode, setLatticeMode] = useState<LatticeModeStatusV1 | null>(null);
  const [latticeScenario, setLatticeScenario] = useState<LatticeScenarioStatusV1 | null>(null);
  const [latticeError, setLatticeError] = useState<string | null>(null);
  const [latticeModeError, setLatticeModeError] = useState<string | null>(null);
  const [latticeScenarioError, setLatticeScenarioError] = useState<string | null>(null);
  const [latticeModeBusy, setLatticeModeBusy] = useState(false);
  const [latticeScenarioBusy, setLatticeScenarioBusy] = useState(false);
  const [selectedLatticeProfile, setSelectedLatticeProfile] =
    useState<LatticeStealthProfile>('stealth_readonly_synthetic');
  const [revertLatticeProfile, setRevertLatticeProfile] = useState<LatticeStealthProfile | null>(null);
  const [selectedScenarioPhaseId, setSelectedScenarioPhaseId] = useState<string>('phase_0_baseline');
  const [selectedScenarioFault, setSelectedScenarioFault] = useState<string>('spoof_burst');
  const [hasAdminPrivileges, setHasAdminPrivileges] = useState(false);
  const currentOperatorId = useCommStore((s) => s.currentOperator?.id);
  const selectedNodeId = useTacticalStore((s) => s.selectedNodeId);
  const adminNodeId = currentOperatorId || selectedNodeId || '';

  const fleetAttestationState = useTacticalStore((s) => s.fleetAttestationState);
  const lastAttestationUpdate = useTacticalStore((s) => s.lastAttestationUpdate);
  const revocationHistory = useTacticalStore((s) => s.revocationHistory);
  const updateFleetAttestationState = useTacticalStore((s) => s.updateFleetAttestationState);

  // Fetch diagnostics on mount
  useEffect(() => {
    if (!isDesktop) {
      return;
    }
    (async () => {
      const result = await TauriCommands.diagnosticsReport();
      if (result.success) {
        setDiagnostics(result.data);
      }
    })();
  }, [isDesktop]);

  // Check admin privileges
  useEffect(() => {
    (async () => {
      if (!adminNodeId) {
        setHasAdminPrivileges(false);
        return;
      }

      try {
        const authorized = await IdentityClient.hasAdminPrivileges(adminNodeId);
        setHasAdminPrivileges(authorized);
      } catch (error) {
        console.error('[ADMIN] Failed to evaluate admin privileges:', error);
        setHasAdminPrivileges(false);
      }
    })();
  }, [adminNodeId]);

  // Fetch fleet attestation state every 5 seconds
  useEffect(() => {
    const fetchAttestation = async () => {
      try {
        const attestations = await IdentityClient.getFleetAttestationState();
        updateFleetAttestationState(attestations);
      } catch (error) {
        console.error('[ADMIN] Failed to fetch fleet attestation:', error);
      }
    };

    // Initial fetch
    fetchAttestation();

    // Poll every 5 seconds
    const interval = setInterval(fetchAttestation, 5000);

    return () => clearInterval(interval);
  }, [updateFleetAttestationState]);

  useEffect(() => {
    let mounted = true;

    const refresh = async () => {
      try {
        const [status, tasks, scenarioResponse] = await Promise.all([
          fetchLatticeStatus(),
          fetchLatticeTasks(8),
          fetchLatticeScenarioStatus().catch(() => ({ status: 'error' as const })),
        ]);
        let mode: LatticeModeStatusV1 | null = status.mode || null;
        try {
          const modeResponse = await fetchLatticeMode();
          mode = modeResponse.mode;
        } catch (modeError) {
          console.warn('[LATTICE] Failed to fetch mode status directly:', modeError);
        }
        if (!mounted) {
          return;
        }
        setLatticeStatus(status);
        setLatticeTasks(tasks.tasks);
        setLatticeMode(mode);
        if (scenarioResponse.status === 'ok' && scenarioResponse.scenario) {
          setLatticeScenario(scenarioResponse.scenario);
          setSelectedScenarioPhaseId(scenarioResponse.scenario.phase_id);
          setLatticeScenarioError(null);
        }
        const effectiveProfile =
          mode?.effective_profile ||
          status.effective_profile ||
          status.mode?.effective_profile ||
          status.bridge?.effective_profile;
        if (
          effectiveProfile === 'stealth_readonly_synthetic' ||
          effectiveProfile === 'stealth_readonly_live'
        ) {
          setSelectedLatticeProfile(effectiveProfile);
        }
        setLatticeError(null);
        setLatticeModeError(null);
      } catch (error) {
        if (!mounted) {
          return;
        }
        setLatticeError(error instanceof Error ? error.message : String(error));
      }
    };

    void refresh();
    const interval = setInterval(() => void refresh(), 5000);
    return () => {
      mounted = false;
      clearInterval(interval);
    };
  }, []);

  const runAction = async (name: string, action: () => Promise<unknown>) => {
    if (!isDesktop) {
      setActionError(`Action "${name}" requires the Tactical Glass desktop runtime.`);
      return;
    }
    setBusyAction(name);
    setActionError(null);
    try {
      await action();
      const refreshed = await TauriCommands.diagnosticsReport();
      if (refreshed.success) {
        setDiagnostics(refreshed.data);
      } else {
        setActionError(`Failed to refresh diagnostics: ${refreshed.error ?? 'unknown error'}`);
      }
    } catch (error) {
      setActionError(`Failed to run ${name}: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setBusyAction(null);
    }
  };

  const refreshLatticePanels = async (): Promise<void> => {
    const [status, tasks, scenarioResponse] = await Promise.all([
      fetchLatticeStatus(),
      fetchLatticeTasks(8),
      fetchLatticeScenarioStatus().catch(() => ({ status: 'error' as const })),
    ]);
    let mode: LatticeModeStatusV1 | null = status.mode || null;
    try {
      const modeResponse = await fetchLatticeMode();
      mode = modeResponse.mode;
    } catch {
      // Fail-visible banner is handled by caller.
    }

    setLatticeStatus(status);
    setLatticeTasks(tasks.tasks);
    setLatticeMode(mode);
    if (scenarioResponse.status === 'ok' && scenarioResponse.scenario) {
      setLatticeScenario(scenarioResponse.scenario);
      setSelectedScenarioPhaseId(scenarioResponse.scenario.phase_id);
    }
    const effectiveProfile =
      mode?.effective_profile ||
      status.effective_profile ||
      status.mode?.effective_profile ||
      status.bridge?.effective_profile;
    if (isLatticeStealthProfile(effectiveProfile)) {
      setSelectedLatticeProfile(effectiveProfile);
    }
  };

  const applyLatticeProfile = async (targetProfile: LatticeStealthProfile, isRevert = false): Promise<void> => {
    if (!adminNodeId) {
      setLatticeModeError('Admin node identity unavailable. Select an enrolled admin operator before applying mode changes.');
      return;
    }

    setLatticeModeBusy(true);
    setLatticeModeError(null);
    try {
      const currentProfileCandidate =
        latticeMode?.effective_profile ||
        latticeStatus?.effective_profile ||
        latticeStatus?.mode?.effective_profile ||
        latticeStatus?.bridge?.effective_profile;
      const currentProfile = isLatticeStealthProfile(currentProfileCandidate)
        ? currentProfileCandidate
        : 'stealth_readonly_synthetic';

      const response = await updateLatticeMode({
        admin_node_id: adminNodeId,
        profile: targetProfile,
        reason: isRevert ? 'system_admin_revert' : 'system_admin_apply',
      });
      if (response.status !== 'ok') {
        throw new Error(response.message || response.code || 'Lattice mode update failed');
      }

      if (!isRevert && currentProfile !== targetProfile) {
        setRevertLatticeProfile(currentProfile);
      }
      if (isRevert) {
        setRevertLatticeProfile(null);
      }
      await refreshLatticePanels();
    } catch (error) {
      setLatticeModeError(error instanceof Error ? error.message : String(error));
    } finally {
      setLatticeModeBusy(false);
    }
  };

  const handleApplyLatticeProfile = async (): Promise<void> => {
    await applyLatticeProfile(selectedLatticeProfile, false);
  };

  const handleRevertLatticeProfile = async (): Promise<void> => {
    if (!revertLatticeProfile) {
      return;
    }
    await applyLatticeProfile(revertLatticeProfile, true);
  };

  const runScenarioControl = async (
    action: 'set_phase' | 'advance' | 'revert' | 'reset' | 'inject_fault' | 'clear_fault',
    payload?: { phase_id?: string; fault_id?: string; reason?: string },
  ): Promise<void> => {
    if (!adminNodeId) {
      setLatticeScenarioError('Admin node identity unavailable. Select an enrolled admin operator.');
      return;
    }

    setLatticeScenarioBusy(true);
    setLatticeScenarioError(null);
    try {
      const response = await controlLatticeScenario({
        admin_node_id: adminNodeId,
        action,
        phase_id: payload?.phase_id,
        fault_id: payload?.fault_id,
        reason: payload?.reason,
      });

      if (response.status !== 'ok') {
        throw new Error(response.message || response.code || 'Scenario control failed');
      }

      await refreshLatticePanels();
    } catch (error) {
      setLatticeScenarioError(error instanceof Error ? error.message : String(error));
    } finally {
      setLatticeScenarioBusy(false);
    }
  };

  // Calculate fleet health metrics from attestation state
  const totalNodes = fleetAttestationState.length;
  const verifiedNodes = fleetAttestationState.filter(n => n.tpm_attestation_valid).length;
  const compromisedNodes = fleetAttestationState.filter(n => n.byzantine_detected).length;
  const revokedNodes = fleetAttestationState.filter(n => n.revoked).length;
  const latticeIntegrationMode =
    latticeStatus?.integration_mode ||
    latticeMode?.integration_mode ||
    latticeStatus?.bridge?.integration_mode ||
    'unknown';
  const latticeInputMode =
    latticeStatus?.input_mode ||
    latticeMode?.input_mode ||
    latticeStatus?.bridge?.input_mode ||
    'unknown';
  const latticeEffectiveProfile =
    latticeStatus?.effective_profile ||
    latticeMode?.effective_profile ||
    latticeStatus?.bridge?.effective_profile ||
    'unknown';
  const latticeModeChangeAtMs =
    latticeStatus?.last_mode_change_at_ms ||
    latticeMode?.last_mode_change_at_ms ||
    latticeStatus?.bridge?.last_mode_change_at_ms ||
    null;
  const latticeReadOnly = latticeIntegrationMode === 'stealth_readonly';
  const canMutateLatticeMode = hasAdminPrivileges && adminNodeId.length > 0;
  const canMutateScenario = canMutateLatticeMode && latticeInputMode === 'synthetic';
  const scenarioPhaseLabel = latticeScenario?.phase_label || latticeStatus?.phase_label || 'n/a';
  const scenarioReady = latticeScenario?.scenario_ready ?? latticeStatus?.scenario_ready ?? false;
  const simulatedCpu = Math.min(95, 18 + (latticeStatus?.tasks_cached ?? 0) + (latticeStatus?.invalid_events_dropped ?? 0));
  const simulatedMemory = 3.4 + ((latticeStatus?.objects_cached ?? 0) % 15) / 10;
  const simulatedStorage = Math.min(92, 41 + ((latticeStatus?.entities_cached ?? 0) % 50));
  const simulatedUptime = latticeModeChangeAtMs
    ? `${Math.max(0, Math.round((Date.now() - latticeModeChangeAtMs) / 60000))}m`
    : 'n/a';

  return (
    <div className="h-full overflow-y-auto overflow-x-hidden">
      <div className="max-w-7xl mx-auto p-4 space-y-4 pb-8">
        <div className="flex items-center justify-between">
          <h1 className="font-display text-3xl font-bold text-tungsten mb-2">
            System Administration
          </h1>
          {!hasAdminPrivileges && (
            <div className="flex items-center gap-2 text-yellow-400 text-sm">
              <AlertTriangle size={16} />
              <span>Limited privileges - read-only mode</span>
            </div>
          )}
        </div>

        {!isDesktop && (
          <ServiceUnavailablePanel
            title="Desktop actions unavailable in browser"
            description="Local stack repair, support bundle collection, and TPM-backed diagnostics require the Tactical Glass desktop runtime."
            capability="Local stack management + diagnostics + support bundles"
            remediation={[
              'Open System Administration in the desktop application for local actions.',
              'Web mode can still view fleet state via backend services, but cannot repair local installs.',
            ]}
          />
        )}

        {/* System Resources */}
        <div className="grid grid-cols-4 gap-4">
          <GlassPanel variant="light" className="p-4">
            <div className="flex items-start justify-between">
              <div>
                <div className="text-tungsten/70 text-sm">Demo Load (SIMULATED)</div>
                <div className="font-display text-3xl font-bold text-tungsten mt-1">{simulatedCpu}%</div>
              </div>
              <Cpu className="text-overmatch" size={24} />
            </div>
          </GlassPanel>

          <GlassPanel variant="light" className="p-4">
            <div className="flex items-start justify-between">
              <div>
                <div className="text-tungsten/70 text-sm">Scenario Memory (SIMULATED)</div>
                <div className="font-display text-3xl font-bold text-tungsten mt-1">{simulatedMemory.toFixed(1)} GB</div>
              </div>
              <HardDrive className="text-overmatch" size={24} />
            </div>
          </GlassPanel>

          <GlassPanel variant="light" className="p-4">
            <div className="flex items-start justify-between">
              <div>
                <div className="text-tungsten/70 text-sm">Evidence Index (SIMULATED)</div>
                <div className="font-display text-3xl font-bold text-tungsten mt-1">{simulatedStorage}%</div>
              </div>
              <Database className="text-ghost" size={24} />
            </div>
          </GlassPanel>

          <GlassPanel variant="light" className="p-4">
            <div className="flex items-start justify-between">
              <div>
                <div className="text-tungsten/70 text-sm">Profile Uptime</div>
                <div className="font-display text-2xl font-bold text-verified-green mt-1">{simulatedUptime}</div>
              </div>
              <Server className="text-verified-green" size={24} />
            </div>
          </GlassPanel>
        </div>

        <GlassPanel variant="light" className="p-6 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="font-display text-xl font-semibold text-tungsten">Diagnostics</h2>
              <p className="text-sm text-tungsten/60">
                Schema v{diagnostics?.schema_version ?? '-'} • Service health, ports, certs, disk, runtimes
              </p>
            </div>
            <div className="flex gap-2">
              <button
                className="px-3 py-2 rounded bg-overmatch/20 hover:bg-overmatch/30 text-xs text-tungsten flex items-center gap-2"
                onClick={() => runAction('repair', () => TauriCommands.repairInstallation())}
                disabled={!isDesktop || busyAction !== null}
              >
                <Wrench size={14} /> Repair Installation
              </button>
              <button
                className="px-3 py-2 rounded bg-ghost/20 hover:bg-ghost/30 text-xs text-tungsten flex items-center gap-2"
                onClick={() => runAction('reset', () => TauriCommands.resetLocalStack())}
                disabled={!isDesktop || busyAction !== null}
              >
                <RotateCcw size={14} /> Reset Local Stack
              </button>
              <button
                className="px-3 py-2 rounded bg-verified-green/20 hover:bg-verified-green/30 text-xs text-tungsten flex items-center gap-2"
                onClick={() =>
                  runAction('bundle', async () => {
                    const result = await TauriCommands.collectSupportBundle();
                    if (result.success) {
                      setBundle(result.data);
                    }
                  })
                }
                disabled={!isDesktop || busyAction !== null}
              >
                <Archive size={14} /> Collect Support Bundle
              </button>
            </div>
          </div>
          {actionError && (
            <div className="flex items-start gap-2 text-xs text-red-300 bg-red-900/30 border border-red-400/40 rounded p-2">
              <AlertTriangle size={14} className="mt-0.5" />
              <span>{actionError}</span>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            {(diagnostics?.checks ?? []).map((check) => (
              <div key={check.id} className="border border-tungsten/10 rounded-lg p-3 bg-carbon/30">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-tungsten">{check.label}</span>
                  <span className={`text-xs ${check.status === 'pass' ? 'text-verified-green' : 'text-yellow-400'}`}>
                    {check.status.toUpperCase()}
                  </span>
                </div>
                <p className="text-xs text-tungsten/70 mt-2">{check.detail}</p>
              </div>
            ))}
          </div>

          {bundle && (
            <div className="text-xs text-tungsten/70 border border-tungsten/10 rounded p-3 bg-carbon/30">
              Support bundle written to <span className="font-mono">{bundle.bundle_path}</span> ({bundle.file_count} files)
            </div>
          )}
        </GlassPanel>

        <GlassPanel variant="light" className="p-6">
          <div className="flex items-center gap-2 mb-3">
            <ShieldAlert size={18} className="text-overmatch" />
            <h2 className="font-display text-xl font-semibold text-tungsten">
              Guided Offline Troubleshooting
            </h2>
          </div>
          <div className="grid grid-cols-3 gap-3">
            {(diagnostics?.troubleshooting_cards ?? []).map((card) => (
              <div key={card.failure_class} className="bg-carbon/50 border border-tungsten/10 rounded-lg p-4">
                <h3 className="text-sm font-semibold text-tungsten mb-2">{card.title}</h3>
                <ul className="space-y-1">
                  {card.steps.map((step, index) => (
                    <li key={index} className="text-xs text-tungsten/70">{index + 1}. {step}</li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </GlassPanel>

        <GlassPanel variant="light" className="p-6 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="font-display text-xl font-semibold text-tungsten">Lattice Bridge</h2>
              <p className="text-xs text-tungsten/60">
                Sandboxes-first synchronization status and read-only task inbox
              </p>
            </div>
            <div className="flex items-center gap-2">
              <span className={`text-xs px-2 py-1 rounded ${latticeReadOnly ? 'bg-ghost/20 text-ghost' : 'bg-overmatch/20 text-overmatch'}`}>
                {latticeReadOnly ? 'STEALTH READ-ONLY' : latticeIntegrationMode.toUpperCase()}
              </span>
              <span
                className={`text-xs px-2 py-1 rounded ${
                  latticeStatus?.status === 'ok'
                    ? 'bg-verified-green/20 text-verified-green'
                    : 'bg-yellow-400/20 text-yellow-300'
                }`}
              >
                {latticeStatus?.status?.toUpperCase() || 'UNKNOWN'}
              </span>
            </div>
          </div>

          <div className="grid grid-cols-6 gap-3">
            <div className="bg-carbon/40 border border-tungsten/10 rounded p-3">
              <div className="text-xs text-tungsten/60">Integration</div>
              <div className="text-sm text-tungsten font-mono mt-1">{latticeIntegrationMode}</div>
            </div>
            <div className="bg-carbon/40 border border-tungsten/10 rounded p-3">
              <div className="text-xs text-tungsten/60">Protocol</div>
              <div className="text-sm text-tungsten font-mono mt-1">
                {latticeStatus?.bridge?.protocol_mode || 'n/a'}
              </div>
            </div>
            <div className="bg-carbon/40 border border-tungsten/10 rounded p-3">
              <div className="text-xs text-tungsten/60">Input Mode</div>
              <div className="text-sm text-tungsten font-mono mt-1">{latticeInputMode}</div>
            </div>
            <div className="bg-carbon/40 border border-tungsten/10 rounded p-3">
              <div className="text-xs text-tungsten/60">Profile</div>
              <div className="text-xs text-tungsten font-mono mt-1">{latticeEffectiveProfile}</div>
            </div>
            <div className="bg-carbon/40 border border-tungsten/10 rounded p-3">
              <div className="text-xs text-tungsten/60">Tasks Cached</div>
              <div className="text-sm text-tungsten font-mono mt-1">{latticeStatus?.tasks_cached ?? 0}</div>
            </div>
          </div>

          <div className="grid grid-cols-5 gap-3">
            <div className="bg-carbon/40 border border-tungsten/10 rounded p-3">
              <div className="text-xs text-tungsten/60">Overlays Cached</div>
              <div className="text-sm text-tungsten font-mono mt-1">{latticeStatus?.overlays_cached ?? 0}</div>
            </div>
            <div className="bg-carbon/40 border border-tungsten/10 rounded p-3">
              <div className="text-xs text-tungsten/60">Entities Cached</div>
              <div className="text-sm text-tungsten font-mono mt-1">{latticeStatus?.entities_cached ?? 0}</div>
            </div>
            <div className="bg-carbon/40 border border-tungsten/10 rounded p-3">
              <div className="text-xs text-tungsten/60">Last Event Age</div>
              <div className="text-sm text-tungsten font-mono mt-1">
                {latticeStatus?.event_age_ms != null ? `${Math.round(latticeStatus.event_age_ms / 1000)}s` : 'n/a'}
              </div>
            </div>
            <div className="bg-carbon/40 border border-tungsten/10 rounded p-3">
              <div className="text-xs text-tungsten/60">Scenario Phase</div>
              <div className="text-xs text-tungsten font-mono mt-1">{scenarioPhaseLabel}</div>
            </div>
            <div className="bg-carbon/40 border border-tungsten/10 rounded p-3">
              <div className="text-xs text-tungsten/60">Scenario Ready</div>
              <div className={`text-sm font-mono mt-1 ${scenarioReady ? 'text-verified-green' : 'text-yellow-300'}`}>
                {scenarioReady ? 'READY' : 'DEGRADED'}
              </div>
            </div>
            <div className="bg-carbon/40 border border-tungsten/10 rounded p-3">
              <div className="text-xs text-tungsten/60">Outbound Posture</div>
              <div className="text-sm text-tungsten font-mono mt-1">
                {latticeReadOnly ? 'disabled' : 'enabled'}
              </div>
            </div>
          </div>

          <div className="bg-carbon/40 border border-tungsten/10 rounded p-3 space-y-3">
            <div className="flex items-center justify-between">
              <div className="text-xs text-tungsten/60">Stealth Profile Selector (Admin)</div>
              <div className="text-xs text-tungsten/60">
                Last change:{' '}
                {latticeModeChangeAtMs ? new Date(latticeModeChangeAtMs).toLocaleString() : 'n/a'}
              </div>
            </div>
            <div className="flex items-center gap-3">
              <select
                className="bg-carbon border border-tungsten/20 rounded px-2 py-1 text-xs text-tungsten"
                value={selectedLatticeProfile}
                onChange={(event) => setSelectedLatticeProfile(event.target.value as LatticeStealthProfile)}
                disabled={!canMutateLatticeMode || latticeModeBusy}
              >
                <option value="stealth_readonly_synthetic">Stealth + Synthetic</option>
                <option value="stealth_readonly_live">Stealth + Live</option>
              </select>
              <button
                className="px-3 py-1 rounded bg-overmatch/20 hover:bg-overmatch/30 text-xs text-tungsten disabled:opacity-40"
                onClick={() => void handleApplyLatticeProfile()}
                disabled={!canMutateLatticeMode || latticeModeBusy}
              >
                {latticeModeBusy ? 'Applying...' : 'Apply'}
              </button>
              <button
                className="px-3 py-1 rounded bg-ghost/20 hover:bg-ghost/30 text-xs text-tungsten disabled:opacity-40"
                onClick={() => void handleRevertLatticeProfile()}
                disabled={!canMutateLatticeMode || latticeModeBusy || !revertLatticeProfile}
              >
                Revert
              </button>
            </div>
            {!canMutateLatticeMode && (
              <div className="text-xs text-yellow-300">
                Controls disabled: admin allowlist + enrollment + revocation checks are required.
              </div>
            )}
          </div>

          <div className="bg-carbon/40 border border-tungsten/10 rounded p-3 space-y-3">
            <div className="flex items-center justify-between">
              <div className="text-xs text-tungsten/60">Scenario Control (Admin)</div>
              <div className="text-xs text-tungsten/60">
                {latticeScenario?.phase_label || latticeStatus?.phase_label || 'phase unavailable'}
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <select
                className="bg-carbon border border-tungsten/20 rounded px-2 py-1 text-xs text-tungsten"
                value={selectedScenarioPhaseId}
                onChange={(event) => setSelectedScenarioPhaseId(event.target.value)}
                disabled={!canMutateScenario || latticeScenarioBusy}
              >
                <option value="phase_0_baseline">Phase 0 Baseline</option>
                <option value="phase_1_contact">Phase 1 Contact</option>
                <option value="phase_2_incursion">Phase 2 Incursion</option>
                <option value="phase_3_response">Phase 3 Response</option>
                <option value="phase_4_resolution">Phase 4 Resolution</option>
              </select>
              <button
                className="px-3 py-1 rounded bg-overmatch/20 hover:bg-overmatch/30 text-xs text-tungsten disabled:opacity-40"
                onClick={() => void runScenarioControl('set_phase', { phase_id: selectedScenarioPhaseId, reason: 'system_admin_set_phase' })}
                disabled={!canMutateScenario || latticeScenarioBusy}
              >
                Set Phase
              </button>
              <button
                className="px-3 py-1 rounded bg-overmatch/20 hover:bg-overmatch/30 text-xs text-tungsten disabled:opacity-40"
                onClick={() => void runScenarioControl('advance', { reason: 'system_admin_advance_phase' })}
                disabled={!canMutateScenario || latticeScenarioBusy}
              >
                Advance
              </button>
              <button
                className="px-3 py-1 rounded bg-ghost/20 hover:bg-ghost/30 text-xs text-tungsten disabled:opacity-40"
                onClick={() => void runScenarioControl('revert', { reason: 'system_admin_revert_phase' })}
                disabled={!canMutateScenario || latticeScenarioBusy}
              >
                Revert
              </button>
              <button
                className="px-3 py-1 rounded bg-tungsten/20 hover:bg-tungsten/30 text-xs text-tungsten disabled:opacity-40"
                onClick={() => void runScenarioControl('reset', { reason: 'system_admin_reset_run' })}
                disabled={!canMutateScenario || latticeScenarioBusy}
              >
                Reset Run
              </button>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <select
                className="bg-carbon border border-tungsten/20 rounded px-2 py-1 text-xs text-tungsten"
                value={selectedScenarioFault}
                onChange={(event) => setSelectedScenarioFault(event.target.value)}
                disabled={!canMutateScenario || latticeScenarioBusy}
              >
                <option value="spoof_burst">Spoof Burst</option>
                <option value="stale_feed">Stale Feed</option>
                <option value="comms_degradation">Comms Degradation</option>
              </select>
              <button
                className="px-3 py-1 rounded bg-yellow-500/20 hover:bg-yellow-500/30 text-xs text-yellow-200 disabled:opacity-40"
                onClick={() => void runScenarioControl('inject_fault', { fault_id: selectedScenarioFault, reason: 'system_admin_inject_fault' })}
                disabled={!canMutateScenario || latticeScenarioBusy}
              >
                Inject Fault
              </button>
              <button
                className="px-3 py-1 rounded bg-verified-green/20 hover:bg-verified-green/30 text-xs text-verified-green disabled:opacity-40"
                onClick={() => void runScenarioControl('clear_fault', { fault_id: selectedScenarioFault, reason: 'system_admin_clear_fault' })}
                disabled={!canMutateScenario || latticeScenarioBusy}
              >
                Clear Fault
              </button>
              <button
                className="px-3 py-1 rounded bg-verified-green/20 hover:bg-verified-green/30 text-xs text-verified-green disabled:opacity-40"
                onClick={() => void runScenarioControl('clear_fault', { reason: 'system_admin_clear_all_faults' })}
                disabled={!canMutateScenario || latticeScenarioBusy}
              >
                Clear All Faults
              </button>
            </div>
            {latticeScenario?.preflight?.checklist?.length ? (
              <div className="grid grid-cols-2 gap-2">
                {latticeScenario.preflight.checklist.map((item) => (
                  <div key={item.id} className="bg-carbon/50 border border-tungsten/10 rounded p-2 text-xs">
                    <div className="flex items-center justify-between">
                      <span className="text-tungsten/80">{item.label}</span>
                      <span className={item.ok ? 'text-verified-green' : 'text-yellow-300'}>
                        {item.ok ? 'OK' : 'CHECK'}
                      </span>
                    </div>
                    <div className="text-tungsten/60 mt-1">{item.detail}</div>
                  </div>
                ))}
              </div>
            ) : null}
            {!canMutateScenario && (
              <div className="text-xs text-yellow-300">
                Scenario controls require admin authorization and `Stealth + Synthetic` profile.
              </div>
            )}
          </div>

          {latticeError && (
            <div className="text-xs text-red-300 bg-red-900/30 border border-red-400/40 rounded p-2">
              FAIL-VISIBLE: Lattice status unavailable: {latticeError}
            </div>
          )}

          {latticeModeError && (
            <div className="text-xs text-red-300 bg-red-900/30 border border-red-400/40 rounded p-2">
              FAIL-VISIBLE: Lattice profile mutation failed: {latticeModeError}
            </div>
          )}

          {latticeScenarioError && (
            <div className="text-xs text-red-300 bg-red-900/30 border border-red-400/40 rounded p-2">
              FAIL-VISIBLE: Scenario control failed: {latticeScenarioError}
            </div>
          )}

          {latticeReadOnly && (
            <div className="text-xs text-ghost bg-ghost/10 border border-ghost/40 rounded p-2">
              Stealth read-only mode active: outbound publish/upload/register and task execution paths remain disabled.
            </div>
          )}

          <div>
            <div className="text-sm font-semibold text-tungsten mb-2">Read-Only Lattice Task Inbox</div>
            <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
              {latticeTasks.length === 0 && (
                <div className="text-xs text-tungsten/60 border border-tungsten/10 rounded p-2 bg-carbon/30">
                  No Lattice tasks currently cached.
                </div>
              )}
              {latticeTasks.map((task) => (
                <div key={task.task_id} className="bg-carbon/50 border border-tungsten/10 rounded p-2 text-xs">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono text-tungsten">{task.task_id}</span>
                    <span className="text-tungsten/60">v{task.status_version}</span>
                  </div>
                  <div className="mt-1 flex items-center justify-between">
                    <span className="text-tungsten/80">{task.status}</span>
                    <span
                      className={`px-2 py-0.5 rounded ${
                        task.trust_posture === 'trusted'
                          ? 'bg-verified-green/20 text-verified-green'
                          : task.trust_posture === 'degraded'
                          ? 'bg-yellow-400/20 text-yellow-300'
                          : 'bg-tungsten/20 text-tungsten/80'
                      }`}
                    >
                      {task.trust_posture}
                    </span>
                  </div>
                  <div className="mt-1 text-tungsten/60">
                    Agent: {task.assigned_agent_id} • freshness {task.freshness_ms}ms
                  </div>
                </div>
              ))}
            </div>
          </div>
        </GlassPanel>

        {/* Configuration Sections */}
        <div className="grid grid-cols-2 gap-4">
          <GlassPanel variant="light" className="p-6">
            <div className="flex items-center gap-3 mb-4">
              <Settings className="text-overmatch" size={24} />
              <h2 className="font-display text-xl font-semibold text-tungsten">
                System Configuration
              </h2>
            </div>
            <div className="space-y-3">
              <div className="flex justify-between items-center py-2 border-b border-tungsten/10">
                <span className="text-tungsten/70">BLAKE3 Hashing</span>
                <span className="badge-success text-xs">Enabled</span>
              </div>
              <div className="flex justify-between items-center py-2 border-b border-tungsten/10">
                <span className="text-tungsten/70">TPM 2.0</span>
                {tpmEnabled ? (
                  <span className="badge-success text-xs">Active</span>
                ) : (
                  <span className="badge-warning text-xs">Disabled</span>
                )}
              </div>
              <div className="flex justify-between items-center py-2 border-b border-tungsten/10">
                <span className="text-tungsten/70">Ed25519 Signatures</span>
                <span className="badge-success text-xs">Enabled</span>
              </div>
              <div className="flex justify-between items-center py-2">
                <span className="text-tungsten/70">Merkle Vine Verification</span>
                <span className="badge-success text-xs">Active</span>
              </div>
            </div>
          </GlassPanel>

          <GlassPanel variant="light" className="p-6">
            <div className="flex items-center gap-3 mb-4">
              <Database className="text-overmatch" size={24} />
              <h2 className="font-display text-xl font-semibold text-tungsten">
                Data Management
              </h2>
            </div>
            <div className="space-y-3">
              <div className="flex justify-between items-center py-2 border-b border-tungsten/10">
                <span className="text-tungsten/70">Telemetry Retention</span>
                <span className="font-mono text-tungsten text-sm">30 days</span>
              </div>
              <div className="flex justify-between items-center py-2 border-b border-tungsten/10">
                <span className="text-tungsten/70">Log Level</span>
                <span className="font-mono text-tungsten text-sm">INFO</span>
              </div>
              <div className="flex justify-between items-center py-2 border-b border-tungsten/10">
                <span className="text-tungsten/70">Backup Schedule</span>
                <span className="font-mono text-tungsten text-sm">Daily 02:00</span>
              </div>
              <div className="flex justify-between items-center py-2">
                <span className="text-tungsten/70">Archive Location</span>
                <span className="font-mono text-tungsten text-sm">/var/aether</span>
              </div>
            </div>
          </GlassPanel>
        </div>

        {/* Gospel & Revocation */}
        <GlassPanel variant="light" className="p-6">
          <div className="flex items-center gap-3 mb-4">
            <Shield className="text-overmatch" size={24} />
            <div className="flex-1">
              <h2 className="font-display text-xl font-semibold text-tungsten">
                The Great Gospel
              </h2>
              <p className="text-xs text-tungsten/60">
                System-wide ledger of sovereign revocation and Byzantine detection events
              </p>
            </div>
            <div className="text-xs text-tungsten/50">
              Last update: {lastAttestationUpdate > 0 ? new Date(lastAttestationUpdate).toLocaleTimeString() : 'Never'}
            </div>
          </div>

          <div className="bg-carbon/50 border border-tungsten/10 rounded-lg p-4 mb-4">
            <div className="grid grid-cols-4 gap-4">
              <div className="text-center">
                <div className="font-display text-2xl font-bold text-tungsten">{totalNodes}</div>
                <div className="text-xs text-tungsten/50 mt-1">Total Nodes</div>
              </div>
              <div className="text-center">
                <div className="font-display text-2xl font-bold text-verified-green">{verifiedNodes}</div>
                <div className="text-xs text-tungsten/50 mt-1">Verified</div>
              </div>
              <div className="text-center">
                <div className={`font-display text-2xl font-bold ${compromisedNodes > 0 ? 'text-red-400' : 'text-tungsten'}`}>
                  {compromisedNodes}
                </div>
                <div className="text-xs text-tungsten/50 mt-1">Compromised</div>
              </div>
              <div className="text-center">
                <div className={`font-display text-2xl font-bold ${revokedNodes > 0 ? 'text-ghost' : 'text-tungsten'}`}>
                  {revokedNodes}
                </div>
                <div className="text-xs text-tungsten/50 mt-1">Revoked</div>
              </div>
            </div>
          </div>

          {/* Fleet Integrity Score */}
          <div className="bg-carbon/50 border border-tungsten/10 rounded-lg p-4">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm text-tungsten/70">Fleet Integrity</span>
              <span className={`font-display text-lg font-bold ${
                totalNodes > 0 && (verifiedNodes / totalNodes) >= 0.9
                  ? 'text-verified-green'
                  : totalNodes > 0 && (verifiedNodes / totalNodes) >= 0.7
                  ? 'text-yellow-400'
                  : 'text-red-400'
              }`}>
                {totalNodes > 0 ? Math.round((verifiedNodes / totalNodes) * 100) : 0}%
              </span>
            </div>
            <div className="trust-gauge">
              <div
                className={`trust-gauge-fill ${
                  totalNodes > 0 && (verifiedNodes / totalNodes) >= 0.9
                    ? 'high'
                    : totalNodes > 0 && (verifiedNodes / totalNodes) >= 0.7
                    ? 'medium'
                    : 'low'
                }`}
                style={{ width: `${totalNodes > 0 ? (verifiedNodes / totalNodes) * 100 : 0}%` }}
              />
            </div>
          </div>

          {/* Recent Revocations */}
          {revocationHistory.length > 0 && (
            <div className="mt-4">
              <div className="text-sm font-semibold text-tungsten mb-2">Recent Revocations</div>
              <div className="space-y-2">
                {revocationHistory.slice(0, 3).map((cert, idx) => (
                  <div key={idx} className="bg-carbon/50 border border-red-400/20 rounded p-2 text-xs">
                    <div className="flex items-center justify-between mb-1">
                      <span className="font-mono text-tungsten">{cert.node_id}</span>
                      <span className="text-tungsten/50">
                        {new Date(cert.timestamp_ms).toLocaleString()}
                      </span>
                    </div>
                    <div className="text-tungsten/70">{cert.revocation_reason}</div>
                    <div className="text-tungsten/50 mt-1">
                      Signature: {cert.signature ? `${cert.signature.substring(0, 16)}...` : 'missing'}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </GlassPanel>

        {/* Node List Panel with Attestation Status */}
        <NodeListPanel />

        {/* Merkle Vine Audit Trail */}
        <AuditLogViewer maxEvents={20} />
      </div>
    </div>
  );
};
