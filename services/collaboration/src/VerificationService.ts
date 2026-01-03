/**
 * VerificationService - Ed25519 Signature Verification
 * 
 * Integrates with crates/identity registry to verify hardware-backed signatures
 * This is the Trust Fabric enforcement layer
 * 
 * ARCHITECTURAL INVARIANTS (4MIK):
 * - Fail-Visible: Returns VerificationStatus for ALL data
 * - No Production Mocks: MockIdentityRegistry is TEST ONLY
 * - BLAKE3 Only: No SHA-256 permitted
 * - Hardware Root: Signatures must be TPM-backed (CodeRalphie)
 */

import {
  SignedEnvelope,
  SignedEnvelopeSchema,
  NodeID,
  SecurityEvent,
  VerificationStatus,
} from '@aethercore/shared';
import * as crypto from 'crypto';

/**
 * Mock Identity Registry Interface
 * 
 * ⚠️ PRODUCTION WARNING ⚠️
 * This interface represents the production gRPC/FFI interface to crates/identity.
 * MockIdentityRegistry (below) is for TESTING ONLY and must NEVER be used in production.
 * 
 * Production implementation:
 * - Must use gRPC calls to crates/identity service
 * - Must verify TPM-backed signatures (CodeRalphie)
 * - Must enforce hardware root-of-trust
 * - Must return STATUS_UNVERIFIED for any enrollment failures
 */
interface IdentityRegistry {
  getPublicKey(nodeId: NodeID): Promise<string | null>;
  isNodeEnrolled(nodeId: NodeID): Promise<boolean>;
}

/**
 * Security Event Handler Interface
 */
interface SecurityEventHandler {
  logEvent(event: SecurityEvent): void;
}

/**
 * VerificationService
 * Verifies SignedEnvelope signatures against the identity registry
 * 
 * Fail-Visible Design: Returns explicit verification status for all data
 */
export class VerificationService {
  constructor(
    private identityRegistry: IdentityRegistry,
    private eventHandler: SecurityEventHandler,
  ) {}

  /**
   * Verify a SignedEnvelope (Fail-Visible Design)
   * 
   * Returns object with:
   * - status: VERIFIED | STATUS_UNVERIFIED | SPOOFED
   * - payload: parsed payload if VERIFIED, null otherwise
   * - reason: failure reason if not VERIFIED
   * 
   * A node with broken cryptographic chain is an ADVERSARY, not a degraded peer.
   */
  async verifyEnvelope(envelope: SignedEnvelope): Promise<{
    status: VerificationStatus;
    payload: any | null;
    reason?: string;
  }> {
    try {
      // Validate schema
      const validated = SignedEnvelopeSchema.parse(envelope);

      // Check if node is enrolled
      const isEnrolled = await this.identityRegistry.isNodeEnrolled(
        validated.nodeId,
      );
      if (!isEnrolled) {
        this.logSecurityEvent('unknown_node', validated.nodeId, 'high', {
          envelope,
        });
        return {
          status: 'STATUS_UNVERIFIED',
          payload: null,
          reason: 'Node not enrolled in identity registry',
        };
      }

      // Get public key from identity registry
      const publicKey = await this.identityRegistry.getPublicKey(
        validated.nodeId,
      );
      if (!publicKey) {
        this.logSecurityEvent('unknown_node', validated.nodeId, 'high', {
          envelope,
        });
        return {
          status: 'STATUS_UNVERIFIED',
          payload: null,
          reason: 'Public key not found for enrolled node',
        };
      }

      // Verify timestamp (prevent replay attacks - check within 5 minutes)
      const now = Date.now();
      const timeDiff = Math.abs(now - validated.timestamp);
      if (timeDiff > 5 * 60 * 1000) {
        this.logSecurityEvent('replay_attack', validated.nodeId, 'high', {
          envelope,
          timeDiff,
        });
        return {
          status: 'SPOOFED',
          payload: null,
          reason: `Replay attack detected: timestamp outside 5min window (${timeDiff}ms)`,
        };
      }

      // Verify Ed25519 signature
      const isValid = this.verifyEd25519Signature(
        validated.payload,
        validated.signature,
        publicKey,
      );

      if (!isValid) {
        this.logSecurityEvent('invalid_signature', validated.nodeId, 'critical', {
          envelope,
        });
        return {
          status: 'SPOOFED',
          payload: null,
          reason: 'Invalid Ed25519 signature - Byzantine node detected',
        };
      }

      // Parse and return payload
      try {
        const payload = JSON.parse(validated.payload);
        return {
          status: 'VERIFIED',
          payload,
        };
      } catch (error) {
        this.logSecurityEvent('invalid_signature', validated.nodeId, 'medium', {
          envelope,
          error: 'Invalid JSON payload',
        });
        return {
          status: 'SPOOFED',
          payload: null,
          reason: 'Invalid JSON payload in signed envelope',
        };
      }
    } catch (error) {
      this.logSecurityEvent('invalid_signature', null, 'medium', {
        error: error instanceof Error ? error.message : String(error),
      });
      return {
        status: 'STATUS_UNVERIFIED',
        payload: null,
        reason: `Schema validation failed: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  /**
   * Verify Ed25519 signature
   * 
   * ⚠️ PRODUCTION WARNING ⚠️
   * This is a MOCK implementation for development/testing ONLY.
   * 
   * Production implementation MUST:
   * - Call crates/crypto via gRPC/FFI for Ed25519 verification
   * - Use TPM-backed keys (CodeRalphie) - keys never in system memory
   * - Use BLAKE3 for any hashing (NO SHA-256)
   * - Enforce hardware root-of-trust
   * 
   * Current implementation is a placeholder that checks signature format only.
   */
  private verifyEd25519Signature(
    payload: string,
    signatureHex: string,
    publicKeyHex: string,
  ): boolean {
    try {
      // Convert hex to buffers
      const signature = Buffer.from(signatureHex, 'hex');
      const publicKey = Buffer.from(publicKeyHex, 'hex');
      const message = Buffer.from(payload, 'utf-8');

      // MOCK IMPLEMENTATION - Development/Testing Only
      // Production: gRPC call to crates/crypto for TPM-backed Ed25519 verification
      // 
      // Example production call:
      // const result = await cryptoService.verifyEd25519({
      //   message: message,
      //   signature: signature,
      //   publicKey: publicKey,
      // });
      // return result.isValid;

      // For now, validate signature format (64 bytes) and public key format (32 bytes)
      // This allows development/testing to proceed while TPM integration is completed
      return signature.length === 64 && publicKey.length === 32;
    } catch (error) {
      return false;
    }
  }

  /**
   * Log a security event
   */
  private logSecurityEvent(
    type: SecurityEvent['type'],
    nodeId: NodeID | null,
    severity: SecurityEvent['severity'],
    metadata?: Record<string, unknown>,
  ): void {
    const event: SecurityEvent = {
      type,
      nodeId,
      description: this.getEventDescription(type),
      severity,
      timestamp: Date.now(),
      metadata,
    };

    this.eventHandler.logEvent(event);
  }

  /**
   * Get human-readable description for security event
   */
  private getEventDescription(type: SecurityEvent['type']): string {
    const descriptions: Record<SecurityEvent['type'], string> = {
      invalid_signature: 'Invalid Ed25519 signature on SignedEnvelope',
      unknown_node: 'NodeID not found in identity registry',
      replay_attack: 'Timestamp outside acceptable window (replay attack)',
      integrity_violation: 'Stream integrity hash mismatch',
      unauthorized_access: 'Unauthorized access attempt',
    };
    return descriptions[type];
  }

  /**
   * Create a signed envelope
   * This would be used by clients to sign their messages
   * 
   * NOTE: In production, the signing would happen in crates/crypto
   * using the TPM-backed hardware key
   */
  static async createSignedEnvelope(
    payload: any,
    nodeId: NodeID,
    privateKeyHex: string,
  ): Promise<SignedEnvelope> {
    const payloadStr = JSON.stringify(payload);
    const timestamp = Date.now();
    const nonce = crypto.randomBytes(16).toString('hex');

    // In production, this would call into crates/crypto/TPM
    // to sign with the hardware key
    const signature = crypto.randomBytes(64).toString('hex');

    return {
      payload: payloadStr,
      signature,
      nodeId,
      timestamp,
      nonce,
    };
  }
}

/**
 * Mock Identity Registry Implementation
 * 
 * ⚠️⚠️⚠️ CRITICAL WARNING - TEST ONLY ⚠️⚠️⚠️
 * 
 * This is a MOCK implementation for development and testing ONLY.
 * NEVER use in production deployments.
 * 
 * Production MUST use:
 * - gRPC/FFI calls to crates/identity service
 * - TPM-backed enrollment (CodeRalphie)
 * - Hardware root-of-trust verification
 * - The Great Gospel for revocation checks
 * 
 * A production system using MockIdentityRegistry has NO TRUST FABRIC.
 * All nodes are potential adversaries without hardware-backed identity.
 */
export class MockIdentityRegistry implements IdentityRegistry {
  private registry: Map<NodeID, string> = new Map();

  constructor() {
    // Emit warning on every instantiation
    console.warn('═'.repeat(80));
    console.warn('⚠️  MOCK IDENTITY REGISTRY ACTIVE - TEST MODE ONLY');
    console.warn('⚠️  NO HARDWARE ROOT-OF-TRUST');
    console.warn('⚠️  NO TPM VERIFICATION');
    console.warn('⚠️  TRUST FABRIC DISABLED');
    console.warn('⚠️  DO NOT USE IN PRODUCTION');
    console.warn('═'.repeat(80));
  }

  async getPublicKey(nodeId: NodeID): Promise<string | null> {
    return this.registry.get(nodeId) || null;
  }

  async isNodeEnrolled(nodeId: NodeID): Promise<boolean> {
    return this.registry.has(nodeId);
  }

  registerNode(nodeId: NodeID, publicKeyHex: string): void {
    this.registry.set(nodeId, publicKeyHex);
  }
}

/**
 * Console Security Event Handler
 */
export class ConsoleSecurityEventHandler implements SecurityEventHandler {
  logEvent(event: SecurityEvent): void {
    const timestamp = new Date(event.timestamp).toISOString();
    console.error(
      `[SECURITY EVENT] [${event.severity.toUpperCase()}] ${timestamp} - ${event.type}`,
    );
    console.error(`  NodeID: ${event.nodeId || 'unknown'}`);
    console.error(`  Description: ${event.description}`);
    if (event.metadata) {
      console.error(`  Metadata:`, JSON.stringify(event.metadata, null, 2));
    }
  }
}
