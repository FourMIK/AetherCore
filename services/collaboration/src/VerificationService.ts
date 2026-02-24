/**
 * VerificationService - Ed25519 Signature Verification (Production)
 * 
 * Integrates with crates/identity registry via gRPC for hardware-backed signature verification.
 * This is the Trust Fabric enforcement layer - NO MOCKS, NO GRACEFUL DEGRADATION.
 * 
 * Security Model:
 * - If identity service fails, nodes are BYZANTINE (fail-visible)
 * - All signature failures are logged as CRITICAL security events
 * - Replay attacks are prevented via timestamp windows (5 minutes)
 */

import {
  SignedEnvelope,
  SignedEnvelopeSchema,
  NodeID,
  SecurityEvent,
} from '@aethercore/shared';
import { IdentityRegistryClient } from './IdentityRegistryClient';

/**
 * Custom error for Identity Registry failures
 * Used to distinguish between re-thrown gRPC errors and other errors
 */
class IdentityRegistryError extends Error {
  constructor(message: string, public readonly originalError?: Error) {
    super(message);
    this.name = 'IdentityRegistryError';
  }
}

/**
 * Security Event Handler Interface
 */
interface SecurityEventHandler {
  logEvent(event: SecurityEvent): void;
}

/**
 * VerificationService (Production)
 * Verifies SignedEnvelope signatures against the gRPC Identity Registry
 */
export class VerificationService {
  constructor(
    private identityRegistryClient: IdentityRegistryClient,
    private eventHandler: SecurityEventHandler,
  ) {}

  /**
   * Verify a SignedEnvelope
   * Returns the parsed payload if valid, null if invalid
   * 
   * FAIL-VISIBLE: If identity service is unreachable, throws error
   */
  async verifyEnvelope(envelope: SignedEnvelope): Promise<any | null> {
    try {
      // Validate schema
      const validated = SignedEnvelopeSchema.parse(envelope);

      // Check if node is enrolled (gRPC call with retries)
      let isEnrolled: boolean;
      try {
        isEnrolled = await this.identityRegistryClient.isNodeEnrolled(
          validated.nodeId,
        );
      } catch (error) {
        // FAIL-VISIBLE: Identity service unreachable
        this.logSecurityEvent(
          'unauthorized_access',
          validated.nodeId,
          'critical',
          {
            envelope,
            error: error instanceof Error ? error.message : String(error),
            context: 'Identity Registry unreachable - treating as Byzantine',
          },
        );
        throw new IdentityRegistryError(
          'Identity Registry unreachable',
          error instanceof Error ? error : undefined
        );
      }

      if (!isEnrolled) {
        this.logSecurityEvent('unknown_node', validated.nodeId, 'high', {
          envelope,
        });
        return null;
      }

      // Verify signature via gRPC (includes timestamp and nonce verification)
      const payload = Buffer.from(validated.payload, 'utf-8');
      let verificationResult: {
        isValid: boolean;
        failureReason?: string;
        securityEventType?: string;
      };

      try {
        verificationResult =
          await this.identityRegistryClient.verifySignature(
            validated.nodeId,
            payload,
            validated.signature,
            validated.timestamp,
            validated.nonce,
          );
      } catch (error) {
        // FAIL-VISIBLE: Verification service failure
        this.logSecurityEvent(
          'invalid_signature',
          validated.nodeId,
          'critical',
          {
            envelope,
            error: error instanceof Error ? error.message : String(error),
            context: 'Signature verification service failure',
          },
        );
        throw new IdentityRegistryError(
          'Signature verification service failure',
          error instanceof Error ? error : undefined
        );
      }

      if (!verificationResult.isValid) {
        // Map security event type from gRPC response
        const eventType =
          (verificationResult.securityEventType as SecurityEvent['type']) ||
          'invalid_signature';

        this.logSecurityEvent(eventType, validated.nodeId, 'critical', {
          envelope,
          failureReason: verificationResult.failureReason,
        });
        return null;
      }

      // Parse and return payload
      try {
        return JSON.parse(validated.payload);
      } catch (error) {
        this.logSecurityEvent('invalid_signature', validated.nodeId, 'medium', {
          envelope,
          error: 'Invalid JSON payload',
        });
        return null;
      }
    } catch (error) {
      // If error is an IdentityRegistryError, it was already logged and should be re-thrown
      if (error instanceof IdentityRegistryError) {
        throw error;
      }

      // Otherwise, log it as a generic security event
      this.logSecurityEvent('invalid_signature', null, 'medium', {
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
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
      unauthorized_access:
        'Unauthorized access attempt or identity service failure',
    };
    return descriptions[type];
  }
}

/**
 * Console Security Event Handler (Fail-Visible)
 * 
 * Logs security events to console with high visibility.
 * In production, this would also:
 * - Send alerts to Tactical Glass dashboard
 * - Write to secure audit log
 * - Trigger automated response (Aetheric Sweep)
 */
export class ConsoleSecurityEventHandler implements SecurityEventHandler {
  logEvent(event: SecurityEvent): void {
    const timestamp = new Date(event.timestamp).toISOString();
    
    // High-visibility logging for security events
    const logLine = `[SECURITY EVENT] [${event.severity.toUpperCase()}] ${timestamp} - ${event.type}`;
    
    if (event.severity === 'critical' || event.severity === 'high') {
      console.error('='.repeat(80));
      console.error(logLine);
      console.error('='.repeat(80));
    } else {
      console.warn(logLine);
    }
    
    console.error(`  NodeID: ${event.nodeId || 'unknown'}`);
    console.error(`  Description: ${event.description}`);
    
    if (event.metadata) {
      console.error(`  Metadata:`, JSON.stringify(event.metadata, null, 2));
    }
    
    if (event.severity === 'critical' || event.severity === 'high') {
      console.error('='.repeat(80));
    }
  }
}
