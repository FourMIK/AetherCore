/**
 * ActivationTerminal
 * Real-time progress and terminal output for device provisioning
 * Handles both USB (firmware flash) and Network (SSH injection) flows
 */

import React, { useState, useEffect, useRef } from 'react';
import { Shield, AlertTriangle, Terminal as TerminalIcon } from 'lucide-react';
import { listen } from '@tauri-apps/api/event';
import { TauriCommands } from '../../api/tauri-commands';

interface CandidateNode {
  type: 'USB' | 'NET';
  id: string;
  label: string;
  transport?: 'usb-serial' | 'usb-mass-storage' | 'network' | 'bluetooth-serial';
  hardware_profile?: string;
}

interface GenesisIdentity {
  public_key: string;
  root_hash: string;
  node_id: string;
  callsign?: string;
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
  const [manualFirmwareOverride, setManualFirmwareOverride] = useState(false);
  const [firmwarePath, setFirmwarePath] = useState('');
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState('');
  const [identity, setIdentity] = useState<GenesisIdentity | null>(null);
  const logEndRef = useRef<HTMLDivElement>(null);

  const addLog = (message: string, level: LogEntry['level'] = 'info') => {
    setLogs((prev) => [...prev, { timestamp: Date.now(), message, level }]);
  };
  const isTetheredDevice = asset.type === 'USB';
  const deviceClassLabel =
    asset.transport === 'bluetooth-serial'
      ? 'Bluetooth Serial RalphieNode Device'
      : isTetheredDevice
      ? 'USB RalphieNode Device'
      : 'Network RalphieNode Device';

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

    if (isTetheredDevice) {
      setupListener();
    }

    return () => {
      if (unlisten) unlisten();
    };
  }, [isTetheredDevice]);

  const canActivate =
    isTetheredDevice
      ? !manualFirmwareOverride || firmwarePath.trim().length > 0
      : password.trim().length > 0;

  const handleInputEnterKey = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter' && canActivate) {
      void handleActivate();
    }
  };

  const handleActivate = async () => {
    setStage('activating');
    setError('');
    setLogs([]);
    setProgress(0);

    try {
      if (isTetheredDevice) {
        // USB Flow
        addLog('Initializing USB provisioning...', 'info');
        addLog(`Target: ${asset.label} (${asset.id})`, 'info');
        if (asset.transport === 'bluetooth-serial') {
          addLog('Transport: Bluetooth serial endpoint', 'info');
        }
        if (asset.hardware_profile) {
          addLog(`Detected hardware profile: ${asset.hardware_profile}`, 'info');
        }
        addLog(
          manualFirmwareOverride
            ? `Using manual firmware override: ${firmwarePath}`
            : 'Using auto-selected bundled firmware profile',
          'info'
        );
        addLog('Flashing Silicon...', 'info');

        const result = await TauriCommands.provisionTarget(
          asset,
          null,
          manualFirmwareOverride ? firmwarePath : null,
        );
        if (!result.success) {
          throw new Error(result.error);
        }
        if (result.data.status !== 'SUCCESS') {
          throw new Error('Provisioning failed (FAIL-VISIBLE: backend returned FAILURE)');
        }

        addLog('Firmware flashed successfully', 'success');
        addLog('Verifying Trust...', 'info');
        addLog(`Root Hash: ${result.data.identity.root_hash}`, 'success');
        addLog(`Callsign: ${result.data.identity.callsign ?? result.data.identity.node_id}`, 'success');
        
        setIdentity(result.data.identity);
        setProgress(100);
        setStage('success');
        
        // Trigger success callback after brief delay
        setTimeout(() => onSuccess(result.data.identity), 1500);
      } else {
        // Network Flow
        addLog('Initializing network provisioning...', 'info');
        addLog(`Target: ${asset.label} (${asset.id})`, 'info');
        addLog('Invoking service-backed provisioning command...', 'info');

        const result = await TauriCommands.provisionTarget(
          asset,
          {
            username: 'pi',
            password,
          },
          null,
        );
        if (!result.success) {
          throw new Error(result.error);
        }
        if (result.data.status !== 'SUCCESS') {
          throw new Error('Provisioning failed (FAIL-VISIBLE: backend returned FAILURE)');
        }

        addLog('Provisioning completed', 'success');
        addLog('Verifying Trust...', 'info');
        addLog(`Root Hash: ${result.data.identity.root_hash}`, 'success');
        addLog(`Callsign: ${result.data.identity.callsign ?? result.data.identity.node_id}`, 'success');
        
        setIdentity(result.data.identity);
        setProgress(100);
        setStage('success');
        
        // Trigger success callback after brief delay
        setTimeout(() => onSuccess(result.data.identity), 1500);
      }
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      addLog(`FAILURE: ${errorMsg}`, 'error');
      setError(errorMsg);
      setStage('error');
    }
  };

  return (
    <div className="space-y-6" data-testid="activation-terminal">
      {/* Header */}
      <div className="text-center">
        <h3 className="font-display text-2xl text-tungsten mb-2">
          Activation Protocol
        </h3>
        <p className="text-tungsten/70">
          {deviceClassLabel} • {asset.label}
        </p>
        <p className="text-xs text-tungsten/50 font-mono mt-1">{asset.id}</p>
      </div>

      {/* Input Stage */}
      {stage === 'input' && (
        <div className="space-y-4">
          {isTetheredDevice ? (
            <div className="space-y-4">
              <div className="p-4 bg-overmatch/10 border border-overmatch/30 rounded-lg">
                <p className="text-sm text-overmatch font-display">Automatic Firmware Selection Enabled</p>
                <p className="text-xs text-tungsten/70 mt-1">
                  Detected profile: <span className="font-mono">{asset.hardware_profile || 'unknown'}</span>
                </p>
                <p className="text-xs text-tungsten/60 mt-1">
                  Transport: <span className="font-mono">{asset.transport || 'usb-serial'}</span>
                </p>
              </div>

              <label className="flex items-center gap-2 text-sm text-tungsten/70">
                <input
                  type="checkbox"
                  checked={manualFirmwareOverride}
                  onChange={(e) => setManualFirmwareOverride(e.target.checked)}
                  data-testid="manual-firmware-toggle"
                />
                Use manual firmware path override
              </label>

              {manualFirmwareOverride && (
                <div>
                  <label className="block text-sm text-tungsten/70 mb-2 font-display">
                    Firmware Binary Path (Override)
                  </label>
                  <input
                    type="text"
                    value={firmwarePath}
                    onChange={(e) => setFirmwarePath(e.target.value)}
                    onKeyDown={handleInputEnterKey}
                    placeholder="/path/to/firmware.bin or /path/to/firmware.uf2"
                    data-testid="firmware-path-input"
                    className="w-full px-4 py-3 bg-carbon/50 border border-tungsten/20 rounded-lg text-tungsten font-mono focus:outline-none focus:border-overmatch"
                  />
                  <p className="text-xs text-tungsten/50 mt-2">
                    Leave override disabled for automatic firmware profile selection.
                  </p>
                </div>
              )}
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
                onKeyDown={handleInputEnterKey}
                placeholder="raspberry"
                data-testid="node-password-input"
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
              data-testid="activation-cancel-button"
              className="flex-1 px-6 py-3 bg-tungsten/10 hover:bg-tungsten/20 text-tungsten rounded-lg transition-colors font-display"
            >
              Cancel
            </button>
            <button
              onClick={handleActivate}
              disabled={!canActivate}
              data-testid="initiate-activation-button"
              className="flex-1 px-6 py-3 bg-overmatch hover:bg-overmatch/90 text-carbon rounded-lg transition-colors font-display font-bold disabled:opacity-50 disabled:cursor-not-allowed"
            >
              INITIATE RALPHIENODE ACTIVATION
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
          <div
            className="bg-carbon/80 border border-tungsten/20 rounded-lg p-4 h-64 overflow-y-auto font-mono text-sm"
            data-testid="activation-log"
          >
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
              <div className="space-y-3" data-testid="activation-success">
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
                    {identity.callsign ?? identity.node_id}
                  </p>
                </div>
              </div>
            )}

            {stage === 'error' && (
              <div className="space-y-3" data-testid="activation-error">
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
                  data-testid="activation-back-to-assets"
                  className="px-6 py-2 bg-tungsten/10 hover:bg-tungsten/20 text-tungsten rounded-lg transition-colors font-display"
                >
                  Back to RalphieNode Scan
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
