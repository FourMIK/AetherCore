/**
 * MeshNetworkView
 * Network topology and RF management workspace
 */

import React, { useEffect } from 'react';
import { GlassPanel } from '../hud/GlassPanel';
import { Radio, Wifi, Activity, TrendingUp, Signal } from 'lucide-react';
import { useTacticalStore } from '../../store/useTacticalStore';
import { useMeshStore } from '../../store/useMeshStore';
import { useCommStore } from '../../store/useCommStore';

export const MeshNetworkView: React.FC = () => {
  const nodes = useTacticalStore((s) => s.nodes) || new Map();
  const nodeArray = Array.from(nodes.values());

  const meshStats = useMeshStore((s) => s.meshStats);
  const linkMetrics = useMeshStore((s) => s.linkMetrics);
  const updateLinkMetrics = useMeshStore((s) => s.updateLinkMetrics);
  const removePeer = useMeshStore((s) => s.removePeer);
  const linkMetricsArray = Array.from(linkMetrics.values());

  const c2State = useCommStore((state) => state.c2State);
  const getC2Status = useCommStore((state) => state.getC2Status);

  useEffect(() => {
    const syncC2LinkMetrics = () => {
      const status = getC2Status();
      if (!status) {
        return;
      }

      if (status.state === 'IDLE' || status.state === 'DISCONNECTED') {
        removePeer('c2-gateway');
        return;
      }

      const trustScore =
        status.state === 'CONNECTED' ? 1 : status.state === 'DEGRADED' ? 0.6 : 0.4;
      const packetLossPercent = Math.min(status.missedHeartbeats / 3, 1);

      updateLinkMetrics('c2-gateway', {
        peerName: 'C2 Gateway',
        rttMs: status.rttMs ?? 0,
        packetLossPercent,
        trustScore,
        lastMeasured: new Date(),
      });
    };

    syncC2LinkMetrics();
    const interval = window.setInterval(syncC2LinkMetrics, 1000);
    return () => window.clearInterval(interval);
  }, [c2State, getC2Status, removePeer, updateLinkMetrics]);

  const formatBandwidth = (mbps: number): string => {
    if (mbps >= 1000) {
      return `${(mbps / 1000).toFixed(2)} Gb/s`;
    }
    return `${mbps.toFixed(1)} Mb/s`;
  };

  const formatLatency = (ms: number): string => {
    if (ms < 1) {
      return '<1ms';
    }
    return `${Math.round(ms)}ms`;
  };

  const getQualityColor = (quality: string): string => {
    switch (quality) {
      case 'excellent':
        return 'text-verified-green';
      case 'good':
        return 'text-verified-green';
      case 'fair':
        return 'text-overmatch';
      case 'poor':
        return 'text-red-500';
      case 'critical':
        return 'text-red-700';
      default:
        return 'text-tungsten';
    }
  };

  return (
    <div className="h-full overflow-y-auto overflow-x-hidden">
      <div className="max-w-7xl mx-auto p-4 space-y-4 pb-8">
        <h1 className="font-display text-3xl font-bold text-tungsten mb-2">
          Mesh Network
        </h1>

        <div className="grid grid-cols-4 gap-4">
          <GlassPanel variant="light" className="p-4">
            <div className="flex items-start justify-between">
              <div>
                <div className="text-tungsten/70 text-sm">Mesh Nodes</div>
                <div className="font-display text-3xl font-bold text-tungsten mt-1">
                  {nodeArray.length}
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
                  {meshStats.connectedPeers}
                </div>
                <div className="text-xs text-tungsten/50 mt-1">
                  of {meshStats.totalPeers} peers
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
                  {formatBandwidth(meshStats.totalBandwidthMbps)}
                </div>
                <div className="text-xs text-tungsten/50 mt-1">
                  Estimated from live link quality
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
                  {formatLatency(meshStats.averageRttMs)}
                </div>
                <div className="text-xs text-tungsten/50 mt-1">
                  {(meshStats.averagePacketLoss * 100).toFixed(1)}% loss
                </div>
              </div>
              <Activity className="text-verified-green" size={24} />
            </div>
          </GlassPanel>
        </div>

        {linkMetricsArray.length > 0 && (
          <GlassPanel variant="light" className="p-6">
            <div className="flex items-center gap-3 mb-4">
              <Signal className="text-overmatch" size={24} />
              <h2 className="font-display text-xl font-semibold text-tungsten">
                Link Quality Metrics
              </h2>
            </div>
            <div className="space-y-3">
              {linkMetricsArray.map((link) => (
                <div
                  key={link.peerId}
                  className="p-4 bg-carbon/30 border border-tungsten/10 rounded-lg"
                >
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <div className="font-mono text-sm text-tungsten">
                        {link.peerName || link.peerId}
                      </div>
                      <div className={`text-xs font-semibold uppercase ${getQualityColor(link.linkQuality)}`}>
                        {link.linkQuality}
                      </div>
                    </div>
                    <div className="text-sm text-tungsten/70">
                      Score: {(link.linkScore * 100).toFixed(0)}%
                    </div>
                  </div>
                  <div className="grid grid-cols-4 gap-3 text-xs">
                    <div>
                      <div className="text-tungsten/50">RTT</div>
                      <div className="text-tungsten font-mono">{link.rttMs}ms</div>
                    </div>
                    <div>
                      <div className="text-tungsten/50">Loss</div>
                      <div className="text-tungsten font-mono">
                        {(link.packetLossPercent * 100).toFixed(1)}%
                      </div>
                    </div>
                    <div>
                      <div className="text-tungsten/50">Trust</div>
                      <div className="text-tungsten font-mono">
                        {(link.trustScore * 100).toFixed(0)}%
                      </div>
                    </div>
                    {link.snrDb !== undefined && (
                      <div>
                        <div className="text-tungsten/50">SNR</div>
                        <div className="text-tungsten font-mono">{link.snrDb.toFixed(1)} dB</div>
                      </div>
                    )}
                  </div>
                  <div className="mt-2 h-2 bg-carbon rounded-full overflow-hidden">
                    <div
                      className={`h-full transition-all duration-500 ${
                        link.linkQuality === 'excellent'
                          ? 'bg-verified-green'
                          : link.linkQuality === 'good'
                          ? 'bg-verified-green'
                          : link.linkQuality === 'fair'
                          ? 'bg-overmatch'
                          : link.linkQuality === 'poor'
                          ? 'bg-red-500'
                          : 'bg-red-700'
                      }`}
                      style={{ width: `${link.linkScore * 100}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </GlassPanel>
        )}

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
                  ? `${nodeArray.length} nodes, ${meshStats.connectedPeers} active links`
                  : 'Waiting for node telemetry...'}
              </div>
            </div>
          </div>
        </GlassPanel>
      </div>
    </div>
  );
};
