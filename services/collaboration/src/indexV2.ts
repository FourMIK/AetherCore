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

// Export legacy mock components (DEPRECATED)
export { SignalingServer } from './SignalingServer';
export { VerificationService as VerificationServiceLegacy, MockIdentityRegistry, ConsoleSecurityEventHandler as ConsoleSecurityEventHandlerLegacy } from './VerificationService';

// Export production components
export * from './SignalingServerV2';
export { VerificationService, ConsoleSecurityEventHandler } from './VerificationServiceV2';
export * from './IdentityRegistryClient';

import { SignalingServer } from './SignalingServer';
import { MockIdentityRegistry } from './VerificationService';
import { SignalingServerV2 } from './SignalingServerV2';

/**
 * Start the collaboration service (Legacy Mock Mode - DEPRECATED)
 * 
 * WARNING: This uses mock signatures and should NEVER be used in production!
 */
export function startCollaborationService(
  port: number = 8080,
): SignalingServer {
  console.warn('='.repeat(80));
  console.warn('[CollaborationService] WARNING: Starting in MOCK mode!');
  console.warn('[CollaborationService] This is for development only!');
  console.warn('[CollaborationService] Use startCollaborationServiceV2 for production!');
  console.warn('='.repeat(80));

  const identityRegistry = new MockIdentityRegistry();
  const server = new SignalingServer(port, identityRegistry);

  console.log('[CollaborationService] Mission Guardian ready (MOCK mode) on port', port);

  return server;
}

/**
 * Start the collaboration service (Production Mode with gRPC)
 * 
 * This is the production implementation that uses:
 * - gRPC-based Identity Registry (crates/identity)
 * - Hardware-backed Ed25519 signatures (CodeRalphie/TPM)
 * - Fail-visible security event logging
 */
export function startCollaborationServiceV2(
  port: number = 8080,
  identityRegistryAddress: string = 'localhost:50051',
): SignalingServerV2 {
  console.log('='.repeat(80));
  console.log('[CollaborationService] Starting Mission Guardian Collaboration Service V2');
  console.log('[CollaborationService] PRODUCTION MODE - Hardware-backed signatures enabled');
  console.log('='.repeat(80));

  const server = new SignalingServerV2({
    port,
    identityRegistryAddress,
  });

  console.log('[CollaborationService] Mission Guardian V2 ready on port', port);
  console.log(`[CollaborationService] Identity Registry: ${identityRegistryAddress}`);

  return server;
}

// Auto-start if run directly
if (require.main === module) {
  const port = parseInt(process.env.PORT || '8080', 10);
  const identityRegistryAddress =
    process.env.IDENTITY_REGISTRY_ADDRESS || 'localhost:50051';
  const useProduction = process.env.USE_PRODUCTION === 'true';

  if (useProduction) {
    console.log('[CollaborationService] Starting in PRODUCTION mode...');
    startCollaborationServiceV2(port, identityRegistryAddress);
  } else {
    console.log('[CollaborationService] Starting in MOCK mode (development only)...');
    startCollaborationService(port);
  }
}
