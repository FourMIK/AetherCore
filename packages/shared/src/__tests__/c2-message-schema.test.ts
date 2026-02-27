/**
 * C2 Message Envelope Schema Tests
 * 
 * Tests for message envelope validation, creation, and serialization.
 */

import { describe, it, expect } from 'vitest';
import {
  parseMessageEnvelope,
  createMessageEnvelope,
  serializeForSigning,
  type MessageEnvelope,
} from '../c2-message-schema';

describe('C2 Message Envelope Schema', () => {
  describe('createMessageEnvelope', () => {
    it('should create valid chat message envelope', () => {
      const envelope = createMessageEnvelope(
        'chat',
        'sender-001',
        { content: 'Test message', recipientId: 'recipient-001', encrypted: false }
      );

      expect(envelope.schema_version).toBe('1.0');
      expect(envelope.type).toBe('chat');
      expect(envelope.from).toBe('sender-001');
      expect(envelope.message_id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
      );
      expect(envelope.timestamp).toBeGreaterThan(0);
      expect(envelope.payload).toEqual({
        content: 'Test message',
        recipientId: 'recipient-001',
        encrypted: false,
      });
    });

    it('should create valid heartbeat envelope', () => {
      const timestamp = Date.now();
      const envelope = createMessageEnvelope(
        'heartbeat',
        'client-001',
        { timestamp }
      );

      expect(envelope.type).toBe('heartbeat');
      expect(envelope.from).toBe('client-001');
      expect(envelope.payload).toEqual({ timestamp });
    });

    it('should include signature if provided', () => {
      const envelope = createMessageEnvelope(
        'chat',
        'sender-001',
        { content: 'Test' },
        'test-signature'
      );

      expect(envelope.signature).toBe('test-signature');
    });
  });

  describe('parseMessageEnvelope', () => {
    it('should parse valid envelope', () => {
      const validEnvelope = {
        schema_version: '1.0',
        message_id: '550e8400-e29b-41d4-a716-446655440000',
        timestamp: Date.now(),
        type: 'chat',
        from: 'sender-001',
        payload: { content: 'Hello' },
      };

      const parsed = parseMessageEnvelope(validEnvelope);
      expect(parsed).toEqual(validEnvelope);
    });

    it('should reject envelope with invalid UUID', () => {
      const invalidEnvelope = {
        schema_version: '1.0',
        message_id: 'not-a-uuid',
        timestamp: Date.now(),
        type: 'chat',
        from: 'sender-001',
        payload: {},
      };

      expect(() => parseMessageEnvelope(invalidEnvelope)).toThrow();
    });

    it('should reject envelope with invalid type', () => {
      const invalidEnvelope = {
        schema_version: '1.0',
        message_id: '550e8400-e29b-41d4-a716-446655440000',
        timestamp: Date.now(),
        type: 'invalid_type',
        from: 'sender-001',
        payload: {},
      };

      expect(() => parseMessageEnvelope(invalidEnvelope)).toThrow();
    });

    it('should accept envelope with optional signature', () => {
      const validEnvelope = {
        schema_version: '1.0',
        message_id: '550e8400-e29b-41d4-a716-446655440000',
        timestamp: Date.now(),
        type: 'chat',
        from: 'sender-001',
        payload: {},
        signature: 'placeholder:abc123',
      };

      const parsed = parseMessageEnvelope(validEnvelope);
      expect(parsed.signature).toBe('placeholder:abc123');
    });
  });

  describe('serializeForSigning', () => {
    it('should produce deterministic output', () => {
      const envelope: Omit<MessageEnvelope, 'signature' | 'trust_status'> = {
        schema_version: '1.0',
        message_id: '550e8400-e29b-41d4-a716-446655440000',
        timestamp: 1234567890,
        type: 'chat',
        from: 'sender-001',
        payload: { content: 'Test' },
      };

      const serialized1 = serializeForSigning(envelope);
      const serialized2 = serializeForSigning(envelope);

      expect(serialized1).toBe(serialized2);
    });

    it('should not include signature or trust_status', () => {
      const envelope: Omit<MessageEnvelope, 'signature' | 'trust_status'> = {
        schema_version: '1.0',
        message_id: '550e8400-e29b-41d4-a716-446655440000',
        timestamp: 1234567890,
        type: 'chat',
        from: 'sender-001',
        payload: { content: 'Test' },
      };

      const serialized = serializeForSigning(envelope);
      const parsed = JSON.parse(serialized);

      expect(parsed).not.toHaveProperty('signature');
      expect(parsed).not.toHaveProperty('trust_status');
    });
  });
});
