/**
 * MessageBubble Component Tests
 * 
 * Tests fail-visible design and verification status rendering
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { MessageBubble, type CanonicalEvent, type MessagePayload } from '../MessageBubble';

describe('MessageBubble', () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(() => {
    document.body.removeChild(container);
  });

  it('renders verified message correctly', () => {
    const event: CanonicalEvent = {
      event_id: 'test-event-1',
      event_type: 'MESSAGE',
      timestamp: Date.now(),
      device_id: 'device-1',
      sequence: 1,
      payload: {
        text: 'Test message',
        conversation_id: 'conv-1',
        recipient_ids: ['recipient-1'],
      } as MessagePayload,
      prev_hash: 'prev-hash-123',
      chain_height: 1,
      hash: 'hash-123',
      signature: 'sig-123',
      public_key: 'pub-key-123',
      node_id: 'node-1',
    };

    const root = createRoot(container);
    act(() => {
      root.render(
        <MessageBubble
          event={event}
          isOwn={false}
          verificationStatus="VERIFIED"
          chainValid={true}
        />
      );
    });

    expect(container.textContent).toContain('Test message');
    expect(container.textContent).toContain('Verified');
  });

  it('renders spoofed message with fail-visible warning', () => {
    const event: CanonicalEvent = {
      event_id: 'test-event-2',
      event_type: 'MESSAGE',
      timestamp: Date.now(),
      device_id: 'device-1',
      sequence: 2,
      payload: {
        text: 'Spoofed message',
        conversation_id: 'conv-1',
        recipient_ids: ['recipient-1'],
      } as MessagePayload,
      prev_hash: 'prev-hash-123',
      chain_height: 2,
      hash: 'hash-456',
      signature: 'invalid-sig',
      public_key: 'pub-key-123',
      node_id: 'node-1',
    };

    const root = createRoot(container);
    act(() => {
      root.render(
        <MessageBubble
          event={event}
          isOwn={false}
          verificationStatus="SPOOFED"
          chainValid={false}
          failureReason="Invalid signature"
        />
      );
    });

    expect(container.textContent).toContain('UNVERIFIED: Potential MitM');
    expect(container.textContent).toContain('Invalid signature');
  });

  it('disables interaction for spoofed messages', () => {
    const event: CanonicalEvent = {
      event_id: 'test-event-3',
      event_type: 'MESSAGE',
      timestamp: Date.now(),
      device_id: 'device-1',
      sequence: 3,
      payload: {
        text: 'Unsafe message',
        conversation_id: 'conv-1',
        recipient_ids: ['recipient-1'],
      } as MessagePayload,
      prev_hash: 'prev-hash-123',
      chain_height: 3,
      hash: 'hash-789',
      signature: 'invalid-sig',
      public_key: 'pub-key-123',
      node_id: 'node-1',
    };

    const root = createRoot(container);
    act(() => {
      root.render(
        <MessageBubble
          event={event}
          isOwn={false}
          verificationStatus="SPOOFED"
          chainValid={false}
        />
      );
    });

    expect(container.textContent).toContain('Message interaction disabled');
  });
});
