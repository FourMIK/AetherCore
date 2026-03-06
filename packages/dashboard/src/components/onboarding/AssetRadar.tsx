/**
 * AssetRadar
 * Sonar-style detection view for discoverable nodes (USB/Network)
 * Part of "One Interaction" doctrine: immediate visibility of all provisionable assets
 */

import React, { useEffect, useRef, useState } from 'react';
import { Usb, Wifi, RefreshCw, Zap, Bluetooth } from 'lucide-react';
import { TauriCommands } from '../../api/tauri-commands';

interface CandidateNode {
  type: 'USB' | 'NET';
  id: string;
  label: string;
  transport?: 'usb-serial' | 'usb-mass-storage' | 'network' | 'bluetooth-serial';
  hardware_profile?: string;
}

interface AssetRadarProps {
  onActivate: (asset: CandidateNode) => void;
  scanning: boolean;
  setScanning: (scanning: boolean) => void;
}

const RALPHIE_USB_HINTS = [
  'ralphie',
  'heltec',
  'esp32',
  'esp-32',
  'rp2040',
  'rp2',
  'pico',
  'uf2',
  'arduino',
  'cp210',
  'ftdi',
  'ch340',
  'silicon labs',
];

const RALPHIE_NET_HINTS = ['ralphie', 'coderalphie', 'aethercore', 'raspberry pi'];
const RALPHIE_BT_HINTS = ['ralphie', 'esp32', 'heltec', 'pico', 'rp2040', 'aethercore'];
const SCAN_TIMEOUT_MS = 15000;

const isBluetoothAsset = (asset: CandidateNode): boolean => {
  if (asset.transport === 'bluetooth-serial') {
    return true;
  }
  const descriptor = `${asset.label} ${asset.id}`.toLowerCase();
  return descriptor.includes('bluetooth') || descriptor.includes('ble');
};

const isRalphieCandidate = (asset: CandidateNode): boolean => {
  const descriptor = `${asset.label} ${asset.id}`.toLowerCase();

  if (isBluetoothAsset(asset)) {
    return RALPHIE_BT_HINTS.some((hint) => descriptor.includes(hint));
  }

  if (asset.type === 'USB') {
    return RALPHIE_USB_HINTS.some((hint) => descriptor.includes(hint));
  }

  if (asset.type === 'NET') {
    return RALPHIE_NET_HINTS.some((hint) => descriptor.includes(hint));
  }

  return false;
};

export const AssetRadar: React.FC<AssetRadarProps> = ({
  onActivate,
  scanning,
  setScanning,
}) => {
  const [assets, setAssets] = useState<CandidateNode[]>([]);
  const [discoveredAssets, setDiscoveredAssets] = useState<CandidateNode[]>([]);
  const [error, setError] = useState<string>('');
  const [eligibilityNotice, setEligibilityNotice] = useState<string>('');
  const [lastScanAt, setLastScanAt] = useState<Date | null>(null);
  const activeScanIdRef = useRef(0);
  const isMountedRef = useRef(true);

  const scanAssets = async () => {
    const scanId = activeScanIdRef.current + 1;
    activeScanIdRef.current = scanId;
    setScanning(true);
    setError('');
    setEligibilityNotice('');
    let timeoutHandle: ReturnType<typeof setTimeout> | null = null;

    try {
      const scanPromise = TauriCommands.scanForAssets().then((result) => {
        if (!result.success) {
          throw new Error(result.error);
        }
        return result.data;
      });
      const timeoutPromise = new Promise<never>((_, reject) => {
        timeoutHandle = setTimeout(() => {
          reject(
            new Error(
              `FAIL-VISIBLE: Scan timed out after ${
                SCAN_TIMEOUT_MS / 1000
              }s while probing USB, Wi-Fi, and Bluetooth channels.`,
            ),
          );
        }, SCAN_TIMEOUT_MS);
      });

      const discovered = await Promise.race([scanPromise, timeoutPromise]);
      if (!isMountedRef.current || activeScanIdRef.current !== scanId) {
        return;
      }

      setDiscoveredAssets(discovered);
      const ralphieCandidates = discovered.filter(isRalphieCandidate);
      const ignoredCount = discovered.length - ralphieCandidates.length;

      if (ignoredCount > 0) {
        setEligibilityNotice(
          `FAIL-VISIBLE: ${ignoredCount} detected asset${
            ignoredCount === 1 ? '' : 's'
          } ignored because identity could not be confirmed as RalphieNode compatible.`,
        );
      }

      setAssets(ralphieCandidates);
      setLastScanAt(new Date());
    } catch (err) {
      if (!isMountedRef.current || activeScanIdRef.current !== scanId) {
        return;
      }
      setError(err instanceof Error ? err.message : String(err));
      setDiscoveredAssets([]);
      setAssets([]);
    } finally {
      if (timeoutHandle) {
        clearTimeout(timeoutHandle);
      }
      if (isMountedRef.current && activeScanIdRef.current === scanId) {
        setScanning(false);
      }
    }
  };

  const cancelScan = () => {
    activeScanIdRef.current += 1;
    setScanning(false);
    setError(
      'FAIL-VISIBLE: Scan cancelled by operator. You can safely rescan when the host interfaces are stable.',
    );
  };

  // Auto-scan on mount
  useEffect(() => {
    isMountedRef.current = true;
    scanAssets();

    return () => {
      isMountedRef.current = false;
      activeScanIdRef.current += 1;
    };
  }, []);

  const usbCount = discoveredAssets.filter((asset) => asset.type === 'USB' && !isBluetoothAsset(asset)).length;
  const networkCount = discoveredAssets.filter((asset) => asset.type === 'NET' || asset.transport === 'network').length;
  const bluetoothCount = discoveredAssets.filter(isBluetoothAsset).length;

  return (
    <div className="space-y-6" data-testid="asset-radar">
      {/* Header */}
      <div className="text-center">
        <h3 className="font-display text-2xl text-tungsten mb-2">Asset Sonar</h3>
        <p className="text-tungsten/70">
          Detecting RalphieNode-compatible hardware on USB, Wi-Fi, and Bluetooth
        </p>
        {lastScanAt && (
          <p className="text-xs text-tungsten/50 mt-2">
            Last scan: {lastScanAt.toLocaleTimeString()}
          </p>
        )}
      </div>

      {/* Scan Coverage */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2" data-testid="asset-scan-coverage">
        <div className="p-3 rounded-lg border border-tungsten/20 bg-carbon/30 flex items-center justify-between">
          <span className="text-xs font-mono text-tungsten/70">USB</span>
          <span className="text-sm font-semibold text-overmatch">
            {scanning ? 'SCAN' : usbCount}
          </span>
        </div>
        <div className="p-3 rounded-lg border border-tungsten/20 bg-carbon/30 flex items-center justify-between">
          <span className="text-xs font-mono text-tungsten/70">WI-FI/LAN</span>
          <span className="text-sm font-semibold text-overmatch">
            {scanning ? 'SCAN' : networkCount}
          </span>
        </div>
        <div className="p-3 rounded-lg border border-tungsten/20 bg-carbon/30 flex items-center justify-between">
          <span className="text-xs font-mono text-tungsten/70">BLUETOOTH</span>
          <span className="text-sm font-semibold text-overmatch">
            {scanning ? 'SCAN' : bluetoothCount}
          </span>
        </div>
      </div>

      {/* Scan Control */}
      <div className="flex justify-center gap-3">
        <button
          onClick={scanAssets}
          disabled={scanning}
          data-testid="rescan-assets-button"
          className="px-6 py-3 bg-overmatch/10 hover:bg-overmatch/20 border border-overmatch/50 rounded-lg transition-colors flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <RefreshCw
            size={20}
            className={`text-overmatch ${scanning ? 'animate-spin' : ''}`}
          />
          <span className="text-overmatch font-medium">
            {scanning ? 'SCANNING...' : 'RESCAN'}
          </span>
        </button>
        {scanning && (
          <button
            onClick={cancelScan}
            className="px-6 py-3 bg-jamming/10 hover:bg-jamming/20 border border-jamming/40 rounded-lg transition-colors text-jamming font-medium"
          >
            CANCEL
          </button>
        )}
      </div>

      {/* Error Display */}
      {error && (
        <div
          className="p-4 bg-jamming/10 border border-jamming/30 rounded-lg"
          data-testid="asset-scan-error"
        >
          <p className="text-jamming text-sm">{error}</p>
        </div>
      )}

      {/* Eligibility Notice */}
      {eligibilityNotice && !error && (
        <div
          className="p-4 bg-overmatch/10 border border-overmatch/30 rounded-lg"
          data-testid="asset-eligibility-notice"
        >
          <p className="text-overmatch text-sm">{eligibilityNotice}</p>
        </div>
      )}

      {/* Asset List */}
      {!scanning && assets.length === 0 && !error && (
        <div className="text-center py-12" data-testid="no-ralphie-assets">
          <div className="text-tungsten/40 mb-3">
            <svg
              className="w-16 h-16 mx-auto"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1.5}
                d="M9.172 16.172a4 4 0 015.656 0M9 10h.01M15 10h.01M12 12h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
              />
            </svg>
          </div>
          <p className="text-tungsten/60">No RalphieNodes detected</p>
          <p className="text-tungsten/40 text-sm mt-2">
            Connect a RalphieNode over USB or ensure a RalphieNode Pi is reachable on-network
          </p>
        </div>
      )}

      {/* Scanning Animation */}
      {scanning && assets.length === 0 && (
        <div className="text-center py-12">
          <div className="relative w-24 h-24 mx-auto mb-4">
            {/* Sonar Pulse Animation */}
            <div className="absolute inset-0 rounded-full border-2 border-overmatch animate-ping opacity-75" />
            <div className="absolute inset-2 rounded-full border-2 border-overmatch animate-ping opacity-50 animation-delay-150" />
            <div className="absolute inset-4 rounded-full border-2 border-overmatch animate-ping opacity-25 animation-delay-300" />
            <div className="absolute inset-0 flex items-center justify-center">
              <Zap size={32} className="text-overmatch" />
            </div>
          </div>
          <p className="text-tungsten/70 animate-pulse">Scanning USB, Wi-Fi, and Bluetooth...</p>
        </div>
      )}

      {/* Detected Assets Grid */}
      {assets.length > 0 && (
        <div className="space-y-3">
          {assets.map((asset, index) => (
            <div
              key={`${asset.type}-${asset.id}-${index}`}
              data-testid={`asset-candidate-${index}`}
              className="group relative p-4 bg-carbon/30 border border-tungsten/10 hover:border-overmatch/50 rounded-lg transition-all flex items-center gap-4"
            >
              {/* Icon */}
              <div className="flex-shrink-0 w-12 h-12 rounded-full bg-overmatch/10 flex items-center justify-center">
                {asset.type === 'USB' && !isBluetoothAsset(asset) ? (
                  <Usb size={24} className="text-overmatch" />
                ) : isBluetoothAsset(asset) ? (
                  <Bluetooth size={24} className="text-overmatch" />
                ) : (
                  <Wifi size={24} className="text-overmatch" />
                )}
              </div>

              {/* Info */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-xs font-mono px-2 py-0.5 bg-tungsten/10 text-tungsten/70 rounded">
                    {asset.type}
                  </span>
                  {asset.transport && (
                    <span className="text-xs font-mono px-2 py-0.5 bg-tungsten/10 text-tungsten/70 rounded">
                      {asset.transport.toUpperCase()}
                    </span>
                  )}
                  <span className="text-xs font-mono px-2 py-0.5 bg-overmatch/10 text-overmatch rounded">
                    RALPHIENODE
                  </span>
                </div>
                <h4 className="font-display text-tungsten font-medium truncate">
                  {asset.label}
                </h4>
                <p className="text-xs text-tungsten/50 font-mono truncate">
                  {asset.id}
                </p>
                {asset.hardware_profile && (
                  <p className="text-xs text-tungsten/40 font-mono truncate mt-1">
                    profile: {asset.hardware_profile}
                  </p>
                )}
              </div>

              {/* Activate Button */}
              <button
                onClick={() => onActivate(asset)}
                data-testid={`activate-asset-${index}`}
                className="flex-shrink-0 px-6 py-2 bg-overmatch hover:bg-overmatch/90 text-carbon font-display font-bold rounded-lg transition-all transform hover:scale-105 shadow-lg hover:shadow-overmatch/50"
              >
                ACTIVATE
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
