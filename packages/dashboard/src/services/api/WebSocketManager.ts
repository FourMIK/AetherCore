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

import {
  HubConnection,
  HubConnectionBuilder,
  HubConnectionState,
  LogLevel,
} from '@microsoft/signalr';
import { TauriCommands } from '../../api/tauri-commands';
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

// Constants for TPM-disabled mode
const UNSIGNED_TPM_SIGNATURE = 'unsigned-tpm-disabled';

// Must match AetherBunker/Models/HeartbeatPayload.cs
export interface HeartbeatPayload {
  deviceId: string;
  signature: string;
  timestamp: string; // ISO 8601 for C# DateTime compatibility
}

export class WebSocketManager {
  private connection: HubConnection | null = null;
  private heartbeatInterval: NodeJS.Timeout | null = null;
  private reconnectTimeout: NodeJS.Timeout | null = null;
  private heartbeatTimeoutCheck: NodeJS.Timeout | null = null;
  private url: string;
  private connectionStatus: ConnectionStatus = 'disconnected';
  private connectionState: ConnectionState = 'disconnected';
  private deviceId: string | null = null; // Cached hardware ID
  private reconnectAttempts: number = 0;
  private readonly maxReconnectAttempts: number;
  private readonly initialRetryDelay: number; // 1 second
  private readonly maxRetryDelay: number; // 30 seconds
  private lastHeartbeatAck: number = 0; // Timestamp of last successful heartbeat ack
  private readonly intermittentThreshold: number = 500; // 500ms threshold for intermittent
  private readonly disconnectedThreshold: number = 2000; // 2000ms threshold for disconnected

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
    if (this.connection && this.connection.state === HubConnectionState.Connected) return;

    this.setConnectionStatus('connecting');

    try {
      // 1. Get Hardware ID (TPM) before connecting
      // We need this to identify ourselves to the bunker.
      // Assuming 'get_hardware_id' is a Tauri command you have or will create.
      // For Alpha, we can derive it from the first signed payload or a specific command.
      this.deviceId = 'ALPHA-TEST-DEVICE-001'; // TODO: Replace with invoke('get_tpm_id')

      this.connection = new HubConnectionBuilder()
        .withUrl(this.url)
        .withAutomaticReconnect({
          nextRetryDelayInMilliseconds: (retryContext) => {
            if (this.connectionStatus === 'severed') return null; // No auto-reconnect if severed

            // Exponential backoff with jitter
            const exponentialDelay = Math.min(
              this.initialRetryDelay * Math.pow(2, retryContext.previousRetryCount),
              this.maxRetryDelay
            );
            const jitter = Math.random() * 1000; // Add up to 1 second of jitter
            return exponentialDelay + jitter;
          },
        })
        .configureLogging(LogLevel.Warning)
        .build();

      // 2. Setup event handlers
      this.connection.onreconnecting(() => {
        console.log('[AETHERIC LINK] Connection lost. Attempting to reconnect...');
        this.setConnectionStatus('connecting');
      });

      this.connection.onreconnected(() => {
        console.log('[AETHERIC LINK] Connection restored');
        this.reconnectAttempts = 0; // Reset counter on successful reconnect
        this.setConnectionStatus('unverified');
        this.startAethericLink(); // Restart heartbeat
      });

      this.connection.onclose((error) => {
        console.error('[AETHERIC LINK] Connection closed:', error);
        this.stopAethericLink();

        if (this.connectionStatus !== 'severed') {
          this.handleDisconnection();
        }
      });

      // 3. Setup Listeners (Receive from Bunker)
      this.connection.on('HeartbeatAck', (data) => {
        console.debug('[AETHERIC LINK] Pulse confirmed by Bunker:', data);
        this.lastHeartbeatAck = Date.now(); // Update last ack timestamp
        if (this.connectionStatus !== 'connected') this.setConnectionStatus('connected');
        this.setConnectionState('connected'); // Update connection state
        this.reconnectAttempts = 0; // Reset on successful heartbeat
      });

      this.connection.on('HeartbeatRejected', (error) => {
        console.error('[CRITICAL] Bunker rejected heartbeat:', error);
        this.severLink('Backend Authentication Failed');
      });

      this.connection.on('ForceDisconnect', (reason) => {
        console.error('[CRITICAL] Remote Kill Switch Activated:', reason);
        this.severLink(`Remote Command: ${reason}`);
      });

      // 4. Establish Physical Link
      await this.connection.start();
      console.log('[AETHERIC LINK] Carrier signal established. Initiating handshake...');
      this.setConnectionStatus('unverified');
      this.reconnectAttempts = 0; // Reset on successful connection

      // 5. Start Cryptographic Pulse
      this.startAethericLink();
    } catch (error) {
      console.error('[AETHERIC LINK] Connection failed:', error);
      this.setConnectionStatus('disconnected');
      this.handleDisconnection();
    }
  }

  public disconnect(): void {
    this.stopAethericLink();
    this.clearReconnectTimeout();
    if (this.connection) {
      this.connection.stop();
    }
    this.setConnectionStatus('disconnected');
    this.reconnectAttempts = 0;
  }

  /**
   * Handle disconnection with exponential backoff retry
   */
  private handleDisconnection(): void {
    // Don't retry if severed or if exceeded max attempts
    if (this.connectionStatus === 'severed') {
      console.log('[AETHERIC LINK] Connection severed - no retry');
      return;
    }

    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.error('[AETHERIC LINK] Max reconnection attempts reached');
      this.setConnectionStatus('disconnected');
      return;
    }

    // Calculate exponential backoff delay
    const exponentialDelay = Math.min(
      this.initialRetryDelay * Math.pow(2, this.reconnectAttempts),
      this.maxRetryDelay
    );
    const jitter = Math.random() * 1000; // Add up to 1 second of jitter
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

  /**
   * Clear any pending reconnect timeout
   */
  private clearReconnectTimeout(): void {
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }
  }

  private severLink(reason: string): void {
    this.stopAethericLink();
    this.clearReconnectTimeout();
    if (this.connection) {
      this.connection.stop();
    }
    this.setConnectionStatus('severed');
    // Dispatch global event for UI Red-Flash
    window.dispatchEvent(new CustomEvent('AETHER_LINK_SEVERED', { detail: { reason } }));
  }

  private startAethericLink(): void {
    if (this.heartbeatInterval) clearInterval(this.heartbeatInterval);
    if (this.heartbeatTimeoutCheck) clearInterval(this.heartbeatTimeoutCheck);

    // Initial pulse
    this.sendHeartbeat();
    this.lastHeartbeatAck = Date.now(); // Initialize timestamp

    // 5-second cadence for heartbeat
    this.heartbeatInterval = setInterval(() => {
      if (this.connection?.state === HubConnectionState.Connected) {
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

  /**
   * Check heartbeat timeout and update connection state
   * Heartbeat Sentinel: Monitors time since last heartbeat acknowledgment
   */
  private checkHeartbeatTimeout(): void {
    if (this.connectionStatus !== 'connected' && this.connectionStatus !== 'unverified') {
      // Don't check heartbeat if not in connected/unverified state
      return;
    }

    const timeSinceLastAck = Date.now() - this.lastHeartbeatAck;

    if (timeSinceLastAck > this.disconnectedThreshold) {
      // More than 2000ms since last ack - DISCONNECTED state
      if (this.connectionState !== 'disconnected') {
        console.warn('[HEARTBEAT SENTINEL] Signal degraded - DISCONNECTED');
        this.setConnectionState('disconnected');
      }
    } else if (timeSinceLastAck > this.intermittentThreshold) {
      // Between 500ms and 2000ms - INTERMITTENT state
      if (this.connectionState !== 'intermittent') {
        console.warn('[HEARTBEAT SENTINEL] Signal degraded - INTERMITTENT');
        this.setConnectionState('intermittent');
      }
    } else {
      // Less than 500ms - CONNECTED state
      if (this.connectionState !== 'connected') {
        this.setConnectionState('connected');
      }
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

      // Check if TPM is enabled
      const { tpmEnabled } = getRuntimeConfig();

      let signature: string;
      if (tpmEnabled) {
        // Hardware Signing (Fail-Visible point)
        const result = await TauriCommands.signHeartbeatPayload(signablePayload);

        if (!result.success) {
          throw new Error(`TPM signing failed: ${result.error}`);
        }
        signature = result.data;
      } else {
        // TPM disabled: send unsigned/placeholder signature
        // Backend should accept this when TPM_ENABLED=false
        console.debug('[AETHERIC LINK] TPM disabled - sending unsigned heartbeat');
        signature = UNSIGNED_TPM_SIGNATURE;
      }

      const payload: HeartbeatPayload = {
        deviceId: this.deviceId,
        signature: signature,
        timestamp: timestamp,
      };

      // Send to SignalR Hub Method "SendHeartbeat"
      await this.connection?.invoke('SendHeartbeat', payload);
    } catch (error) {
      console.error('[AETHERIC LINK] Pulse Generation Failed:', error);

      const { tpmEnabled } = getRuntimeConfig();
      if (tpmEnabled) {
        // If TPM is enabled and signing fails, we must sever (Fail-Visible)
        this.severLink('TPM Signing Failure');
      } else {
        // If TPM is disabled, log error but don't sever the link
        // This allows operation without TPM in non-production environments
        console.warn(
          '[AETHERIC LINK] Heartbeat failed in TPM-disabled mode, but link remains active'
        );
      }
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

  /**
   * Get current connection status
   */
  public getStatus(): ConnectionStatus {
    return this.connectionStatus;
  }

  /**
   * Get current connection state (for UI degradation)
   */
  public getConnectionState(): ConnectionState {
    return this.connectionState;
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
