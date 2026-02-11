/**
 * C2 Message Envelope Schema
 * 
 * Defines the versioned message envelope for Command & Control communications.
 * All C2 messages use this envelope format with signing for integrity.
 */

import { z } from 'zod';

// Message types for C2 communication
export const MessageTypeSchema = z.enum([
  'chat',
  'call_invite',
  'call_accept',
  'call_reject',
  'call_end',
  'presence',
  'ack',
  'control',
  'heartbeat',
]);

export type MessageType = z.infer<typeof MessageTypeSchema>;

// Chat message payload
export const ChatPayloadSchema = z.object({
  content: z.string(),
  recipientId: z.string(),
  encrypted: z.boolean().optional().default(false),
});

// Call invitation payload
export const CallInvitePayloadSchema = z.object({
  callId: z.string(),
  recipientId: z.string(),
  sdpOffer: z.string().optional(), // WebRTC SDP offer
});

// Call response payload
export const CallResponsePayloadSchema = z.object({
  callId: z.string(),
  sdpAnswer: z.string().optional(), // WebRTC SDP answer
});

// Presence payload
export const PresencePayloadSchema = z.object({
  status: z.enum(['online', 'offline', 'busy', 'away']),
  trustScore: z.number().min(0).max(1).optional(),
});

// Control message payload
export const ControlPayloadSchema = z.object({
  command: z.string(),
  parameters: z.record(z.unknown()).optional(),
});

// Message envelope (top-level structure)
export const MessageEnvelopeSchema = z.object({
  // Schema version for forward compatibility
  schema_version: z.string().default('1.0'),
  
  // Unique message identifier
  message_id: z.string().uuid(),
  
  // Timestamp in milliseconds since epoch
  timestamp: z.number().int().positive(),
  
  // Message type
  type: MessageTypeSchema,
  
  // Sender identity
  from: z.string(),
  
  // Message payload (type-specific)
  payload: z.unknown(),
  
  // Ed25519 signature (hex-encoded)
  // Signature covers: schema_version + message_id + timestamp + type + from + payload
  signature: z.string().optional(),
  
  // Trust status (set by receiver after verification)
  trust_status: z.enum(['verified', 'unverified', 'invalid']).optional(),
});

export type MessageEnvelope = z.infer<typeof MessageEnvelopeSchema>;

// Typed message envelopes for specific message types
export interface ChatMessage extends MessageEnvelope {
  type: 'chat';
  payload: z.infer<typeof ChatPayloadSchema>;
}

export interface CallInviteMessage extends MessageEnvelope {
  type: 'call_invite';
  payload: z.infer<typeof CallInvitePayloadSchema>;
}

export interface CallResponseMessage extends MessageEnvelope {
  type: 'call_accept' | 'call_reject' | 'call_end';
  payload: z.infer<typeof CallResponsePayloadSchema>;
}

export interface PresenceMessage extends MessageEnvelope {
  type: 'presence';
  payload: z.infer<typeof PresencePayloadSchema>;
}

export interface ControlMessage extends MessageEnvelope {
  type: 'control';
  payload: z.infer<typeof ControlPayloadSchema>;
}

/**
 * Validate and parse a message envelope
 */
export function parseMessageEnvelope(data: unknown): MessageEnvelope {
  return MessageEnvelopeSchema.parse(data);
}

/**
 * Create a message envelope
 */
export function createMessageEnvelope(
  type: MessageType,
  from: string,
  payload: unknown,
  signature?: string
): MessageEnvelope {
  return {
    schema_version: '1.0',
    message_id: crypto.randomUUID(),
    timestamp: Date.now(),
    type,
    from,
    payload,
    signature,
  };
}

/**
 * Serialize envelope payload for signing
 * Creates a canonical string representation for signature generation/verification
 */
export function serializeForSigning(envelope: Omit<MessageEnvelope, 'signature' | 'trust_status'>): string {
  return JSON.stringify({
    schema_version: envelope.schema_version,
    message_id: envelope.message_id,
    timestamp: envelope.timestamp,
    type: envelope.type,
    from: envelope.from,
    payload: envelope.payload,
  });
}
