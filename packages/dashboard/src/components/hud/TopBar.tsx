/**
 * TopBar
 * Top navigation with UTC clock and system status
 */

import React, { useState, useEffect } from 'react';
import { Clock, Activity, Shield } from 'lucide-react';
import { GlassPanel } from './GlassPanel';
import { ConnectionIndicator } from '../health/ConnectionIndicator';
import { useCommStore } from '../../store/useCommStore';
import { useTacticalStore } from '../../store/useTacticalStore';

interface TopBarProps {
  systemStatus?: 'operational' | 'degraded' | 'offline';
  verifiedNodes?: number;
  totalNodes?: number;
  className?: string;
}

export const TopBar: React.FC<TopBarProps> = ({
  systemStatus = 'operational',
  verifiedNodes = 0,
  totalNodes = 0,
  className = '',
}) => {
  const [utcTime, setUtcTime] = useState('');
  const c2State = useCommStore((state) => state.c2State);
  const backendCoreStatus = useCommStore((state) => state.backendCoreStatus);
  const meshNodes = useTacticalStore((state) => state.nodes) || new Map();

  const liveMeshNodeCount = Array.from(meshNodes.values()).filter((node) => {
    const ageMs = Date.now() - new Date(node.lastSeen).getTime();
    return node.status !== 'offline' && ageMs < 120000;
  }).length;

  useEffect(() => {
    const updateTime = () => {
      const now = new Date();
      setUtcTime(
        now.toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, ' UTC')
      );
    };

    updateTime();
    const interval = setInterval(updateTime, 1000);
    return () => clearInterval(interval);
  }, []);

  const statusColor = {
    operational: 'text-verified-green',
    degraded: 'text-ghost',
    offline: 'text-jamming',
  }[systemStatus];

  const statusBadge = {
    operational: 'badge-success',
    degraded: 'badge-warning',
    offline: 'badge-danger',
  }[systemStatus];

  const piMeshStatus = (() => {
    if ((c2State === 'CONNECTED' || c2State === 'DEGRADED') && liveMeshNodeCount > 0) {
      return { label: 'CONNECTED', tone: 'text-verified-green border-verified-green/40' };
    }
    if (c2State === 'CONNECTING' || c2State === 'BACKOFF') {
      return { label: 'PENDING', tone: 'text-overmatch border-overmatch/40' };
    }
    if (c2State === 'CONNECTED' || c2State === 'DEGRADED') {
      return { label: 'WAITING', tone: 'text-overmatch border-overmatch/40' };
    }
    return { label: 'OFFLINE', tone: 'text-tungsten/70 border-tungsten/30' };
  })();

  const backendStatus = (() => {
    if (backendCoreStatus === 'connected') {
      return { label: 'CONNECTED', tone: 'text-verified-green border-verified-green/40' };
    }
    if (backendCoreStatus === 'unreachable') {
      return { label: 'UNREACHABLE', tone: 'text-jamming border-jamming/40' };
    }
    return { label: 'UNKNOWN', tone: 'text-tungsten/70 border-tungsten/30' };
  })();

  return (
    <GlassPanel
      variant="heavy"
      className={`flex items-center justify-between px-4 py-2 ${className}`}
      hover={false}
    >
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-2">
          <Shield className="text-overmatch flex-shrink-0" size={20} />
          <span className="font-display text-lg font-semibold text-overmatch whitespace-nowrap">
            AETHERCORE
          </span>
        </div>
        <div className="h-6 w-px bg-tungsten/20 flex-shrink-0" />
        <div className="flex items-center gap-2">
          <Activity className={statusColor} size={16} />
          <span className={`${statusBadge} whitespace-nowrap`}>{systemStatus.toUpperCase()}</span>
        </div>
        <span className="badge-info whitespace-nowrap" aria-label="Supported operator mode">
          Commander Edition
        </span>
      </div>

      <div className="flex items-center gap-4 ml-4">
        {/* Aetheric Link Status */}
        <ConnectionIndicator />
        <div className="hidden 2xl:flex items-center gap-2">
          <div className={`rounded border bg-carbon/40 px-2 py-1 text-[10px] font-mono ${piMeshStatus.tone}`}>
            PI MESH {piMeshStatus.label}
          </div>
          <div className={`rounded border bg-carbon/40 px-2 py-1 text-[10px] font-mono ${backendStatus.tone}`}>
            BACKEND CORE {backendStatus.label}
          </div>
        </div>
        <div className="h-6 w-px bg-tungsten/20 flex-shrink-0" />
        <div className="text-sm text-tungsten/70 whitespace-nowrap">
          <span className="font-semibold text-verified-green">{verifiedNodes}</span>
          <span className="mx-1">/</span>
          <span>{totalNodes}</span>
          <span className="ml-1 hidden sm:inline">Verified Nodes</span>
        </div>
        <div className="h-6 w-px bg-tungsten/20 flex-shrink-0" />
        <div className="flex items-center gap-2 font-mono text-sm text-tungsten/70 whitespace-nowrap">
          <Clock size={16} className="flex-shrink-0" />
          <span className="hidden md:inline">{utcTime}</span>
        </div>
      </div>
    </GlassPanel>
  );
};
