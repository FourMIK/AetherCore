/**
 * C2 Status Panel - Operator-Grade Connection Diagnostics
 * 
 * Provides detailed C2 connection status and diagnostics:
 * - Real-time state display
 * - Last message timestamps
 * - RTT (Round Trip Time)
 * - Missed heartbeats
 * - Queue status
 * - Reconnection controls
 * 
 * Implements Fail-Visible doctrine with clear status indicators.
 */

import React, { useState } from 'react';
import {
  Wifi,
  WifiOff,
  AlertTriangle,
  Loader2,
  RefreshCw,
  Clock,
  Activity,
  MessageSquare,
  Copy,
  ChevronDown,
  ChevronUp,
  XCircle,
} from 'lucide-react';
import { useCommStore } from '../../store/useCommStore';
import type { C2State } from '../../services/c2/C2Client';

interface StatusConfig {
  icon: React.ElementType;
  color: string;
  bgColor: string;
  borderColor: string;
  label: string;
  description: string;
}

const STATE_CONFIG: Record<C2State, StatusConfig> = {
  IDLE: {
    icon: WifiOff,
    color: 'text-gray-400',
    bgColor: 'bg-gray-900/50',
    borderColor: 'border-gray-700',
    label: 'Idle',
    description: 'Not connected',
  },
  CONNECTING: {
    icon: Loader2,
    color: 'text-yellow-400',
    bgColor: 'bg-yellow-900/30',
    borderColor: 'border-yellow-700',
    label: 'Connecting',
    description: 'Establishing connection...',
  },
  CONNECTED: {
    icon: Wifi,
    color: 'text-green-400',
    bgColor: 'bg-green-900/30',
    borderColor: 'border-green-700',
    label: 'Connected',
    description: 'Operational',
  },
  DEGRADED: {
    icon: AlertTriangle,
    color: 'text-orange-400',
    bgColor: 'bg-orange-900/30',
    borderColor: 'border-orange-700',
    label: 'Degraded',
    description: 'Connection quality degraded',
  },
  BACKOFF: {
    icon: RefreshCw,
    color: 'text-yellow-400',
    bgColor: 'bg-yellow-900/30',
    borderColor: 'border-yellow-700',
    label: 'Reconnecting',
    description: 'Scheduled reconnect',
  },
  DISCONNECTED: {
    icon: WifiOff,
    color: 'text-red-400',
    bgColor: 'bg-red-900/50',
    borderColor: 'border-red-700',
    label: 'Disconnected',
    description: 'Connection lost',
  },
};

function formatTimeAgo(date: Date | undefined): string {
  if (!date) return 'Never';
  
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
  
  if (seconds < 5) return 'Just now';
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

function formatBackoffRemaining(backoffUntil: Date | undefined): string {
  if (!backoffUntil) return '';
  
  const remaining = Math.max(0, backoffUntil.getTime() - Date.now());
  const seconds = Math.ceil(remaining / 1000);
  
  if (seconds <= 0) return 'Reconnecting now...';
  if (seconds === 1) return '1 second';
  return `${seconds} seconds`;
}

interface C2StatusPanelProps {
  compact?: boolean;
}

export function C2StatusPanel({ compact = false }: C2StatusPanelProps) {
  const [expanded, setExpanded] = useState(!compact);
  const [copiedError, setCopiedError] = useState(false);
  
  const c2State = useCommStore((state) => state.c2State);
  const getC2Status = useCommStore((state) => state.getC2Status);
  const c2Client = useCommStore((state) => state.c2Client);
  const { connectC2, disconnectC2 } = useCommStore();
  
  const status = getC2Status();
  const config = STATE_CONFIG[c2State];
  const Icon = config.icon;
  
  // Get max reconnect attempts from client config
  const maxReconnectAttempts = (c2Client as any)?.config?.maxReconnectAttempts || 10;
  
  if (!status) {
    return (
      <div className="p-4 bg-gray-900/50 border border-gray-700 rounded-lg">
        <div className="text-gray-400 text-sm">C2 client not initialized</div>
      </div>
    );
  }
  
  const handleReconnect = () => {
    // Use reconnectNow if available, otherwise disconnect and reconnect
    const c2Client = useCommStore.getState().c2Client;
    if (c2Client && 'reconnectNow' in c2Client) {
      (c2Client as any).reconnectNow();
    } else {
      disconnectC2();
      setTimeout(() => connectC2(), 100);
    }
  };
  
  const handleCopyError = () => {
    if (status.error) {
      navigator.clipboard.writeText(status.error);
      setCopiedError(true);
      setTimeout(() => setCopiedError(false), 2000);
    }
  };
  
  const isSpinning = c2State === 'CONNECTING';
  const isPulsing = c2State === 'DEGRADED' || c2State === 'BACKOFF';
  
  return (
    <div className={`${config.bgColor} border ${config.borderColor} rounded-lg transition-all`}>
      {/* Header - Always Visible */}
      <div
        className={`flex items-center justify-between p-3 ${compact ? 'cursor-pointer' : ''}`}
        onClick={compact ? () => setExpanded(!expanded) : undefined}
      >
        <div className="flex items-center gap-3">
          <Icon
            className={`w-5 h-5 ${config.color} ${
              isSpinning ? 'animate-spin' : isPulsing ? 'animate-pulse' : ''
            }`}
          />
          <div>
            <div className={`text-sm font-bold ${config.color}`}>
              C2: {config.label}
            </div>
            {c2State === 'BACKOFF' && status.backoffUntil && (
              <div className="text-xs text-gray-400">
                Reconnecting in {formatBackoffRemaining(status.backoffUntil)}
              </div>
            )}
          </div>
        </div>
        
        {compact && (
          <button
            className="text-gray-400 hover:text-gray-300 transition-colors"
            aria-label={expanded ? 'Collapse' : 'Expand'}
          >
            {expanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
          </button>
        )}
      </div>
      
      {/* Detailed Status - Expandable */}
      {expanded && (
        <div className="px-3 pb-3 space-y-3 border-t border-gray-700/50 pt-3">
          {/* Connection Details */}
          <div className="grid grid-cols-2 gap-2 text-xs">
            <div className="flex items-center gap-2 text-gray-400">
              <Clock size={14} />
              <span>Last RX:</span>
            </div>
            <div className="text-gray-300 font-mono">
              {formatTimeAgo(status.lastMessageReceived)}
            </div>
            
            <div className="flex items-center gap-2 text-gray-400">
              <Clock size={14} />
              <span>Last TX:</span>
            </div>
            <div className="text-gray-300 font-mono">
              {formatTimeAgo(status.lastMessageSent)}
            </div>
            
            {status.rttMs !== undefined && (
              <>
                <div className="flex items-center gap-2 text-gray-400">
                  <Activity size={14} />
                  <span>RTT:</span>
                </div>
                <div className="text-gray-300 font-mono">
                  {Math.round(status.rttMs)}ms
                </div>
              </>
            )}
            
            {status.missedHeartbeats > 0 && (
              <>
                <div className="flex items-center gap-2 text-orange-400">
                  <AlertTriangle size={14} />
                  <span>Missed HB:</span>
                </div>
                <div className="text-orange-400 font-mono font-bold">
                  {status.missedHeartbeats}
                </div>
              </>
            )}
            
            {status.queuedMessages > 0 && (
              <>
                <div className="flex items-center gap-2 text-yellow-400">
                  <MessageSquare size={14} />
                  <span>Queued:</span>
                </div>
                <div className="text-yellow-400 font-mono">
                  {status.queuedMessages} msg
                </div>
              </>
            )}
            
            {status.reconnectAttempts > 0 && (
              <>
                <div className="flex items-center gap-2 text-gray-400">
                  <RefreshCw size={14} />
                  <span>Attempts:</span>
                </div>
                <div className="text-gray-300 font-mono">
                  {status.reconnectAttempts}/{maxReconnectAttempts}
                </div>
              </>
            )}
          </div>
          
          {/* Error Display */}
          {status.error && (
            <div className="p-2 bg-red-950/50 border border-red-800/50 rounded text-xs">
              <div className="flex items-start justify-between gap-2">
                <div className="flex-1">
                  <div className="text-red-400 font-bold mb-1">Last Error:</div>
                  <div className="text-red-300 font-mono break-all">
                    {status.error}
                  </div>
                </div>
                <button
                  onClick={handleCopyError}
                  className="flex-shrink-0 p-1 text-red-400 hover:text-red-300 transition-colors"
                  title="Copy error"
                >
                  {copiedError ? (
                    <span className="text-green-400">✓</span>
                  ) : (
                    <Copy size={14} />
                  )}
                </button>
              </div>
            </div>
          )}
          
          {/* Degraded Warning */}
          {c2State === 'DEGRADED' && (
            <div className="p-2 bg-orange-950/50 border border-orange-800/50 rounded text-xs text-orange-300">
              <AlertTriangle className="inline w-3 h-3 mr-1" />
              Connection quality degraded. High latency or packet loss detected.
            </div>
          )}
          
          {/* Quick Actions */}
          <div className="flex gap-2">
            {(c2State === 'CONNECTED' || c2State === 'DEGRADED') && (
              <button
                onClick={disconnectC2}
                className="flex-1 px-3 py-2 bg-gray-800 hover:bg-gray-700 border border-gray-600 rounded text-xs text-gray-300 transition-colors flex items-center justify-center gap-2"
              >
                <XCircle size={14} />
                Disconnect
              </button>
            )}
            
            {(c2State === 'DISCONNECTED' || c2State === 'BACKOFF' || c2State === 'DEGRADED') && (
              <button
                onClick={handleReconnect}
                className="flex-1 px-3 py-2 bg-yellow-900/50 hover:bg-yellow-800/50 border border-yellow-700 rounded text-xs text-yellow-300 transition-colors flex items-center justify-center gap-2"
              >
                <RefreshCw size={14} />
                Reconnect Now
              </button>
            )}
            
            {c2State === 'IDLE' && (
              <button
                onClick={connectC2}
                className="flex-1 px-3 py-2 bg-green-900/50 hover:bg-green-800/50 border border-green-700 rounded text-xs text-green-300 transition-colors flex items-center justify-center gap-2"
              >
                <Wifi size={14} />
                Connect
              </button>
            )}
          </div>
          
          {/* Endpoint */}
          <div className="text-xs text-gray-500 font-mono truncate" title={status.endpoint}>
            {status.endpoint}
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Compact C2 Status Indicator
 * For use in the top bar or minimal UI contexts
 */
export function C2StatusIndicator() {
  const c2State = useCommStore((state) => state.c2State);
  const getC2Status = useCommStore((state) => state.getC2Status);
  const [showPanel, setShowPanel] = useState(false);
  
  const status = getC2Status();
  const config = STATE_CONFIG[c2State];
  const Icon = config.icon;
  
  if (!status) return null;
  
  const isSpinning = c2State === 'CONNECTING';
  const isPulsing = c2State === 'DEGRADED' || c2State === 'BACKOFF';
  
  return (
    <div className="relative">
      <button
        onClick={() => setShowPanel(!showPanel)}
        className={`flex items-center gap-2 px-3 py-1.5 ${config.bgColor} border ${config.borderColor} rounded-lg transition-all hover:opacity-80`}
        title={config.description}
      >
        <Icon
          className={`w-4 h-4 ${config.color} ${
            isSpinning ? 'animate-spin' : isPulsing ? 'animate-pulse' : ''
          }`}
        />
        <span className={`text-xs font-mono font-bold ${config.color}`}>
          {config.label.toUpperCase()}
        </span>
        {status.missedHeartbeats > 0 && (
          <span className="text-xs font-mono text-orange-400">
            !{status.missedHeartbeats}
          </span>
        )}
      </button>
      
      {showPanel && (
        <>
          <div
            className="fixed inset-0 z-40"
            onClick={() => setShowPanel(false)}
          />
          <div className="absolute top-full right-0 mt-2 w-80 z-50">
            <C2StatusPanel compact={false} />
          </div>
        </>
      )}
    </div>
  );
}
