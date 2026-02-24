/**
 * AetherCore Mission Guardian Collaboration Service V2 (Production)
 * 
 * Secure Console-to-Console Video/Voice/Chat over Trust Fabric with Hardware-Backed Signatures
 * 
 * This service provides:
 * - WebRTC signaling with Ed25519 signature verification via gRPC
 * - Hardware-backed identity verification through crates/identity
 * - Fail-visible security event logging
 * - NO GRACEFUL DEGRADATION for security failures
 * 
 * Environment Variables:
 * - PORT: WebSocket server port (default: 8080)
 * - IDENTITY_REGISTRY_ADDRESS: gRPC address for Identity Registry (default: localhost:50051)
 * - USE_PRODUCTION: Set to 'true' to use production mode with gRPC (default: false)
 */

// Export production components
export * from './SignalingServerV2';
export { VerificationService, ConsoleSecurityEventHandler } from './VerificationServiceV2';
export * from './IdentityRegistryClient';

import { SignalingServerV2 } from './SignalingServerV2';

/**
 * Start the collaboration service (Production Mode with gRPC)
 * 
 * This is the production implementation that uses:
 * - gRPC-based Identity Registry (crates/identity)
 * - Hardware-backed Ed25519 signatures (CodeRalphie/TPM)
 * - Fail-visible security event logging
 */
export function startCollaborationService(
  port: number = 8080,
  identityRegistryAddress: string = 'localhost:50051',
): SignalingServerV2 {
  console.log('='.repeat(80));
  console.log('[CollaborationService] Starting Mission Guardian Collaboration Service');
  console.log('[CollaborationService] PRODUCTION MODE - Hardware-backed signatures enabled');
  console.log('='.repeat(80));

  const server = new SignalingServerV2({
    port,
    identityRegistryAddress,
  });

  console.log('[CollaborationService] Mission Guardian ready on port', port);
  console.log(`[CollaborationService] Identity Registry: ${identityRegistryAddress}`);

  return server;
}
