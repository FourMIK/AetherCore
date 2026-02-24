/**
 * C2Client Tests
 * 
 * Unit tests for C2Client state machine, connection management, and messaging.
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { C2Client, C2State } from '../C2Client';
import type { C2ClientConfig } from '../C2Client';

// Mock WebSocket
class MockWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;

  readyState: number = MockWebSocket.CONNECTING;
  onopen: ((event: Event) => void) | null = null;
  onclose: ((event: CloseEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  sentMessages: string[] = [];

  constructor(public url: string) {
    // Simulate async connection
    setTimeout(() => {
      if (this.readyState === MockWebSocket.CONNECTING) {
        this.readyState = MockWebSocket.OPEN;
        this.onopen?.(new Event('open'));
      }
    }, 10);
  }

  send(data: string) {
    this.sentMessages.push(data);
  }

  close(code?: number, reason?: string) {
    this.readyState = MockWebSocket.CLOSED;
    this.onclose?.(new CloseEvent('close', { code, reason }));
  }

  // Test helper: simulate receiving a message
  simulateMessage(data: string) {
    if (this.onmessage) {
      this.onmessage(new MessageEvent('message', { data }));
    }
  }
}

// Replace global WebSocket with mock
vi.stubGlobal('WebSocket', MockWebSocket);

// Mock endpoint validation
vi.mock('../../../utils/endpoint-validation', () => ({
  validateWebSocketEndpoint: vi.fn((url: string) => ({
    valid: url.startsWith('ws://') || url.startsWith('wss://'),
    protocol: url.startsWith('wss://') ? 'wss' : 'ws',
    isLocalhost: url.includes('localhost') || url.includes('127.0.0.1'),
    error: url.startsWith('ws://') || url.startsWith('wss://') ? undefined : 'Invalid protocol',
  })),
}));

describe('C2Client', () => {
  let client: C2Client;
  let config: C2ClientConfig;
  let mockWs: MockWebSocket;

  const createClient = (overrides: Partial<C2ClientConfig> = {}) => {
    config = {
      endpoint: 'ws://localhost:8080',
      clientId: 'test-client-001',
      signingEnabled: false,
      heartbeatIntervalMs: 1000,
      heartbeatTimeoutMs: 500,
      maxReconnectAttempts: 3,
      initialBackoffMs: 100,
      maxBackoffMs: 1000,
      onStateChange: vi.fn(),
      onMessage: vi.fn(),
      onError: vi.fn(),
      ...overrides,
    };

    client = new C2Client(config);
  };

  beforeEach(() => {
    vi.useFakeTimers();
    createClient();
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.restoreAllMocks();
  });

  describe('State Machine', () => {
    it('should start in IDLE state', () => {
      const status = client.getStatus();
      expect(status.state).toBe('IDLE');
    });

    it('should transition IDLE -> CONNECTING on connect()', async () => {
      const connectPromise = client.connect();
      
      // Should be in CONNECTING state immediately
      expect(client.getStatus().state).toBe('CONNECTING');
      
      // Wait for connection to complete
      await vi.advanceTimersByTimeAsync(20);
      await connectPromise;
    });

    it('should transition CONNECTING -> CONNECTED on successful connection', async () => {
      const onStateChange = vi.fn();
      createClient({ onStateChange });

      await client.connect();
      await vi.advanceTimersByTimeAsync(20);

      expect(client.getStatus().state).toBe('CONNECTED');
      expect(onStateChange).toHaveBeenCalledWith('CONNECTED', 'CONNECTED');
    });

    it('should transition CONNECTED -> DISCONNECTED on close', async () => {
      await client.connect();
      await vi.advanceTimersByTimeAsync(20);

      // Get the WebSocket instance
      const ws = (client as any).ws as MockWebSocket;
      ws.close(1000, 'Normal close');

      expect(client.getStatus().state).toBe('DISCONNECTED');
    });

    it('should transition CONNECTED -> DEGRADED on heartbeat timeout', async () => {
      createClient({ heartbeatTimeoutMs: 500 });
      
      await client.connect();
      await vi.advanceTimersByTimeAsync(20);
      
      // Wait for heartbeat timeout
      await vi.advanceTimersByTimeAsync(600);

      expect(client.getStatus().state).toBe('DEGRADED');
      expect(client.getStatus().missedHeartbeats).toBeGreaterThan(0);
    });
  });

  describe('Connection Management', () => {
    it('should connect to endpoint', async () => {
      await client.connect();
      await vi.advanceTimersByTimeAsync(20);

      const status = client.getStatus();
      expect(status.state).toBe('CONNECTED');
      expect(status.endpoint).toBe('ws://localhost:8080');
      expect(status.lastConnected).toBeInstanceOf(Date);
    });

    it('should not connect if already connecting', async () => {
      const promise1 = client.connect();
      const promise2 = client.connect();

      await vi.advanceTimersByTimeAsync(20);
      await Promise.all([promise1, promise2]);

      // Should only call WebSocket constructor once
      expect(client.getStatus().state).toBe('CONNECTED');
    });

    it('should disconnect cleanly', async () => {
      await client.connect();
      await vi.advanceTimersByTimeAsync(20);

      client.disconnect();

      expect(client.getStatus().state).toBe('IDLE');
    });

    it('should reset counters on successful connection', async () => {
      await client.connect();
      await vi.advanceTimersByTimeAsync(20);

      const status = client.getStatus();
      expect(status.reconnectAttempts).toBe(0);
      expect(status.missedHeartbeats).toBe(0);
    });
  });

  describe('Message Handling', () => {
    it('should send message when connected', async () => {
      await client.connect();
      await vi.advanceTimersByTimeAsync(20);

      const ws = (client as any).ws as MockWebSocket;
      ws.sentMessages = [];

      await client.sendMessage('chat', { content: 'Test message' });

      expect(ws.sentMessages.length).toBeGreaterThan(0);
      const message = JSON.parse(ws.sentMessages[ws.sentMessages.length - 1]);
      expect(message.type).toBe('chat');
      expect(message.payload.content).toBe('Test message');
    });

    it('should queue message when disconnected', async () => {
      await client.sendMessage('chat', { content: 'Queued message' });

      const status = client.getStatus();
      expect(status.queuedMessages).toBe(1);
    });

    it('should flush queued messages on reconnection', async () => {
      // Queue a message while disconnected
      await client.sendMessage('chat', { content: 'Queued message' });
      expect(client.getStatus().queuedMessages).toBe(1);

      // Connect and wait
      await client.connect();
      await vi.advanceTimersByTimeAsync(20);

      // Queue should be flushed
      expect(client.getStatus().queuedMessages).toBe(0);

      // Message should have been sent
      const ws = (client as any).ws as MockWebSocket;
      const messages = ws.sentMessages.map(m => JSON.parse(m));
      const chatMessage = messages.find(m => m.type === 'chat');
      expect(chatMessage?.payload.content).toBe('Queued message');
    });

    it('should handle received messages', async () => {
      const onMessage = vi.fn();
      createClient({ onMessage });

      await client.connect();
      await vi.advanceTimersByTimeAsync(20);

      const ws = (client as any).ws as MockWebSocket;
      ws.simulateMessage(JSON.stringify({
        schema_version: '1.0',
        message_id: '550e8400-e29b-41d4-a716-446655440000',
        timestamp: Date.now(),
        type: 'chat',
        from: 'server',
        payload: { content: 'Hello' },
      }));

      expect(onMessage).toHaveBeenCalled();
      const receivedMessage = onMessage.mock.calls[0][0];
      expect(receivedMessage.type).toBe('chat');
      expect(receivedMessage.payload.content).toBe('Hello');
    });
  });

  describe('Heartbeat Mechanism', () => {
    it('should send heartbeat periodically', async () => {
      createClient({ heartbeatIntervalMs: 100 });

      await client.connect();
      await vi.advanceTimersByTimeAsync(20);

      const ws = (client as any).ws as MockWebSocket;
      const initialCount = ws.sentMessages.filter(m => 
        JSON.parse(m).type === 'heartbeat'
      ).length;

      // Wait for another heartbeat
      await vi.advanceTimersByTimeAsync(150);

      const afterCount = ws.sentMessages.filter(m => 
        JSON.parse(m).type === 'heartbeat'
      ).length;

      expect(afterCount).toBeGreaterThan(initialCount);
    });

    it('should calculate RTT from heartbeat response', async () => {
      await client.connect();
      await vi.advanceTimersByTimeAsync(20);

      const ws = (client as any).ws as MockWebSocket;
      
      // Find last heartbeat sent
      const heartbeatMsg = ws.sentMessages
        .map(m => JSON.parse(m))
        .reverse()
        .find(m => m.type === 'heartbeat');

      expect(heartbeatMsg).toBeDefined();

      // Simulate heartbeat response
      await vi.advanceTimersByTimeAsync(50);
      ws.simulateMessage(JSON.stringify({
        schema_version: '1.0',
        message_id: '550e8400-e29b-41d4-a716-446655440000',
        timestamp: Date.now(),
        type: 'heartbeat',
        from: 'server',
        payload: { timestamp: Date.now() },
      }));

      // RTT should be calculated
      const status = client.getStatus();
      expect(status.rttMs).toBeDefined();
      expect(status.rttMs).toBeGreaterThan(0);
    });

    it('should transition to DEGRADED on missed heartbeats', async () => {
      createClient({ heartbeatTimeoutMs: 200 });

      await client.connect();
      await vi.advanceTimersByTimeAsync(20);

      // Don't send heartbeat responses, just wait for timeout
      await vi.advanceTimersByTimeAsync(300);

      const status = client.getStatus();
      expect(status.state).toBe('DEGRADED');
      expect(status.missedHeartbeats).toBeGreaterThan(0);
    });

    it('should recover from DEGRADED when heartbeat resumes', async () => {
      createClient({ heartbeatTimeoutMs: 200 });

      await client.connect();
      await vi.advanceTimersByTimeAsync(20);

      // Wait for degraded state
      await vi.advanceTimersByTimeAsync(300);
      expect(client.getStatus().state).toBe('DEGRADED');

      // Simulate heartbeat response
      const ws = (client as any).ws as MockWebSocket;
      ws.simulateMessage(JSON.stringify({
        schema_version: '1.0',
        message_id: '550e8400-e29b-41d4-a716-446655440000',
        timestamp: Date.now(),
        type: 'heartbeat',
        from: 'server',
        payload: {},
      }));

      // Should recover to CONNECTED
      expect(client.getStatus().state).toBe('CONNECTED');
      expect(client.getStatus().missedHeartbeats).toBe(0);
    });
  });

  describe('Reconnection Strategy', () => {
    it('should schedule reconnection after disconnect', async () => {
      await client.connect();
      await vi.advanceTimersByTimeAsync(20);

      // Force disconnect
      const ws = (client as any).ws as MockWebSocket;
      ws.close(1006, 'Abnormal close');

      // Should enter BACKOFF state
      expect(client.getStatus().state).toBe('BACKOFF');
      expect(client.getStatus().backoffUntil).toBeInstanceOf(Date);
    });

    it('should use exponential backoff', async () => {
      createClient({ initialBackoffMs: 100, maxBackoffMs: 1000 });

      await client.connect();
      await vi.advanceTimersByTimeAsync(20);

      // First disconnect
      let ws = (client as any).ws as MockWebSocket;
      ws.close(1006);
      
      const firstBackoff = client.getStatus().backoffUntil;

      // Wait and reconnect
      await vi.advanceTimersByTimeAsync(200);
      await vi.advanceTimersByTimeAsync(20);

      // Second disconnect
      ws = (client as any).ws as MockWebSocket;
      ws.close(1006);

      const secondBackoff = client.getStatus().backoffUntil;

      // Second backoff should be later than first (exponential)
      if (firstBackoff && secondBackoff) {
        const firstDelay = firstBackoff.getTime() - Date.now();
        const secondDelay = secondBackoff.getTime() - Date.now();
        expect(secondDelay).toBeGreaterThan(firstDelay);
      }
    });

    it('should stop reconnecting after max attempts', async () => {
      createClient({ maxReconnectAttempts: 2, initialBackoffMs: 50 });

      // Connect and disconnect multiple times
      for (let i = 0; i < 3; i++) {
        await client.connect();
        await vi.advanceTimersByTimeAsync(20);

        const ws = (client as any).ws as MockWebSocket;
        ws.close(1006);

        await vi.advanceTimersByTimeAsync(100);
      }

      // Should stay in DISCONNECTED after max attempts
      const status = client.getStatus();
      expect(status.state).toBe('DISCONNECTED');
      expect(status.reconnectAttempts).toBeGreaterThanOrEqual(2);
    });
  });

  describe('reconnectNow()', () => {
    it('should immediately reconnect bypassing backoff', async () => {
      await client.connect();
      await vi.advanceTimersByTimeAsync(20);

      // Disconnect
      const ws = (client as any).ws as MockWebSocket;
      ws.close(1006);

      // Should be in BACKOFF
      expect(client.getStatus().state).toBe('BACKOFF');

      // Call reconnectNow
      client.reconnectNow();

      // Should immediately start connecting
      expect(client.getStatus().state).toBe('CONNECTING');

      // Wait for connection
      await vi.advanceTimersByTimeAsync(20);
      expect(client.getStatus().state).toBe('CONNECTED');
    });

    it('should reset reconnect attempts counter', async () => {
      await client.connect();
      await vi.advanceTimersByTimeAsync(20);

      // Force multiple disconnects to increment counter
      for (let i = 0; i < 2; i++) {
        const ws = (client as any).ws as MockWebSocket;
        ws.close(1006);
        await vi.advanceTimersByTimeAsync(200);
      }

      expect(client.getStatus().reconnectAttempts).toBeGreaterThan(0);

      // reconnectNow should reset
      client.reconnectNow();
      await vi.advanceTimersByTimeAsync(20);

      expect(client.getStatus().reconnectAttempts).toBe(0);
    });
  });

  describe('Error Handling', () => {
    it('should handle invalid endpoint', async () => {
      createClient({ endpoint: 'invalid://endpoint' });

      await expect(client.connect()).rejects.toThrow('Invalid C2 endpoint');
      expect(client.getStatus().state).toBe('IDLE');
    });

    it('should handle malformed messages gracefully', async () => {
      const onError = vi.fn();
      createClient({ onError });

      await client.connect();
      await vi.advanceTimersByTimeAsync(20);

      const ws = (client as any).ws as MockWebSocket;
      
      // Send invalid JSON
      ws.simulateMessage('not json');

      // Should not crash
      expect(client.getStatus().state).toBe('CONNECTED');
      expect(onError).toHaveBeenCalled();
    });

    it('should set lastError on failure', async () => {
      createClient({ endpoint: 'invalid://endpoint' });

      try {
        await client.connect();
      } catch (e) {
        // Expected
      }

      const status = client.getStatus();
      expect(status.error).toBeDefined();
      expect(status.error).toContain('Invalid C2 endpoint');
    });
  });

  describe('Status Reporting', () => {
    it('should return complete status', async () => {
      await client.connect();
      await vi.advanceTimersByTimeAsync(20);

      const status = client.getStatus();

      expect(status.state).toBe('CONNECTED');
      expect(status.endpoint).toBe('ws://localhost:8080');
      expect(status.reconnectAttempts).toBe(0);
      expect(status.lastConnected).toBeInstanceOf(Date);
      expect(status.missedHeartbeats).toBe(0);
      expect(status.queuedMessages).toBe(0);
    });

    it('should update timestamps correctly', async () => {
      await client.connect();
      await vi.advanceTimersByTimeAsync(20);

      // Send a message
      await client.sendMessage('chat', { content: 'Test' });

      const status = client.getStatus();
      expect(status.lastMessageSent).toBeInstanceOf(Date);
    });
  });
});
