/**
 * MerkleChainIndicator - Fail-Visible Verification Status
 * 
 * Displays cryptographic verification status for messages and events.
 * 
 * FAIL-VISIBLE DESIGN:
 * - VERIFIED: Green shield with checkmark
 * - STATUS_UNVERIFIED: Yellow shield with question mark
 * - SPOOFED: Red shield with X (Byzantine node detected)
 * 
 * This component ensures operators ALWAYS see the trust state of data.
 * Unverified or spoofed data is immediately visible.
 */

import React, { useState } from 'react';
import { Shield, ShieldCheck, ShieldAlert, ShieldOff, AlertTriangle, Info } from 'lucide-react';
import type { VerificationStatus } from '@aethercore/shared';

export interface MerkleChainIndicatorProps {
  /** Verification status from Trust Fabric */
  verificationStatus: VerificationStatus;
  
  /** Whether hash chain is valid */
  chainValid: boolean;
  
  /** Optional failure reason */
  failureReason?: string;
  
  /** Chain height (optional, for detailed view) */
  chainHeight?: number;
  
  /** Show detailed tooltip on hover */
  showDetails?: boolean;
  
  /** Size variant */
  size?: 'sm' | 'md' | 'lg';
}

/**
 * MerkleChainIndicator Component
 * 
 * Visual indicator for message/event verification status.
 * Follows Fail-Visible design: all states are explicit and color-coded.
 */
export const MerkleChainIndicator: React.FC<MerkleChainIndicatorProps> = ({
  verificationStatus,
  chainValid,
  failureReason,
  chainHeight,
  showDetails = true,
  size = 'sm',
}) => {
  const [showTooltip, setShowTooltip] = useState(false);

  // Size mappings
  const iconSize = size === 'lg' ? 24 : size === 'md' ? 18 : 14;
  const textSize = size === 'lg' ? 'text-sm' : size === 'md' ? 'text-xs' : 'text-[10px]';

  /**
   * Get visual properties based on verification status
   */
  const getStatusProps = () => {
    if (!chainValid || verificationStatus === 'SPOOFED') {
      return {
        icon: ShieldOff,
        color: 'text-jamming',
        bgColor: 'bg-jamming/20',
        borderColor: 'border-jamming',
        label: 'SPOOFED',
        description: 'Invalid signature or broken hash chain. Byzantine behavior detected.',
        severity: 'critical' as const,
      };
    }

    if (verificationStatus === 'STATUS_UNVERIFIED') {
      return {
        icon: ShieldAlert,
        color: 'text-tungsten',
        bgColor: 'bg-tungsten/20',
        borderColor: 'border-tungsten',
        label: 'UNVERIFIED',
        description: 'Missing signature or unable to verify. Enrollment may be pending.',
        severity: 'warning' as const,
      };
    }

    // VERIFIED
    return {
      icon: ShieldCheck,
      color: 'text-verified-green',
      bgColor: 'bg-verified-green/20',
      borderColor: 'border-verified-green',
      label: 'VERIFIED',
      description: 'Valid cryptographic signature from enrolled node with hardware root-of-trust.',
      severity: 'success' as const,
    };
  };

  const status = getStatusProps();
  const Icon = status.icon;

  /**
   * Render compact indicator (icon only)
   */
  if (!showDetails) {
    return (
      <div className="relative inline-block">
        <div
          className={`${status.color}`}
          onMouseEnter={() => setShowTooltip(true)}
          onMouseLeave={() => setShowTooltip(false)}
        >
          <Icon size={iconSize} />
        </div>

        {/* Tooltip */}
        {showTooltip && (
          <div className="absolute z-50 bottom-full left-1/2 transform -translate-x-1/2 mb-2 w-64">
            <div className={`rounded-lg border ${status.borderColor} ${status.bgColor} backdrop-blur-md p-3 shadow-lg`}>
              <div className="flex items-center gap-2 mb-2">
                <Icon size={16} className={status.color} />
                <span className={`font-mono font-semibold ${textSize} ${status.color}`}>
                  {status.label}
                </span>
              </div>
              <p className="text-xs text-tungsten/70 leading-relaxed">
                {status.description}
              </p>
              {failureReason && (
                <div className="mt-2 pt-2 border-t border-tungsten/10">
                  <div className="flex items-start gap-2">
                    <AlertTriangle size={12} className="text-jamming flex-shrink-0 mt-0.5" />
                    <span className="text-xs text-jamming leading-relaxed">
                      {failureReason}
                    </span>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    );
  }

  /**
   * Render detailed indicator (badge with label)
   */
  return (
    <div className="relative inline-block">
      <div
        className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border ${status.borderColor} ${status.bgColor} backdrop-blur-sm transition-all hover:shadow-lg cursor-default`}
        onMouseEnter={() => setShowTooltip(true)}
        onMouseLeave={() => setShowTooltip(false)}
      >
        <Icon size={iconSize} className={status.color} />
        <span className={`font-mono font-semibold ${textSize} ${status.color} uppercase tracking-wide`}>
          {status.label}
        </span>
        {chainHeight !== undefined && (
          <>
            <div className={`w-px h-4 ${status.bgColor}`} />
            <div className="flex items-center gap-1">
              <Info size={12} className="text-tungsten/50" />
              <span className="text-xs text-tungsten/50 font-mono">
                #{chainHeight}
              </span>
            </div>
          </>
        )}
      </div>

      {/* Detailed Tooltip */}
      {showTooltip && (
        <div className="absolute z-50 top-full left-0 mt-2 w-80">
          <div className={`rounded-lg border ${status.borderColor} ${status.bgColor} backdrop-blur-md p-4 shadow-xl`}>
            <div className="flex items-center gap-2 mb-3">
              <Icon size={20} className={status.color} />
              <span className={`font-mono font-semibold text-sm ${status.color}`}>
                {status.label}
              </span>
            </div>

            <p className="text-xs text-tungsten/70 leading-relaxed mb-3">
              {status.description}
            </p>

            <div className="space-y-2">
              <div className="flex items-center justify-between text-xs">
                <span className="text-tungsten/50">Chain Valid:</span>
                <span className={chainValid ? 'text-verified-green' : 'text-jamming'}>
                  {chainValid ? 'Yes' : 'No'}
                </span>
              </div>

              {chainHeight !== undefined && (
                <div className="flex items-center justify-between text-xs">
                  <span className="text-tungsten/50">Chain Height:</span>
                  <span className="text-tungsten font-mono">#{chainHeight}</span>
                </div>
              )}

              <div className="flex items-center justify-between text-xs">
                <span className="text-tungsten/50">Signature Type:</span>
                <span className="text-tungsten font-mono">Ed25519</span>
              </div>

              <div className="flex items-center justify-between text-xs">
                <span className="text-tungsten/50">Hash Algorithm:</span>
                <span className="text-tungsten font-mono">BLAKE3</span>
              </div>
            </div>

            {failureReason && (
              <div className="mt-3 pt-3 border-t border-tungsten/10">
                <div className="flex items-start gap-2">
                  <AlertTriangle size={14} className="text-jamming flex-shrink-0 mt-0.5" />
                  <div>
                    <div className="text-xs font-semibold text-jamming mb-1">
                      Verification Failed
                    </div>
                    <div className="text-xs text-jamming/80 leading-relaxed">
                      {failureReason}
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Fail-Visible Philosophy Note */}
            <div className="mt-3 pt-3 border-t border-tungsten/10">
              <div className="flex items-start gap-2">
                <Info size={12} className="text-tungsten/30 flex-shrink-0 mt-0.5" />
                <p className="text-[10px] text-tungsten/30 leading-relaxed">
                  Fail-Visible Design: All data streams must be explicitly marked.
                  A node with broken cryptographic chain is an adversary, not a degraded peer.
                </p>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

/**
 * Inline verification badge (minimal variant for message bubbles)
 */
export const InlineVerificationBadge: React.FC<{
  verificationStatus: VerificationStatus;
  chainValid: boolean;
}> = ({ verificationStatus, chainValid }) => {
  if (!chainValid || verificationStatus === 'SPOOFED') {
    return (
      <div className="flex items-center gap-1 text-jamming">
        <ShieldOff size={12} />
        <span className="text-[10px] font-mono font-bold">SPOOFED</span>
      </div>
    );
  }

  if (verificationStatus === 'STATUS_UNVERIFIED') {
    return (
      <div className="flex items-center gap-1 text-tungsten/50">
        <ShieldAlert size={12} />
        <span className="text-[10px] font-mono">UNVERIFIED</span>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-1 text-verified-green">
      <ShieldCheck size={12} />
      <span className="text-[10px] font-mono">✓</span>
    </div>
  );
};
