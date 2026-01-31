/**
 * WebSocket Manager - Aetheric Link Protocol
 * 
 * Implements the signed heartbeat protocol for C2 channel authentication.
 * Every 5 seconds, the client cryptographically proves its identity via
 * TPM-backed Ed25519 signatures. Missing 2 heartbeats triggers Dead Man's Switch.
 * 
 * Fail-Visible Doctrine:
 * - If TPM signing fails, the link is SEVERED immediately
 * - If the backend rejects verification, the link is SEVERED
 * - No "graceful degradation" for security failures
 */

import { invoke } from '@tauri-apps/api/core';
import { useCommStore } from '../../store/useCommStore';

export type ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'unverified' | 'severed';

export interface HeartbeatPayload {
  ts: number;
  nonce: string;
}

export interface HeartbeatMessage {
  type: 'HEARTBEAT';
  payload: string;
  signature: string;
}

export class WebSocketManager {
  private ws: WebSocket | null = null;
  private heartbeatInterval: NodeJS.Timeout | null = null;
  private url: string;
  private connectionStatus: ConnectionStatus = 'disconnected';
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;
  private reconnectDelay = 2000;
  private heartbeatInProgress = false;

  constructor(url: string) {
    this.url = url;
  }

  /**
   * Connect to the gateway WebSocket server
   */
  public connect(): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      console.warn('[AETHERIC LINK] Already connected');
      return;
    }

    this.setConnectionStatus('connecting');

    try {
      this.ws = new WebSocket(this.url);

      this.ws.onopen = () => {
        console.log('[AETHERIC LINK] Connection established');
        this.setConnectionStatus('unverified');
        this.reconnectAttempts = 0;
        this.startAethericLink();
      };

      this.ws.onmessage = (event) => {
        this.handleMessage(event.data);
      };

      this.ws.onerror = (error) => {
        console.error('[AETHERIC LINK] WebSocket error:', error);
        this.setConnectionStatus('severed');
      };

      this.ws.onclose = () => {
        console.warn('[AETHERIC LINK] Connection closed');
        this.stopAethericLink();
        this.setConnectionStatus('disconnected');
        this.attemptReconnect();
      };
    } catch (error) {
      console.error('[AETHERIC LINK] Failed to create WebSocket:', error);
      this.setConnectionStatus('severed');
    }
  }

  /**
   * Disconnect from the gateway
   */
  public disconnect(): void {
    this.stopAethericLink();
    
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    
    this.setConnectionStatus('disconnected');
  }

  /**
   * Start the Aetheric Link heartbeat loop
   * 
   * Runs every 5 seconds:
   * 1. Generate timestamp + nonce payload
   * 2. Sign with TPM via Tauri command
   * 3. Send signed heartbeat to backend
   * 4. Fail-visible: TPM error or socket failure severs the link
   */
  private startAethericLink(): void {
    // Clear any existing interval
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
    }

    // Send first heartbeat immediately
    this.sendHeartbeat();

    // Then send every 5 seconds (with overlap protection)
    this.heartbeatInterval = setInterval(() => {
      // Skip if previous heartbeat still in progress
      if (!this.heartbeatInProgress) {
        this.sendHeartbeat();
      }
    }, 5000);
  }

  /**
   * Stop the Aetheric Link heartbeat loop
   */
  private stopAethericLink(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
  }

  /**
   * Send a signed heartbeat to the backend
   */
  private async sendHeartbeat(): Promise<void> {
    // Set in-progress flag to prevent overlapping calls
    this.heartbeatInProgress = true;

    try {
      // Generate nonce payload
      const payload: HeartbeatPayload = {
        ts: Date.now(),
        nonce: crypto.randomUUID(),
      };
      const payloadString = JSON.stringify(payload);

      // Sign with TPM via Tauri command
      const signature = await invoke<string>('sign_heartbeat_payload', {
        nonce: payloadString,
      });

      // Send over WebSocket
      const message: HeartbeatMessage = {
        type: 'HEARTBEAT',
        payload: payloadString,
        signature,
      };

      this.send(message);

      // Update status to connected after first successful heartbeat
      if (this.connectionStatus === 'unverified') {
        this.setConnectionStatus('connected');
      }

      console.debug('[AETHERIC LINK] Heartbeat sent');
    } catch (error) {
      console.error('[CRITICAL] TPM Signing Failed. Severing Link:', error);
      
      // Fail-Visible: Kill the connection client-side too
      this.disconnect();
      this.setConnectionStatus('severed');
      
      // Dispatch global event for UI
      this.dispatchAethericLinkSevered('TPM signing failure');
    } finally {
      // Clear in-progress flag
      this.heartbeatInProgress = false;
    }
  }

  /**
   * Send a message over the WebSocket
   */
  private send(message: unknown): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      console.error('[AETHERIC LINK] Cannot send - WebSocket not open');
      this.setConnectionStatus('severed');
      return;
    }

    try {
      this.ws.send(JSON.stringify(message));
    } catch (error) {
      console.error('[AETHERIC LINK] Failed to send message:', error);
      this.setConnectionStatus('severed');
    }
  }

  /**
   * Handle incoming WebSocket messages
   */
  private handleMessage(data: string): void {
    try {
      const message = JSON.parse(data);
      
      // Handle different message types
      switch (message.type) {
        case 'HEARTBEAT_ACK':
          console.debug('[AETHERIC LINK] Heartbeat acknowledged');
          break;
        case 'VERIFICATION_FAILED':
          console.error('[SECURITY] Backend verification failed');
          this.disconnect();
          this.setConnectionStatus('severed');
          this.dispatchAethericLinkSevered('Backend verification failed');
          break;
        default:
          console.log('[AETHERIC LINK] Received message:', message);
      }
    } catch (error) {
      console.error('[AETHERIC LINK] Failed to parse message:', error);
    }
  }

  /**
   * Attempt to reconnect after connection loss
   */
  private attemptReconnect(): void {
    if (this.connectionStatus === 'severed') {
      // Don't auto-reconnect after security failure
      console.warn('[AETHERIC LINK] Not reconnecting after security failure');
      return;
    }

    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.error('[AETHERIC LINK] Max reconnect attempts reached');
      this.setConnectionStatus('severed');
      return;
    }

    this.reconnectAttempts++;
    const delay = this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1);
    
    console.log(`[AETHERIC LINK] Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts})`);
    
    setTimeout(() => {
      this.connect();
    }, delay);
  }

  /**
   * Update connection status and notify store
   */
  private setConnectionStatus(status: ConnectionStatus): void {
    this.connectionStatus = status;
    useCommStore.getState().setConnectionStatus(status);
  }

  /**
   * Dispatch global event when Aetheric Link is severed
   */
  private dispatchAethericLinkSevered(reason: string): void {
    const event = new CustomEvent('AETHER_LINK_SEVERED', {
      detail: { reason },
    });
    window.dispatchEvent(event);
  }

  /**
   * Get current connection status
   */
  public getStatus(): ConnectionStatus {
    return this.connectionStatus;
  }
}

// Singleton instance
let wsManagerInstance: WebSocketManager | null = null;

/**
 * Get or create WebSocket Manager singleton
 */
export function getWebSocketManager(url?: string): WebSocketManager {
  if (!wsManagerInstance && url) {
    wsManagerInstance = new WebSocketManager(url);
  }
  
  if (!wsManagerInstance) {
    throw new Error('WebSocketManager not initialized. Provide URL on first call.');
  }
  
  return wsManagerInstance;
}
