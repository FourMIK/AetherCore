/**
 * VerificationPanel
 * Inline verification status with trust score gauge
 */

import React from 'react';
import { Shield, AlertTriangle } from 'lucide-react';
import { GlassPanel } from '../hud/GlassPanel';
import { TrustScoreGauge } from './TrustScoreGauge';
import { HashVisualizer } from '../hud/HashVisualizer';

interface VerificationPanelProps {
  verified: boolean;
  trustScore?: number;
  attestationHash?: string;
  lastVerified?: Date;
  className?: string;
}

export const VerificationPanel: React.FC<VerificationPanelProps> = ({
  verified,
  trustScore = 0,
  attestationHash,
  lastVerified,
  className = '',
}) => {
  return (
    <GlassPanel variant="light" className={`p-4 ${className}`}>
      <div className="space-y-4">
        {/* Verification Status */}
        <div className="flex items-center gap-3">
          {verified ? (
            <>
              <Shield className="text-verified-green" size={24} />
              <div>
                <div className="font-semibold text-verified-green">
                  Verified
                </div>
                {lastVerified && (
                  <div className="text-xs text-tungsten/50">
                    Last verified: {lastVerified.toLocaleString()}
                  </div>
                )}
              </div>
            </>
          ) : (
            <>
              <AlertTriangle className="text-jamming" size={24} />
              <div>
                <div className="font-semibold text-jamming">
                  Unverified
                </div>
                <div className="text-xs text-tungsten/50">
                  Cryptographic verification failed
                </div>
              </div>
            </>
          )}
        </div>

        {/* Trust Score */}
        {verified && <TrustScoreGauge score={trustScore} />}

        {/* Attestation Hash */}
        {attestationHash && (
          <div className="space-y-1">
            <div className="text-xs text-tungsten/50">Attestation Hash</div>
            <HashVisualizer hash={attestationHash} length={16} />
          </div>
        )}
      </div>
    </GlassPanel>
  );
};
