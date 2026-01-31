/**
 * WebSocket Manager - Aetheric Link Protocol (SignalR Edition)
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

import { HubConnection, HubConnectionBuilder, HubConnectionState, LogLevel } from '@microsoft/signalr';
import { invoke } from '@tauri-apps/api/core';
import { useCommStore } from '../../store/useCommStore';

export type ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'unverified' | 'severed';

// Must match AetherBunker/Models/HeartbeatPayload.cs
export interface HeartbeatPayload {
  deviceId: string;
  signature: string;
  timestamp: string; // ISO 8601 for C# DateTime compatibility
}

export class WebSocketManager {
  private connection: HubConnection | null = null;
  private heartbeatInterval: NodeJS.Timeout | null = null;
  private url: string;
  private connectionStatus: ConnectionStatus = 'disconnected';
  private deviceId: string | null = null; // Cached hardware ID

  constructor(url: string) {
    this.url = url; // e.g., "http://localhost:5000/h2-tactical"
  }

  public async connect(): Promise<void> {
    if (this.connection && this.connection.state === HubConnectionState.Connected) return;

    this.setConnectionStatus('connecting');

    try {
        // 1. Get Hardware ID (TPM) before connecting
        // We need this to identify ourselves to the bunker.
        // Assuming 'get_hardware_id' is a Tauri command you have or will create.
        // For Alpha, we can derive it from the first signed payload or a specific command.
        this.deviceId = "ALPHA-TEST-DEVICE-001"; // TODO: Replace with invoke('get_tpm_id')

        this.connection = new HubConnectionBuilder()
            .withUrl(this.url)
            .withAutomaticReconnect({
                nextRetryDelayInMilliseconds: retryContext => {
                    if (this.connectionStatus === 'severed') return null; // No auto-reconnect if severed
                    return Math.min(1000 * retryContext.previousRetryCount, 10000);
                }
            })
            .configureLogging(LogLevel.Warning)
            .build();

        // 2. Setup Listeners (Receive from Bunker)
        this.connection.on("HeartbeatAck", (data) => {
            console.debug('[AETHERIC LINK] Pulse confirmed by Bunker:', data);
            if (this.connectionStatus !== 'connected') this.setConnectionStatus('connected');
        });

        this.connection.on("HeartbeatRejected", (error) => {
            console.error('[CRITICAL] Bunker rejected heartbeat:', error);
            this.severLink("Backend Authentication Failed");
        });

        this.connection.on("ForceDisconnect", (reason) => {
            console.error('[CRITICAL] Remote Kill Switch Activated:', reason);
            this.severLink(`Remote Command: ${reason}`);
        });

        // 3. Establish Physical Link
        await this.connection.start();
        console.log('[AETHERIC LINK] Carrier signal established. Initiating handshake...');
        this.setConnectionStatus('unverified');
        
        // 4. Start Cryptographic Pulse
        this.startAethericLink();

    } catch (error) {
        console.error('[AETHERIC LINK] Connection failed:', error);
        this.setConnectionStatus('disconnected');
    }
  }

  public disconnect(): void {
    this.stopAethericLink();
    if (this.connection) {
        this.connection.stop();
    }
    this.setConnectionStatus('disconnected');
  }

  private severLink(reason: string): void {
      this.disconnect();
      this.setConnectionStatus('severed');
      // Dispatch global event for UI Red-Flash
      window.dispatchEvent(new CustomEvent('AETHER_LINK_SEVERED', { detail: { reason } }));
  }

  private startAethericLink(): void {
    if (this.heartbeatInterval) clearInterval(this.heartbeatInterval);

    // Initial pulse
    this.sendHeartbeat();

    // 5-second cadence
    this.heartbeatInterval = setInterval(() => {
        if (this.connection?.state === HubConnectionState.Connected) {
            this.sendHeartbeat();
        }
    }, 5000);
  }

  private stopAethericLink(): void {
    if (this.heartbeatInterval) {
        clearInterval(this.heartbeatInterval);
        this.heartbeatInterval = null;
    }
  }

  private async sendHeartbeat(): Promise<void> {
    try {
        // Fail-Visible: deviceId must be set before sending heartbeat
        if (!this.deviceId) {
            throw new Error('Device ID not initialized');
        }

        const timestamp = new Date().toISOString();
        // Create the string to sign: DeviceID + Timestamp ensures uniqueness
        const signablePayload = `${this.deviceId}:${timestamp}`;

        // Hardware Signing (Fail-Visible point)
        // If this fails, the code naturally throws, catching below.
        const signature = await invoke<string>('sign_heartbeat_payload', { 
            nonce: signablePayload 
        });

        const payload: HeartbeatPayload = {
            deviceId: this.deviceId,
            signature: signature,
            timestamp: timestamp
        };

        // Send to SignalR Hub Method "SendHeartbeat"
        await this.connection?.invoke("SendHeartbeat", payload);

    } catch (error) {
        console.error('[AETHERIC LINK] Pulse Generation Failed:', error);
        // If we can't sign, we can't talk. Sever.
        this.severLink("TPM Signing Failure");
    }
  }

  private setConnectionStatus(status: ConnectionStatus): void {
    this.connectionStatus = status;
    useCommStore.getState().setConnectionStatus(status);
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
