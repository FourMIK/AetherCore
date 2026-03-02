/**
 * ISRConsoleView
 * Intelligence, Surveillance, Reconnaissance workspace
 * Features dynamic video feed integration for ISR-capable nodes
 */

import React, { useMemo } from 'react';
import { GlassPanel } from '../hud/GlassPanel';
import { Eye, Camera, Satellite, AlertTriangle, Video } from 'lucide-react';
import { AgnosticVideoPlayer } from '../media/AgnosticVideoPlayer';
import { useTacticalStore } from '../../store/useTacticalStore';

export const ISRConsoleView: React.FC = () => {
  // Get selected node from store
  const selectedNodeId = useTacticalStore((state) => state.selectedNodeId);
  const nodes = useTacticalStore((state) => state.nodes);

  // Get the selected node and its video stream
  const selectedNode = useMemo(() => {
    if (!selectedNodeId) return null;
    return nodes.get(selectedNodeId);
  }, [selectedNodeId, nodes]);

  const videoStream = selectedNode?.videoStream;

  // Count active video feeds across all nodes
  const activeFeeds = useMemo(() => {
    let count = 0;
    nodes.forEach((node) => {
      if (node.videoStream && node.videoStream.status === 'live') {
        count++;
      }
    });
    return count;
  }, [nodes]);

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
                Visual Intelligence
              </h2>
            </div>
            <div className="space-y-3">
              <div className="flex justify-between py-2 border-b border-tungsten/10">
                <span className="text-tungsten/70">Active Feeds</span>
                <span className="font-mono text-tungsten font-semibold">
                  {activeFeeds}
                </span>
              </div>
              <div className="flex justify-between py-2 border-b border-tungsten/10">
                <span className="text-tungsten/70">Recording</span>
                <span className="font-mono text-tungsten/50">
                  {activeFeeds > 0 ? 'Active' : 'Inactive'}
                </span>
              </div>
              <div className="flex justify-between py-2">
                <span className="text-tungsten/70">Storage Used</span>
                <span className="font-mono text-tungsten font-semibold">0 GB</span>
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
                <span className="font-mono text-tungsten font-semibold">0</span>
              </div>
              <div className="flex justify-between py-2 border-b border-tungsten/10">
                <span className="text-tungsten/70">Intercepts</span>
                <span className="font-mono text-tungsten/50">None</span>
              </div>
              <div className="flex justify-between py-2">
                <span className="text-tungsten/70">Classification</span>
                <span className="font-mono text-tungsten font-semibold">N/A</span>
              </div>
            </div>
          </GlassPanel>
        </div>

        <GlassPanel variant="light" className="p-6">
          <div className="flex items-center gap-3 mb-4">
            <Eye className="text-overmatch" size={24} />
            <h2 className="font-display text-xl font-semibold text-tungsten">
              Reconnaissance Feed
            </h2>
            {selectedNode && (
              <span className="ml-auto text-sm text-tungsten/60 font-mono">
                Node: {selectedNode.id}
              </span>
            )}
          </div>

          {/* Video feed display */}
          {videoStream ? (
            <div className="bg-carbon/50 border border-tungsten/10 rounded-lg overflow-hidden" style={{ minHeight: '400px' }}>
              <AgnosticVideoPlayer
                stream={videoStream}
                onError={(error) => {
                  console.error('Video stream error:', error);
                }}
              />
            </div>
          ) : (
            <div className="bg-carbon/50 border border-tungsten/10 rounded-lg h-64 flex items-center justify-center">
              <div className="text-center text-tungsten/50">
                <AlertTriangle className="mx-auto mb-2" size={48} />
                <div>
                  {selectedNode
                    ? 'No video stream available for selected node'
                    : 'No ISR Materia Slots Configured'}
                </div>
                <div className="text-sm mt-1">
                  {selectedNode
                    ? 'This node does not have ISR capabilities'
                    : 'Deploy ISR-capable units to enable reconnaissance'}
                </div>
              </div>
            </div>
          )}

          {/* Additional video stream info */}
          {videoStream && (
            <div className="mt-4 p-4 bg-carbon/30 rounded-lg border border-tungsten/10">
              <div className="flex items-center gap-2 mb-3">
                <Video className="text-overmatch" size={16} />
                <span className="text-sm font-semibold text-tungsten">
                  Stream Information
                </span>
              </div>
              <div className="grid grid-cols-2 gap-3 text-xs">
                <div className="flex justify-between">
                  <span className="text-tungsten/60">Format:</span>
                  <span className="font-mono text-tungsten uppercase">
                    {videoStream.format}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-tungsten/60">Status:</span>
                  <span className="font-mono text-tungsten capitalize">
                    {videoStream.status}
                  </span>
                </div>
                {videoStream.resolution && (
                  <div className="flex justify-between">
                    <span className="text-tungsten/60">Resolution:</span>
                    <span className="font-mono text-tungsten">
                      {videoStream.resolution}
                    </span>
                  </div>
                )}
                {videoStream.metadata?.fps && (
                  <div className="flex justify-between">
                    <span className="text-tungsten/60">Frame Rate:</span>
                    <span className="font-mono text-tungsten">
                      {videoStream.metadata.fps} fps
                    </span>
                  </div>
                )}
                {videoStream.metadata?.codec && (
                  <div className="flex justify-between">
                    <span className="text-tungsten/60">Codec:</span>
                    <span className="font-mono text-tungsten uppercase">
                      {videoStream.metadata.codec}
                    </span>
                  </div>
                )}
                {videoStream.metadata?.bitrate && (
                  <div className="flex justify-between">
                    <span className="text-tungsten/60">Bitrate:</span>
                    <span className="font-mono text-tungsten">
                      {videoStream.metadata.bitrate} kbps
                    </span>
                  </div>
                )}
              </div>
            </div>
          )}
        </GlassPanel>
      </div>
    </div>
  );
};

