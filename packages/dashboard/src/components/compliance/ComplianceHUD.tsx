/**
 * ComplianceHUD
 * Operation Legal Shield: License Compliance Status Display
 * 
 * Provides real-time visibility into license compliance status for all
 * dependencies in the Tactical Glass desktop application. Integrates with
 * the trust mesh ledger for compliance proof verification.
 */

import React, { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { GlassPanel } from '../hud/GlassPanel';

interface LicenseInventoryEntry {
  package_name: string;
  version: string;
  license: string;
  license_hash: string | null;
  ecosystem: string;
  compliance_status: 'APPROVED' | 'FLAGGED' | 'UNKNOWN';
}

interface LicenseInventory {
  total_dependencies: number;
  approved_count: number;
  flagged_count: number;
  unknown_count: number;
  entries: LicenseInventoryEntry[];
  manifest_hash: string | null;
  last_verification: number | null;
}

export const ComplianceHUD: React.FC = () => {
  const [inventory, setInventory] = useState<LicenseInventory | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedPackages, setExpandedPackages] = useState(false);

  useEffect(() => {
    loadLicenseInventory();
    
    // Refresh every 60 seconds
    const interval = setInterval(() => {
      loadLicenseInventory();
    }, 60000);
    
    return () => clearInterval(interval);
  }, []);

  const loadLicenseInventory = async () => {
    try {
      setLoading(true);
      const data = await invoke<LicenseInventory>('get_license_inventory');
      setInventory(data);
      setError(null);
    } catch (err) {
      console.error('Failed to load license inventory:', err);
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  };

  const getComplianceStatus = (): { status: string; color: string; label: string } => {
    if (!inventory) {
      return { status: 'UNVERIFIED', color: 'text-yellow-400', label: 'Status Unverified' };
    }
    
    if (inventory.flagged_count > 0) {
      return { status: 'NON_COMPLIANT', color: 'text-red-500', label: 'Non-Compliant' };
    }
    
    if (inventory.unknown_count > 0) {
      return { status: 'UNVERIFIED', color: 'text-yellow-400', label: 'Partially Verified' };
    }
    
    return { status: 'COMPLIANT', color: 'text-green-400', label: 'Compliant' };
  };

  const formatTimestamp = (timestamp: number | null): string => {
    if (!timestamp) return 'Never';
    const date = new Date(timestamp);
    return date.toLocaleString();
  };

  const compliance = getComplianceStatus();

  if (loading && !inventory) {
    return (
      <GlassPanel className="p-6">
        <div className="text-center">
          <div className="animate-pulse text-cyan-400">Loading compliance data...</div>
        </div>
      </GlassPanel>
    );
  }

  if (error) {
    return (
      <GlassPanel className="p-6 border-red-500/50">
        <div className="text-red-400">
          <div className="font-bold mb-2">⚠️ Compliance Check Failed</div>
          <div className="text-sm opacity-75">{error}</div>
        </div>
      </GlassPanel>
    );
  }

  return (
    <div className="space-y-4">
      {/* Status Overview */}
      <GlassPanel className="p-6" chamfered>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-bold text-cyan-400">
            🛡️ Operation Legal Shield
          </h2>
          <button
            onClick={loadLicenseInventory}
            className="px-3 py-1 text-xs border border-cyan-500/30 rounded hover:border-cyan-500/70 transition-colors"
          >
            Refresh
          </button>
        </div>

        {/* Compliance Status Badge */}
        <div className={`text-2xl font-bold mb-6 ${compliance.color} flex items-center gap-3`}>
          {compliance.status === 'COMPLIANT' && '✅'}
          {compliance.status === 'NON_COMPLIANT' && '❌'}
          {compliance.status === 'UNVERIFIED' && '⚠️'}
          <span>{compliance.label}</span>
        </div>

        {/* Statistics Grid */}
        <div className="grid grid-cols-4 gap-4 mb-6">
          <div className="text-center">
            <div className="text-3xl font-bold text-white">
              {inventory?.total_dependencies || 0}
            </div>
            <div className="text-xs text-gray-400 mt-1">Total Dependencies</div>
          </div>
          
          <div className="text-center">
            <div className="text-3xl font-bold text-green-400">
              {inventory?.approved_count || 0}
            </div>
            <div className="text-xs text-gray-400 mt-1">Approved</div>
          </div>
          
          <div className="text-center">
            <div className="text-3xl font-bold text-red-400">
              {inventory?.flagged_count || 0}
            </div>
            <div className="text-xs text-gray-400 mt-1">Flagged</div>
          </div>
          
          <div className="text-center">
            <div className="text-3xl font-bold text-yellow-400">
              {inventory?.unknown_count || 0}
            </div>
            <div className="text-xs text-gray-400 mt-1">Unknown</div>
          </div>
        </div>

        {/* Metadata */}
        <div className="text-xs text-gray-400 space-y-1 border-t border-gray-700 pt-4">
          <div>
            <span className="opacity-50">Last Verification:</span>{' '}
            <span className="text-gray-300">
              {formatTimestamp(inventory?.last_verification || null)}
            </span>
          </div>
          {inventory?.manifest_hash && (
            <div>
              <span className="opacity-50">Manifest Hash:</span>{' '}
              <code className="text-xs text-cyan-400">
                {inventory.manifest_hash.substring(0, 32)}...
              </code>
            </div>
          )}
        </div>

        {/* Quarantine Warning */}
        {compliance.status === 'NON_COMPLIANT' && (
          <div className="mt-4 p-4 bg-red-500/10 border border-red-500/30 rounded">
            <div className="text-red-400 font-bold mb-2">
              ⚠️ QUARANTINE: Legal Risk
            </div>
            <div className="text-sm text-gray-300">
              This node contains non-compliant dependencies and is blocked from
              kinetic C2 operations. Review flagged packages and replace with
              permissive alternatives.
            </div>
          </div>
        )}
      </GlassPanel>

      {/* Package List */}
      <GlassPanel className="p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-bold text-gray-300">Dependency Inventory</h3>
          <button
            onClick={() => setExpandedPackages(!expandedPackages)}
            className="text-sm text-cyan-400 hover:text-cyan-300"
          >
            {expandedPackages ? 'Hide' : 'Show'} Packages
          </button>
        </div>

        {expandedPackages && inventory && (
          <div className="space-y-2 max-h-96 overflow-y-auto">
            {inventory.entries.length === 0 ? (
              <div className="text-center text-gray-500 py-8">
                No dependency data available
              </div>
            ) : (
              inventory.entries.map((entry, idx) => (
                <div
                  key={idx}
                  className={`p-3 rounded border ${
                    entry.compliance_status === 'APPROVED'
                      ? 'border-green-500/20 bg-green-500/5'
                      : entry.compliance_status === 'FLAGGED'
                      ? 'border-red-500/30 bg-red-500/10'
                      : 'border-yellow-500/20 bg-yellow-500/5'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="font-mono text-sm text-white">
                        {entry.package_name}
                        <span className="text-gray-500 ml-2">v{entry.version}</span>
                      </div>
                      <div className="text-xs text-gray-400 mt-1">
                        License: <span className="text-gray-300">{entry.license}</span>
                        {' • '}
                        Ecosystem: <span className="text-gray-300">{entry.ecosystem}</span>
                      </div>
                    </div>
                    <div
                      className={`text-xs font-bold px-2 py-1 rounded ${
                        entry.compliance_status === 'APPROVED'
                          ? 'bg-green-500/20 text-green-400'
                          : entry.compliance_status === 'FLAGGED'
                          ? 'bg-red-500/20 text-red-400'
                          : 'bg-yellow-500/20 text-yellow-400'
                      }`}
                    >
                      {entry.compliance_status}
                    </div>
                  </div>
                  {entry.license_hash && (
                    <div className="mt-2 text-xs text-gray-500">
                      Hash: <code className="text-cyan-400">{entry.license_hash.substring(0, 20)}...</code>
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        )}
      </GlassPanel>

      {/* Documentation Link */}
      <div className="text-center text-xs text-gray-500">
        <a
          href="https://github.com/FourMIK/AetherCore/blob/main/LICENSE_COMPLIANCE.md"
          target="_blank"
          rel="noopener noreferrer"
          className="text-cyan-400 hover:text-cyan-300 underline"
        >
          View License Compliance Documentation
        </a>
      </div>
    </div>
  );
};
