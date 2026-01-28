/**
 * ActivationTerminal
 * Real-time progress and terminal output for device provisioning
 * Handles both USB (firmware flash) and Network (SSH injection) flows
 */

import React, { useState, useEffect, useRef } from 'react';
import { Shield, AlertTriangle, CheckCircle, Terminal as TerminalIcon } from 'lucide-react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';

interface CandidateNode {
  type: string;
  id: string;
  label: string;
}

interface GenesisIdentity {
  public_key: string;
  root_hash: string;
  callsign: string;
}

interface ActivationTerminalProps {
  asset: CandidateNode;
  onSuccess: (identity: GenesisIdentity) => void;
  onCancel: () => void;
}

interface LogEntry {
  timestamp: number;
  message: string;
  level: 'info' | 'error' | 'success';
}

export const ActivationTerminal: React.FC<ActivationTerminalProps> = ({
  asset,
  onSuccess,
  onCancel,
}) => {
  const [stage, setStage] = useState<'input' | 'activating' | 'success' | 'error'>('input');
  const [password, setPassword] = useState('raspberry'); // Default for Pi
  const [firmwarePath, setFirmwarePath] = useState('');
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState('');
  const [identity, setIdentity] = useState<GenesisIdentity | null>(null);
  const logEndRef = useRef<HTMLDivElement>(null);

  const addLog = (message: string, level: LogEntry['level'] = 'info') => {
    setLogs((prev) => [...prev, { timestamp: Date.now(), message, level }]);
  };

  // Auto-scroll logs
  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);

  // Listen for flash progress events
  useEffect(() => {
    let unlisten: (() => void) | undefined;

    const setupListener = async () => {
      unlisten = await listen<{ stage: string; message: string; progress: number }>(
        'flash_progress',
        (event) => {
          const { stage, message, progress: p } = event.payload;
          addLog(`[${stage.toUpperCase()}] ${message}`, 'info');
          setProgress(p * 100);
        }
      );
    };

    if (asset.type === 'USB') {
      setupListener();
    }

    return () => {
      if (unlisten) unlisten();
    };
  }, [asset.type]);

  const handleActivate = async () => {
    setStage('activating');
    setError('');
    setLogs([]);
    setProgress(0);

    try {
      if (asset.type === 'USB') {
        // USB Flow
        if (!firmwarePath) {
          throw new Error('Firmware path is required for USB devices');
        }
        
        addLog('Initializing USB provisioning...', 'info');
        addLog(`Target: ${asset.label} (${asset.id})`, 'info');
        addLog('Flashing Silicon...', 'info');

        const result = await invoke<{ identity: GenesisIdentity }>('provision_target', {
          target: asset,
          credentials: null,
          firmwarePath,
        });

        addLog('Firmware flashed successfully', 'success');
        addLog('Verifying Trust...', 'info');
        addLog(`Root Hash: ${result.identity.root_hash}`, 'success');
        addLog(`Callsign: ${result.identity.callsign}`, 'success');
        
        setIdentity(result.identity);
        setProgress(100);
        setStage('success');
        
        // Trigger success callback after brief delay
        setTimeout(() => onSuccess(result.identity), 1500);
      } else {
        // Network Flow
        addLog('Initializing network provisioning...', 'info');
        addLog(`Target: ${asset.label} (${asset.id})`, 'info');
        addLog('Establishing SSH connection...', 'info');
        setProgress(20);

        const result = await invoke<{ identity: GenesisIdentity }>('provision_target', {
          target: asset,
          credentials: {
            username: 'pi', // Standard for Raspberry Pi
            password,
          },
          firmwarePath: null,
        });

        addLog('SSH connection established', 'success');
        setProgress(40);
        addLog('Injecting Agent...', 'info');
        setProgress(60);
        addLog('Securing Keys...', 'info');
        setProgress(80);
        addLog('Verifying Trust...', 'info');
        setProgress(90);
        addLog(`Root Hash: ${result.identity.root_hash}`, 'success');
        addLog(`Callsign: ${result.identity.callsign}`, 'success');
        
        setIdentity(result.identity);
        setProgress(100);
        setStage('success');
        
        // Trigger success callback after brief delay
        setTimeout(() => onSuccess(result.identity), 1500);
      }
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      addLog(`FAILURE: ${errorMsg}`, 'error');
      setError(errorMsg);
      setStage('error');
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="text-center">
        <h3 className="font-display text-2xl text-tungsten mb-2">
          Activation Protocol
        </h3>
        <p className="text-tungsten/70">
          {asset.type === 'USB' ? 'USB Serial Device' : 'Network Device'} • {asset.label}
        </p>
        <p className="text-xs text-tungsten/50 font-mono mt-1">{asset.id}</p>
      </div>

      {/* Input Stage (Network only requires password, USB requires firmware path) */}
      {stage === 'input' && (
        <div className="space-y-4">
          {asset.type === 'USB' ? (
            <div>
              <label className="block text-sm text-tungsten/70 mb-2 font-display">
                Firmware Binary Path
              </label>
              <input
                type="text"
                value={firmwarePath}
                onChange={(e) => setFirmwarePath(e.target.value)}
                placeholder="/path/to/firmware.bin"
                className="w-full px-4 py-3 bg-carbon/50 border border-tungsten/20 rounded-lg text-tungsten font-mono focus:outline-none focus:border-overmatch"
              />
              <p className="text-xs text-tungsten/50 mt-2">
                Path to the compiled firmware binary for provisioning
              </p>
            </div>
          ) : (
            <div>
              <label className="block text-sm text-tungsten/70 mb-2 font-display">
                Device Password
              </label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="raspberry"
                className="w-full px-4 py-3 bg-carbon/50 border border-tungsten/20 rounded-lg text-tungsten focus:outline-none focus:border-overmatch"
              />
              <p className="text-xs text-tungsten/50 mt-2">
                Default password is pre-filled. Change if you've customized it.
              </p>
            </div>
          )}

          <div className="flex gap-3 pt-4">
            <button
              onClick={onCancel}
              className="flex-1 px-6 py-3 bg-tungsten/10 hover:bg-tungsten/20 text-tungsten rounded-lg transition-colors font-display"
            >
              Cancel
            </button>
            <button
              onClick={handleActivate}
              disabled={(asset.type === 'USB' && !firmwarePath) || (asset.type === 'NET' && !password)}
              className="flex-1 px-6 py-3 bg-overmatch hover:bg-overmatch/90 text-carbon rounded-lg transition-colors font-display font-bold disabled:opacity-50 disabled:cursor-not-allowed"
            >
              INITIATE ACTIVATION
            </button>
          </div>
        </div>
      )}

      {/* Progress Stage */}
      {(stage === 'activating' || stage === 'success' || stage === 'error') && (
        <div className="space-y-4">
          {/* Progress Bar */}
          {stage === 'activating' && (
            <div>
              <div className="flex justify-between text-sm text-tungsten/70 mb-2">
                <span className="font-display">Progress</span>
                <span className="font-mono">{Math.round(progress)}%</span>
              </div>
              <div className="h-2 bg-carbon border border-overmatch/30 rounded-full overflow-hidden">
                <div
                  className="h-full bg-overmatch transition-all duration-500"
                  style={{ width: `${progress}%` }}
                />
              </div>
            </div>
          )}

          {/* Terminal Output */}
          <div className="bg-carbon/80 border border-tungsten/20 rounded-lg p-4 h-64 overflow-y-auto font-mono text-sm">
            <div className="flex items-center gap-2 mb-3 pb-2 border-b border-tungsten/10">
              <TerminalIcon size={16} className="text-overmatch" />
              <span className="text-tungsten/70 text-xs">ACTIVATION LOG</span>
            </div>
            
            {logs.map((log, index) => (
              <div
                key={index}
                className={`mb-1 ${
                  log.level === 'error'
                    ? 'text-jamming'
                    : log.level === 'success'
                    ? 'text-verified-green'
                    : 'text-tungsten/70'
                }`}
              >
                <span className="text-tungsten/40 mr-2">
                  [{new Date(log.timestamp).toLocaleTimeString()}]
                </span>
                {log.message}
              </div>
            ))}
            <div ref={logEndRef} />
            
            {stage === 'activating' && (
              <div className="mt-2 text-overmatch animate-pulse">▊</div>
            )}
          </div>

          {/* Status Icons */}
          <div className="text-center">
            {stage === 'success' && identity && (
              <div className="space-y-3">
                <div className="flex justify-center">
                  <div className="w-20 h-20 rounded-full bg-verified-green/20 flex items-center justify-center">
                    <Shield size={40} className="text-verified-green" />
                  </div>
                </div>
                <h4 className="font-display text-xl text-verified-green">
                  Link Established
                </h4>
                <div className="p-4 bg-verified-green/10 border border-verified-green/30 rounded-lg">
                  <p className="text-sm text-tungsten/70 mb-2">Node Callsign</p>
                  <p className="text-lg font-display text-verified-green font-bold tracking-wider">
                    {identity.callsign}
                  </p>
                </div>
              </div>
            )}

            {stage === 'error' && (
              <div className="space-y-3">
                <div className="flex justify-center">
                  <div className="w-20 h-20 rounded-full bg-jamming/20 flex items-center justify-center">
                    <AlertTriangle size={40} className="text-jamming" />
                  </div>
                </div>
                <h4 className="font-display text-xl text-jamming">
                  Activation Failed
                </h4>
                <div className="p-4 bg-jamming/10 border border-jamming/30 rounded-lg">
                  <p className="text-sm text-jamming">{error}</p>
                </div>
                <button
                  onClick={onCancel}
                  className="px-6 py-2 bg-tungsten/10 hover:bg-tungsten/20 text-tungsten rounded-lg transition-colors font-display"
                >
                  Back to Assets
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
