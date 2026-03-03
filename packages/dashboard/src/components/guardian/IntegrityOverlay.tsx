/**
 * IntegrityOverlay - Fail-Visible Security Alert
 * 
 * Displays "INTEGRITY COMPROMISED" blackout screen when stream integrity fails
 * TacticalGlass design system styling
 * 
 * FAIL-VISIBLE DESIGN:
 * - Immediately overlays video on integrity violation
 * - Shows frame statistics (valid/invalid/total)
 * - Provides termination option for Byzantine streams
 */

import React from 'react';
import { AlertTriangle, ShieldOff } from 'lucide-react';
import { IntegrityStatus } from '@aethercore/shared';

/**
 * IntegrityOverlay Props
 */
export interface IntegrityOverlayProps {
  status: IntegrityStatus;
  onDismiss?: () => void;
  onTerminate?: () => void;
}

/**
 * IntegrityOverlay React Component
 */
export const IntegrityOverlay: React.FC<IntegrityOverlayProps> = ({
  status,
  onDismiss,
  onTerminate,
}) => {
  if (!status.showAlert) return null;

  const severity = status.invalidFrames > 10 ? 'critical' : 'warning';
  const compromiseRate = status.totalFrames > 0
    ? Math.round((status.invalidFrames / status.totalFrames) * 100)
    : 0;

  return (
    <div
      className={`fixed inset-0 z-[9999] flex items-center justify-center backdrop-blur-2xl animate-in fade-in duration-300 ${
        severity === 'critical'
          ? 'bg-jamming/95'
          : 'bg-tungsten/90'
      }`}
    >
      <div className="max-w-2xl p-12 text-center">
        {/* Warning Icon */}
        <div className="w-32 h-32 mx-auto mb-8 animate-pulse">
          {severity === 'critical' ? (
            <ShieldOff size={128} className="text-white" strokeWidth={1.5} />
          ) : (
            <AlertTriangle size={128} className="text-white" strokeWidth={1.5} />
          )}
        </div>

        {/* Title */}
        <h1 className="font-display text-6xl font-black tracking-wider text-white uppercase mb-6 drop-shadow-2xl">
          INTEGRITY COMPROMISED
        </h1>

        {/* Message */}
        <p className="text-xl text-white/90 font-semibold leading-relaxed mb-8 drop-shadow-lg">
          Video stream integrity verification failed.
          <br />
          The incoming video may have been tampered with or injected.
        </p>

        {/* Stats */}
        <div className="flex gap-8 justify-center mb-8 p-6 bg-black/40 rounded-lg backdrop-blur-md border border-white/20">
          <div className="flex flex-col">
            <span className="text-sm font-bold text-white/70 uppercase tracking-wider mb-2">
              Invalid Frames
            </span>
            <span className="text-5xl font-black font-display text-white">
              {status.invalidFrames}
            </span>
          </div>

          <div className="flex flex-col">
            <span className="text-sm font-bold text-white/70 uppercase tracking-wider mb-2">
              Valid Frames
            </span>
            <span className="text-5xl font-black font-display text-white">
              {status.validFrames}
            </span>
          </div>

          <div className="flex flex-col">
            <span className="text-sm font-bold text-white/70 uppercase tracking-wider mb-2">
              Total Frames
            </span>
            <span className="text-5xl font-black font-display text-white">
              {status.totalFrames}
            </span>
          </div>
        </div>

        {/* Compromise Rate */}
        <div className="mb-8 p-4 bg-black/40 rounded-lg border border-white/20">
          <div className="text-sm font-bold text-white/70 uppercase tracking-wider mb-2">
            Compromise Rate
          </div>
          <div className="text-4xl font-black font-display text-white">
            {compromiseRate}%
          </div>
        </div>

        {/* Verification Status */}
        <div className="mb-8 p-4 bg-black/40 rounded-lg border border-white/20">
          <div className="text-sm font-bold text-white/70 uppercase tracking-wider mb-2">
            Verification Status
          </div>
          <div className="text-2xl font-black font-display text-white">
            {status.verificationStatus}
          </div>
        </div>

        {/* Actions */}
        <div className="flex gap-4 justify-center">
          {onTerminate && (
            <button
              onClick={onTerminate}
              className="px-8 py-4 bg-black/50 border-2 border-white text-white font-display font-bold text-lg uppercase tracking-wider rounded-lg hover:bg-white hover:text-jamming transition-all duration-200 hover:-translate-y-1 hover:shadow-2xl"
            >
              Terminate Connection
            </button>
          )}

          {onDismiss && (
            <button
              onClick={onDismiss}
              className="px-8 py-4 bg-white/10 border-2 border-white/40 text-white font-display font-bold text-lg uppercase tracking-wider rounded-lg hover:bg-white/20 transition-all duration-200"
            >
              Acknowledge
            </button>
          )}
        </div>

        {/* Warning Footer */}
        <div className="mt-8 p-4 bg-black/30 rounded-lg border border-white/10">
          <p className="text-xs text-white/60 leading-relaxed">
            <strong>FAIL-VISIBLE DESIGN:</strong> A node with broken cryptographic chain is an
            adversary, not a degraded peer. This stream has been flagged for Byzantine behavior.
          </p>
        </div>
      </div>
    </div>
  );
};
