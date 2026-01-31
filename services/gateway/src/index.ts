/**
 * AetherCore Gateway Service
 * 
 * Main entry point for the gateway with Aetheric Link protocol enforcement.
 * Implements WebSocket server with signed heartbeat verification and Dead Man's Switch.
 */

import { WebSocketServer, WebSocket } from 'ws';
import { createHash } from 'crypto';

// Connection tracking for Dead Man's Switch
interface ConnectionState {
  ws: WebSocket;
  connectionId: string;
  publicKey: string | null;
  lastHeartbeat: number;
  verified: boolean;
}

// Heartbeat message types
interface HeartbeatPayload {
  ts: number;
  nonce: string;
}

interface HeartbeatMessage {
  type: 'HEARTBEAT';
  payload: string;
  signature: string;
}

export class Gateway {
  private wss: WebSocketServer | null = null;
  private connections: Map<string, ConnectionState> = new Map();
  private deadManCheckInterval: NodeJS.Timeout | null = null;
  private port: number;

  constructor(port: number = 8080) {
    this.port = port;
    console.log('Gateway initialized');
  }

  /**
   * Start the Gateway WebSocket server
   */
  start(): void {
    console.log(`Gateway starting on port ${this.port}...`);

    // Create WebSocket server
    this.wss = new WebSocketServer({ port: this.port });

    this.wss.on('connection', (ws: WebSocket) => {
      this.handleConnection(ws);
    });

    // Start Dead Man's Switch check (runs every 2 seconds)
    this.startDeadManSwitch();

    console.log(`[AETHERIC LINK] Gateway listening on ws://localhost:${this.port}`);
  }

  /**
   * Handle new WebSocket connection
   */
  private handleConnection(ws: WebSocket): void {
    const connectionId = this.generateConnectionId();
    
    // Initialize connection state
    const state: ConnectionState = {
      ws,
      connectionId,
      publicKey: null,
      lastHeartbeat: Date.now(),
      verified: false,
    };
    
    this.connections.set(connectionId, state);
    console.log(`[AETHERIC LINK] New connection: ${connectionId}`);

    // Handle messages
    ws.on('message', (data: Buffer) => {
      this.handleMessage(connectionId, data.toString());
    });

    // Handle close
    ws.on('close', () => {
      console.log(`[AETHERIC LINK] Connection closed: ${connectionId}`);
      this.connections.delete(connectionId);
    });

    // Handle errors
    ws.on('error', (error) => {
      console.error(`[AETHERIC LINK] WebSocket error for ${connectionId}:`, error);
      this.connections.delete(connectionId);
    });
  }

  /**
   * Handle incoming WebSocket messages
   */
  private handleMessage(connectionId: string, data: string): void {
    const state = this.connections.get(connectionId);
    if (!state) {
      console.error(`[AETHERIC LINK] Unknown connection: ${connectionId}`);
      return;
    }

    try {
      const message = JSON.parse(data);

      if (message.type === 'HEARTBEAT') {
        this.handleHeartbeat(connectionId, message as HeartbeatMessage);
      } else {
        console.log(`[AETHERIC LINK] Received message:`, message);
      }
    } catch (error) {
      console.error(`[AETHERIC LINK] Failed to parse message:`, error);
    }
  }

  /**
   * Handle HEARTBEAT message with signature verification
   */
  private handleHeartbeat(connectionId: string, message: HeartbeatMessage): void {
    const state = this.connections.get(connectionId);
    if (!state) return;

    console.debug(`[AETHERIC LINK] Heartbeat received from ${connectionId}`);

    try {
      // Parse payload
      const payload: HeartbeatPayload = JSON.parse(message.payload);

      // Freshness Check: Reject if payload.timestamp is older than 3 seconds (anti-replay)
      const age = Date.now() - payload.ts;
      if (age > 3000) {
        console.error(`[SECURITY] Stale heartbeat rejected (age: ${age}ms) for ${connectionId}`);
        this.sendVerificationFailed(state.ws);
        this.terminateConnection(connectionId, 'Stale heartbeat (anti-replay)');
        return;
      }

      // Signature Verification
      // In production, this would verify against the stored Public Key for this connection
      // For now, we'll verify the signature is present and matches expected format
      if (!message.signature || message.signature.length === 0) {
        console.error(`[SECURITY] Missing signature for ${connectionId}`);
        this.sendVerificationFailed(state.ws);
        this.terminateConnection(connectionId, 'Missing signature');
        return;
      }

      // Decode base64 signature
      const signatureBuffer = Buffer.from(message.signature, 'base64');
      
      // Verify signature length (32 bytes for BLAKE3 stub, 64 for Ed25519)
      if (signatureBuffer.length !== 32 && signatureBuffer.length !== 64) {
        console.error(`[SECURITY] Invalid signature length for ${connectionId}: ${signatureBuffer.length}`);
        this.sendVerificationFailed(state.ws);
        this.terminateConnection(connectionId, 'Invalid signature format');
        return;
      }

      // Stub verification: In production, use Ed25519 verify with stored public key
      // For now, verify the signature is a valid BLAKE3 hash of the payload
      const expectedHash = createHash('blake3').update(message.payload).digest();
      const isValid = Buffer.compare(signatureBuffer, expectedHash) === 0;

      if (!isValid) {
        console.error(`[SECURITY] Signature verification failed for ${connectionId}`);
        this.sendVerificationFailed(state.ws);
        this.terminateConnection(connectionId, 'Signature verification failed');
        return;
      }

      // SUCCESS: Update last heartbeat timestamp
      state.lastHeartbeat = Date.now();
      state.verified = true;

      // Send acknowledgment
      this.sendHeartbeatAck(state.ws);

      console.debug(`[AETHERIC LINK] Heartbeat verified for ${connectionId}`);
    } catch (error) {
      console.error(`[AETHERIC LINK] Error processing heartbeat:`, error);
      this.sendVerificationFailed(state.ws);
      this.terminateConnection(connectionId, 'Heartbeat processing error');
    }
  }

  /**
   * Start Dead Man's Switch interval check
   * 
   * Runs every 2 seconds. If (Date.now() - last_heartbeat) > 10000 (10s = 2 missed beats),
   * terminate the connection immediately.
   */
  private startDeadManSwitch(): void {
    this.deadManCheckInterval = setInterval(() => {
      const now = Date.now();
      
      for (const [connectionId, state] of this.connections.entries()) {
        const timeSinceLastHeartbeat = now - state.lastHeartbeat;
        
        // Dead Man's Switch: 10 seconds = 2 missed heartbeats (5s interval)
        if (timeSinceLastHeartbeat > 10000) {
          console.warn(
            `[SECURITY] Aetheric Link Severed: Heartbeat Timeout (${timeSinceLastHeartbeat}ms) for ${connectionId}`
          );
          this.terminateConnection(connectionId, 'Dead Man\'s Switch triggered');
        }
      }
    }, 2000);
  }

  /**
   * Terminate a connection and clean up
   */
  private terminateConnection(connectionId: string, reason: string): void {
    const state = this.connections.get(connectionId);
    if (!state) return;

    console.log(`[AETHERIC LINK] Terminating connection ${connectionId}: ${reason}`);
    
    state.ws.terminate();
    this.connections.delete(connectionId);
  }

  /**
   * Send heartbeat acknowledgment
   */
  private sendHeartbeatAck(ws: WebSocket): void {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'HEARTBEAT_ACK' }));
    }
  }

  /**
   * Send verification failed message
   */
  private sendVerificationFailed(ws: WebSocket): void {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ 
        type: 'VERIFICATION_FAILED',
        reason: 'Cryptographic verification failed'
      }));
    }
  }

  /**
   * Generate unique connection ID
   */
  private generateConnectionId(): string {
    return `conn-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Stop the gateway server
   */
  stop(): void {
    console.log('Gateway stopping...');
    
    if (this.deadManCheckInterval) {
      clearInterval(this.deadManCheckInterval);
      this.deadManCheckInterval = null;
    }

    if (this.wss) {
      this.wss.close();
      this.wss = null;
    }

    this.connections.clear();
    console.log('Gateway stopped');
  }
}

export default Gateway;

// Start gateway if run directly
if (require.main === module) {
  const port = process.env.PORT ? parseInt(process.env.PORT) : 8080;
  const gateway = new Gateway(port);
  gateway.start();

  // Graceful shutdown
  process.on('SIGINT', () => {
    console.log('\nReceived SIGINT, shutting down gracefully...');
    gateway.stop();
    process.exit(0);
  });

  process.on('SIGTERM', () => {
    console.log('\nReceived SIGTERM, shutting down gracefully...');
    gateway.stop();
    process.exit(0);
  });
}
