/**
 * AetherCore Mission Guardian Protocol Types
 * 
 * Secure Console-to-Console Collaboration Protocol
 * Trust Fabric: Hardware-backed signatures (Ed25519) for WebRTC signaling
 * 
 * ARCHITECTURAL INVARIANTS (4MIK):
 * - Fail-Visible Design: All data must be explicitly marked as VERIFIED, STATUS_UNVERIFIED, or SPOOFED
 * - No Mocks in Production: MockIdentityRegistry is test-only; production uses gRPC to crates/identity
 * - Merkle Vines: All events contain BLAKE3 hash of ancestor
 * - Memory Safety: Rust is source of truth; TypeScript is for Tactical Glass visualization only
 */

import { z } from 'zod';

/**
 * VerificationStatus - Cryptographic verification state
 * 
 * Fail-Visible Design: All data streams MUST be explicitly marked.
 * - VERIFIED: Valid cryptographic signature from enrolled node with hardware root-of-trust
 * - STATUS_UNVERIFIED: Missing signature, unable to verify, or enrollment pending
 * - SPOOFED: Invalid signature, replay attack, or Byzantine behavior detected
 * 
 * A node with broken cryptographic chain is an ADVERSARY, not a degraded peer.
 */
export const VerificationStatusSchema = z.enum([
  'VERIFIED',
  'STATUS_UNVERIFIED',
  'SPOOFED',
]);
export type VerificationStatus = z.infer<typeof VerificationStatusSchema>;

/**
 * NodeID - Public Key Hash identifier (replaces usernames)
 * Derived from device's Hardware Key (CodeRalphie / TPM 2.0)
 */
export const NodeIDSchema = z.string().regex(/^[0-9a-fA-F]{64}$/);
export type NodeID = z.infer<typeof NodeIDSchema>;

/**
 * SignedEnvelope - Cryptographic wrapper for all Guardian messages
 * Signature verified against crates/identity registry
 */
export const SignedEnvelopeSchema = z.object({
  /** The payload (serialized JSON) */
  payload: z.string(),
  
  /** Ed25519 signature of the payload */
  signature: z.string().regex(/^[0-9a-fA-F]{128}$/),
  
  /** NodeID of the signing device (Public Key Hash) */
  nodeId: NodeIDSchema,
  
  /** Unix timestamp (ms) when signed */
  timestamp: z.number().int().positive(),
  
  /** Nonce to prevent replay attacks */
  nonce: z.string().regex(/^[0-9a-fA-F]{32}$/),
});
export type SignedEnvelope = z.infer<typeof SignedEnvelopeSchema>;

/**
 * WebRTC Session Description (SDP)
 */
export const SDPSchema = z.object({
  type: z.enum(['offer', 'answer', 'pranswer', 'rollback']),
  sdp: z.string(),
});
export type SDP = z.infer<typeof SDPSchema>;

/**
 * ICE Candidate for WebRTC connection
 */
export const ICECandidateSchema = z.object({
  candidate: z.string(),
  sdpMLineIndex: z.number().nullable(),
  sdpMid: z.string().nullable(),
  usernameFragment: z.string().nullable().optional(),
});
export type ICECandidate = z.infer<typeof ICECandidateSchema>;

/**
 * GuardianSignal - WebRTC signaling wrapped in Trust Fabric
 * This is the primary protocol message for establishing secure peer connections
 */
export const GuardianSignalSchema = z.object({
  /** Type of signaling message */
  type: z.enum(['offer', 'answer', 'ice-candidate', 'ice-complete', 'hangup']),
  
  /** Source NodeID (sender) */
  from: NodeIDSchema,
  
  /** Destination NodeID (receiver) */
  to: NodeIDSchema,
  
  /** Session identifier */
  sessionId: z.string().uuid(),
  
  /** WebRTC SDP (for offer/answer) */
  sdp: SDPSchema.nullable().optional(),
  
  /** ICE candidate (for ice-candidate) */
  iceCandidate: ICECandidateSchema.nullable().optional(),
  
  /** Timestamp */
  timestamp: z.number().int().positive(),
});
export type GuardianSignal = z.infer<typeof GuardianSignalSchema>;

/**
 * VerifiedData - Wrapper for cryptographically verified data
 * 
 * Fail-Visible Design: This wrapper ensures all data consumers
 * must explicitly handle verification status.
 */
export const VerifiedDataSchema = z.object({
  /** The actual data payload */
  data: z.unknown(),
  
  /** Verification status from Trust Fabric */
  verificationStatus: VerificationStatusSchema,
  
  /** NodeID that signed the data (if verified) */
  signerId: NodeIDSchema.nullable(),
  
  /** Timestamp of verification */
  verifiedAt: z.number().int().positive(),
  
  /** Reason if unverified or spoofed */
  failureReason: z.string().optional(),
});
export type VerifiedData = z.infer<typeof VerifiedDataSchema>;

/**
 * SignedSignal - GuardianSignal wrapped in SignedEnvelope
 * This is what actually gets transmitted over NATS/WebSocket
 */
export const SignedSignalSchema = z.object({
  envelope: SignedEnvelopeSchema,
});
export type SignedSignal = z.infer<typeof SignedSignalSchema>;

/**
 * StreamIntegrityHash - BLAKE3 hash of video keyframe
 * Sent via side-channel for integrity verification
 */
export const StreamIntegrityHashSchema = z.object({
  /** Session identifier */
  sessionId: z.string().uuid(),
  
  /** NodeID of the sender */
  nodeId: NodeIDSchema,
  
  /** Frame sequence number */
  frameSequence: z.number().int().nonnegative(),
  
  /** BLAKE3 hash of the keyframe (hex encoded) */
  hash: z.string().regex(/^[0-9a-fA-F]{64}$/),
  
  /** Timestamp when frame was captured */
  timestamp: z.number().int().positive(),
  
  /** Frame type indicator */
  isKeyframe: z.boolean(),
});
export type StreamIntegrityHash = z.infer<typeof StreamIntegrityHashSchema>;

/**
 * NetworkHealth - Real-time network status from crates/unit-status
 * Used for contested mode auto-downgrade
 */
export const NetworkHealthSchema = z.object({
  /** Health percentage (0-100) */
  healthPercent: z.number().min(0).max(100),
  
  /** Latency in milliseconds */
  latencyMs: z.number().nonnegative(),
  
  /** Packet loss percentage (0-100) */
  packetLossPercent: z.number().min(0).max(100),
  
  /** Available bandwidth (kbps) */
  bandwidthKbps: z.number().nonnegative(),
  
  /** Timestamp of measurement */
  timestamp: z.number().int().positive(),
  
  /** Whether in contested mode (health < 40%) */
  isContested: z.boolean(),
});
export type NetworkHealth = z.infer<typeof NetworkHealthSchema>;

/**
 * MediaConstraints - Configuration for media streams
 */
export const MediaConstraintsSchema = z.object({
  /** Enable video */
  video: z.boolean(),
  
  /** Enable audio */
  audio: z.boolean(),
  
  /** Video quality preset */
  videoQuality: z.enum(['high', 'medium', 'low', 'audio-only']).optional(),
  
  /** Maximum bitrate (kbps) */
  maxBitrate: z.number().positive().optional(),
});
export type MediaConstraints = z.infer<typeof MediaConstraintsSchema>;

/**
 * CallState - Current state of a Guardian call
 */
export const CallStateSchema = z.enum([
  'idle',
  'initiating',
  'handshaking',
  'connecting',
  'connected',
  'contested',
  'disconnecting',
  'disconnected',
  'failed',
]);
export type CallState = z.infer<typeof CallStateSchema>;

/**
 * ParticipantInfo - Information about a call participant
 */
export const ParticipantInfoSchema = z.object({
  /** NodeID (Public Key Hash) */
  nodeId: NodeIDSchema,
  
  /** Display name resolved from TrustMesh */
  displayName: z.string().optional(),
  
  /** Whether participant is the local user */
  isLocal: z.boolean(),
  
  /** Current media state */
  hasVideo: z.boolean(),
  hasAudio: z.boolean(),
  
  /** Connection quality */
  connectionQuality: z.enum(['excellent', 'good', 'fair', 'poor']).optional(),
  
  /** Timestamp when joined */
  joinedAt: z.number().int().positive(),
});
export type ParticipantInfo = z.infer<typeof ParticipantInfoSchema>;

/**
 * SecurityEvent - Logged when signature verification fails
 */
export const SecurityEventSchema = z.object({
  /** Event type */
  type: z.enum([
    'invalid_signature',
    'unknown_node',
    'replay_attack',
    'integrity_violation',
    'unauthorized_access',
  ]),
  
  /** NodeID involved (if known) */
  nodeId: NodeIDSchema.nullable().optional(),
  
  /** Event description */
  description: z.string(),
  
  /** Event severity */
  severity: z.enum(['critical', 'high', 'medium', 'low']),
  
  /** Timestamp */
  timestamp: z.number().int().positive(),
  
  /** Additional metadata */
  metadata: z.record(z.unknown()).optional(),
});
export type SecurityEvent = z.infer<typeof SecurityEventSchema>;

/**
 * Challenge/Response for Hardware Handshake
 */
export const HandshakeChallengeSchema = z.object({
  /** Challenge nonce */
  challenge: z.string().regex(/^[0-9a-fA-F]{64}$/),
  
  /** Issuer NodeID */
  issuerId: NodeIDSchema,
  
  /** Timestamp */
  timestamp: z.number().int().positive(),
  
  /** Expiry (ms from timestamp) */
  expiryMs: z.number().int().positive(),
});
export type HandshakeChallenge = z.infer<typeof HandshakeChallengeSchema>;

export const HandshakeResponseSchema = z.object({
  /** Challenge that was responded to */
  challenge: z.string().regex(/^[0-9a-fA-F]{64}$/),
  
  /** Response signature (Ed25519 signature of challenge) */
  signature: z.string().regex(/^[0-9a-fA-F]{128}$/),
  
  /** Responder NodeID */
  responderId: NodeIDSchema,
  
  /** Timestamp */
  timestamp: z.number().int().positive(),
});
export type HandshakeResponse = z.infer<typeof HandshakeResponseSchema>;

/**
 * IntegrityStatus - Real-time integrity verification status
 */
export const IntegrityStatusSchema = z.object({
  /** Whether integrity is currently valid */
  isValid: z.boolean(),
  
  /** Verification status for fail-visible design */
  verificationStatus: VerificationStatusSchema,
  
  /** Total frames received */
  totalFrames: z.number().int().nonnegative(),
  
  /** Frames with valid hashes */
  validFrames: z.number().int().nonnegative(),
  
  /** Frames with invalid hashes */
  invalidFrames: z.number().int().nonnegative(),
  
  /** Last check timestamp */
  lastCheckTimestamp: z.number().int().positive(),
  
  /** Whether to show integrity alert */
  showAlert: z.boolean(),
});
export type IntegrityStatus = z.infer<typeof IntegrityStatusSchema>;
