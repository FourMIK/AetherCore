/**
 * AssetRadar
 * Sonar-style detection view for discoverable nodes (USB/Network)
 * Part of "One Interaction" doctrine: immediate visibility of all provisionable assets
 */

import React, { useEffect, useState } from 'react';
import { Usb, Wifi, RefreshCw, Zap } from 'lucide-react';
import { invoke } from '@tauri-apps/api/core';

interface CandidateNode {
  type: string; // "USB" or "NET"
  id: string;
  label: string;
}

interface AssetRadarProps {
  onActivate: (asset: CandidateNode) => void;
  scanning: boolean;
  setScanninig: (scanning: boolean) => void;
}

export const AssetRadar: React.FC<AssetRadarProps> = ({
  onActivate,
  scanning,
  setScanninig,
}) => {
  const [assets, setAssets] = useState<CandidateNode[]>([]);
  const [error, setError] = useState<string>('');

  const scanAssets = async () => {
    setScanninig(true);
    setError('');
    try {
      const discovered = await invoke<CandidateNode[]>('scan_for_assets');
      setAssets(discovered);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setAssets([]);
    } finally {
      setScanninig(false);
    }
  };

  // Auto-scan on mount
  useEffect(() => {
    scanAssets();
  }, []);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="text-center">
        <h3 className="font-display text-2xl text-tungsten mb-2">Asset Sonar</h3>
        <p className="text-tungsten/70">
          Detecting provisionable hardware on USB and Network
        </p>
      </div>

      {/* Scan Control */}
      <div className="flex justify-center">
        <button
          onClick={scanAssets}
          disabled={scanning}
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
      </div>

      {/* Error Display */}
      {error && (
        <div className="p-4 bg-jamming/10 border border-jamming/30 rounded-lg">
          <p className="text-jamming text-sm">{error}</p>
        </div>
      )}

      {/* Asset List */}
      {!scanning && assets.length === 0 && !error && (
        <div className="text-center py-12">
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
          <p className="text-tungsten/60">No assets detected</p>
          <p className="text-tungsten/40 text-sm mt-2">
            Connect USB devices or ensure Pis are on network
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
          <p className="text-tungsten/70 animate-pulse">Scanning environment...</p>
        </div>
      )}

      {/* Detected Assets Grid */}
      {assets.length > 0 && (
        <div className="space-y-3">
          {assets.map((asset, index) => (
            <div
              key={`${asset.type}-${asset.id}-${index}`}
              className="group relative p-4 bg-carbon/30 border border-tungsten/10 hover:border-overmatch/50 rounded-lg transition-all flex items-center gap-4"
            >
              {/* Icon */}
              <div className="flex-shrink-0 w-12 h-12 rounded-full bg-overmatch/10 flex items-center justify-center">
                {asset.type === 'USB' ? (
                  <Usb size={24} className="text-overmatch" />
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
                </div>
                <h4 className="font-display text-tungsten font-medium truncate">
                  {asset.label}
                </h4>
                <p className="text-xs text-tungsten/50 font-mono truncate">
                  {asset.id}
                </p>
              </div>

              {/* Activate Button */}
              <button
                onClick={() => onActivate(asset)}
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
