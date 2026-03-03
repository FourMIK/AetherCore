/**
 * Identity Services - Hardware-Rooted Trust Verification
 * 
 * Exports clients for interacting with AetherCore identity and signing services.
 * These replace all mock identity implementations in the codebase.
 * 
 * Usage:
 * ```typescript
 * import { createIdentityClient, createSigningClient } from './services/identity';
 * 
 * // Create clients
 * const identityClient = createIdentityClient('http://localhost:50052');
 * const signingClient = createSigningClient('http://localhost:50053');
 * 
 * // Check enrollment
 * const isEnrolled = await identityClient.isNodeEnrolled(nodeId);
 * 
 * // Sign message
 * const signature = await signingClient.signMessage(nodeId, message);
 * ```
 */

// Identity Registry Client
export {
  IdentityClient,
  createIdentityClient,
  IdentityClientError,
  type IdentityClientConfig,
  type NodeID,
  type PublicKeyHex,
  type GetPublicKeyRequest,
  type GetPublicKeyResponse,
  type IsNodeEnrolledRequest,
  type IsNodeEnrolledResponse,
  type VerifySignatureRequest as IdentityVerifySignatureRequest,
  type VerifySignatureResponse as IdentityVerifySignatureResponse,
} from './identityClient';

// Signing Service Client
export {
  SigningClient,
  createSigningClient,
  SigningClientError,
  type SigningClientConfig,
  type SignMessageRequest,
  type SignMessageResponse,
  type GetPublicKeyRequest as SigningGetPublicKeyRequest,
  type GetPublicKeyResponse as SigningGetPublicKeyResponse,
  type CreateSignedEnvelopeRequest,
  type CreateSignedEnvelopeResponse,
  type VerifySignatureRequest as SigningVerifySignatureRequest,
  type VerifySignatureResponse as SigningVerifySignatureResponse,
  type SigningMetrics,
} from './signingClient';
