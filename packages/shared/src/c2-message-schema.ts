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
  content: z.string().optional(),
  recipientId: z.string(),
  encrypted: z.boolean().optional().default(false),
  ciphertext: z.string().optional(),
  nonce: z.string().optional(),
  authTag: z.string().optional(),
  senderEphemeralPublicKey: z.string().optional(),
  senderChatPublicKey: z.string().optional(),
  keyAgreement: z.string().optional(),
  cipher: z.string().optional(),
  keyEpoch: z.number().int().positive().optional(),
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

  // Replay defense nonce (hex-encoded random bytes)
  nonce: z.string().min(16).optional(),

  // Monotonic sequence number for sender-local ordering
  sequence: z.number().int().positive().optional(),

  // Previous message_id emitted by this sender (if available)
  previous_message_id: z.string().uuid().optional(),
  
  // Ed25519 signature (hex-encoded)
  // Signature covers: schema_version + message_id + timestamp + type + from + payload
  signature: z.string().optional(),
  
  // Trust status (set by receiver after verification)
  trust_status: z.enum(['verified', 'unverified', 'invalid']).optional(),
});

export type MessageEnvelope = z.infer<typeof MessageEnvelopeSchema>;

const senderSequenceTracker = new Map<string, number>();
const senderLastMessageTracker = new Map<string, string>();

function generateMessageId(): string {
  const cryptoObj = (globalThis as {
    crypto?: {
      randomUUID?: () => string;
      getRandomValues?: (arr: Uint8Array) => Uint8Array;
    };
  }).crypto;

  if (cryptoObj?.randomUUID) {
    return cryptoObj.randomUUID();
  }

  const bytes = new Uint8Array(16);
  if (cryptoObj?.getRandomValues) {
    cryptoObj.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i += 1) {
      bytes[i] = Math.floor(Math.random() * 256);
    }
  }

  // RFC 4122 version 4 UUID bits.
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;

  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function nextSequenceForSender(senderId: string): number {
  const current = senderSequenceTracker.get(senderId) ?? 0;
  const next = current + 1;
  senderSequenceTracker.set(senderId, next);
  return next;
}

function generateNonceHex(): string {
  const bytes = new Uint8Array(16);
  const cryptoObj = (globalThis as {
    crypto?: {
      getRandomValues?: (arr: Uint8Array) => Uint8Array;
    };
  }).crypto;

  if (cryptoObj?.getRandomValues) {
    cryptoObj.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i += 1) {
      bytes[i] = Math.floor(Math.random() * 256);
    }
  }

  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

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
  const previousMessageId = senderLastMessageTracker.get(from);
  const messageId = generateMessageId();
  const sequence = nextSequenceForSender(from);
  senderLastMessageTracker.set(from, messageId);

  return {
    schema_version: '1.0',
    message_id: messageId,
    timestamp: Date.now(),
    type,
    from,
    payload,
    nonce: generateNonceHex(),
    sequence,
    previous_message_id: previousMessageId,
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
    nonce: envelope.nonce,
    sequence: envelope.sequence,
    previous_message_id: envelope.previous_message_id,
  });
}
