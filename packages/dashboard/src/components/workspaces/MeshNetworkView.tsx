/**
 * MeshNetworkView
 * Network topology and RF management workspace
 */

import React, { useEffect, useMemo } from 'react';
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
  const c2Reachable = c2State === 'CONNECTED' || c2State === 'DEGRADED';

  const topologyLayout = useMemo(() => {
    const viewBoxWidth = 960;
    const viewBoxHeight = 360;
    const gateway = {
      x: viewBoxWidth / 2,
      y: 72,
      label: 'C2 Gateway',
    };

    if (nodeArray.length === 0) {
      return {
        viewBoxWidth,
        viewBoxHeight,
        gateway,
        nodes: [] as Array<{
          id: string;
          x: number;
          y: number;
          label: string;
          domain: string;
          trustScore: number;
          verified: boolean;
          status: 'online' | 'offline' | 'degraded' | 'compromised' | 'revoked';
          phase: number;
        }>,
      };
    }

    const ringCenterX = viewBoxWidth / 2;
    const ringCenterY = 168;
    const radiusX = 300;
    const radiusY = 120;
    const startAngle = Math.PI * 0.15;
    const endAngle = Math.PI * 0.85;

    const nodes = nodeArray.map((node, index) => {
      const angle =
        nodeArray.length === 1
          ? Math.PI / 2
          : startAngle + ((endAngle - startAngle) * index) / (nodeArray.length - 1);
      const x = ringCenterX + Math.cos(angle) * radiusX;
      const y = ringCenterY + Math.sin(angle) * radiusY;
      const label =
        node.id.length > 20 ? `${node.id.slice(0, 12)}...${node.id.slice(-4)}` : node.id;

      return {
        id: node.id,
        x,
        y,
        label,
        domain: node.domain,
        trustScore: node.trustScore,
        verified: node.verified,
        status: node.status,
        phase: (index % 6) * 0.28,
      };
    });

    return { viewBoxWidth, viewBoxHeight, gateway, nodes };
  }, [nodeArray]);

  const activeLinks = useMemo(() => {
    const onlineNodeCount = nodeArray.filter((node) => node.status !== 'offline').length;
    if (onlineNodeCount === 0) {
      return 0;
    }
    if (c2Reachable) {
      return onlineNodeCount;
    }
    return Math.min(onlineNodeCount, meshStats.connectedPeers);
  }, [c2Reachable, meshStats.connectedPeers, nodeArray]);

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

  const getNodeStrokeColor = (
    status: 'online' | 'offline' | 'degraded' | 'compromised' | 'revoked',
    trustScore: number,
    verified: boolean
  ): string => {
    // Fail-Visible: Compromised and revoked nodes get explicit red/gray colors
    if (status === 'revoked') return '#808080'; // Ghost gray
    if (status === 'compromised') return '#dc2626'; // Red for Byzantine
    if (status === 'offline') return '#6b7280';
    if (status === 'degraded') return '#f59e0b';
    if (!verified) return '#f59e0b';
    if (trustScore >= 80) return '#22c55e';
    if (trustScore >= 50) return '#eab308';
    return '#f97316';
  };

  const getLinkColor = (online: boolean): string => {
    if (!online) return '#6b7280';
    return c2Reachable ? '#22c55e' : '#f59e0b';
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
          <div className="bg-carbon/50 border border-tungsten/10 rounded-lg h-96 relative overflow-hidden">
            <svg
              viewBox={`0 0 ${topologyLayout.viewBoxWidth} ${topologyLayout.viewBoxHeight}`}
              className="absolute inset-0 h-full w-full"
              role="img"
              aria-label="Live mesh topology graph"
            >
              <defs>
                <linearGradient id="meshBgGlow" x1="0%" y1="0%" x2="100%" y2="100%">
                  <stop offset="0%" stopColor="#00d4ff" stopOpacity="0.04" />
                  <stop offset="100%" stopColor="#22c55e" stopOpacity="0.04" />
                </linearGradient>
                <linearGradient id="meshLinkGradient" x1="0%" y1="0%" x2="100%" y2="0%">
                  <stop offset="0%" stopColor="#00d4ff" stopOpacity="0.9" />
                  <stop offset="100%" stopColor="#22c55e" stopOpacity="0.9" />
                </linearGradient>
              </defs>

              <rect
                x="0"
                y="0"
                width={topologyLayout.viewBoxWidth}
                height={topologyLayout.viewBoxHeight}
                fill="url(#meshBgGlow)"
              />

              {topologyLayout.nodes.map((node) => {
                const online = node.status !== 'offline';
                const linkColor = getLinkColor(online);
                return (
                  <line
                    key={`link-${node.id}`}
                    x1={topologyLayout.gateway.x}
                    y1={topologyLayout.gateway.y}
                    x2={node.x}
                    y2={node.y}
                    stroke={online && c2Reachable ? 'url(#meshLinkGradient)' : linkColor}
                    strokeWidth={online ? 2.5 : 1.5}
                    strokeOpacity={online ? 0.9 : 0.45}
                    strokeDasharray={online ? '0' : '6 6'}
                  >
                    {online && (
                      <animate
                        attributeName="stroke-opacity"
                        values="0.35;1;0.35"
                        dur={`${1.7 + node.phase}s`}
                        begin={`${node.phase}s`}
                        repeatCount="indefinite"
                      />
                    )}
                  </line>
                );
              })}

              {topologyLayout.nodes.map((node) => {
                const online = node.status !== 'offline';
                if (!online) {
                  return null;
                }
                return (
                  <g key={`packet-${node.id}`}>
                    <circle r="4" fill="#00d4ff" fillOpacity="0.95">
                      <animate
                        attributeName="cx"
                        values={`${topologyLayout.gateway.x};${node.x}`}
                        dur={`${2.4 + node.phase}s`}
                        begin={`${node.phase}s`}
                        repeatCount="indefinite"
                      />
                      <animate
                        attributeName="cy"
                        values={`${topologyLayout.gateway.y};${node.y}`}
                        dur={`${2.4 + node.phase}s`}
                        begin={`${node.phase}s`}
                        repeatCount="indefinite"
                      />
                      <animate
                        attributeName="opacity"
                        values="0;1;0"
                        dur={`${2.4 + node.phase}s`}
                        begin={`${node.phase}s`}
                        repeatCount="indefinite"
                      />
                    </circle>
                    <circle r="2.5" fill="#22c55e" fillOpacity="0.9">
                      <animate
                        attributeName="cx"
                        values={`${topologyLayout.gateway.x};${node.x}`}
                        dur={`${2.8 + node.phase}s`}
                        begin={`${0.6 + node.phase}s`}
                        repeatCount="indefinite"
                      />
                      <animate
                        attributeName="cy"
                        values={`${topologyLayout.gateway.y};${node.y}`}
                        dur={`${2.8 + node.phase}s`}
                        begin={`${0.6 + node.phase}s`}
                        repeatCount="indefinite"
                      />
                      <animate
                        attributeName="opacity"
                        values="0;0.9;0"
                        dur={`${2.8 + node.phase}s`}
                        begin={`${0.6 + node.phase}s`}
                        repeatCount="indefinite"
                      />
                    </circle>
                  </g>
                );
              })}

              <circle
                cx={topologyLayout.gateway.x}
                cy={topologyLayout.gateway.y}
                r="26"
                fill="#00d4ff"
                fillOpacity="0.22"
                stroke={c2Reachable ? '#00d4ff' : '#f59e0b'}
                strokeWidth="2.5"
              />
              <circle
                cx={topologyLayout.gateway.x}
                cy={topologyLayout.gateway.y}
                r="30"
                fill="none"
                stroke={c2Reachable ? '#00d4ff' : '#f59e0b'}
                strokeWidth="1.5"
                opacity="0.45"
              >
                <animate attributeName="r" values="28;36;28" dur="2.8s" repeatCount="indefinite" />
                <animate attributeName="opacity" values="0.65;0.15;0.65" dur="2.8s" repeatCount="indefinite" />
              </circle>
              <text
                x={topologyLayout.gateway.x}
                y={topologyLayout.gateway.y + 4}
                textAnchor="middle"
                className="fill-tungsten text-[12px] font-semibold"
              >
                C2
              </text>
              <text
                x={topologyLayout.gateway.x}
                y={topologyLayout.gateway.y + 40}
                textAnchor="middle"
                className="fill-tungsten/80 text-[11px]"
              >
                Gateway
              </text>

              {topologyLayout.nodes.map((node) => {
                const strokeColor = getNodeStrokeColor(node.status, node.trustScore, node.verified);
                const fillOpacity = node.status === 'offline' ? 0.16 : 0.24;
                return (
                  <g key={node.id}>
                    <circle
                      cx={node.x}
                      cy={node.y}
                      r="20"
                      fill={strokeColor}
                      fillOpacity={fillOpacity}
                      stroke={strokeColor}
                      strokeWidth="2"
                    >
                      {node.status !== 'offline' && (
                        <animate
                          attributeName="fill-opacity"
                          values={`${fillOpacity};${Math.min(fillOpacity + 0.18, 0.6)};${fillOpacity}`}
                          dur={`${2.1 + node.phase}s`}
                          begin={`${node.phase}s`}
                          repeatCount="indefinite"
                        />
                      )}
                    </circle>
                    {node.status !== 'offline' && (
                      <circle
                        cx={node.x}
                        cy={node.y}
                        r="22"
                        fill="none"
                        stroke={strokeColor}
                        strokeWidth="1.2"
                        opacity="0.45"
                      >
                        <animate
                          attributeName="r"
                          values="21;29;21"
                          dur={`${2.6 + node.phase}s`}
                          begin={`${node.phase}s`}
                          repeatCount="indefinite"
                        />
                        <animate
                          attributeName="opacity"
                          values="0.65;0.12;0.65"
                          dur={`${2.6 + node.phase}s`}
                          begin={`${node.phase}s`}
                          repeatCount="indefinite"
                        />
                      </circle>
                    )}
                    <text
                      x={node.x}
                      y={node.y + 4}
                      textAnchor="middle"
                      className="fill-tungsten text-[11px] font-semibold"
                    >
                      {node.verified ? 'TPM' : 'NODE'}
                    </text>
                    <text
                      x={node.x}
                      y={node.y + 34}
                      textAnchor="middle"
                      className="fill-tungsten/80 text-[10px]"
                    >
                      {node.label}
                    </text>
                    <text
                      x={node.x}
                      y={node.y + 48}
                      textAnchor="middle"
                      className="fill-tungsten/60 text-[9px]"
                    >
                      {node.domain}
                    </text>
                    <title>{`${node.id} (${node.status})`}</title>
                  </g>
                );
              })}
            </svg>

            <div className="absolute right-4 top-4 rounded-md border border-tungsten/15 bg-carbon/70 px-3 py-2 text-xs text-tungsten/80">
              <div className="font-medium text-tungsten">Mesh Topology Visualization</div>
              <div className="mt-1">
                {nodeArray.length > 0
                  ? `${nodeArray.length} nodes, ${activeLinks} active links`
                  : 'Waiting for node telemetry...'}
              </div>
            </div>

            {nodeArray.length === 0 && (
              <div className="absolute inset-0 flex items-center justify-center">
                <div className="text-center text-tungsten/50">
                  <Wifi className="mx-auto mb-2" size={42} />
                  <div className="text-sm">Mesh Topology Visualization</div>
                  <div className="text-xs mt-1">Waiting for node telemetry...</div>
                </div>
              </div>
            )}
          </div>
          <div className="mt-3 text-xs text-tungsten/55">
            Links are drawn between the C2 gateway and active edge nodes. Color encodes trust and
            current reachability.
          </div>
        </GlassPanel>
      </div>
    </div>
  );
};
