/**
 * SystemAdminView
 * Configuration and system management workspace
 */

import React, { useEffect, useState } from 'react';
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
} from 'lucide-react';
import { getRuntimeConfig } from '../../config/runtime';
import {
  DiagnosticsReport,
  SupportBundleSummary,
  TauriCommands,
} from '../../api/tauri-commands';

export const SystemAdminView: React.FC = () => {
  const { tpmEnabled } = getRuntimeConfig();
  const [diagnostics, setDiagnostics] = useState<DiagnosticsReport | null>(null);
  const [bundle, setBundle] = useState<SupportBundleSummary | null>(null);
  const [busyAction, setBusyAction] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const result = await TauriCommands.diagnosticsReport();
      if (result.success) {
        setDiagnostics(result.data);
      }
    })();
  }, []);

  const runAction = async (name: string, action: () => Promise<unknown>) => {
    setBusyAction(name);
    await action();
    const refreshed = await TauriCommands.diagnosticsReport();
    if (refreshed.success) {
      setDiagnostics(refreshed.data);
    }
    setBusyAction(null);
  };

  return (
    <div className="h-full overflow-y-auto overflow-x-hidden">
      <div className="max-w-7xl mx-auto p-4 space-y-4 pb-8">
        <h1 className="font-display text-3xl font-bold text-tungsten mb-2">
          System Administration
        </h1>

        {/* System Resources */}
        <div className="grid grid-cols-4 gap-4">
          <GlassPanel variant="light" className="p-4">
            <div className="flex items-start justify-between">
              <div>
                <div className="text-tungsten/70 text-sm">CPU Usage</div>
                <div className="font-display text-3xl font-bold text-tungsten mt-1">23%</div>
              </div>
              <Cpu className="text-overmatch" size={24} />
            </div>
          </GlassPanel>

          <GlassPanel variant="light" className="p-4">
            <div className="flex items-start justify-between">
              <div>
                <div className="text-tungsten/70 text-sm">Memory</div>
                <div className="font-display text-3xl font-bold text-tungsten mt-1">4.2 GB</div>
              </div>
              <HardDrive className="text-overmatch" size={24} />
            </div>
          </GlassPanel>

          <GlassPanel variant="light" className="p-4">
            <div className="flex items-start justify-between">
              <div>
                <div className="text-tungsten/70 text-sm">Storage</div>
                <div className="font-display text-3xl font-bold text-tungsten mt-1">67%</div>
              </div>
              <Database className="text-ghost" size={24} />
            </div>
          </GlassPanel>

          <GlassPanel variant="light" className="p-4">
            <div className="flex items-start justify-between">
              <div>
                <div className="text-tungsten/70 text-sm">Uptime</div>
                <div className="font-display text-2xl font-bold text-verified-green mt-1">12d 4h</div>
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
                disabled={busyAction !== null}
              >
                <Wrench size={14} /> Repair Installation
              </button>
              <button
                className="px-3 py-2 rounded bg-ghost/20 hover:bg-ghost/30 text-xs text-tungsten flex items-center gap-2"
                onClick={() => runAction('reset', () => TauriCommands.resetLocalStack())}
                disabled={busyAction !== null}
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
                disabled={busyAction !== null}
              >
                <Archive size={14} /> Collect Support Bundle
              </button>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            {diagnostics?.checks.map((check) => (
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
            {diagnostics?.troubleshooting_cards.map((card) => (
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
            <Server className="text-overmatch" size={24} />
            <h2 className="font-display text-xl font-semibold text-tungsten">
              The Great Gospel
            </h2>
          </div>
          <div className="bg-carbon/50 border border-tungsten/10 rounded-lg p-4">
            <div className="text-sm text-tungsten/70 mb-3">
              System-wide ledger of sovereign revocation and trust events
            </div>
            <div className="grid grid-cols-3 gap-4">
              <div className="text-center">
                <div className="font-display text-2xl font-bold text-tungsten">0</div>
                <div className="text-xs text-tungsten/50 mt-1">Revocations</div>
              </div>
              <div className="text-center">
                <div className="font-display text-2xl font-bold text-tungsten">0</div>
                <div className="text-xs text-tungsten/50 mt-1">Sweeps</div>
              </div>
              <div className="text-center">
                <div className="font-display text-2xl font-bold text-verified-green">100%</div>
                <div className="text-xs text-tungsten/50 mt-1">Integrity</div>
              </div>
            </div>
          </div>
        </GlassPanel>
      </div>
    </div>
  );
};
