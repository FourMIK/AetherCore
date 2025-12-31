/**
 * AetherCore Mission Guardian Collaboration Service
 * 
 * Secure Console-to-Console Video/Voice/Chat over Trust Fabric
 * 
 * This service provides:
 * - WebRTC signaling with Ed25519 signature verification
 * - Integration with crates/identity registry
 * - Security event logging
 * - NATS/WebSocket transport
 */

export * from './SignalingServer';
export * from './VerificationService';

import { SignalingServer } from './SignalingServer';
import { MockIdentityRegistry } from './VerificationService';

/**
 * Start the collaboration service
 */
export function startCollaborationService(port: number = 8080): SignalingServer {
  console.log('[CollaborationService] Starting Mission Guardian Collaboration Service...');
  
  // Initialize mock identity registry
  // In production, this would connect to crates/identity via gRPC/FFI
  const identityRegistry = new MockIdentityRegistry();
  
  // Start signaling server
  const server = new SignalingServer(port, identityRegistry);
  
  console.log('[CollaborationService] Mission Guardian ready on port', port);
  
  return server;
}

// Auto-start if run directly
if (require.main === module) {
  const port = parseInt(process.env.PORT || '8080', 10);
  startCollaborationService(port);
}
