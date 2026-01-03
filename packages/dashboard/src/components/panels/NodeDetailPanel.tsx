/**
 * NodeDetailPanel
 * Detailed node view with trust gauge, metrics, and firmware info
 */

import React from 'react';
import { X, MapPin, Clock, Package, Shield } from 'lucide-react';
import { GlassPanel } from '../hud/GlassPanel';
import { TrustScoreGauge } from '../command/TrustScoreGauge';
import { HashVisualizer } from '../hud/HashVisualizer';
import { VerificationPanel } from '../command/VerificationPanel';
import { useTacticalStore } from '../../store/useTacticalStore';

export const NodeDetailPanel: React.FC = () => {
  const nodes = useTacticalStore((s) => s.nodes);
  const selectedNodeId = useTacticalStore((s) => s.selectedNodeId);
  const selectNode = useTacticalStore((s) => s.selectNode);

  if (!selectedNodeId) {
    return (
      <GlassPanel variant="default" className="h-full flex items-center justify-center">
        <div className="text-center text-tungsten/50">
          <Shield size={48} className="mx-auto mb-3" />
          <p className="text-sm">Select a node to view details</p>
        </div>
      </GlassPanel>
    );
  }

  const node = nodes.get(selectedNodeId);

  if (!node) {
    return (
      <GlassPanel variant="default" className="h-full flex items-center justify-center">
        <div className="text-center text-tungsten/50">
          <p className="text-sm">Node not found</p>
        </div>
      </GlassPanel>
    );
  }

  return (
    <GlassPanel variant="default" className="h-full flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-tungsten/10">
        <h3 className="font-display text-lg font-semibold text-tungsten">
          Node Details
        </h3>
        <button
          onClick={() => selectNode(null)}
          className="p-2 rounded-lg text-tungsten/70 hover:bg-tungsten/10 hover:text-tungsten transition-colors"
        >
          <X size={20} />
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {/* Node ID */}
        <div>
          <div className="text-xs text-tungsten/50 mb-1">Node ID</div>
          <div className="font-mono text-sm text-tungsten">{node.id}</div>
        </div>

        {/* Domain */}
        <div>
          <div className="text-xs text-tungsten/50 mb-1">Domain</div>
          <div className="text-sm text-tungsten">{node.domain}</div>
        </div>

        {/* Status */}
        <div>
          <div className="text-xs text-tungsten/50 mb-1">Status</div>
          <span
            className={
              node.status === 'online'
                ? 'badge-success'
                : node.status === 'offline'
                ? 'badge-danger'
                : 'badge-warning'
            }
          >
            {node.status.toUpperCase()}
          </span>
        </div>

        {/* Position */}
        <div>
          <div className="text-xs text-tungsten/50 mb-2 flex items-center gap-1">
            <MapPin size={12} />
            Position
          </div>
          <div className="font-mono text-xs text-tungsten/70 space-y-1">
            <div>Lat: {node.position.latitude.toFixed(6)}°</div>
            <div>Lon: {node.position.longitude.toFixed(6)}°</div>
            {node.position.altitude && (
              <div>Alt: {node.position.altitude.toFixed(0)}m</div>
            )}
          </div>
        </div>

        {/* Trust Score */}
        <TrustScoreGauge score={node.trustScore} />

        {/* Verification */}
        <VerificationPanel
          verified={node.verified}
          trustScore={node.trustScore}
          attestationHash={node.attestationHash}
          lastVerified={node.lastSeen}
        />

        {/* Last Seen */}
        <div>
          <div className="text-xs text-tungsten/50 mb-1 flex items-center gap-1">
            <Clock size={12} />
            Last Seen
          </div>
          <div className="text-sm text-tungsten/70">
            {node.lastSeen.toLocaleString()}
          </div>
        </div>

        {/* Firmware Version */}
        {node.firmwareVersion && (
          <div>
            <div className="text-xs text-tungsten/50 mb-1 flex items-center gap-1">
              <Package size={12} />
              Firmware Version
            </div>
            <div className="font-mono text-sm text-tungsten">
              {node.firmwareVersion}
            </div>
          </div>
        )}

        {/* Attestation Hash */}
        {node.attestationHash && (
          <div>
            <div className="text-xs text-tungsten/50 mb-1">Attestation Hash</div>
            <HashVisualizer hash={node.attestationHash} length={16} />
          </div>
        )}
      </div>
    </GlassPanel>
  );
};
