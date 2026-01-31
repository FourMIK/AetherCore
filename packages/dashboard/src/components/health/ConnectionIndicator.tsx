/**
 * Connection Indicator - Aetheric Link Status Display
 * 
 * Visual fail-state indicator for the C2 channel authentication status.
 * Shows real-time connection health per the signed heartbeat protocol.
 * 
 * States:
 * - Green (Solid): LINK ESTABLISHED - Heartbeats verified
 * - Amber (Pulsing): LINK PENDING - Handshake in progress
 * - Red (Flashing): LINK SEVERED - Authentication failure or timeout
 * 
 * Fail-Visible Doctrine:
 * - No "Reconnecting..." spinner on security failures
 * - Show the failure state immediately and prominently
 */

import React, { useEffect, useState } from 'react';
import { useCommStore } from '../../store/useCommStore';
import { Shield, ShieldAlert, ShieldX } from 'lucide-react';

export const ConnectionIndicator: React.FC = () => {
  const connectionStatus = useCommStore((state) => state.connectionStatus);
  const [linkSeveredReason, setLinkSeveredReason] = useState<string | null>(null);

  useEffect(() => {
    // Listen for AETHER_LINK_SEVERED event
    const handleLinkSevered = (event: CustomEvent) => {
      setLinkSeveredReason(event.detail?.reason || 'Unknown failure');
    };

    window.addEventListener('AETHER_LINK_SEVERED', handleLinkSevered as EventListener);

    return () => {
      window.removeEventListener('AETHER_LINK_SEVERED', handleLinkSevered as EventListener);
    };
  }, []);

  // Reset reason when status changes away from severed
  useEffect(() => {
    if (connectionStatus !== 'severed') {
      setLinkSeveredReason(null);
    }
  }, [connectionStatus]);

  const getStatusConfig = () => {
    switch (connectionStatus) {
      case 'connected':
        return {
          color: 'text-green-400',
          bgColor: 'bg-green-400/20',
          borderColor: 'border-green-400/40',
          icon: Shield,
          label: 'LINK ESTABLISHED',
          description: 'Cryptographic authentication verified',
          animate: '',
        };
      
      case 'unverified':
      case 'connecting':
        return {
          color: 'text-amber-400',
          bgColor: 'bg-amber-400/20',
          borderColor: 'border-amber-400/40',
          icon: ShieldAlert,
          label: 'LINK PENDING',
          description: 'Handshake in progress...',
          animate: 'animate-pulse',
        };
      
      case 'severed':
        return {
          color: 'text-red-400',
          bgColor: 'bg-red-400/20',
          borderColor: 'border-red-400/40',
          icon: ShieldX,
          label: 'LINK SEVERED',
          description: linkSeveredReason || 'Authentication failure',
          animate: 'animate-pulse-fast',
        };
      
      case 'disconnected':
      default:
        return {
          color: 'text-slate-400',
          bgColor: 'bg-slate-400/10',
          borderColor: 'border-slate-400/20',
          icon: ShieldX,
          label: 'LINK OFFLINE',
          description: 'No connection to gateway',
          animate: '',
        };
    }
  };

  const config = getStatusConfig();
  const Icon = config.icon;

  return (
    <div
      className={`flex items-center gap-3 px-4 py-2 rounded-lg border ${config.bgColor} ${config.borderColor} ${config.animate}`}
    >
      {/* Status Icon */}
      <div className={`${config.color}`}>
        <Icon size={20} />
      </div>

      {/* Status Text */}
      <div className="flex flex-col">
        <span className={`text-sm font-bold ${config.color} tracking-wide`}>
          {config.label}
        </span>
        <span className="text-xs text-slate-400">
          {config.description}
        </span>
      </div>

      {/* Status Indicator Dot */}
      <div className={`ml-auto w-2 h-2 rounded-full ${config.color.replace('text-', 'bg-')} ${config.animate}`} />
    </div>
  );
};
