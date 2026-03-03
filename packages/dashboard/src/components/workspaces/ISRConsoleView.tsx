/**
 * ISRConsoleView
 * Intelligence, Surveillance, Reconnaissance workspace
 * Integrated with TeleDyne/FLIR thermal camera feeds
 */

import React, { useEffect, useState } from 'react';
import { GlassPanel } from '../hud/GlassPanel';
import { Eye, Camera, Satellite, AlertTriangle, Radio, Zap } from 'lucide-react';
import { fetchTelemetry, subscribeToTelemetry } from '../../services/telemetryService';
import type { TelemetryData } from '../../services/telemetryService';

interface ISRNode {
  id: string;
  name: string;
  camera_active: boolean;
  frame_count: number;
  last_frame_ts?: number;
  resolution?: string;
  trust_score: number;
  hardware_backed: boolean;
}

export const ISRConsoleView: React.FC = () => {
  const [isrNodes, setIsrNodes] = useState<ISRNode[]>([]);
  const [activeFeeds, setActiveFeeds] = useState(0);
  const [selectedNode, setSelectedNode] = useState<ISRNode | null>(null);
  const [loading, setLoading] = useState(true);

  // Load initial telemetry and subscribe to updates
  useEffect(() => {
    const initTelemetry = async () => {
      try {
        const nodes = await fetchTelemetry();
        const isrNodesList: ISRNode[] = [];

        nodes.forEach((node, nodeId) => {
          // Look for ISR-capable nodes (FLIR thermal cameras, etc.)
          if (node.id.includes('flir') || node.id.includes('thermal') || node.id.includes('isr')) {
            isrNodesList.push({
              id: node.id,
              name: node.id.includes('flir-alpha') ? 'FLIR Alpha' :
                    node.id.includes('thermal') ? 'Thermal Demo' :
                    node.id.includes('isr') ? 'ISR Sensor' : node.id,
              camera_active: Math.random() > 0.3, // Simulated for now
              frame_count: Math.floor(Math.random() * 10000),
              last_frame_ts: Date.now(),
              resolution: '640x512',
              trust_score: node.trustScore,
              hardware_backed: node.verified,
            });
          }
        });

        setIsrNodes(isrNodesList);
        setActiveFeeds(isrNodesList.filter(n => n.camera_active).length);
        if (isrNodesList.length > 0) {
          setSelectedNode(isrNodesList[0]);
        }
        setLoading(false);
      } catch (error) {
        console.error('[ISR] Failed to load telemetry:', error);
        setLoading(false);
      }
    };

    initTelemetry();

    // Subscribe to live telemetry updates
    const unsubscribe = subscribeToTelemetry((telemetry: TelemetryData) => {
      if (telemetry.isr && (telemetry.node_id.includes('flir') || telemetry.node_id.includes('thermal'))) {
        setIsrNodes((prev) => {
          const updated = [...prev];
          const existingIndex = updated.findIndex(n => n.id === telemetry.node_id);

          if (existingIndex >= 0) {
            updated[existingIndex] = {
              ...updated[existingIndex],
              camera_active: telemetry.isr?.camera_active ?? false,
              frame_count: telemetry.isr?.frame_count ?? 0,
              last_frame_ts: telemetry.isr?.last_frame_ts,
              resolution: telemetry.isr?.resolution,
              trust_score: telemetry.trust?.self_score || 0,
              hardware_backed: telemetry.security?.hardware_backed || false,
            };
          } else {
            updated.push({
              id: telemetry.node_id,
              name: telemetry.node_id.includes('flir-alpha') ? 'FLIR Alpha' : 'Thermal Sensor',
              camera_active: telemetry.isr?.camera_active ?? false,
              frame_count: telemetry.isr?.frame_count ?? 0,
              last_frame_ts: telemetry.isr?.last_frame_ts,
              resolution: telemetry.isr?.resolution,
              trust_score: telemetry.trust?.self_score || 0,
              hardware_backed: telemetry.security?.hardware_backed || false,
            });
          }

          // Update active feeds count
          setActiveFeeds(updated.filter(n => n.camera_active).length);
          return updated;
        });
      }
    });

    return () => unsubscribe();
  }, []);

  return (
    <div className="h-full overflow-y-auto overflow-x-hidden">
      <div className="max-w-7xl mx-auto p-4 space-y-4 pb-8">
        <h1 className="font-display text-3xl font-bold text-tungsten mb-2">
          ISR Console
        </h1>

        <div className="grid grid-cols-2 gap-4">
          <GlassPanel variant="light" className="p-6">
            <div className="flex items-center gap-3 mb-4">
              <Camera className="text-overmatch" size={24} />
              <h2 className="font-display text-xl font-semibold text-tungsten">
                Visual Intelligence (FLIR/Thermal)
              </h2>
            </div>
            <div className="space-y-3">
              <div className="flex justify-between py-2 border-b border-tungsten/10">
                <span className="text-tungsten/70">Active Feeds</span>
                <span className="font-mono text-overmatch font-semibold">{activeFeeds}</span>
              </div>
              <div className="flex justify-between py-2 border-b border-tungsten/10">
                <span className="text-tungsten/70">Total Nodes</span>
                <span className="font-mono text-tungsten font-semibold">{isrNodes.length}</span>
              </div>
              <div className="flex justify-between py-2">
                <span className="text-tungsten/70">Recording</span>
                <span className="font-mono text-tungsten/50">{activeFeeds > 0 ? 'Active' : 'Inactive'}</span>
              </div>
            </div>
          </GlassPanel>

          <GlassPanel variant="light" className="p-6">
            <div className="flex items-center gap-3 mb-4">
              <Satellite className="text-overmatch" size={24} />
              <h2 className="font-display text-xl font-semibold text-tungsten">
                Signal Intelligence
              </h2>
            </div>
            <div className="space-y-3">
              <div className="flex justify-between py-2 border-b border-tungsten/10">
                <span className="text-tungsten/70">RF Channels</span>
                <span className="font-mono text-tungsten font-semibold">{isrNodes.length}</span>
              </div>
              <div className="flex justify-between py-2 border-b border-tungsten/10">
                <span className="text-tungsten/70">Status</span>
                <span className={`font-mono font-semibold ${isrNodes.length > 0 ? 'text-lime-400' : 'text-tungsten/50'}`}>
                  {isrNodes.length > 0 ? 'Connected' : 'Waiting'}
                </span>
              </div>
              <div className="flex justify-between py-2">
                <span className="text-tungsten/70">Classification</span>
                <span className="font-mono text-tungsten font-semibold">Thermal</span>
              </div>
            </div>
          </GlassPanel>
        </div>

        {isrNodes.length > 0 ? (
          <>
            <GlassPanel variant="light" className="p-6">
              <div className="flex items-center gap-3 mb-4">
                <Eye className="text-overmatch" size={24} />
                <h2 className="font-display text-xl font-semibold text-tungsten">
                  Available ISR Nodes
                </h2>
              </div>
              <div className="grid grid-cols-2 gap-3">
                {isrNodes.map((node) => (
                  <button
                    key={node.id}
                    onClick={() => setSelectedNode(node)}
                    className={`p-3 rounded-lg border transition-all ${
                      selectedNode?.id === node.id
                        ? 'border-overmatch bg-overmatch/10'
                        : 'border-tungsten/10 hover:border-tungsten/30'
                    }`}
                  >
                    <div className="flex items-center gap-2 mb-2">
                      {node.camera_active ? (
                        <Zap className="w-4 h-4 text-lime-400" />
                      ) : (
                        <Radio className="w-4 h-4 text-tungsten/50" />
                      )}
                      <span className="font-semibold text-tungsten">{node.name}</span>
                    </div>
                    <div className="text-xs text-tungsten/70 space-y-1">
                      <div>Frames: {node.frame_count}</div>
                      <div>Resolution: {node.resolution}</div>
                      <div>Trust: {Math.round(node.trust_score)}%</div>
                    </div>
                  </button>
                ))}
              </div>
            </GlassPanel>

            {selectedNode && (
              <GlassPanel variant="light" className="p-6">
                <div className="flex items-center gap-3 mb-4">
                  <Camera className="text-overmatch" size={24} />
                  <h2 className="font-display text-xl font-semibold text-tungsten">
                    {selectedNode.name} - Live Feed
                  </h2>
                </div>
                <div className="bg-carbon/50 border border-tungsten/10 rounded-lg aspect-video flex items-center justify-center mb-4">
                  <div className="text-center text-tungsten/50">
                    <Camera className="mx-auto mb-2" size={48} />
                    <div>Thermal Video Stream</div>
                    <div className="text-sm mt-1">
                      {selectedNode.camera_active
                        ? 'Camera Active - Streaming'
                        : 'Camera Standby'}
                    </div>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <span className="text-tungsten/70 text-sm">Frame Count</span>
                    <div className="font-mono text-overmatch font-semibold">
                      {selectedNode.frame_count}
                    </div>
                  </div>
                  <div>
                    <span className="text-tungsten/70 text-sm">Status</span>
                    <div className={`font-mono font-semibold ${selectedNode.camera_active ? 'text-lime-400' : 'text-tungsten/50'}`}>
                      {selectedNode.camera_active ? 'ACTIVE' : 'IDLE'}
                    </div>
                  </div>
                  <div>
                    <span className="text-tungsten/70 text-sm">Hardware Backed</span>
                    <div className="font-mono font-semibold">
                      {selectedNode.hardware_backed ? '✓' : '✗'}
                    </div>
                  </div>
                  <div>
                    <span className="text-tungsten/70 text-sm">Trust Score</span>
                    <div className="font-mono text-overmatch font-semibold">
                      {Math.round(selectedNode.trust_score)}%
                    </div>
                  </div>
                </div>
              </GlassPanel>
            )}
          </>
        ) : (
          <GlassPanel variant="light" className="p-6">
            <div className="flex items-center gap-3 mb-4">
              <Eye className="text-overmatch" size={24} />
              <h2 className="font-display text-xl font-semibold text-tungsten">
                Reconnaissance Feed
              </h2>
            </div>
            <div className="bg-carbon/50 border border-tungsten/10 rounded-lg h-64 flex items-center justify-center">
              <div className="text-center text-tungsten/50">
                {loading ? (
                  <>
                    <Zap className="mx-auto mb-2 animate-pulse" size={48} />
                    <div>Loading ISR nodes...</div>
                  </>
                ) : (
                  <>
                    <AlertTriangle className="mx-auto mb-2" size={48} />
                    <div>No ISR Materia Slots Configured</div>
                    <div className="text-sm mt-1">Deploy ISR-capable units (FLIR/Thermal) to enable reconnaissance</div>
                  </>
                )}
              </div>
            </div>
          </GlassPanel>
        )}
      </div>
    </div>
  );
};
