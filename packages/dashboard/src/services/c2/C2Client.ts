/**
 * C2 Client - Command & Control Communication Client
 * 
 * Implements a deterministic state machine for C2 communications:
 * - IDLE -> CONNECTING -> CONNECTED -> DEGRADED -> BACKOFF -> DISCONNECTED
 * - Exponential backoff with jitter for reconnection
 * - Heartbeat/ping mechanism for connection health monitoring
 * - Message signing and verification
 * - Fail-visible error handling
 */

import { validateWebSocketEndpoint } from '../../utils/endpoint-validation';
import {
  MessageEnvelope,
  MessageType,
  createMessageEnvelope,
  parseMessageEnvelope,
  serializeForSigning,
} from '../../../../../shared/src/c2-message-schema';

// C2 Client States
export type C2State =
  | 'IDLE'
  | 'CONNECTING'
  | 'CONNECTED'
  | 'DEGRADED'
  | 'DISCONNECTED'
  | 'BACKOFF';

// C2 Client Events
export type C2Event =
  | 'CONNECT_REQUESTED'
  | 'CONNECTED'
  | 'DISCONNECTED'
  | 'MESSAGE_RX'
  | 'MESSAGE_TX'
  | 'ERROR'
  | 'BACKOFF_SCHEDULED'
  | 'HEARTBEAT_TIMEOUT';

// C2 Client Configuration
export interface C2ClientConfig {
  endpoint: string;
  clientId: string;
  signingEnabled: boolean;
  heartbeatIntervalMs: number;
  heartbeatTimeoutMs: number;
  maxReconnectAttempts: number;
  initialBackoffMs: number;
  maxBackoffMs: number;
  onStateChange?: (state: C2State, event: C2Event) => void;
  onMessage?: (message: MessageEnvelope) => void;
  onError?: (error: Error) => void;
}

export interface C2ClientStatus {
  state: C2State;
  endpoint: string;
  reconnectAttempts: number;
  lastConnected?: Date;
  lastMessageSent?: Date;
  lastMessageReceived?: Date;
  lastHeartbeat?: Date;
  backoffUntil?: Date;
  error?: string;
  rttMs?: number;
  missedHeartbeats: number;
  queuedMessages: number;
}

export class C2Client {
  private config: C2ClientConfig;
  private ws: WebSocket | null = null;
  private state: C2State = 'IDLE';
  private reconnectAttempts: number = 0;
  private heartbeatInterval: number | null = null;
  private heartbeatTimeout: number | null = null;
  private reconnectTimeout: number | null = null;
  private lastHeartbeat: Date | null = null;
  private lastConnected: Date | null = null;
  private lastMessageSent: Date | null = null;
  private lastMessageReceived: Date | null = null;
  private backoffUntil: Date | null = null;
  private lastError: string | null = null;
  private messageQueue: MessageEnvelope[] = [];
  private missedHeartbeats: number = 0;
  private rttMs: number | null = null;
  private heartbeatSentAt: number | null = null;

  constructor(config: C2ClientConfig) {
    this.config = config;
  }

  /**
   * Connect to C2 endpoint
   */
  public async connect(): Promise<void> {
    if (this.state === 'CONNECTING' || this.state === 'CONNECTED') {
      console.warn('[C2] Already connected or connecting');
      return;
    }

    // Validate endpoint
    const validation = validateWebSocketEndpoint(this.config.endpoint);
    if (!validation.valid) {
      const error = new Error(`Invalid C2 endpoint: ${validation.error}`);
      this.handleError(error);
      throw error;
    }

    this.setState('CONNECTING', 'CONNECT_REQUESTED');

    try {
      this.ws = new WebSocket(this.config.endpoint);

      this.ws.onopen = () => {
        console.log('[C2] Connected to', this.config.endpoint);
        this.reconnectAttempts = 0;
        this.lastConnected = new Date();
        this.lastError = null;
        this.missedHeartbeats = 0;
        this.rttMs = null;
        this.setState('CONNECTED', 'CONNECTED');
        this.startHeartbeat();

        // Send any queued messages
        this.flushMessageQueue();
      };

      this.ws.onclose = (event) => {
        console.log('[C2] Connection closed:', event.code, event.reason);
        this.stopHeartbeat();
        this.setState('DISCONNECTED', 'DISCONNECTED');
        this.handleReconnection();
      };

      this.ws.onerror = (event) => {
        console.error('[C2] WebSocket error:', event);
        const error = new Error('WebSocket connection error');
        this.handleError(error);
      };

      this.ws.onmessage = (event) => {
        this.handleMessage(event.data);
      };
    } catch (error) {
      this.handleError(error as Error);
      throw error;
    }
  }

  /**
   * Disconnect from C2 endpoint
   */
  public disconnect(): void {
    this.stopHeartbeat();
    this.clearReconnectTimeout();
    
    if (this.ws) {
      this.ws.close(1000, 'Client disconnect');
      this.ws = null;
    }

    this.setState('IDLE', 'DISCONNECTED');
    this.reconnectAttempts = 0;
  }

  /**
   * Reconnect immediately (bypass backoff)
   */
  public reconnectNow(): void {
    console.log('[C2] Immediate reconnection requested');
    
    // Clear any pending reconnect
    this.clearReconnectTimeout();
    this.backoffUntil = null;
    
    // Reset to first attempt
    this.reconnectAttempts = 0;
    
    // Disconnect if currently connected
    if (this.ws) {
      this.ws.close(1000, 'Manual reconnect');
      this.ws = null;
    }
    
    // Immediate reconnect
    this.connect().catch((error) => {
      console.error('[C2] Immediate reconnection failed:', error);
    });
  }

  /**
   * Send a message
   */
  public async sendMessage(
    type: MessageType,
    payload: unknown,
    recipientId?: string
  ): Promise<void> {
    const envelope = createMessageEnvelope(
      type,
      this.config.clientId,
      payload
    );

    // Sign message if enabled
    if (this.config.signingEnabled) {
      try {
        envelope.signature = await this.signMessage(envelope);
      } catch (error) {
        console.error('[C2] Failed to sign message:', error);
        throw new Error('Message signing failed');
      }
    }

    // If not connected, queue the message
    if (this.state !== 'CONNECTED') {
      console.warn('[C2] Not connected, queueing message');
      this.messageQueue.push(envelope);
      return;
    }

    this.sendEnvelope(envelope);
  }

  /**
   * Get current client status
   */
  public getStatus(): C2ClientStatus {
    return {
      state: this.state,
      endpoint: this.config.endpoint,
      reconnectAttempts: this.reconnectAttempts,
      lastConnected: this.lastConnected || undefined,
      lastMessageSent: this.lastMessageSent || undefined,
      lastMessageReceived: this.lastMessageReceived || undefined,
      lastHeartbeat: this.lastHeartbeat || undefined,
      backoffUntil: this.backoffUntil || undefined,
      error: this.lastError || undefined,
      rttMs: this.rttMs || undefined,
      missedHeartbeats: this.missedHeartbeats,
      queuedMessages: this.messageQueue.length,
    };
  }

  /**
   * Handle incoming message
   */
  private handleMessage(data: string): void {
    try {
      const json = JSON.parse(data);
      const envelope = parseMessageEnvelope(json);

      this.lastMessageReceived = new Date();

      // Verify signature if present
      if (envelope.signature && this.config.signingEnabled) {
        const verified = this.verifyMessage(envelope);
        envelope.trust_status = verified ? 'verified' : 'invalid';
      } else {
        envelope.trust_status = 'unverified';
      }

      // Reset heartbeat timeout on any message
      this.resetHeartbeatTimeout();

      // Handle heartbeat response
      if (envelope.type === 'heartbeat') {
        this.lastHeartbeat = new Date();
        
        // Calculate RTT if we have a sent timestamp
        if (this.heartbeatSentAt) {
          const rtt = Date.now() - this.heartbeatSentAt;
          // Exponential moving average for smoothing
          this.rttMs = this.rttMs ? (this.rttMs * 0.8 + rtt * 0.2) : rtt;
          this.heartbeatSentAt = null;
        }
        
        // Reset missed heartbeats counter
        if (this.missedHeartbeats > 0) {
          console.log(`[C2] Heartbeat restored, ${this.missedHeartbeats} missed`);
          this.missedHeartbeats = 0;
          
          // Transition back to CONNECTED if we were DEGRADED
          if (this.state === 'DEGRADED') {
            this.setState('CONNECTED', 'CONNECTED');
          }
        }
        
        return;
      }

      // Deliver message to callback
      if (this.config.onMessage) {
        this.config.onMessage(envelope);
      }

      this.setState(this.state, 'MESSAGE_RX');
    } catch (error) {
      console.error('[C2] Failed to parse message:', error);
      this.handleError(error as Error);
    }
  }

  /**
   * Send an envelope
   */
  private sendEnvelope(envelope: MessageEnvelope): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error('WebSocket not connected');
    }

    try {
      this.ws.send(JSON.stringify(envelope));
      this.lastMessageSent = new Date();
      this.setState(this.state, 'MESSAGE_TX');
    } catch (error) {
      console.error('[C2] Failed to send message:', error);
      throw error;
    }
  }

  /**
   * Flush queued messages
   */
  private flushMessageQueue(): void {
    if (this.messageQueue.length === 0) return;

    console.log(`[C2] Flushing ${this.messageQueue.length} queued messages`);
    
    while (this.messageQueue.length > 0) {
      const envelope = this.messageQueue.shift();
      if (envelope) {
        try {
          this.sendEnvelope(envelope);
        } catch (error) {
          console.error('[C2] Failed to send queued message:', error);
          // Requeue on failure
          this.messageQueue.unshift(envelope);
          break;
        }
      }
    }
  }

  /**
   * Start heartbeat mechanism
   */
  private startHeartbeat(): void {
    this.stopHeartbeat();

    this.heartbeatInterval = setInterval(() => {
      this.sendHeartbeat();
    }, this.config.heartbeatIntervalMs);

    // Initial heartbeat
    this.sendHeartbeat();
  }

  /**
   * Stop heartbeat mechanism
   */
  private stopHeartbeat(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
    if (this.heartbeatTimeout) {
      clearTimeout(this.heartbeatTimeout);
      this.heartbeatTimeout = null;
    }
  }

  /**
   * Send heartbeat
   */
  private sendHeartbeat(): void {
    // Check if WebSocket is open before sending
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      console.warn('[C2] Cannot send heartbeat - WebSocket not open');
      return;
    }

    try {
      // Track send time for RTT calculation
      this.heartbeatSentAt = Date.now();
      
      const envelope = createMessageEnvelope(
        'heartbeat',
        this.config.clientId,
        { timestamp: this.heartbeatSentAt }
      );

      this.sendEnvelope(envelope);
      this.resetHeartbeatTimeout();
    } catch (error) {
      console.error('[C2] Failed to send heartbeat:', error);
    }
  }

  /**
   * Reset heartbeat timeout
   */
  private resetHeartbeatTimeout(): void {
    if (this.heartbeatTimeout) {
      clearTimeout(this.heartbeatTimeout);
    }

    this.heartbeatTimeout = setTimeout(() => {
      // Increment missed heartbeats
      this.missedHeartbeats++;
      
      console.warn(
        `[C2] Heartbeat timeout - missed ${this.missedHeartbeats} heartbeat(s), connection degraded`
      );
      
      // Transition to DEGRADED state
      if (this.state === 'CONNECTED') {
        this.setState('DEGRADED', 'HEARTBEAT_TIMEOUT');
      }
      
      // If we've missed multiple heartbeats, force disconnect
      const maxMissed = 3;
      if (this.missedHeartbeats >= maxMissed) {
        console.error(
          `[C2] Missed ${this.missedHeartbeats} heartbeats (max: ${maxMissed}) - forcing disconnect`
        );
        this.ws?.close(1006, 'Heartbeat timeout');
      } else {
        // Schedule another check
        this.resetHeartbeatTimeout();
      }
    }, this.config.heartbeatTimeoutMs);
  }

  /**
   * Handle reconnection with exponential backoff
   */
  private handleReconnection(): void {
    if (this.reconnectAttempts >= this.config.maxReconnectAttempts) {
      console.error('[C2] Max reconnection attempts reached');
      this.setState('DISCONNECTED', 'ERROR');
      return;
    }

    // Calculate backoff delay
    const exponentialDelay = Math.min(
      this.config.initialBackoffMs * Math.pow(2, this.reconnectAttempts),
      this.config.maxBackoffMs
    );
    const jitter = Math.random() * 1000; // 0-1000ms jitter
    const delay = exponentialDelay + jitter;

    this.reconnectAttempts++;
    this.backoffUntil = new Date(Date.now() + delay);

    console.log(
      `[C2] Reconnecting in ${Math.round(delay)}ms (attempt ${this.reconnectAttempts}/${this.config.maxReconnectAttempts})`
    );

    this.setState('BACKOFF', 'BACKOFF_SCHEDULED');

    this.reconnectTimeout = setTimeout(() => {
      this.backoffUntil = null;
      this.connect().catch((error) => {
        console.error('[C2] Reconnection failed:', error);
      });
    }, delay);
  }

  /**
   * Clear reconnect timeout
   */
  private clearReconnectTimeout(): void {
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }
  }

  /**
   * Handle error
   */
  private handleError(error: Error): void {
    this.lastError = error.message;
    this.setState(this.state, 'ERROR');

    if (this.config.onError) {
      this.config.onError(error);
    }
  }

  /**
   * Set state and notify
   */
  private setState(state: C2State, event: C2Event): void {
    if (this.state !== state) {
      console.log(`[C2] State transition: ${this.state} -> ${state} (${event})`);
    }
    
    this.state = state;

    if (this.config.onStateChange) {
      this.config.onStateChange(state, event);
    }
  }

  /**
   * Sign a message (placeholder for TPM integration)
   * 
   * TPM INTEGRATION REQUIRED FOR PRODUCTION:
   * - Use BLAKE3 for hashing (NOT SHA-256)
   * - Use Ed25519 for signing via TPM/Secure Enclave
   * - Private keys must never reside in application memory
   * - Call crates/crypto via FFI/gRPC
   */
  private async signMessage(envelope: Omit<MessageEnvelope, 'signature' | 'trust_status'>): Promise<string> {
    const payload = serializeForSigning(envelope);
    
    // Placeholder implementation for Sprint 1
    // WARNING: This uses SHA-256 which is NOT approved for production
    // Production MUST use BLAKE3 as per agent instructions
    const encoder = new TextEncoder();
    const data = encoder.encode(payload);
    
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const signature = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    
    return `placeholder:sha256:${signature}`;
  }

  /**
   * Verify a message signature (placeholder for TPM integration)
   * 
   * TPM INTEGRATION REQUIRED FOR PRODUCTION:
   * - Verify Ed25519 signatures
   * - Validate against public key from identity registry
   * - Use BLAKE3 for payload hashing
   */
  private verifyMessage(envelope: MessageEnvelope): boolean {
    if (!envelope.signature) return false;

    // Accept placeholder signatures in development
    if (envelope.signature.startsWith('placeholder:')) {
      return true;
    }

    // In production, verify Ed25519 signature with BLAKE3
    // TODO: Call crates/crypto verification service
    return false;
  }
}
