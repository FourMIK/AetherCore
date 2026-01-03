/**
 * TopBar
 * Top navigation with UTC clock and system status
 */

import React, { useState, useEffect } from 'react';
import { Clock, Activity, Shield } from 'lucide-react';
import { GlassPanel } from './GlassPanel';

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

  return (
    <GlassPanel
      variant="heavy"
      className={`flex items-center justify-between px-6 py-3 ${className}`}
      hover={false}
    >
      <div className="flex items-center gap-6">
        <div className="flex items-center gap-2">
          <Shield className="text-overmatch" size={20} />
          <span className="font-display text-lg font-semibold text-overmatch">
            AETHERCORE
          </span>
        </div>
        <div className="h-6 w-px bg-tungsten/20" />
        <div className="flex items-center gap-2">
          <Activity className={statusColor} size={16} />
          <span className={statusBadge}>{systemStatus.toUpperCase()}</span>
        </div>
      </div>

      <div className="flex items-center gap-6">
        <div className="text-sm text-tungsten/70">
          <span className="font-semibold text-verified-green">{verifiedNodes}</span>
          <span className="mx-1">/</span>
          <span>{totalNodes}</span>
          <span className="ml-1">Verified Nodes</span>
        </div>
        <div className="h-6 w-px bg-tungsten/20" />
        <div className="flex items-center gap-2 font-mono text-sm text-tungsten/70">
          <Clock size={16} />
          <span>{utcTime}</span>
        </div>
      </div>
    </GlassPanel>
  );
};
