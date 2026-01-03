/**
 * MeshNetworkView
 * Network topology and RF management workspace
 */

import React from 'react';
import { GlassPanel } from '../hud/GlassPanel';
import { Radio, Wifi, Activity, TrendingUp } from 'lucide-react';
import { useTacticalStore } from '../../store/useTacticalStore';

export const MeshNetworkView: React.FC = () => {
  const nodes = useTacticalStore((s) => s.nodes);
  const nodeArray = Array.from(nodes.values());
  
  const meshStats = {
    nodes: nodeArray.length,
    connections: nodeArray.filter(n => n.status === 'online').length * 2,
    bandwidth: '1.2 GB/s',
    latency: '12ms',
  };

  return (
    <div className="h-full overflow-y-auto overflow-x-hidden">
      <div className="max-w-7xl mx-auto p-4 space-y-4 pb-8">
        <h1 className="font-display text-3xl font-bold text-tungsten mb-2">
          Mesh Network
        </h1>

        {/* Network Stats */}
        <div className="grid grid-cols-4 gap-4">
          <GlassPanel variant="light" className="p-4">
            <div className="flex items-start justify-between">
              <div>
                <div className="text-tungsten/70 text-sm">Mesh Nodes</div>
                <div className="font-display text-3xl font-bold text-tungsten mt-1">
                  {meshStats.nodes}
                </div>
              </div>
              <Radio className="text-overmatch" size={24} />
            </div>
          </GlassPanel>

          <GlassPanel variant="light" className="p-4">
            <div className="flex items-start justify-between">
              <div>
                <div className="text-tungsten/70 text-sm">Connections</div>
                <div className="font-display text-3xl font-bold text-verified-green mt-1">
                  {meshStats.connections}
                </div>
              </div>
              <Wifi className="text-verified-green" size={24} />
            </div>
          </GlassPanel>

          <GlassPanel variant="light" className="p-4">
            <div className="flex items-start justify-between">
              <div>
                <div className="text-tungsten/70 text-sm">Throughput</div>
                <div className="font-display text-2xl font-bold text-overmatch mt-1">
                  {meshStats.bandwidth}
                </div>
              </div>
              <TrendingUp className="text-overmatch" size={24} />
            </div>
          </GlassPanel>

          <GlassPanel variant="light" className="p-4">
            <div className="flex items-start justify-between">
              <div>
                <div className="text-tungsten/70 text-sm">Avg Latency</div>
                <div className="font-display text-3xl font-bold text-verified-green mt-1">
                  {meshStats.latency}
                </div>
              </div>
              <Activity className="text-verified-green" size={24} />
            </div>
          </GlassPanel>
        </div>

        {/* Mesh Topology */}
        <GlassPanel variant="light" className="p-6">
          <div className="flex items-center gap-3 mb-4">
            <Radio className="text-overmatch" size={24} />
            <h2 className="font-display text-xl font-semibold text-tungsten">
              Network Topology
            </h2>
          </div>
          <div className="bg-carbon/50 border border-tungsten/10 rounded-lg h-96 flex items-center justify-center">
            <div className="text-center text-tungsten/50">
              <Wifi className="mx-auto mb-2" size={48} />
              <div>Mesh Topology Visualization</div>
              <div className="text-sm mt-1">
                {nodeArray.length > 0 
                  ? `${nodeArray.length} nodes in mesh network` 
                  : 'Add nodes to visualize mesh topology'}
              </div>
            </div>
          </div>
        </GlassPanel>

        {/* RF Channels */}
        <GlassPanel variant="light" className="p-6">
          <div className="flex items-center gap-3 mb-4">
            <Activity className="text-overmatch" size={24} />
            <h2 className="font-display text-xl font-semibold text-tungsten">
              RF Channel Status
            </h2>
          </div>
          <div className="grid grid-cols-3 gap-4">
            {['2.4 GHz', '5.8 GHz', '900 MHz'].map((freq, i) => (
              <div key={freq} className="p-4 bg-carbon/30 border border-tungsten/10 rounded-lg">
                <div className="text-tungsten/70 text-sm mb-2">{freq}</div>
                <div className="flex items-center justify-between">
                  <div className="font-display text-xl font-bold text-verified-green">
                    Active
                  </div>
                  <div className="text-xs text-tungsten/50">
                    {i === 0 ? '11' : i === 1 ? '45' : '3'} channels
                  </div>
                </div>
                <div className="mt-2 h-1 bg-carbon rounded-full overflow-hidden">
                  <div 
                    className="h-full bg-verified-green" 
                    style={{ width: `${60 + i * 10}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        </GlassPanel>
      </div>
    </div>
  );
};
