/**
 * IdentitySlot
 * Node identity and CodeRalphie credentials display
 * TPM-rooted CodeRalphie hardware identity with cryptographic proofs
 */

import React from 'react';
import { Shield, Check, AlertCircle, Copy } from 'lucide-react';
import { MateriaSlot, MateriaSlotConfig } from './MateriaSlot';

export interface CodeRalphieCredential {
  /** Credential type */
  type: 'endorsement_key' | 'attestation_key' | 'storage_key' | 'signing_key';
  /** Public key (PEM or hex encoded) */
  publicKey: string;
  /** Creation timestamp */
  createdAt: number;
  /** Last used timestamp */
  lastUsed?: number;
  /** Key algorithm */
  algorithm: string;
  /** Curve (if applicable) */
  curve?: string;
  /** Activation status */
  active: boolean;
}

export interface IdentitySlotConfig extends MateriaSlotConfig {
  type: 'identity';
  /** Node ID */
  nodeId: string;
  /** Human-readable node name */
  nodeName?: string;
  /** Public identity key (hex encoded) */
  publicIdentityKey: string;
  /** CodeRalphie credentials */
  credentials: CodeRalphieCredential[];
  /** Trust score (0-100) */
  trustScore: number;
  /** Onboarded/Verified status */
  verified: boolean;
  /** Squad or organization association */
  organization?: string;
  /** Optional role/designation */
  role?: string;
}

export interface IdentitySlotProps {
  config: IdentitySlotConfig;
  onClose?: () => void;
  onMinimize?: () => void;
  onCopyKey?: (key: string) => void;
}

/**
 * IdentitySlot Component
 * Displays CodeRalphie hardware identity with TPM credentials
 */
export const IdentitySlot: React.FC<IdentitySlotProps> = ({
  config,
  onClose,
  onMinimize,
  onCopyKey,
}) => {
  const handleCopyKey = (key: string) => {
    navigator.clipboard.writeText(key);
    onCopyKey?.(key);
  };

  const getTrustColor = (score: number): string => {
    if (score >= 80) return 'text-verified-green';
    if (score >= 50) return 'text-ghost';
    return 'text-jamming';
  };

  const formatKey = (key: string): string => {
    if (key.length <= 24) return key;
    return `${key.substring(0, 12)}...${key.slice(-8)}`;
  };

  return (
    <MateriaSlot
      config={{
        ...config,
        type: 'identity',
        description: `Node Identity${config.role ? ` • ${config.role}` : ''}`,
      }}
      onClose={onClose}
      onMinimize={onMinimize}
    >
      <div className="flex flex-col gap-4 h-full">
        {/* Node Header */}
        <div className="border-b border-tungsten/10 pb-4">
          <div className="flex items-start justify-between mb-3">
            <div className="flex-1">
              <h4 className="text-lg font-mono font-bold text-tungsten">
                {config.nodeName || config.nodeId}
              </h4>
              <p className="text-xs text-tungsten/50 mt-1">{config.nodeId}</p>
            </div>

            {/* Verification Badge */}
            <div
              className={`flex items-center gap-1 px-2 py-1 rounded text-xs font-semibold ${
                config.verified
                  ? 'bg-verified-green/10 text-verified-green'
                  : 'bg-jamming/10 text-jamming'
              }`}
            >
              {config.verified ? (
                <>
                  <Check size={12} />
                  VERIFIED
                </>
              ) : (
                <>
                  <AlertCircle size={12} />
                  UNVERIFIED
                </>
              )}
            </div>
          </div>

          {/* Organization & Role */}
          {(config.organization || config.role) && (
            <div className="text-xs text-tungsten/70 space-y-1">
              {config.organization && (
                <div>Organization: <span className="text-tungsten">{config.organization}</span></div>
              )}
              {config.role && (
                <div>Role: <span className="text-tungsten">{config.role}</span></div>
              )}
            </div>
          )}
        </div>

        {/* Trust Score */}
        <div className="bg-carbon/50 border border-tungsten/10 rounded-lg p-3">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm text-tungsten/70">Trust Score</span>
            <span className={`text-2xl font-mono font-bold ${getTrustColor(config.trustScore)}`}>
              {config.trustScore}%
            </span>
          </div>

          {/* Trust Bar */}
          <div className="h-2 bg-carbon border border-tungsten/10 rounded-full overflow-hidden">
            <div
              className={`h-full transition-all ${getTrustColor(config.trustScore).replace('text', 'bg')}`}
              style={{ width: `${config.trustScore}%` }}
            />
          </div>
        </div>

        {/* Public Identity Key */}
        <div>
          <div className="text-xs text-tungsten/70 mb-2 flex items-center gap-1">
            <Shield size={14} />
            Public Identity Key
          </div>
          <div className="bg-carbon/50 border border-tungsten/10 rounded-lg p-2 flex items-center justify-between group">
            <code className="text-xs text-tungsten/80 font-mono break-all flex-1">
              {formatKey(config.publicIdentityKey)}
            </code>
            <button
              onClick={() => handleCopyKey(config.publicIdentityKey)}
              className="ml-2 p-1 opacity-0 group-hover:opacity-100 hover:bg-tungsten/10 rounded transition-all"
              title="Copy full key"
            >
              <Copy size={14} className="text-tungsten/70" />
            </button>
          </div>
        </div>

        {/* CodeRalphie Credentials */}
        <div className="flex-1 overflow-auto">
          <div className="text-xs text-tungsten/70 mb-2 flex items-center gap-1">
            <Shield size={14} />
            CodeRalphie Credentials ({config.credentials.length})
          </div>

          {config.credentials.length === 0 ? (
            <div className="text-center text-tungsten/50 py-4">
              No credentials provisioned
            </div>
          ) : (
            <div className="space-y-2">
              {config.credentials.map((cred, index) => (
                <div
                  key={index}
                  className="bg-carbon/50 border border-tungsten/10 rounded p-2 space-y-1"
                >
                  {/* Credential Header */}
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <div
                        className={`w-2 h-2 rounded-full ${cred.active ? 'bg-verified-green' : 'bg-tungsten/30'}`}
                      />
                      <span className="text-xs font-mono text-tungsten font-semibold">
                        {cred.type.replace(/_/g, ' ').toUpperCase()}
                      </span>
                    </div>
                    <span className="text-xs text-tungsten/50">
                      {cred.algorithm}
                      {cred.curve && ` (${cred.curve})`}
                    </span>
                  </div>

                  {/* Key Preview */}
                  <div className="bg-carbon/30 rounded p-1 font-mono text-xs text-tungsten/60 break-all">
                    {formatKey(cred.publicKey)}
                  </div>

                  {/* Metadata */}
                  <div className="text-xs text-tungsten/50 space-y-0.5">
                    <div>Created: {new Date(cred.createdAt).toLocaleDateString()}</div>
                    {cred.lastUsed && (
                      <div>
                        Last Used: {new Date(cred.lastUsed).toLocaleDateString()}
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </MateriaSlot>
  );
};

export default IdentitySlot;
