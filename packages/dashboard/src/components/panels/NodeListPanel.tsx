/**
 * NodeListPanel
 * Sortable/filterable node list with domain and status filters
 *
 * Design Doctrine:
 * - Fail-Visible attestation rendering (red UNVERIFIED/SPOOFED for crypto failures)
 * - The Great Gospel kill-switch (hardware-signed revocations)
 * - Byzantine nodes visually quarantined (glaring red state)
 */

import React, { useState, useMemo } from 'react';
import { Search, Filter, ShieldX, AlertTriangle, Shield } from 'lucide-react';
import { GlassPanel } from '../hud/GlassPanel';
import { useTacticalStore } from '../../store/useTacticalStore';
import { useCommStore } from '../../store/useCommStore';
import { IdentityClient, type RevocationCertificate } from '../../services/identity/identityClient';
import { createSigningClient } from '../../services/identity';

export const NodeListPanel: React.FC = () => {
  const nodes = useTacticalStore((s) => s.nodes) || new Map();
  const selectedNodeId = useTacticalStore((s) => s.selectedNodeId);
  const selectNode = useTacticalStore((s) => s.selectNode);
  const markNodeAsRevoked = useTacticalStore((s) => s.markNodeAsRevoked);
  const recordRevocation = useTacticalStore((s) => s.recordRevocation);
  const currentOperatorId = useCommStore((s) => s.currentOperator?.id);

  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'online' | 'offline' | 'degraded' | 'compromised' | 'revoked'>('all');
  const [domainFilter, setDomainFilter] = useState('');
  const [revokingNodeId, setRevokingNodeId] = useState<string | null>(null);

  const filteredNodes = useMemo(() => {
    let filtered = Array.from(nodes.values());

    // Search filter
    if (searchTerm) {
      filtered = filtered.filter(
        (node) =>
          node.id.toLowerCase().includes(searchTerm.toLowerCase()) ||
          node.domain.toLowerCase().includes(searchTerm.toLowerCase())
      );
    }

    // Status filter
    if (statusFilter !== 'all') {
      filtered = filtered.filter((node) => node.status === statusFilter);
    }

    // Domain filter
    if (domainFilter) {
      filtered = filtered.filter((node) =>
        node.domain.toLowerCase().includes(domainFilter.toLowerCase())
      );
    }

    return filtered;
  }, [nodes, searchTerm, statusFilter, domainFilter]);

  /**
   * Get status badge with fail-visible rendering
   * - Compromised nodes: RED UNVERIFIED
   * - Revoked nodes: GHOST REVOKED
   * - TPM attestation failure: RED SPOOFED
   */
  const getStatusBadge = (node: typeof filteredNodes[0]) => {
    if (node.revoked) {
      return { className: 'badge-danger', label: 'REVOKED' };
    }
    if (node.byzantineDetected) {
      return { className: 'badge-danger', label: 'BYZANTINE' };
    }
    if (node.tpmAttestationValid === false) {
      return { className: 'badge-danger', label: 'SPOOFED' };
    }
    if (!node.verified || node.integrityCompromised) {
      return { className: 'badge-danger', label: 'UNVERIFIED' };
    }
    if (node.status === 'online') {
      return { className: 'badge-success', label: 'ONLINE' };
    }
    if (node.status === 'degraded') {
      return { className: 'badge-warning', label: 'DEGRADED' };
    }
    if (node.status === 'compromised') {
      return { className: 'badge-danger', label: 'COMPROMISED' };
    }
    return { className: 'badge-info', label: 'OFFLINE' };
  };

  /**
   * The Great Gospel Kill-Switch
   *
   * Executes sovereign revocation with hardware-signed CanonicalEvent:
   * 1. Prompts user for revocation reason
   * 2. Invokes commander's IdentitySlot for Ed25519 signature
   * 3. Broadcasts CanonicalEvent to mesh ledger
   * 4. Triggers Aetheric Sweep visualization
   */
  const handleRevokeNode = async (nodeId: string) => {
    if (!confirm(`⚠️  SOVEREIGN REVOCATION\n\nYou are about to revoke node: ${nodeId}\n\nThis action:\n- Broadcasts a signed CanonicalEvent to The Great Gospel\n- Requires your hardware IdentitySlot signature\n- Is IRREVERSIBLE and logged in the mesh ledger\n\nProceed?`)) {
      return;
    }

    const reason = prompt('Enter revocation reason (will be permanently recorded):');
    if (!reason || reason.trim() === '') {
      alert('Revocation cancelled: reason is required');
      return;
    }

    setRevokingNodeId(nodeId);

    try {
      console.log(`[GOSPEL] Initiating sovereign revocation for node: ${nodeId}`);

      const adminNodeId = currentOperatorId || useTacticalStore.getState().selectedNodeId;
      if (!adminNodeId) {
        throw new Error('No admin identity is active in this session');
      }

      const timestampMs = Date.now();
      const canonicalPayload = `${nodeId}${reason.trim()}${timestampMs}`;
      const signingClient = createSigningClient();
      let signatureHex = '';
      try {
        const signature = await signingClient.signMessage(
          adminNodeId,
          new TextEncoder().encode(canonicalPayload),
        );
        signatureHex = signature.signature_hex;
      } finally {
        signingClient.close();
      }

      // Step 1: Request hardware-signed revocation certificate
      const revoked = await IdentityClient.revokeNodeIdentity(nodeId, reason.trim(), {
        adminNodeId,
        timestampMs,
        authoritySignatureHex: signatureHex,
      });

      if (!revoked) {
        throw new Error('Revocation failed');
      }

      // Create revocation certificate
      const certificate: RevocationCertificate = {
        node_id: nodeId,
        revoked_at_ms: Date.now(),
        revocation_reason: reason.trim(),
        revoking_authority: adminNodeId,
        signature: signatureHex,
        timestamp_ms: Date.now(),
      };

      // Step 2: Update local state (Aetheric Sweep triggers here)
      markNodeAsRevoked(nodeId, reason.trim());

      // Step 3: Record in local revocation history
      recordRevocation(certificate);

      console.log(`[GOSPEL] ✅ Node ${nodeId} revoked successfully`);
      alert(`✅ Node revoked successfully\n\nNode: ${nodeId}\nSignature: ${certificate.signature.substring(0, 16)}...`);
    } catch (error) {
      console.error(`[GOSPEL] ❌ Revocation failed:`, error);
      alert(`❌ Revocation failed\n\n${error}\n\nEnsure your IdentitySlot is available and you have admin privileges.`);
    } finally {
      setRevokingNodeId(null);
    }
  };

  return (
    <GlassPanel variant="default" className="h-full flex flex-col">
      {/* Header */}
      <div className="p-4 border-b border-tungsten/10">
        <h3 className="font-display text-lg font-semibold text-tungsten mb-4">
          Fleet Node Registry
        </h3>

        {/* Search */}
        <div className="relative mb-3">
          <Search
            className="absolute left-3 top-1/2 transform -translate-y-1/2 text-tungsten/50"
            size={16}
          />
          <input
            type="text"
            placeholder="Search nodes..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-10 pr-4 py-2 bg-carbon/50 border border-tungsten/20 rounded-lg text-sm text-tungsten focus:outline-none focus:border-overmatch"
          />
        </div>

        {/* Filters */}
        <div className="flex flex-col sm:flex-row gap-2">
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as any)}
            className="flex-1 px-3 py-2 bg-carbon/50 border border-tungsten/20 rounded-lg text-sm text-tungsten focus:outline-none focus:border-overmatch"
          >
            <option value="all">All Status</option>
            <option value="online">Online</option>
            <option value="offline">Offline</option>
            <option value="degraded">Degraded</option>
            <option value="compromised">Compromised</option>
            <option value="revoked">Revoked</option>
          </select>

          <input
            type="text"
            placeholder="Domain..."
            value={domainFilter}
            onChange={(e) => setDomainFilter(e.target.value)}
            className="flex-1 px-3 py-2 bg-carbon/50 border border-tungsten/20 rounded-lg text-sm text-tungsten focus:outline-none focus:border-overmatch"
          />
        </div>
      </div>

      {/* Node List */}
      <div className="flex-1 min-h-0 overflow-y-auto p-4 pt-2 space-y-2">
        {filteredNodes.length === 0 ? (
          <div className="text-center text-tungsten/50 py-8">
            <Filter size={32} className="mx-auto mb-2 opacity-30" />
            <p className="text-sm">No nodes found</p>
          </div>
        ) : (
          filteredNodes.map((node) => {
            const statusBadge = getStatusBadge(node);
            const isCritical = node.byzantineDetected || node.revoked || !node.verified || node.integrityCompromised;
            const isExternalNode = node.readOnlyExternal === true || node.provenance === 'lattice.synthetic' || node.provenance === 'lattice.live';
            const canRevokeNode = !node.revoked && !isExternalNode;
            const freshnessLabel =
              typeof node.freshnessMs === 'number' && Number.isFinite(node.freshnessMs)
                ? `${Math.max(0, Math.round(node.freshnessMs / 1000))}s`
                : null;

            return (
              <GlassPanel
                key={node.id}
                variant="light"
                className={`p-3 cursor-pointer transition-all ${
                  selectedNodeId === node.id
                    ? 'border-overmatch ring-1 ring-overmatch/30'
                    : isCritical
                    ? 'border-red-400/50 bg-red-900/10'
                    : 'hover:border-tungsten/40'
                }`}
                onClick={() => selectNode(node.id)}
              >
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    {node.byzantineDetected && <AlertTriangle size={14} className="text-red-400" />}
                    {node.revoked && <ShieldX size={14} className="text-ghost" />}
                    {!node.revoked && node.verified && node.tpmAttestationValid && (
                      <Shield size={14} className="text-verified-green" />
                    )}
                    <span className="font-mono text-sm text-tungsten truncate">{node.id}</span>
                  </div>
                  <span className={`${statusBadge.className} text-xs flex-shrink-0`}>
                    {statusBadge.label}
                  </span>
                </div>

                <div className="flex items-center justify-between text-xs mb-2">
                  <span className="text-tungsten/70 truncate mr-2">{node.domain}</span>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    {node.sourceBadge && (
                      <span className="px-2 py-0.5 rounded bg-tungsten/15 text-tungsten/80">{node.sourceBadge}</span>
                    )}
                    {node.verificationStatus && (
                      <span
                        className={`px-2 py-0.5 rounded ${
                          node.verificationStatus === 'VERIFIED'
                            ? 'bg-verified-green/20 text-verified-green'
                            : node.verificationStatus === 'SPOOFED'
                            ? 'bg-red-500/20 text-red-400'
                            : 'bg-yellow-400/20 text-yellow-300'
                        }`}
                      >
                        {node.verificationStatus}
                      </span>
                    )}
                    {freshnessLabel && <span className="text-tungsten/60">fresh {freshnessLabel}</span>}
                    {node.tpmAttestationValid === false && (
                      <span className="text-red-400">TPM FAIL</span>
                    )}
                    {node.integrityCompromised && (
                      <span className="text-yellow-400">CHAIN BREAK</span>
                    )}
                    {node.verified && node.tpmAttestationValid !== false && (
                      <span className="text-verified-green">VERIFIED</span>
                    )}
                  </div>
                </div>

                {/* Trust Score Gauge */}
                <div className="mb-2">
                  <div className="trust-gauge">
                    <div
                      className={`trust-gauge-fill ${
                        node.trustScore >= 80
                          ? 'high'
                          : node.trustScore >= 50
                          ? 'medium'
                          : 'low'
                      }`}
                      style={{ width: `${node.trustScore}%` }}
                    />
                  </div>
                  <div className="flex justify-between mt-1">
                    <span className="text-xs text-tungsten/50">Trust Score</span>
                    <span className={`text-xs font-mono ${
                      node.trustScore >= 80
                        ? 'text-verified-green'
                        : node.trustScore >= 50
                        ? 'text-yellow-400'
                        : 'text-red-400'
                    }`}>
                      {Math.round(node.trustScore)}%
                    </span>
                  </div>
                </div>

                {/* Revocation Reason */}
                {node.revoked && node.revocationReason && (
                  <div className="text-xs text-red-400 bg-red-900/20 border border-red-400/30 rounded p-2 mb-2">
                    <div className="font-semibold">REVOKED</div>
                    <div className="text-tungsten/70 mt-1">{node.revocationReason}</div>
                  </div>
                )}

                {/* Byzantine Alert */}
                {node.byzantineDetected && (
                  <div className="text-xs text-red-400 bg-red-900/20 border border-red-400/30 rounded p-2 mb-2">
                    <div className="font-semibold">BYZANTINE DETECTED</div>
                    <div className="text-tungsten/70 mt-1">Node flagged for cryptographic audit failure</div>
                  </div>
                )}

                {isExternalNode && (
                  <div className="text-xs text-yellow-300 bg-yellow-500/10 border border-yellow-300/25 rounded p-2 mb-2">
                    External provenance: tactical controls remain read-only for this entity.
                  </div>
                )}

                {/* The Great Gospel Kill-Switch */}
                {canRevokeNode && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleRevokeNode(node.id);
                    }}
                    disabled={revokingNodeId === node.id}
                    className="w-full mt-2 px-3 py-1.5 rounded text-xs font-semibold bg-red-500/20 hover:bg-red-500/30 text-red-400 border border-red-400/30 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                  >
                    {revokingNodeId === node.id ? (
                      <>Signing revocation...</>
                    ) : (
                      <>
                        <ShieldX size={12} />
                        Revoke Identity (Gospel)
                      </>
                    )}
                  </button>
                )}

                {!canRevokeNode && !node.revoked && (
                  <button
                    type="button"
                    disabled
                    className="w-full mt-2 px-3 py-1.5 rounded text-xs font-semibold bg-tungsten/10 text-tungsten/50 border border-tungsten/20 cursor-not-allowed"
                  >
                    Revocation Locked (External Provenance)
                  </button>
                )}
              </GlassPanel>
            );
          })
        )}
      </div>
    </GlassPanel>
  );
};
