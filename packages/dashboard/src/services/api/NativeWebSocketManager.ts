/**
 * Native WebSocket Manager for Tactical Glass
 *
 * Replaces SignalR with direct WebSocket protocol for AetherCore Gateway.
 * Implements hardware-rooted authentication with TPM-backed Ed25519 signatures.
 *
 * Fail-Visible Doctrine:
 * - If TPM signing fails, connection is SEVERED immediately
 * - If backend rejects authentication, connection is SEVERED
 * - No "graceful degradation" for security failures
 */

import { invoke } from '@tauri-apps/api/core';
import { useCommStore } from '../../store/useCommStore';
import { getRuntimeConfig } from '../../config/runtime';
import { validateWebSocketEndpoint } from '../../utils/endpoint-validation';

export type ConnectionStatus =
  | 'disconnected'
  | 'connecting'
  | 'connected'
  | 'unverified'
  | 'severed';
export type ConnectionState = 'connected' | 'intermittent' | 'disconnected';

// Message types matching gateway contract
interface OutboundMessage {
  type: string;
  [key: string]: unknown;
}

interface InboundMessage {
  type: string;
  [key: string]: unknown;
}

interface PresenceMessage extends OutboundMessage {
  type: 'presence';
  payload: {
    clientId: string;
    status: 'online' | 'offline' | 'busy' | 'away';
    trustScore: number;
    verified: boolean;
  };
  signature?: string;
  timestamp?: string;
}

export class NativeWebSocketManager {
  private ws: WebSocket | null = null;
  private heartbeatInterval: NodeJS.Timeout | null = null;
  private reconnectTimeout: NodeJS.Timeout | null = null;
  private heartbeatTimeoutCheck: NodeJS.Timeout | null = null;
  private url: string;
  private connectionStatus: ConnectionStatus = 'disconnected';
  private connectionState: ConnectionState = 'disconnected';
  private deviceId: string | null = null; // Cached hardware ID from TPM
  private reconnectAttempts: number = 0;
  private readonly maxReconnectAttempts: number;
  private readonly initialRetryDelay: number;
  private readonly maxRetryDelay: number;
  private lastHeartbeatAck: number = 0;
  private readonly intermittentThreshold: number = 500;
  private readonly disconnectedThreshold: number = 2000;
  private messageHandlers: Map<string, (msg: InboundMessage) => void> = new Map();

  constructor(url: string) {
    // Validate endpoint before storing
    const validation = validateWebSocketEndpoint(url);
    if (!validation.valid) {
      throw new Error(
        `[AETHERIC LINK] Invalid WebSocket endpoint: ${validation.error}`
      );
    }

    this.url = url;

    const { unified } = getRuntimeConfig();
    this.maxReconnectAttempts = unified.connection_retry.max_retries;
    this.initialRetryDelay = unified.connection_retry.initial_delay_ms;
    this.maxRetryDelay = unified.connection_retry.max_delay_ms;

    // Log security posture
    if (validation.isLocalhost && validation.protocol === 'ws') {
      console.warn(
        '[AETHERIC LINK] INSECURE LOCALHOST MODE: Using ws:// for localhost. This is only allowed in development with DEV_ALLOW_INSECURE_LOCALHOST=true'
      );
    }
  }

  public async connect(): Promise<void> {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) return;

    this.setConnectionStatus('connecting');

    try {
      // 1. Get Hardware ID from TPM before connecting
      if (!this.deviceId) {
        try {
          this.deviceId = await invoke<string>('get_hardware_identity');
          console.log(`[AETHERIC LINK] Hardware identity retrieved: ${this.deviceId}`);
        } catch (error) {
          console.error('[AETHERIC LINK] Failed to retrieve hardware identity:', error);
          // Fallback for development (TPM not available)
          const { tpmEnabled } = getRuntimeConfig();
          if (!tpmEnabled) {
            this.deviceId = 'DEVELOPMENT-DEVICE-PLACEHOLDER';
            console.warn('[AETHERIC LINK] Using development placeholder identity');
          } else {
            throw new Error('Hardware identity retrieval failed in TPM-enabled mode');
          }
        }
      }

      // 2. Create WebSocket connection
      this.ws = new WebSocket(this.url);

      // 3. Setup event handlers
      this.ws.onopen = () => {
        console.log('[AETHERIC LINK] Connection established');
        this.setConnectionStatus('unverified');
        this.reconnectAttempts = 0;
        this.startAethericLink();
      };

      this.ws.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data) as InboundMessage;
          this.handleMessage(message);
        } catch (error) {
          console.error('[AETHERIC LINK] Failed to parse message:', error);
        }
      };

      this.ws.onclose = (event) => {
        console.log(`[AETHERIC LINK] Connection closed: ${event.code} ${event.reason}`);
        this.stopAethericLink();

        if (this.connectionStatus !== 'severed') {
          this.handleDisconnection();
        }
      };

      this.ws.onerror = (error) => {
        console.error('[AETHERIC LINK] WebSocket error:', error);
      };
    } catch (error) {
      console.error('[AETHERIC LINK] Connection failed:', error);
      this.setConnectionStatus('disconnected');
      this.handleDisconnection();
    }
  }

  public disconnect(): void {
    this.stopAethericLink();
    this.clearReconnectTimeout();
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.setConnectionStatus('disconnected');
    this.reconnectAttempts = 0;
  }

  public onMessage(type: string, handler: (msg: InboundMessage) => void): void {
    this.messageHandlers.set(type, handler);
  }

  private handleMessage(message: InboundMessage): void {
    // Handle built-in message types
    switch (message.type) {
      case 'PRESENCE_ACK':
        this.lastHeartbeatAck = Date.now();
        if (this.connectionStatus !== 'connected') {
          this.setConnectionStatus('connected');
        }
        this.setConnectionState('connected');
        this.reconnectAttempts = 0;
        break;

      case 'AUTH_REJECTED':
        console.error('[CRITICAL] Backend rejected authentication');
        this.severLink('Backend Authentication Failed');
        break;

      case 'FORCE_DISCONNECT':
        console.error('[CRITICAL] Remote Kill Switch Activated');
        this.severLink(`Remote Command: ${(message as any).reason || 'Unknown'}`);
        break;

      case 'ERROR':
        console.error('[AETHERIC LINK] Gateway error:', message);
        break;

      default:
        // Forward to registered handlers
        const handler = this.messageHandlers.get(message.type);
        if (handler) {
          handler(message);
        } else {
          console.debug('[AETHERIC LINK] Unhandled message type:', message.type);
        }
    }
  }

  private handleDisconnection(): void {
    if (this.connectionStatus === 'severed') {
      console.log('[AETHERIC LINK] Connection severed - no retry');
      return;
    }

    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.error('[AETHERIC LINK] Max reconnection attempts reached');
      this.setConnectionStatus('disconnected');
      return;
    }

    const exponentialDelay = Math.min(
      this.initialRetryDelay * Math.pow(2, this.reconnectAttempts),
      this.maxRetryDelay
    );
    const jitter = Math.random() * 1000;
    const delay = exponentialDelay + jitter;

    this.reconnectAttempts++;
    console.log(
      `[AETHERIC LINK] Scheduling reconnect attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts} in ${Math.round(delay)}ms`
    );

    this.clearReconnectTimeout();
    this.reconnectTimeout = setTimeout(() => {
      console.log('[AETHERIC LINK] Attempting to reconnect...');
      this.connect().catch((err) => {
        console.error('[AETHERIC LINK] Reconnection attempt failed:', err);
      });
    }, delay);
  }

  private clearReconnectTimeout(): void {
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }
  }

  private severLink(reason: string): void {
    this.stopAethericLink();
    this.clearReconnectTimeout();
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.setConnectionStatus('severed');
    window.dispatchEvent(new CustomEvent('AETHER_LINK_SEVERED', { detail: { reason } }));
  }

  private startAethericLink(): void {
    if (this.heartbeatInterval) clearInterval(this.heartbeatInterval);
    if (this.heartbeatTimeoutCheck) clearInterval(this.heartbeatTimeoutCheck);

    // Initial heartbeat
    this.sendHeartbeat();
    this.lastHeartbeatAck = Date.now();

    // 5-second cadence for heartbeat
    this.heartbeatInterval = setInterval(() => {
      if (this.ws?.readyState === WebSocket.OPEN) {
        this.sendHeartbeat();
      }
    }, 5000);

    // 100ms check cadence for heartbeat timeout monitoring
    this.heartbeatTimeoutCheck = setInterval(() => {
      this.checkHeartbeatTimeout();
    }, 100);
  }

  private stopAethericLink(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
    if (this.heartbeatTimeoutCheck) {
      clearInterval(this.heartbeatTimeoutCheck);
      this.heartbeatTimeoutCheck = null;
    }
  }

  private checkHeartbeatTimeout(): void {
    if (this.connectionStatus !== 'connected' && this.connectionStatus !== 'unverified') {
      return;
    }

    const timeSinceLastAck = Date.now() - this.lastHeartbeatAck;

    if (timeSinceLastAck > this.disconnectedThreshold) {
      if (this.connectionState !== 'disconnected') {
        console.warn('[HEARTBEAT SENTINEL] Signal degraded - DISCONNECTED');
        this.setConnectionState('disconnected');
      }
    } else if (timeSinceLastAck > this.intermittentThreshold) {
      if (this.connectionState !== 'intermittent') {
        console.warn('[HEARTBEAT SENTINEL] Signal degraded - INTERMITTENT');
        this.setConnectionState('intermittent');
      }
    } else {
      if (this.connectionState !== 'connected') {
        this.setConnectionState('connected');
      }
    }
  }

  private async sendHeartbeat(): Promise<void> {
    try {
      if (!this.deviceId) {
        throw new Error('Device ID not initialized');
      }

      const timestamp = new Date().toISOString();
      const { tpmEnabled } = getRuntimeConfig();

      let signature: string | undefined;
      if (tpmEnabled) {
        // Create signable payload
        const signablePayload = `${this.deviceId}:${timestamp}`;

        try {
          // Invoke Tauri command for TPM signing
          signature = await invoke<string>('sign_heartbeat_payload', {
            payload: signablePayload,
          });
        } catch (error) {
          console.error('[AETHERIC LINK] TPM signing failed:', error);
          this.severLink('TPM Signing Failure');
          return;
        }
      }

      // Build presence message matching gateway contract
      const presenceMessage: PresenceMessage = {
        type: 'presence',
        payload: {
          clientId: this.deviceId,
          status: 'online',
          trustScore: 1.0,
          verified: tpmEnabled,
        },
        signature,
        timestamp,
      };

      this.sendMessage(presenceMessage);
    } catch (error) {
      console.error('[AETHERIC LINK] Heartbeat failed:', error);

      const { tpmEnabled } = getRuntimeConfig();
      if (tpmEnabled) {
        this.severLink('Heartbeat Generation Failure');
      } else {
        console.warn('[AETHERIC LINK] Heartbeat failed in TPM-disabled mode');
      }
    }
  }

  private sendMessage(message: OutboundMessage): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      console.warn('[AETHERIC LINK] Cannot send message: connection not open');
      return;
    }

    try {
      this.ws.send(JSON.stringify(message));
    } catch (error) {
      console.error('[AETHERIC LINK] Failed to send message:', error);
    }
  }

  private setConnectionStatus(status: ConnectionStatus): void {
    this.connectionStatus = status;
    useCommStore.getState().setConnectionStatus(status);
  }

  private setConnectionState(state: ConnectionState): void {
    this.connectionState = state;
    useCommStore.getState().setConnectionState?.(state);
  }

  public getStatus(): ConnectionStatus {
    return this.connectionStatus;
  }

  public getConnectionState(): ConnectionState {
    return this.connectionState;
  }
}

// Singleton instance
let wsManagerInstance: NativeWebSocketManager | null = null;

export function getNativeWebSocketManager(url?: string): NativeWebSocketManager {
  if (!wsManagerInstance && url) {
    wsManagerInstance = new NativeWebSocketManager(url);
  }

  if (!wsManagerInstance) {
    throw new Error('NativeWebSocketManager not initialized. Provide URL on first call.');
  }

  return wsManagerInstance;
}
