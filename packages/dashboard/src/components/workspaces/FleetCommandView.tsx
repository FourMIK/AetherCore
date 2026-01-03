/**
 * FleetCommandView
 * Fleet-wide operations and unit management workspace
 */

import React from 'react';
import { GlassPanel } from '../hud/GlassPanel';
import { Users, Radio, Shield, Activity } from 'lucide-react';
import { useTacticalStore } from '../../store/useTacticalStore';

export const FleetCommandView: React.FC = () => {
  const nodes = useTacticalStore((s) => s.nodes);
  const nodeArray = Array.from(nodes.values());
  
  const stats = {
    total: nodeArray.length,
    online: nodeArray.filter(n => n.status === 'online').length,
    verified: nodeArray.filter(n => n.verified).length,
    avgTrust: nodeArray.length > 0 
      ? Math.round(nodeArray.reduce((sum, n) => sum + n.trustScore, 0) / nodeArray.length) 
      : 0,
  };

  return (
    <div className="h-full overflow-y-auto overflow-x-hidden">
      <div className="max-w-7xl mx-auto p-4 space-y-4 pb-8">
        <h1 className="font-display text-3xl font-bold text-tungsten mb-2">
          Fleet Command
        </h1>

        {/* Stats Grid */}
        <div className="grid grid-cols-4 gap-4">
          <GlassPanel variant="light" className="p-4">
            <div className="flex items-start justify-between">
              <div>
                <div className="text-tungsten/70 text-sm">Total Units</div>
                <div className="font-display text-3xl font-bold text-tungsten mt-1">
                  {stats.total}
                </div>
              </div>
              <Users className="text-overmatch" size={24} />
            </div>
          </GlassPanel>

          <GlassPanel variant="light" className="p-4">
            <div className="flex items-start justify-between">
              <div>
                <div className="text-tungsten/70 text-sm">Online</div>
                <div className="font-display text-3xl font-bold text-verified-green mt-1">
                  {stats.online}
                </div>
              </div>
              <Activity className="text-verified-green" size={24} />
            </div>
          </GlassPanel>

          <GlassPanel variant="light" className="p-4">
            <div className="flex items-start justify-between">
              <div>
                <div className="text-tungsten/70 text-sm">Verified</div>
                <div className="font-display text-3xl font-bold text-verified-green mt-1">
                  {stats.verified}
                </div>
              </div>
              <Shield className="text-verified-green" size={24} />
            </div>
          </GlassPanel>

          <GlassPanel variant="light" className="p-4">
            <div className="flex items-start justify-between">
              <div>
                <div className="text-tungsten/70 text-sm">Avg Trust</div>
                <div className="font-display text-3xl font-bold text-overmatch mt-1">
                  {stats.avgTrust}%
                </div>
              </div>
              <Radio className="text-overmatch" size={24} />
            </div>
          </GlassPanel>
        </div>

        {/* Fleet List */}
        <GlassPanel variant="light" className="p-4">
          <h2 className="font-display text-xl font-semibold text-tungsten mb-4">
            Unit Roster
          </h2>
          <div className="space-y-2">
            {nodeArray.length === 0 ? (
              <div className="text-center py-8 text-tungsten/50">
                No units in fleet. Add nodes to begin operations.
              </div>
            ) : (
              nodeArray.map((node) => (
                <div
                  key={node.id}
                  className="flex items-center justify-between p-3 bg-carbon/30 border border-tungsten/10 rounded-lg"
                >
                  <div className="flex items-center gap-4">
                    <div className={`w-2 h-2 rounded-full ${
                      node.status === 'online' ? 'bg-verified-green' : 'bg-tungsten/30'
                    }`} />
                    <div>
                      <div className="font-mono text-tungsten font-semibold">
                        {node.id}
                      </div>
                      <div className="text-xs text-tungsten/50">
                        {node.domain || 'No domain'}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-6">
                    <div className="text-right">
                      <div className="text-xs text-tungsten/50">Trust Score</div>
                      <div className={`font-mono text-sm font-semibold ${
                        node.trustScore >= 90 ? 'text-verified-green' :
                        node.trustScore >= 70 ? 'text-ghost' : 'text-jamming'
                      }`}>
                        {node.trustScore}%
                      </div>
                    </div>
                    <div>
                      {node.verified ? (
                        <Shield className="text-verified-green" size={18} />
                      ) : (
                        <Shield className="text-tungsten/30" size={18} />
                      )}
                    </div>
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
