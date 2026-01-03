/**
 * BioSlot
 * Biometric sensor data visualization
 * TPM attestation and real-time health telemetry
 */

import React, { useState, useEffect } from 'react';
import { Activity, Heart, Gauge, Droplet } from 'lucide-react';
import { MateriaSlot, MateriaSlotConfig } from './MateriaSlot';
import { Sparkline } from '../components/hud/Sparkline';

export interface BioMetrics {
  /** Heart rate in BPM */
  heartRate?: number;
  /** Oxygen saturation percentage */
  spO2?: number;
  /** Body temperature in Celsius */
  temperature?: number;
  /** Blood pressure (systolic/diastolic) */
  bloodPressure?: { systolic: number; diastolic: number };
  /** Respiratory rate */
  respRate?: number;
  /** TPM attestation status */
  tpmAttestation: {
    verified: boolean;
    hashAlgorithm: string;
    chainLength: number;
  };
  /** Timestamp in milliseconds */
  timestamp: number;
}

export interface BioSlotConfig extends MateriaSlotConfig {
  type: 'bio';
  /** Node ID providing biometrics */
  nodeId: string;
  /** Current metrics */
  metrics: BioMetrics;
  /** Historical data for sparklines */
  history?: number[];
}

export interface BioSlotProps {
  config: BioSlotConfig;
  onClose?: () => void;
  onMinimize?: () => void;
  onMetricsUpdate?: (metrics: BioMetrics) => void;
}

/**
 * BioSlot Component
 * Real-time biometric display with TPM attestation indicators
 */
export const BioSlot: React.FC<BioSlotProps> = ({
  config,
  onClose,
  onMinimize,
}) => {
  const [updateTime, setUpdateTime] = useState(new Date(config.metrics.timestamp));

  useEffect(() => {
    setUpdateTime(new Date(config.metrics.timestamp));
  }, [config.metrics.timestamp]);

  const getHealthStatus = (): 'critical' | 'warning' | 'normal' => {
    const hr = config.metrics.heartRate;
    const spO2 = config.metrics.spO2;

    if (hr && (hr < 40 || hr > 120)) return 'critical';
    if (spO2 && spO2 < 94) return 'critical';
    if (hr && (hr < 50 || hr > 100)) return 'warning';
    if (spO2 && spO2 < 96) return 'warning';
    return 'normal';
  };

  const healthStatus = getHealthStatus();
  const statusColors = {
    critical: 'text-jamming',
    warning: 'text-ghost',
    normal: 'text-verified-green',
  };

  return (
    <MateriaSlot
      config={{
        ...config,
        type: 'bio',
        description: `Biometrics • Node: ${config.nodeId}`,
      }}
      onClose={onClose}
      onMinimize={onMinimize}
    >
      <div className="flex flex-col gap-4 h-full">
        {/* Health Status Header */}
        <div className="flex items-center gap-2">
          <Activity size={20} className={statusColors[healthStatus]} />
          <span className={`text-sm font-semibold ${statusColors[healthStatus]}`}>
            {healthStatus.toUpperCase()}
          </span>
          <span className="text-xs text-tungsten/50 ml-auto">
            {updateTime.toLocaleTimeString()}
          </span>
        </div>

        {/* Primary Metrics Grid */}
        <div className="grid grid-cols-2 gap-3">
          {/* Heart Rate */}
          {config.metrics.heartRate !== undefined && (
            <div className="bg-carbon/50 border border-tungsten/10 rounded-lg p-3">
              <div className="flex items-center gap-2 mb-2">
                <Heart size={16} className="text-jamming" />
                <span className="text-xs text-tungsten/70">Heart Rate</span>
              </div>
              <div className="text-2xl font-mono font-bold text-tungsten">
                {config.metrics.heartRate}
              </div>
              <div className="text-xs text-tungsten/50">BPM</div>
              {config.history && (
                <Sparkline
                  data={config.history}
                  color="rgb(255, 42, 42)"
                  height={30}
                />
              )}
            </div>
          )}

          {/* Oxygen Saturation */}
          {config.metrics.spO2 !== undefined && (
            <div className="bg-carbon/50 border border-tungsten/10 rounded-lg p-3">
              <div className="flex items-center gap-2 mb-2">
                <Droplet size={16} className="text-overmatch" />
                <span className="text-xs text-tungsten/70">SpO₂</span>
              </div>
              <div className="text-2xl font-mono font-bold text-tungsten">
                {config.metrics.spO2}
              </div>
              <div className="text-xs text-tungsten/50">%</div>
            </div>
          )}
        </div>

        {/* Secondary Metrics */}
        <div className="space-y-2 text-sm">
          {config.metrics.temperature !== undefined && (
            <div className="flex justify-between items-center p-2 bg-carbon/30 rounded">
              <span className="text-tungsten/70">Temperature</span>
              <span className="font-mono text-tungsten">
                {config.metrics.temperature.toFixed(1)}°C
              </span>
            </div>
          )}

          {config.metrics.bloodPressure && (
            <div className="flex justify-between items-center p-2 bg-carbon/30 rounded">
              <span className="text-tungsten/70">Blood Pressure</span>
              <span className="font-mono text-tungsten">
                {config.metrics.bloodPressure.systolic}/{config.metrics.bloodPressure.diastolic}
              </span>
            </div>
          )}

          {config.metrics.respRate !== undefined && (
            <div className="flex justify-between items-center p-2 bg-carbon/30 rounded">
              <span className="text-tungsten/70">Resp. Rate</span>
              <span className="font-mono text-tungsten">
                {config.metrics.respRate} /min
              </span>
            </div>
          )}
        </div>

        {/* TPM Attestation */}
        <div className="mt-auto pt-3 border-t border-tungsten/10">
          <div className="text-xs space-y-1">
            <div className="flex justify-between items-center">
              <span className="text-tungsten/70">TPM Attestation</span>
              <div
                className={`flex items-center gap-1 ${
                  config.metrics.tpmAttestation.verified
                    ? 'text-verified-green'
                    : 'text-jamming'
                }`}
              >
                <div
                  className={`w-2 h-2 rounded-full ${
                    config.metrics.tpmAttestation.verified
                      ? 'bg-verified-green'
                      : 'bg-jamming'
                  }`}
                />
                {config.metrics.tpmAttestation.verified ? 'Verified' : 'Unverified'}
              </div>
            </div>
            <div className="text-tungsten/50">
              Algorithm: {config.metrics.tpmAttestation.hashAlgorithm}
            </div>
            <div className="text-tungsten/50">
              Chain Length: {config.metrics.tpmAttestation.chainLength}
            </div>
          </div>
        </div>
      </div>
    </MateriaSlot>
  );
};

export default BioSlot;
