/**
 * Connection Status Indicator
 * 
 * Real-time visual feedback for C2 mesh connection status.
 * Implements Fail-Visible doctrine - integrity failures are never hidden.
 */

import React from 'react';
import { Wifi, WifiOff, AlertTriangle, ShieldAlert, Loader2 } from 'lucide-react';
import { useCommStore, ConnectionStatus } from '../store/useCommStore';

interface StatusConfig {
  icon: React.ElementType;
  color: string;
  bgColor: string;
  borderColor: string;
  label: string;
  description: string;
  pulse?: boolean;
}

const STATUS_CONFIG: Record<ConnectionStatus, StatusConfig> = {
  disconnected: {
    icon: WifiOff,
    color: 'text-gray-400',
    bgColor: 'bg-gray-900/50',
    borderColor: 'border-gray-700',
    label: 'DISCONNECTED',
    description: 'Not connected to C2 mesh',
  },
  connecting: {
    icon: Loader2,
    color: 'text-yellow-400',
    bgColor: 'bg-yellow-900/30',
    borderColor: 'border-yellow-700',
    label: 'CONNECTING',
    description: 'Establishing secure connection...',
    pulse: true,
  },
  connected: {
    icon: Wifi,
    color: 'text-green-400',
    bgColor: 'bg-green-900/30',
    borderColor: 'border-green-700',
    label: 'CONNECTED',
    description: 'Secure connection established',
  },
  unverified: {
    icon: AlertTriangle,
    color: 'text-orange-400',
    bgColor: 'bg-orange-900/30',
    borderColor: 'border-orange-700',
    label: 'UNVERIFIED',
    description: 'Connection established but not authenticated',
    pulse: true,
  },
  severed: {
    icon: ShieldAlert,
    color: 'text-red-400',
    bgColor: 'bg-red-900/50',
    borderColor: 'border-red-700',
    label: 'SEVERED',
    description: 'Security failure - connection terminated',
    pulse: true,
  },
};

export function ConnectionStatusIndicator() {
  const connectionStatus = useCommStore((state) => state.connectionStatus);
  const config = STATUS_CONFIG[connectionStatus];
  const Icon = config.icon;

  return (
    <div
      className={`flex items-center gap-2 px-3 py-2 ${config.bgColor} border ${config.borderColor} rounded-lg transition-all duration-300`}
      title={config.description}
    >
      <Icon
        className={`w-4 h-4 ${config.color} ${
          config.pulse ? 'animate-pulse' : ''
        } ${connectionStatus === 'connecting' ? 'animate-spin' : ''}`}
      />
      <span className={`text-xs font-mono font-bold ${config.color}`}>
        {config.label}
      </span>
    </div>
  );
}

/**
 * Expanded Connection Status Panel
 * 
 * Provides detailed connection information and manual controls.
 * Used in settings or debug panels.
 */
export function ConnectionStatusPanel() {
  const connectionStatus = useCommStore((state) => state.connectionStatus);
  const config = STATUS_CONFIG[connectionStatus];
  const Icon = config.icon;

  return (
    <div className={`p-4 ${config.bgColor} border ${config.borderColor} rounded-lg`}>
      <div className="flex items-start gap-3">
        <Icon
          className={`w-6 h-6 ${config.color} flex-shrink-0 ${
            config.pulse ? 'animate-pulse' : ''
          } ${connectionStatus === 'connecting' ? 'animate-spin' : ''}`}
        />
        <div className="flex-1">
          <div className={`text-sm font-bold ${config.color} mb-1`}>
            {config.label}
          </div>
          <div className="text-xs text-gray-400">{config.description}</div>

          {/* Additional details for specific states */}
          {connectionStatus === 'severed' && (
            <div className="mt-2 p-2 bg-red-950/50 border border-red-800 rounded text-xs text-red-300">
              <strong>SECURITY ALERT:</strong> The connection was terminated due to a
              security policy violation. Check logs for details. This may indicate:
              <ul className="list-disc list-inside mt-1 ml-2">
                <li>TPM signing failure</li>
                <li>Backend authentication failure</li>
                <li>Remote kill switch activation</li>
              </ul>
            </div>
          )}

          {connectionStatus === 'unverified' && (
            <div className="mt-2 p-2 bg-orange-950/50 border border-orange-800 rounded text-xs text-orange-300">
              Connection is active but cryptographic authentication is in progress.
              Do not transmit sensitive data until status shows CONNECTED.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
