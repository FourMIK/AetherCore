/**
 * SystemAdminView
 * Configuration and system management workspace
 */

import React from 'react';
import { GlassPanel } from '../hud/GlassPanel';
import { Settings, Database, Server, HardDrive, Cpu } from 'lucide-react';
import { getRuntimeConfig } from '../../config/runtime';

export const SystemAdminView: React.FC = () => {
  const { tpmEnabled } = getRuntimeConfig();
  
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
                <div className="font-display text-3xl font-bold text-tungsten mt-1">
                  23%
                </div>
              </div>
              <Cpu className="text-overmatch" size={24} />
            </div>
          </GlassPanel>

          <GlassPanel variant="light" className="p-4">
            <div className="flex items-start justify-between">
              <div>
                <div className="text-tungsten/70 text-sm">Memory</div>
                <div className="font-display text-3xl font-bold text-tungsten mt-1">
                  4.2 GB
                </div>
              </div>
              <HardDrive className="text-overmatch" size={24} />
            </div>
          </GlassPanel>

          <GlassPanel variant="light" className="p-4">
            <div className="flex items-start justify-between">
              <div>
                <div className="text-tungsten/70 text-sm">Storage</div>
                <div className="font-display text-3xl font-bold text-tungsten mt-1">
                  67%
                </div>
              </div>
              <Database className="text-ghost" size={24} />
            </div>
          </GlassPanel>

          <GlassPanel variant="light" className="p-4">
            <div className="flex items-start justify-between">
              <div>
                <div className="text-tungsten/70 text-sm">Uptime</div>
                <div className="font-display text-2xl font-bold text-verified-green mt-1">
                  12d 4h
                </div>
              </div>
              <Server className="text-verified-green" size={24} />
            </div>
          </GlassPanel>
        </div>

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
