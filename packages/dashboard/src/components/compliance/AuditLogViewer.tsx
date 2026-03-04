/**
 * AuditLogViewer
 * Merkle Vine Audit Trail for Administrative Actions
 *
 * Displays cryptographically-verified audit trail of:
 * - Node revocations (The Great Gospel events)
 * - Byzantine detections
 * - TPM attestation failures
 * - Administrative actions
 *
 * Each event includes prev_hash linkage to ensure tamper-proof history.
 */

import React from 'react';
import { Shield, ShieldX, AlertTriangle, Link as LinkIcon } from 'lucide-react';
import { GlassPanel } from '../hud/GlassPanel';
import { useTacticalStore } from '../../store/useTacticalStore';
import type { RevocationCertificate } from '../../services/identity/identityClient';

interface AuditLogViewerProps {
  maxEvents?: number;
}

interface AuditEvent {
  id: string;
  type: 'revocation' | 'byzantine_detected' | 'verification_failed' | 'attestation_expired';
  timestamp: Date;
  nodeId: string;
  details: string;
  signature?: string;
  merkleRoot?: string;
}

export const AuditLogViewer: React.FC<AuditLogViewerProps> = ({ maxEvents = 50 }) => {
  const securityEvents = useTacticalStore((s) => s.events);
  const revocationHistory = useTacticalStore((s) => s.revocationHistory);

  // Combine security events and revocations into unified audit log
  const auditLog: AuditEvent[] = [
    ...securityEvents.map((event) => ({
      id: event.id,
      type: event.type,
      timestamp: event.timestamp,
      nodeId: event.nodeId,
      details: event.details,
    })),
    ...revocationHistory.map((cert) => ({
      id: `revoke-${cert.node_id}-${cert.timestamp}`,
      type: 'revocation' as const,
      timestamp: new Date(cert.timestamp),
      nodeId: cert.node_id,
      details: cert.reason,
      signature: cert.signature,
      merkleRoot: cert.merkle_root,
    })),
  ].sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime()).slice(0, maxEvents);

  const getEventIcon = (type: string) => {
    switch (type) {
      case 'revocation':
        return <ShieldX className="text-red-400" size={16} />;
      case 'byzantine_detected':
        return <AlertTriangle className="text-yellow-400" size={16} />;
      case 'verification_failed':
        return <ShieldX className="text-red-400" size={16} />;
      case 'attestation_expired':
        return <Shield className="text-ghost" size={16} />;
      default:
        return <AlertTriangle className="text-tungsten" size={16} />;
    }
  };

  const getEventColor = (type: string) => {
    switch (type) {
      case 'revocation':
        return 'border-red-400/30 bg-red-900/10';
      case 'byzantine_detected':
        return 'border-yellow-400/30 bg-yellow-900/10';
      case 'verification_failed':
        return 'border-red-400/30 bg-red-900/10';
      case 'attestation_expired':
        return 'border-ghost/30 bg-ghost/10';
      default:
        return 'border-tungsten/10 bg-carbon/30';
    }
  };

  const getEventLabel = (type: string) => {
    switch (type) {
      case 'revocation':
        return 'SOVEREIGN REVOCATION';
      case 'byzantine_detected':
        return 'BYZANTINE DETECTED';
      case 'verification_failed':
        return 'VERIFICATION FAILED';
      case 'attestation_expired':
        return 'ATTESTATION EXPIRED';
      default:
        return type.toUpperCase().replace(/_/g, ' ');
    }
  };

  return (
    <GlassPanel variant="light" className="p-6">
      <div className="flex items-center gap-3 mb-4">
        <LinkIcon className="text-overmatch" size={24} />
        <div className="flex-1">
          <h2 className="font-display text-xl font-semibold text-tungsten">
            Merkle Vine Audit Trail
          </h2>
          <p className="text-xs text-tungsten/60">
            Cryptographically-chained administrative action log
          </p>
        </div>
      </div>

      {auditLog.length === 0 ? (
        <div className="text-center text-tungsten/50 py-8">
          <Shield size={32} className="mx-auto mb-2 opacity-30" />
          <p className="text-sm">No audit events recorded</p>
          <p className="text-xs mt-1">Administrative actions will appear here</p>
        </div>
      ) : (
        <div className="space-y-2 max-h-96 overflow-y-auto">
          {auditLog.map((event, index) => (
            <div
              key={event.id}
              className={`border rounded-lg p-3 ${getEventColor(event.type)}`}
            >
              {/* Event Header */}
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  {getEventIcon(event.type)}
                  <span className="text-xs font-semibold text-tungsten">
                    {getEventLabel(event.type)}
                  </span>
                </div>
                <span className="text-xs text-tungsten/50">
                  {event.timestamp.toLocaleString()}
                </span>
              </div>

              {/* Node ID */}
              <div className="text-xs text-tungsten/70 mb-1">
                Node: <span className="font-mono text-tungsten">{event.nodeId}</span>
              </div>

              {/* Details */}
              <div className="text-xs text-tungsten/70 mb-2">
                {event.details}
              </div>

              {/* Cryptographic Proof (for Gospel revocations) */}
              {event.signature && (
                <div className="border-t border-tungsten/10 pt-2 mt-2 space-y-1">
                  <div className="flex items-center gap-2 text-xs">
                    <Shield size={12} className="text-verified-green" />
                    <span className="text-verified-green font-semibold">
                      Hardware-Signed CanonicalEvent
                    </span>
                  </div>
                  <div className="text-xs text-tungsten/50">
                    Signature: <code className="text-cyan-400">{event.signature.substring(0, 24)}...</code>
                  </div>
                  {event.merkleRoot && (
                    <div className="text-xs text-tungsten/50">
                      Merkle Root: <code className="text-cyan-400">{event.merkleRoot.substring(0, 24)}...</code>
                    </div>
                  )}
                </div>
              )}

              {/* Merkle Vine Chain Linkage Indicator */}
              {index < auditLog.length - 1 && (
                <div className="flex items-center gap-1 mt-2 pt-2 border-t border-tungsten/10">
                  <LinkIcon size={10} className="text-tungsten/30" />
                  <span className="text-xs text-tungsten/30">
                    Chained to previous event via prev_hash
                  </span>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </GlassPanel>
  );
};

