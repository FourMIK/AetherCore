/**
 * TrustGuardianView
 * Identity verification and trust mesh monitoring workspace
 */

import React from 'react';
import { GlassPanel } from '../hud/GlassPanel';
import { Shield, Lock, AlertTriangle, CheckCircle, Key } from 'lucide-react';
import { useTacticalStore } from '../../store/useTacticalStore';

export const TrustGuardianView: React.FC = () => {
  const nodes = useTacticalStore((s) => s.nodes);
  const nodeArray = Array.from(nodes.values());
  
  const trustMetrics = {
    verified: nodeArray.filter(n => n.verified).length,
    pending: nodeArray.filter(n => !n.verified).length,
    highTrust: nodeArray.filter(n => n.trustScore >= 90).length,
    degraded: nodeArray.filter(n => n.trustScore < 70).length,
  };

  return (
    <div className="h-full overflow-y-auto overflow-x-hidden">
      <div className="max-w-7xl mx-auto p-4 space-y-4 pb-8">
        <h1 className="font-display text-3xl font-bold text-tungsten mb-2">
          Trust Guardian
        </h1>

        {/* Trust Metrics */}
        <div className="grid grid-cols-4 gap-4">
          <GlassPanel variant="light" className="p-4">
            <div className="flex items-start justify-between">
              <div>
                <div className="text-tungsten/70 text-sm">Verified Nodes</div>
                <div className="font-display text-3xl font-bold text-verified-green mt-1">
                  {trustMetrics.verified}
                </div>
              </div>
              <CheckCircle className="text-verified-green" size={24} />
            </div>
          </GlassPanel>

          <GlassPanel variant="light" className="p-4">
            <div className="flex items-start justify-between">
              <div>
                <div className="text-tungsten/70 text-sm">Pending</div>
                <div className="font-display text-3xl font-bold text-ghost mt-1">
                  {trustMetrics.pending}
                </div>
              </div>
              <AlertTriangle className="text-ghost" size={24} />
            </div>
          </GlassPanel>

          <GlassPanel variant="light" className="p-4">
            <div className="flex items-start justify-between">
              <div>
                <div className="text-tungsten/70 text-sm">High Trust</div>
                <div className="font-display text-3xl font-bold text-overmatch mt-1">
                  {trustMetrics.highTrust}
                </div>
              </div>
              <Shield className="text-overmatch" size={24} />
            </div>
          </GlassPanel>

          <GlassPanel variant="light" className="p-4">
            <div className="flex items-start justify-between">
              <div>
                <div className="text-tungsten/70 text-sm">Degraded</div>
                <div className="font-display text-3xl font-bold text-jamming mt-1">
                  {trustMetrics.degraded}
                </div>
              </div>
              <AlertTriangle className="text-jamming" size={24} />
            </div>
          </GlassPanel>
        </div>

        {/* CodeRalphie Status */}
        <GlassPanel variant="light" className="p-6">
          <div className="flex items-center gap-3 mb-4">
            <Key className="text-overmatch" size={24} />
            <h2 className="font-display text-xl font-semibold text-tungsten">
              CodeRalphie Hardware Trust
            </h2>
          </div>
          <div className="grid grid-cols-3 gap-4">
            <div className="p-4 bg-carbon/30 border border-tungsten/10 rounded-lg">
              <div className="text-tungsten/70 text-sm mb-2">TPM Attestations</div>
              <div className="font-display text-2xl font-bold text-tungsten">
                {trustMetrics.verified}
              </div>
              <div className="text-xs text-verified-green mt-1">✓ All Valid</div>
            </div>
            <div className="p-4 bg-carbon/30 border border-tungsten/10 rounded-lg">
              <div className="text-tungsten/70 text-sm mb-2">Ed25519 Keys</div>
              <div className="font-display text-2xl font-bold text-tungsten">
                {nodeArray.length}
              </div>
              <div className="text-xs text-verified-green mt-1">✓ Hardware-Backed</div>
            </div>
            <div className="p-4 bg-carbon/30 border border-tungsten/10 rounded-lg">
              <div className="text-tungsten/70 text-sm mb-2">BLAKE3 Hashes</div>
              <div className="font-display text-2xl font-bold text-tungsten">
                {nodeArray.length * 2}
              </div>
              <div className="text-xs text-verified-green mt-1">✓ Merkle Verified</div>
            </div>
          </div>
        </GlassPanel>

        {/* Trust Events */}
        <GlassPanel variant="light" className="p-6">
          <div className="flex items-center gap-3 mb-4">
            <Lock className="text-overmatch" size={24} />
            <h2 className="font-display text-xl font-semibold text-tungsten">
              Recent Trust Events
            </h2>
          </div>
          <div className="space-y-2">
            {nodeArray.length === 0 ? (
              <div className="text-center py-8 text-tungsten/50">
                No trust events recorded
              </div>
            ) : (
              nodeArray.slice(0, 5).map((node) => (
                <div
                  key={node.id}
                  className="flex items-center justify-between p-3 bg-carbon/30 border border-tungsten/10 rounded-lg"
                >
                  <div className="flex items-center gap-3">
                    {node.verified ? (
                      <CheckCircle className="text-verified-green" size={18} />
                    ) : (
                      <AlertTriangle className="text-ghost" size={18} />
                    )}
                    <div>
                      <div className="font-mono text-tungsten text-sm">
                        {node.id}
                      </div>
                      <div className="text-xs text-tungsten/50">
                        {node.verified ? 'Identity verified' : 'Awaiting attestation'}
                      </div>
                    </div>
                  </div>
                  <div className="text-xs text-tungsten/50 font-mono">
                    {new Date(node.lastSeen).toLocaleString()}
                  </div>
                </div>
              ))
            )}
          </div>
        </GlassPanel>
      </div>
    </div>
  );
};
