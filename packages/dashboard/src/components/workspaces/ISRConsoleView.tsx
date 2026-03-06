/**
 * ISRConsoleView
 * Intelligence, Surveillance, Reconnaissance workspace
 * Integrated with Teledyne FLIR Trust Bridge
 */

import React, { useMemo, useState, useEffect } from 'react';
import { GlassPanel } from '../hud/GlassPanel';
import { Eye, Camera, Satellite, AlertTriangle, Lock, Zap } from 'lucide-react';
import { useTacticalStore } from '../../store/useTacticalStore';
import { AgnosticVideoPlayer } from '../media/AgnosticVideoPlayer';
import { getRuntimeConfig } from '../../config/runtime';
import { useCommStore } from '../../store/useCommStore';

type ServiceHealth = 'up' | 'degraded' | 'down' | 'unknown';

function healthPillClasses(status: ServiceHealth): { container: string; dot: string; text: string } {
  switch (status) {
    case 'up':
      return {
        container: 'bg-emerald-900/20 border-emerald-400/30',
        dot: 'bg-emerald-400 animate-pulse',
        text: 'text-emerald-400',
      };
    case 'degraded':
      return {
        container: 'bg-yellow-900/10 border-yellow-400/30',
        dot: 'bg-yellow-400 animate-pulse',
        text: 'text-yellow-400',
      };
    case 'down':
      return {
        container: 'bg-jamming/10 border-jamming/30',
        dot: 'bg-jamming animate-pulse',
        text: 'text-jamming',
      };
    case 'unknown':
    default:
      return {
        container: 'bg-tungsten/5 border-tungsten/20',
        dot: 'bg-tungsten/40',
        text: 'text-tungsten/50',
      };
  }
}

export const ISRConsoleView: React.FC = () => {
  const selectedNodeId = useTacticalStore((s) => s.selectedNodeId);
  const nodes = useTacticalStore((s) => s.nodes);
  const connectionStatus = useCommStore((s) => s.connectionStatus);

  const [gatewayHealth, setGatewayHealth] = useState<ServiceHealth>('unknown');
  const [gatewayHealthDetail, setGatewayHealthDetail] = useState<string | null>(null);

  const selectedNode = useMemo(() => {
    return selectedNodeId ? nodes.get(selectedNodeId) : null;
  }, [selectedNodeId, nodes]);

  useEffect(() => {
    const { apiUrl } = getRuntimeConfig();
    let mounted = true;

    const check = async () => {
      try {
        const response = await fetch(`${apiUrl}/health`, { method: 'GET' });
        if (!mounted) return;
        if (response.ok) {
          setGatewayHealth('up');
          setGatewayHealthDetail(null);
        } else {
          setGatewayHealth('degraded');
          setGatewayHealthDetail(`HTTP ${response.status}`);
        }
      } catch (error) {
        if (!mounted) return;
        setGatewayHealth('down');
        setGatewayHealthDetail(error instanceof Error ? error.message : String(error));
      }
    };

    void check();
    const interval = setInterval(() => void check(), 15000);

    return () => {
      mounted = false;
      clearInterval(interval);
    };
  }, []);

  // Count active video feeds
  const activeFeeds = useMemo(() => {
    let count = 0;
    nodes.forEach((node) => {
      if (node.videoStream?.status === 'live') {
        count++;
      }
    });
    return count;
  }, [nodes]);

  const trustPct = (() => {
    if (!selectedNode) return null;
    const raw = selectedNode.trustScore;
    if (typeof raw !== 'number' || !Number.isFinite(raw)) return null;
    const pct = raw <= 1 ? raw * 100 : raw;
    return Math.max(0, Math.min(100, pct));
  })();

  const integrityHealth: ServiceHealth = (() => {
    if (!selectedNode) return 'unknown';
    if (selectedNode.integrityCompromised === true) return 'down';
    if (selectedNode.integrityCompromised === false) return 'up';
    return 'unknown';
  })();

  const c2Health: ServiceHealth = (() => {
    switch (connectionStatus) {
      case 'connected':
        return 'up';
      case 'connecting':
      case 'unverified':
        return 'degraded';
      case 'severed':
      case 'disconnected':
      default:
        return 'down';
    }
  })();

  const videoBitrate =
    selectedNode?.videoStream?.bitrate ||
    (typeof selectedNode?.videoStream?.metadata?.bitrate === 'number'
      ? `${(selectedNode.videoStream.metadata.bitrate / 1_000_000).toFixed(2)} Mbps`
      : null) ||
    'Unavailable';

  return (
    <div className="h-full overflow-hidden">
      <div className="max-w-full h-full flex flex-col gap-4 p-4">
        <h1 className="font-display text-3xl font-bold text-tungsten">
          ISR Console - Teledyne FLIR Integration
        </h1>

        {/* Main Grid: Video Feed + Status Panels */}
        <div className="flex-1 grid grid-cols-3 gap-4 min-h-0">
          {/* Left: Video Feed (2 columns) */}
          <div className="col-span-2 flex flex-col gap-4">
            {selectedNode?.videoStream ? (
              <div className="flex-1 rounded-lg overflow-hidden border border-tungsten/20 shadow-lg">
                <AgnosticVideoPlayer
                  stream={selectedNode.videoStream}
                  title={selectedNode.id}
                  showOverlay={true}
                />
              </div>
            ) : (
              <GlassPanel variant="light" className="flex-1 p-6 flex items-center justify-center">
                <div className="text-center text-tungsten/50">
                  <AlertTriangle className="mx-auto mb-2" size={48} />
                  <div>No ISR Feeds Available</div>
                  <div className="text-sm mt-1">Select a FLIR sensor to view live feed</div>
                </div>
              </GlassPanel>
            )}

            {/* Bottom: Live Telemetry Info */}
            <GlassPanel variant="light" className="p-4">
              <div className="grid grid-cols-5 gap-4">
                <div className="flex flex-col justify-between py-2 border-b border-tungsten/10">
                  <span className="text-tungsten/70 text-xs">Frames</span>
                  <span className="font-mono text-tungsten/70 text-xs">Unavailable</span>
                </div>
                <div className="flex flex-col justify-between py-2 border-b border-tungsten/10">
                  <span className="text-tungsten/70 text-xs">Uptime</span>
                  <span className="font-mono text-tungsten/70 text-xs">Unavailable</span>
                </div>
                <div className="flex flex-col justify-between py-2 border-b border-tungsten/10">
                  <span className="text-tungsten/70 text-xs">Bitrate</span>
                  <span className="font-mono text-tungsten/70 text-xs">{videoBitrate}</span>
                </div>
                <div className="flex flex-col justify-between py-2 border-b border-tungsten/10">
                  <span className="text-tungsten/70 text-xs">Latency</span>
                  <span className="font-mono text-tungsten/70 text-xs">Unavailable</span>
                </div>
                <div className="flex flex-col justify-between py-2">
                  <span className="text-tungsten/70 text-xs">Integrity</span>
                  {(() => {
                    const classes = healthPillClasses(integrityHealth);
                    const label =
                      integrityHealth === 'up'
                        ? 'VERIFIED'
                        : integrityHealth === 'down'
                        ? 'COMPROMISED'
                        : 'UNAVAILABLE';
                    return (
                      <span className={`${classes.text} font-semibold flex items-center gap-1 text-xs`}>
                        <Lock size={12} /> {label}
                      </span>
                    );
                  })()}
                </div>
              </div>
            </GlassPanel>
          </div>

          {/* Right: Status Panels */}
          <div className="col-span-1 flex flex-col gap-4 overflow-y-auto">
            {/* Camera Selection Panel */}
            <GlassPanel variant="light" className="p-4">
              <div className="flex items-center gap-2 mb-3">
                <Camera className="text-overmatch" size={18} />
                <h3 className="font-display text-lg font-semibold text-tungsten">
                  Cameras
                </h3>
              </div>
              <div className="space-y-2 max-h-48 overflow-y-auto">
                {Array.from(nodes.values())
                  .filter((n) => n.videoStream)
                  .map((node) => (
                    <button
                      key={node.id}
                      onClick={() => useTacticalStore.getState().selectNode(node.id)}
                      className={`w-full text-left px-3 py-2 rounded text-sm transition ${
                        selectedNodeId === node.id
                          ? 'bg-overmatch/30 border border-overmatch text-overmatch'
                          : 'bg-tungsten/5 border border-tungsten/10 text-tungsten/70 hover:border-tungsten/30'
                      }`}
                    >
                      <div className="font-mono text-xs">{node.id}</div>
                      <div className="text-xs mt-1">{node.firmwareVersion}</div>
                      <div className="flex items-center gap-1 mt-1">
                        <div
                          className={`w-2 h-2 rounded-full ${
                            node.videoStream?.status === 'live' ? 'bg-emerald-400' : 'bg-gray-500'
                          }`}
                        />
                        <span className="text-xs">
                          {node.videoStream?.status === 'live' ? 'LIVE' : 'OFFLINE'}
                        </span>
                      </div>
                    </button>
                  ))}
              </div>
            </GlassPanel>

            {/* Network Connections Panel */}
            <GlassPanel variant="light" className="p-4">
              <div className="flex items-center gap-2 mb-3">
                <Zap className="text-emerald-400 animate-pulse" size={18} />
                <h3 className="font-display text-sm font-semibold text-tungsten">
                  Connections
                </h3>
              </div>
              <div className="space-y-2 text-xs">
                {(() => {
                  const gatewayClasses = healthPillClasses(gatewayHealth);
                  const c2Classes = healthPillClasses(c2Health);
                  const unknownClasses = healthPillClasses('unknown');

                  return (
                    <>
                      <div className={`flex items-center justify-between py-1 px-2 border rounded ${gatewayClasses.container}`}>
                        <span className="text-tungsten/70">Gateway</span>
                        <span className="flex items-center gap-1">
                          <div className={`w-2 h-2 rounded-full ${gatewayClasses.dot}`} />
                          <span className={gatewayClasses.text}>
                            {gatewayHealthDetail ? `health (${gatewayHealthDetail})` : 'health'}
                          </span>
                        </span>
                      </div>

                      <div className={`flex items-center justify-between py-1 px-2 border rounded ${c2Classes.container}`}>
                        <span className="text-tungsten/70">C2 Router</span>
                        <span className="flex items-center gap-1">
                          <div className={`w-2 h-2 rounded-full ${c2Classes.dot}`} />
                          <span className={c2Classes.text}>{connectionStatus}</span>
                        </span>
                      </div>

                      <div className={`flex items-center justify-between py-1 px-2 border rounded ${unknownClasses.container}`}>
                        <span className="text-tungsten/70">Collab</span>
                        <span className="flex items-center gap-1">
                          <div className={`w-2 h-2 rounded-full ${unknownClasses.dot}`} />
                          <span className={unknownClasses.text}>unknown</span>
                        </span>
                      </div>

                      <div className={`flex items-center justify-between py-1 px-2 border rounded ${unknownClasses.container}`}>
                        <span className="text-tungsten/70">Database</span>
                        <span className="flex items-center gap-1">
                          <div className={`w-2 h-2 rounded-full ${unknownClasses.dot}`} />
                          <span className={unknownClasses.text}>unknown</span>
                        </span>
                      </div>

                      <div className={`flex items-center justify-between py-1 px-2 border rounded ${unknownClasses.container}`}>
                        <span className="text-tungsten/70">Cache</span>
                        <span className="flex items-center gap-1">
                          <div className={`w-2 h-2 rounded-full ${unknownClasses.dot}`} />
                          <span className={unknownClasses.text}>unknown</span>
                        </span>
                      </div>
                    </>
                  );
                })()}
              </div>
            </GlassPanel>

            {/* Visual Intelligence Stats */}
            <GlassPanel variant="light" className="p-4">
              <div className="flex items-center gap-2 mb-3">
                <Eye className="text-overmatch" size={18} />
                <h3 className="font-display text-lg font-semibold text-tungsten">
                  Intelligence
                </h3>
              </div>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between py-2 border-b border-tungsten/10">
                  <span className="text-tungsten/70">Recording</span>
                  <span className="text-tungsten font-mono">Inactive</span>
                </div>
                <div className="flex justify-between py-2">
                  <span className="text-tungsten/70">Storage Used</span>
                  <span className="text-tungsten font-mono">0 GB</span>
                </div>
              </div>
            </GlassPanel>

            {/* Signal Intelligence */}
            <GlassPanel variant="light" className="p-4">
              <div className="flex items-center gap-2 mb-3">
                <Satellite className="text-overmatch" size={18} />
                <h3 className="font-display text-lg font-semibold text-tungsten">
                  SIGINT
                </h3>
              </div>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between py-2 border-b border-tungsten/10">
                  <span className="text-tungsten/70">Signals</span>
                  <span className="text-tungsten font-mono">0</span>
                </div>
                <div className="flex justify-between py-2">
                  <span className="text-tungsten/70">Coverage</span>
                  <span className="text-tungsten/50 text-xs">N/A</span>
                </div>
              </div>
            </GlassPanel>

            {/* Selected Camera Details */}
            {selectedNode && (
              <GlassPanel variant="light" className="p-4">
                <div className="flex items-center gap-2 mb-3">
                  <Lock className="text-emerald-400" size={18} />
                  <h3 className="font-display text-sm font-semibold text-tungsten">
                    Verification
                  </h3>
                </div>
                <div className="space-y-2 text-xs">
                  <div className="flex justify-between py-2 border-b border-tungsten/10">
                    <span className="text-tungsten/70">Trust Score</span>
                    <span className="text-emerald-400 font-mono font-bold">{trustPct !== null ? `${trustPct.toFixed(1)}%` : 'Unavailable'}</span>
                  </div>
                  <div className="flex justify-between py-2 border-b border-tungsten/10">
                    <span className="text-tungsten/70">Ed25519</span>
                    <span className={`${selectedNode.verified ? 'text-emerald-400' : 'text-yellow-400'} font-semibold`}>
                      {selectedNode.verified ? '✓ VERIFIED' : 'UNVERIFIED'}
                    </span>
                  </div>
                  <div className="flex justify-between py-2">
                    <span className="text-tungsten/70">Merkle</span>
                    <span className={`${selectedNode.integrityCompromised ? 'text-jamming' : 'text-emerald-400'} font-semibold`}>
                      {selectedNode.integrityCompromised === true
                        ? 'BROKEN'
                        : selectedNode.integrityCompromised === false
                        ? '✓ VERIFIED'
                        : 'UNAVAILABLE'}
                    </span>
                  </div>
                  <div className="mt-3 pt-2 border-t border-tungsten/10">
                    <div className="text-tungsten/50 text-xs mb-1">Attestation Hash</div>
                    <div className="font-mono text-[10px] text-tungsten/60 break-all">
                      blake3:{selectedNode.attestationHash?.slice(0, 20) || 'loading...'}...
                    </div>
                  </div>
                </div>
              </GlassPanel>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

