/**
 * AetherCore Mission Guardian Collaboration Service (Production)
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
 */

// Export production components
export * from './SignalingServer';
export { VerificationService, ConsoleSecurityEventHandler } from './VerificationService';
export * from './IdentityRegistryClient';

import { SignalingServer } from './SignalingServer';

/**
 * Start the collaboration service (Production Mode with gRPC)
 * 
 * This is the production implementation that uses:
 * - gRPC-based Identity Registry (crates/identity)
 * - Hardware-backed Ed25519 signatures (CodeRalphie/TPM)
 * - Fail-visible security event logging
 */
export function startCollaborationService(
  port?: number,
  identityRegistryAddress?: string,
): SignalingServer {
  // Read from environment variables or use defaults
  const serverPort = port ?? parseInt(process.env.PORT || '8080', 10);
  const registryAddress = identityRegistryAddress ?? process.env.IDENTITY_REGISTRY_ADDRESS ?? 'localhost:50051';

  console.log('='.repeat(80));
  console.log('[CollaborationService] Starting Mission Guardian Collaboration Service');
  console.log('[CollaborationService] PRODUCTION MODE - Hardware-backed signatures enabled');
  console.log('='.repeat(80));

  const server = new SignalingServer({
    port: serverPort,
    identityRegistryAddress: registryAddress,
  });

  console.log('[CollaborationService] Mission Guardian ready on port', serverPort);
  console.log(`[CollaborationService] Identity Registry: ${registryAddress}`);

  return server;
}

// Auto-start if run directly
if (require.main === module) {
  startCollaborationService();
}
