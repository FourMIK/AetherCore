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
  setEnvelopeVerificationStatus,
} from '@aethercore/shared';

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
  maxMissedHeartbeats?: number; // Max missed heartbeats before disconnect (default: 3)
  rttSmoothingFactor?: number; // RTT exponential moving average factor (default: 0.8)
  onStateChange?: (state: C2State, event: C2Event) => void;
  onMessage?: (message: MessageEnvelope) => void;
  onRalphiePresence?: (presence: RalphiePresenceFrame) => void;
  onRalphiePresenceSnapshot?: (nodes: RalphiePresenceFrame[]) => void;
  onSystemStatus?: (status: SystemStatusFrame) => void;
  onError?: (error: Error) => void;
}

export interface RalphiePresenceIdentity {
  device_id: string;
  public_key?: string;
  chat_public_key?: string;
  hardware_serial: string;
  certificate_serial: string;
  trust_score: number;
  enrolled_at: number;
  tpm_backed: boolean;
}

export interface RalphiePresenceTelemetryGps {
  lat?: number;
  lon?: number;
  latitude?: number;
  longitude?: number;
  alt_m?: number;
  altitude_m?: number;
  fix?: boolean;
  sats?: number;
  hdop?: number;
  speed_mps?: number;
  course_deg?: number;
  timestamp?: number;
  source?: string;
}

export interface RalphiePresenceTelemetryPower {
  battery_pct?: number;
  voltage_v?: number;
  charging?: boolean;
  external_power?: boolean;
}

export interface RalphiePresenceTelemetryRadio {
  snr_db?: number;
  rssi_dbm?: number;
  lora_snr_db?: number;
  lora_rssi_dbm?: number;
}

export interface RalphiePresenceTelemetryDevice {
  model?: string;
  firmware?: string;
  transport?: string;
  role?: string;
}

export interface RalphiePresenceTelemetry {
  gps?: RalphiePresenceTelemetryGps;
  power?: RalphiePresenceTelemetryPower;
  radio?: RalphiePresenceTelemetryRadio;
  device?: RalphiePresenceTelemetryDevice;
}

export interface RalphiePresenceFrame {
  type: 'RALPHIE_PRESENCE';
  reason: 'startup' | 'heartbeat';
  timestamp: number;
  endpoint: string;
  last_disconnect_reason?: string;
  identity: RalphiePresenceIdentity;
  telemetry?: RalphiePresenceTelemetry;
  received_at?: number;
}

export interface SystemStatusFrame {
  type: 'SYSTEM_STATUS';
  status: 'ONLINE' | 'DEGRADED' | 'OFFLINE' | string;
  backend: 'CONNECTED' | 'UNREACHABLE' | string;
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
  private signingKeyPair: CryptoKeyPair | null = null;
  private signingPublicKeyPem: string | null = null;
  private senderVerificationKeys: Map<string, CryptoKey> = new Map();
  private chatKeyPair: CryptoKeyPair | null = null;
  private chatPublicKeyPem: string | null = null;
  private senderChatEncryptionKeys: Map<string, CryptoKey> = new Map();
  private chatEpochCounter = 0;
  private readonly signingReady: Promise<void>;
  private readonly chatCryptoReady: Promise<void>;
  
  // Configuration constants with defaults
  private readonly maxMissedHeartbeats: number;
  private readonly rttSmoothingFactor: number;
  private readonly rttNewWeight: number;

  constructor(config: C2ClientConfig) {
    this.config = config;
    this.maxMissedHeartbeats = config.maxMissedHeartbeats ?? 3;
    this.rttSmoothingFactor = config.rttSmoothingFactor ?? 0.8;
    this.rttNewWeight = 1 - this.rttSmoothingFactor;
    this.signingReady = config.signingEnabled
      ? this.initializeSigningMaterial()
      : Promise.resolve();
    this.signingReady.catch((error) => {
      console.error('[C2] Signing initialization failed:', error);
    });
    this.chatCryptoReady = this.initializeChatCryptoMaterial();
    this.chatCryptoReady.catch((error) => {
      console.error('[C2] Chat encryption initialization failed:', error);
    });
  }

  /**
   * Connect to C2 endpoint
   */
  public async connect(): Promise<void> {
    if (this.state === 'CONNECTING' || this.state === 'CONNECTED') {
      console.warn('[C2] Already connected or connecting');
      return;
    }

    if (this.config.signingEnabled) {
      await this.signingReady;
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
        void this.handleMessage(event.data);
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
    await this.signingReady;
    await this.chatCryptoReady;
    let outgoingPayload = payload;
    if (type === 'chat' && payload && typeof payload === 'object') {
      outgoingPayload = await this.encryptChatPayload(payload as Record<string, unknown>);
    }
    if (type === 'presence' && payload && typeof payload === 'object') {
      outgoingPayload = {
        ...(payload as Record<string, unknown>),
        ...(this.config.signingEnabled ? { public_key: this.signingPublicKeyPem } : {}),
        chat_public_key: this.chatPublicKeyPem,
      };
    }

    const envelope = createMessageEnvelope(
      type,
      this.config.clientId,
      outgoingPayload
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
  private async handleMessage(data: string): Promise<void> {
    try {
      const json = JSON.parse(data);

      // Local gateway compatibility: accept non-envelope status frames.
      if (json && typeof json === 'object' && 'type' in json) {
        const messageType = (json as { type?: unknown }).type;
        if (
          messageType === 'SYSTEM_STATUS' ||
          messageType === 'COMMAND_ACK' ||
          messageType === 'ERROR'
        ) {
          if (messageType === 'SYSTEM_STATUS' && this.config.onSystemStatus) {
            const status = json as SystemStatusFrame;
            this.config.onSystemStatus(status);
          }
          this.lastMessageReceived = new Date();
          this.setState(this.state, 'MESSAGE_RX');
          return;
        }

        if (messageType === 'RALPHIE_PRESENCE') {
          const frame = json as { data?: RalphiePresenceFrame };
          if (frame.data?.identity?.device_id) {
            await this.cacheSenderPublicKey(frame.data.identity.device_id, frame.data.identity.public_key);
            await this.cacheSenderChatKey(frame.data.identity.device_id, frame.data.identity.chat_public_key);
          }
          if (frame.data && this.config.onRalphiePresence) {
            this.config.onRalphiePresence(frame.data);
          }
          this.lastMessageReceived = new Date();
          this.setState(this.state, 'MESSAGE_RX');
          return;
        }

        if (messageType === 'RALPHIE_PRESENCE_SNAPSHOT') {
          const snapshot = json as { nodes?: RalphiePresenceFrame[] };
          if (Array.isArray(snapshot.nodes)) {
            await Promise.all(
              snapshot.nodes.flatMap((node) => [
                this.cacheSenderPublicKey(node.identity.device_id, node.identity.public_key),
                this.cacheSenderChatKey(node.identity.device_id, node.identity.chat_public_key),
              ]),
            );
          }
          if (Array.isArray(snapshot.nodes) && this.config.onRalphiePresenceSnapshot) {
            this.config.onRalphiePresenceSnapshot(snapshot.nodes);
          }
          this.lastMessageReceived = new Date();
          this.setState(this.state, 'MESSAGE_RX');
          return;
        }
      }

      const envelope = parseMessageEnvelope(json);

      this.lastMessageReceived = new Date();

      // Normalize verification semantics for legacy and guardian status fields.
      if (envelope.signature && this.config.signingEnabled) {
        const verified = await this.verifyMessage(envelope);
        setEnvelopeVerificationStatus(envelope, verified ? 'VERIFIED' : 'SPOOFED');
      } else if (!envelope.signature) {
        setEnvelopeVerificationStatus(envelope, 'STATUS_UNVERIFIED');
      }
      const payloadChatPublicKey = this.extractChatPublicKeyFromPayload(envelope.payload);
      if (payloadChatPublicKey) {
        await this.cacheSenderChatKey(envelope.from, payloadChatPublicKey);
      }

      if (envelope.type === 'chat' && envelope.payload && typeof envelope.payload === 'object') {
        try {
          envelope.payload = await this.decryptChatPayload(
            envelope.from,
            envelope.payload as Record<string, unknown>,
          );
        } catch (error) {
          console.warn(
            `[C2] Rejected encrypted chat payload from ${envelope.from}: ${error instanceof Error ? error.message : String(error)}`,
          );
          return;
        }
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
          this.rttMs = this.rttMs 
            ? (this.rttMs * this.rttSmoothingFactor + rtt * this.rttNewWeight) 
            : rtt;
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

    if (this.config.heartbeatIntervalMs <= 0 || this.config.heartbeatTimeoutMs <= 0) {
      return;
    }

    this.heartbeatInterval = setInterval(() => {
      this.sendHeartbeat();
    }, this.config.heartbeatIntervalMs) as unknown as number;

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
    if (this.config.heartbeatTimeoutMs <= 0) {
      return;
    }

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
      if (this.missedHeartbeats >= this.maxMissedHeartbeats) {
        console.error(
          `[C2] Missed ${this.missedHeartbeats} heartbeats (max: ${this.maxMissedHeartbeats}) - forcing disconnect`
        );
        this.ws?.close(1006, 'Heartbeat timeout');
      } else {
        // Schedule another check
        this.resetHeartbeatTimeout();
      }
    }, this.config.heartbeatTimeoutMs) as unknown as number;
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
    }, delay) as unknown as number;
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

  private async initializeSigningMaterial(): Promise<void> {
    const subtle = globalThis.crypto?.subtle;
    if (!subtle) {
      throw new Error('WebCrypto subtle API is unavailable; cannot initialize C2 signing');
    }
    const generated = (await subtle.generateKey(
      { name: 'Ed25519' } as AlgorithmIdentifier,
      true,
      ['sign', 'verify'],
    )) as CryptoKeyPair;
    this.signingKeyPair = generated;
    this.signingPublicKeyPem = await this.exportPublicKeyToPem(generated.publicKey);
    this.senderVerificationKeys.set(this.config.clientId, generated.publicKey);
  }

  private async initializeChatCryptoMaterial(): Promise<void> {
    const subtle = globalThis.crypto?.subtle;
    if (!subtle) {
      throw new Error('WebCrypto subtle API is unavailable; cannot initialize chat encryption');
    }
    const generated = (await subtle.generateKey(
      { name: 'ECDH', namedCurve: 'P-256' },
      true,
      ['deriveBits'],
    )) as CryptoKeyPair;
    this.chatKeyPair = generated;
    this.chatPublicKeyPem = await this.exportPublicKeyToPem(generated.publicKey);
    this.senderChatEncryptionKeys.set(this.config.clientId, generated.publicKey);
  }

  private async deriveChatAesKey(
    privateKey: CryptoKey,
    peerPublicKey: CryptoKey,
    usage: 'encrypt' | 'decrypt',
  ): Promise<CryptoKey> {
    const subtle = globalThis.crypto?.subtle;
    if (!subtle) {
      throw new Error('WebCrypto subtle API is unavailable; cannot derive chat key');
    }

    // Keep KDF behavior aligned with mesh-client.ts: AES key = SHA-256(ECDH shared secret).
    const sharedSecret = await subtle.deriveBits(
      {
        name: 'ECDH',
        public: peerPublicKey,
      },
      privateKey,
      256,
    );
    const hashedSecret = await subtle.digest('SHA-256', sharedSecret);
    return subtle.importKey(
      'raw',
      hashedSecret,
      { name: 'AES-GCM' },
      false,
      [usage],
    );
  }

  private normalizePublicKeyPem(value: unknown): string | null {
    if (typeof value !== 'string') {
      return null;
    }
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }

  private bytesToBase64(bytes: Uint8Array): string {
    let binary = '';
    for (let i = 0; i < bytes.length; i += 1) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
  }

  private base64ToBytes(value: string): Uint8Array {
    const binary = atob(value);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
  }

  private pemToArrayBuffer(pem: string): ArrayBuffer {
    const normalized = pem
      .replace(/-----BEGIN PUBLIC KEY-----/g, '')
      .replace(/-----END PUBLIC KEY-----/g, '')
      .replace(/\s+/g, '');
    const binary = atob(normalized);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes.buffer;
  }

  private arrayBufferToPem(buffer: ArrayBuffer): string {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    for (let i = 0; i < bytes.length; i += 1) {
      binary += String.fromCharCode(bytes[i]);
    }
    const b64 = btoa(binary);
    const lines = b64.match(/.{1,64}/g) ?? [];
    return `-----BEGIN PUBLIC KEY-----\n${lines.join('\n')}\n-----END PUBLIC KEY-----`;
  }

  private async exportPublicKeyToPem(publicKey: CryptoKey): Promise<string> {
    const subtle = globalThis.crypto?.subtle;
    if (!subtle) {
      throw new Error('WebCrypto subtle API is unavailable; cannot export public key');
    }
    const spki = await subtle.exportKey('spki', publicKey);
    return this.arrayBufferToPem(spki);
  }

  private async importPublicKeyFromPem(pem: string): Promise<CryptoKey> {
    const subtle = globalThis.crypto?.subtle;
    if (!subtle) {
      throw new Error('WebCrypto subtle API is unavailable; cannot import public key');
    }
    const spkiBuffer = this.pemToArrayBuffer(pem);
    return subtle.importKey(
      'spki',
      spkiBuffer,
      { name: 'Ed25519' } as AlgorithmIdentifier,
      true,
      ['verify'],
    );
  }

  private async importChatPublicKeyFromPem(pem: string): Promise<CryptoKey> {
    const subtle = globalThis.crypto?.subtle;
    if (!subtle) {
      throw new Error('WebCrypto subtle API is unavailable; cannot import chat public key');
    }
    const spkiBuffer = this.pemToArrayBuffer(pem);
    return subtle.importKey(
      'spki',
      spkiBuffer,
      { name: 'ECDH', namedCurve: 'P-256' },
      true,
      [],
    );
  }

  private async cacheSenderPublicKey(senderId: string, candidate: unknown): Promise<void> {
    const normalizedPem = this.normalizePublicKeyPem(candidate);
    if (!normalizedPem || senderId.length === 0) {
      return;
    }
    try {
      const imported = await this.importPublicKeyFromPem(normalizedPem);
      this.senderVerificationKeys.set(senderId, imported);
    } catch (error) {
      console.warn(
        `[C2] Ignoring invalid public key for sender ${senderId}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  private async cacheSenderChatKey(senderId: string, candidate: unknown): Promise<void> {
    const normalizedPem = this.normalizePublicKeyPem(candidate);
    if (!normalizedPem || senderId.length === 0) {
      return;
    }
    try {
      const imported = await this.importChatPublicKeyFromPem(normalizedPem);
      this.senderChatEncryptionKeys.set(senderId, imported);
    } catch (error) {
      console.warn(
        `[C2] Ignoring invalid chat encryption key for sender ${senderId}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  private extractPublicKeyFromPayload(payload: unknown): string | null {
    if (!payload || typeof payload !== 'object') {
      return null;
    }
    const record = payload as Record<string, unknown>;
    return this.normalizePublicKeyPem(record.public_key ?? record.publicKey);
  }

  private extractChatPublicKeyFromPayload(payload: unknown): string | null {
    if (!payload || typeof payload !== 'object') {
      return null;
    }
    const record = payload as Record<string, unknown>;
    return this.normalizePublicKeyPem(
      record.chat_public_key ??
        record.chatPublicKey ??
        record.senderChatPublicKey ??
        record.sender_chat_public_key,
    );
  }

  private async encryptChatPayload(payload: Record<string, unknown>): Promise<Record<string, unknown>> {
    const subtle = globalThis.crypto?.subtle;
    if (!subtle || !globalThis.crypto) {
      throw new Error('WebCrypto API unavailable for chat encryption');
    }

    const recipientId =
      typeof payload.recipientId === 'string' && payload.recipientId.length > 0 ? payload.recipientId : null;
    const content = typeof payload.content === 'string' ? payload.content : '';
    if (!recipientId) {
      throw new Error('chat payload is missing recipientId');
    }

    await this.chatCryptoReady;
    const recipientKey = this.senderChatEncryptionKeys.get(recipientId);
    if (!recipientKey) {
      throw new Error(`recipient ${recipientId} has not advertised a chat encryption key yet`);
    }
    if (!this.chatPublicKeyPem) {
      throw new Error('local chat encryption key is unavailable');
    }

    const senderEphemeralKeyPair = (await subtle.generateKey(
      { name: 'ECDH', namedCurve: 'P-256' },
      true,
      ['deriveBits'],
    )) as CryptoKeyPair;

    const aesKey = await this.deriveChatAesKey(
      senderEphemeralKeyPair.privateKey,
      recipientKey,
      'encrypt',
    );

    const keyEpoch = this.chatEpochCounter + 1;
    const aad = new TextEncoder().encode(`${this.config.clientId}|${recipientId}|${keyEpoch}`);
    const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
    const encrypted = new Uint8Array(
      await subtle.encrypt(
        {
          name: 'AES-GCM',
          iv,
          additionalData: aad,
          tagLength: 128,
        },
        aesKey,
        new TextEncoder().encode(content),
      ),
    );

    if (encrypted.length < 16) {
      throw new Error('invalid encrypted payload length');
    }

    const authTag = encrypted.slice(encrypted.length - 16);
    const ciphertext = encrypted.slice(0, encrypted.length - 16);
    const senderEphemeralPublicKey = await this.exportPublicKeyToPem(senderEphemeralKeyPair.publicKey);
    this.chatEpochCounter = keyEpoch;

    return {
      ...payload,
      content: '',
      encrypted: true,
      ciphertext: this.bytesToBase64(ciphertext),
      nonce: this.bytesToBase64(iv),
      authTag: this.bytesToBase64(authTag),
      senderEphemeralPublicKey,
      senderChatPublicKey: this.chatPublicKeyPem,
      keyAgreement: 'ECDH-P256',
      cipher: 'AES-256-GCM',
      keyEpoch,
    };
  }

  private async decryptChatPayload(
    senderId: string,
    payload: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    const subtle = globalThis.crypto?.subtle;
    if (!subtle) {
      throw new Error('WebCrypto API unavailable for chat decryption');
    }
    if (payload.encrypted !== true) {
      return payload;
    }

    const ciphertextB64 = typeof payload.ciphertext === 'string' ? payload.ciphertext : null;
    const nonceB64 = typeof payload.nonce === 'string' ? payload.nonce : null;
    const authTagB64 = typeof payload.authTag === 'string' ? payload.authTag : null;
    const senderEphemeralPublicKey =
      typeof payload.senderEphemeralPublicKey === 'string' ? payload.senderEphemeralPublicKey : null;
    const recipientId =
      typeof payload.recipientId === 'string' && payload.recipientId.length > 0 ? payload.recipientId : null;
    const keyEpoch = typeof payload.keyEpoch === 'number' && Number.isFinite(payload.keyEpoch) ? payload.keyEpoch : 0;

    if (!ciphertextB64 || !nonceB64 || !authTagB64 || !senderEphemeralPublicKey || !recipientId) {
      throw new Error('encrypted chat payload is missing required fields');
    }

    await this.chatCryptoReady;
    if (!this.chatKeyPair?.privateKey) {
      throw new Error('local chat private key is unavailable');
    }

    const peerEphemeralPublicKey = await this.importChatPublicKeyFromPem(senderEphemeralPublicKey);
    const aesKey = await this.deriveChatAesKey(
      this.chatKeyPair.privateKey,
      peerEphemeralPublicKey,
      'decrypt',
    );

    const ciphertext = this.base64ToBytes(ciphertextB64);
    const authTag = this.base64ToBytes(authTagB64);
    const iv = this.base64ToBytes(nonceB64);
    const ivBuffer = new Uint8Array(iv.length);
    ivBuffer.set(iv);
    const sealedPayload = new Uint8Array(ciphertext.length + authTag.length);
    sealedPayload.set(ciphertext, 0);
    sealedPayload.set(authTag, ciphertext.length);
    const aad = new TextEncoder().encode(`${senderId}|${recipientId}|${keyEpoch}`);
    const plaintext = await subtle.decrypt(
      {
        name: 'AES-GCM',
        iv: ivBuffer,
        additionalData: aad,
        tagLength: 128,
      },
      aesKey,
      sealedPayload,
    );

    return {
      ...payload,
      content: new TextDecoder().decode(plaintext),
    };
  }

  private async signMessage(
    envelope: Omit<MessageEnvelope, 'signature' | 'trust_status' | 'verification_status'>,
  ): Promise<string> {
    await this.signingReady;
    if (!this.signingKeyPair?.privateKey) {
      throw new Error('No signing key available');
    }
    const subtle = globalThis.crypto?.subtle;
    if (!subtle) {
      throw new Error('WebCrypto subtle API is unavailable; cannot sign');
    }

    const payload = serializeForSigning(envelope);
    const data = new TextEncoder().encode(payload);
    const signature = await subtle.sign(
      { name: 'Ed25519' } as AlgorithmIdentifier,
      this.signingKeyPair.privateKey,
      data,
    );
    return Array.from(new Uint8Array(signature), (byte) => byte.toString(16).padStart(2, '0')).join('');
  }

  private async verifyMessage(envelope: MessageEnvelope): Promise<boolean> {
    if (!envelope.signature || !/^[0-9a-fA-F]{128}$/.test(envelope.signature)) {
      return false;
    }

    await this.signingReady;
    const subtle = globalThis.crypto?.subtle;
    if (!subtle) {
      return false;
    }

    let verifyingKey = this.senderVerificationKeys.get(envelope.from);
    if (!verifyingKey) {
      const payloadPublicKey = this.extractPublicKeyFromPayload(envelope.payload);
      if (payloadPublicKey) {
        await this.cacheSenderPublicKey(envelope.from, payloadPublicKey);
        verifyingKey = this.senderVerificationKeys.get(envelope.from);
      }
    }
    if (!verifyingKey) {
      return false;
    }

    const canonicalPayload = serializeForSigning({
      schema_version: envelope.schema_version,
      message_id: envelope.message_id,
      timestamp: envelope.timestamp,
      type: envelope.type,
      from: envelope.from,
      payload: envelope.payload,
      nonce: envelope.nonce,
      sequence: envelope.sequence,
      previous_message_id: envelope.previous_message_id,
      transport: envelope.transport,
    });
    const data = new TextEncoder().encode(canonicalPayload);
    const signatureBytes = Uint8Array.from(
      envelope.signature.match(/.{1,2}/g)?.map((hex) => parseInt(hex, 16)) ?? [],
    );
    const valid = await subtle.verify(
      { name: 'Ed25519' } as AlgorithmIdentifier,
      verifyingKey,
      signatureBytes,
      data,
    );
    return valid;
  }
}
