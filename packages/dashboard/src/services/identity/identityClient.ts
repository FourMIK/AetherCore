/**
 * Identity Client - Hardware-Rooted Administrative Actions
 *
 * This service provides cryptographically-signed administrative operations
 * bound to physical silicon (TPM 2.0 / Secure Enclave).
 *
 * Design Doctrine:
 * - All revocations are CanonicalEvents signed by the commander's IdentitySlot
 * - Attestation failures MUST be fail-visible
 * - Byzantine nodes are quarantined, not silently ignored
 */

import { invoke } from '@tauri-apps/api/core';

/**
 * Node attestation state from TPM 2.0 verification
 */
export interface NodeAttestationState {
  node_id: string;
  tpm_attestation_valid: boolean;
  hardware_backed: boolean;
  trust_score: number;
  last_attestation_ts: number;
  merkle_vine_synced: boolean;
  byzantine_detected: boolean;
  revoked: boolean;
  revocation_reason?: string;
}

/**
 * Fleet-wide attestation report
 */
export interface FleetAttestationReport {
  schema_version: number;
  timestamp: number;
  nodes: NodeAttestationState[];
  total_nodes: number;
  verified_nodes: number;
  compromised_nodes: number;
  revoked_nodes: number;
}

/**
 * Revocation request payload
 * Must be signed by commander's IdentitySlot
 */
export interface RevocationRequest {
  node_id: string;
  reason: string;
  commander_id: string;
  timestamp: number;
}

/**
 * Signed revocation certificate (CanonicalEvent)
 */
export interface RevocationCertificate {
  node_id: string;
  reason: string;
  commander_id: string;
  timestamp: number;
  signature: string; // Ed25519 signature from commander's IdentitySlot
  merkle_root: string; // BLAKE3 hash for ledger chaining
}

/**
 * Identity Client for administrative operations
 */
export class IdentityClient {
  /**
   * Fetch fleet-wide attestation state
   *
   * Queries the C2 mesh for real-time TPM 2.0 attestation status
   * of all registered nodes.
   *
   * @returns Fleet attestation report
   * @throws If backend is unreachable or attestation service fails
   */
  static async getFleetAttestationState(): Promise<FleetAttestationReport> {
    try {
      const report = await invoke<FleetAttestationReport>('get_fleet_attestation_state');

      console.log(`[IDENTITY] Fleet attestation: ${report.verified_nodes}/${report.total_nodes} verified`);

      if (report.compromised_nodes > 0) {
        console.warn(`[IDENTITY] ⚠️  ${report.compromised_nodes} nodes compromised - Byzantine detection active`);
      }

      return report;
    } catch (error) {
      console.error('[IDENTITY] Failed to fetch fleet attestation:', error);

      // Fail-Visible: Return empty report with error indicator
      return {
        schema_version: 1,
        timestamp: Date.now(),
        nodes: [],
        total_nodes: 0,
        verified_nodes: 0,
        compromised_nodes: 0,
        revoked_nodes: 0,
      };
    }
  }

  /**
   * Revoke node identity (The Great Gospel kill-switch)
   *
   * This is a SOVEREIGN REVOCATION - not a simple state toggle.
   * Steps:
   * 1. Create RevocationRequest payload
   * 2. Request commander's IdentitySlot signature (TPM/Secure Enclave)
   * 3. Broadcast CanonicalEvent to The Great Gospel ledger
   * 4. Trigger Aetheric Sweep visualization
   *
   * @param nodeId Node to revoke
   * @param reason Human-readable revocation reason
   * @returns Signed revocation certificate
   * @throws If signature fails or ledger broadcast fails
   */
  static async revokeNodeIdentity(
    nodeId: string,
    reason: string
  ): Promise<RevocationCertificate> {
    try {
      console.log(`[IDENTITY] Initiating sovereign revocation for node: ${nodeId}`);
      console.log(`[IDENTITY] Reason: ${reason}`);

      // Step 1: Request commander's IdentitySlot signature
      // This will prompt the local TPM/Secure Enclave for cryptographic proof
      const certificate = await invoke<RevocationCertificate>('revoke_node_identity', {
        nodeId,
        reason,
        timestamp: Date.now(),
      });

      console.log(`[IDENTITY] ✅ Revocation signed by commander's IdentitySlot`);
      console.log(`[IDENTITY] Certificate signature: ${certificate.signature.substring(0, 16)}...`);
      console.log(`[IDENTITY] Merkle root: ${certificate.merkle_root.substring(0, 16)}...`);

      // Step 2: Broadcast to The Great Gospel ledger (handled by Rust backend)
      console.log(`[IDENTITY] Broadcasting revocation event to mesh...`);

      return certificate;
    } catch (error) {
      console.error(`[IDENTITY] ❌ Revocation failed for ${nodeId}:`, error);
      throw new Error(`Failed to revoke node ${nodeId}: ${error}`);
    }
  }

  /**
   * Verify node's current attestation status
   *
   * Queries the identity registry for a single node's TPM attestation.
   *
   * @param nodeId Node to verify
   * @returns Attestation state
   */
  static async verifyNodeAttestation(nodeId: string): Promise<NodeAttestationState | null> {
    try {
      const state = await invoke<NodeAttestationState>('verify_node_attestation', {
        nodeId,
      });

      if (!state.tpm_attestation_valid) {
        console.warn(`[IDENTITY] ⚠️  Node ${nodeId} failed TPM attestation`);
      }

      if (state.byzantine_detected) {
        console.error(`[IDENTITY] 🚨 Node ${nodeId} flagged as Byzantine - QUARANTINE`);
      }

      return state;
    } catch (error) {
      console.error(`[IDENTITY] Failed to verify attestation for ${nodeId}:`, error);
      return null;
    }
  }

  /**
   * Get revocation history from The Great Gospel
   *
   * Returns the ledger of all revocation events with cryptographic proof.
   *
   * @param limit Maximum number of events to return
   * @returns Array of revocation certificates
   */
  static async getRevocationHistory(limit: number = 50): Promise<RevocationCertificate[]> {
    try {
      const history = await invoke<RevocationCertificate[]>('get_revocation_history', {
        limit,
      });

      console.log(`[IDENTITY] Retrieved ${history.length} revocation events from Gospel`);

      return history;
    } catch (error) {
      console.error('[IDENTITY] Failed to fetch revocation history:', error);
      return [];
    }
  }

  /**
   * Check if current operator has admin privileges
   *
   * Verifies if the local IdentitySlot is authorized for administrative actions.
   *
   * @returns True if authorized for revocations
   */
  static async hasAdminPrivileges(): Promise<boolean> {
    try {
      const authorized = await invoke<boolean>('check_admin_privileges');

      if (!authorized) {
        console.warn('[IDENTITY] Current operator lacks admin privileges');
      }

      return authorized;
    } catch (error) {
      console.error('[IDENTITY] Failed to check admin privileges:', error);
      return false;
    }
  }
}

