/**
 * SignalingServer - Mission Guardian Signaling Server
 * 
 * WebSocket/NATS-based signaling server for WebRTC with Trust Fabric verification
 * All signals must be wrapped in SignedEnvelope and verified before forwarding
 */

import { WebSocket, WebSocketServer } from 'ws';
import {
  SignedSignal,
  SignedSignalSchema,
  GuardianSignal,
  GuardianSignalSchema,
  NodeID,
  SecurityEvent,
} from '@aethercore/shared';
import {
  VerificationService,
  MockIdentityRegistry,
  ConsoleSecurityEventHandler,
} from './VerificationService';

/**
 * Connected client info
 */
interface ConnectedClient {
  ws: WebSocket;
  nodeId: NodeID | null;
  authenticated: boolean;
}

/**
 * SignalingServer
 * Handles WebRTC signaling with hardware-backed signature verification
 */
export class SignalingServer {
  private wss: WebSocketServer;
  private clients: Map<WebSocket, ConnectedClient> = new Map();
  private nodeIdToClient: Map<NodeID, WebSocket> = new Map();
  private verificationService: VerificationService;

  constructor(
    port: number = 8080,
    identityRegistry?: MockIdentityRegistry,
  ) {
    // Initialize verification service
    const registry = identityRegistry || new MockIdentityRegistry();
    const eventHandler = new ConsoleSecurityEventHandler();
    this.verificationService = new VerificationService(registry, eventHandler);

    // Initialize WebSocket server
    this.wss = new WebSocketServer({ port });

    this.wss.on('connection', (ws: WebSocket) => {
      this.handleConnection(ws);
    });

    console.log(`[SignalingServer] Listening on port ${port}`);
  }

  /**
   * Handle new WebSocket connection
   */
  private handleConnection(ws: WebSocket): void {
    const client: ConnectedClient = {
      ws,
      nodeId: null,
      authenticated: false,
    };

    this.clients.set(ws, client);
    console.log('[SignalingServer] New connection');

    ws.on('message', async (data: Buffer) => {
      await this.handleMessage(ws, data);
    });

    ws.on('close', () => {
      this.handleDisconnect(ws);
    });

    ws.on('error', (error: Error) => {
      console.error('[SignalingServer] WebSocket error:', error);
      this.handleDisconnect(ws);
    });
  }

  /**
   * Handle incoming message
   */
  private async handleMessage(ws: WebSocket, data: Buffer): Promise<void> {
    try {
      const message = JSON.parse(data.toString());
      
      // Validate as SignedSignal
      const signedSignal = SignedSignalSchema.parse(message);

      // Verify signature against identity registry
      const payload = await this.verificationService.verifyEnvelope(
        signedSignal.envelope,
      );

      if (!payload) {
        // Signature verification failed - packet dropped
        console.error('[SignalingServer] SECURITY: Invalid signature - dropping packet');
        this.sendError(ws, 'Invalid signature');
        return;
      }

      // Parse and validate the Guardian signal
      const guardianSignal = GuardianSignalSchema.parse(payload);

      // Update client info on first valid message
      const client = this.clients.get(ws);
      if (client && !client.authenticated) {
        client.nodeId = guardianSignal.from;
        client.authenticated = true;
        this.nodeIdToClient.set(guardianSignal.from, ws);
        console.log(`[SignalingServer] Client authenticated: ${guardianSignal.from}`);
      }

      // Forward signal to destination
      await this.forwardSignal(guardianSignal);

    } catch (error) {
      console.error('[SignalingServer] Error processing message:', error);
      this.sendError(ws, 'Invalid message format');
    }
  }

  /**
   * Forward verified signal to destination
   */
  private async forwardSignal(signal: GuardianSignal): Promise<void> {
    const destinationWs = this.nodeIdToClient.get(signal.to);

    if (!destinationWs) {
      console.warn(`[SignalingServer] Destination not connected: ${signal.to}`);
      return;
    }

    try {
      // Forward the signal (already verified)
      const message = JSON.stringify(signal);
      destinationWs.send(message);

      console.log(
        `[SignalingServer] Forwarded ${signal.type} from ${signal.from} to ${signal.to}`,
      );
    } catch (error) {
      console.error('[SignalingServer] Error forwarding signal:', error);
    }
  }

  /**
   * Handle client disconnect
   */
  private handleDisconnect(ws: WebSocket): void {
    const client = this.clients.get(ws);
    
    if (client?.nodeId) {
      this.nodeIdToClient.delete(client.nodeId);
      console.log(`[SignalingServer] Client disconnected: ${client.nodeId}`);
    }

    this.clients.delete(ws);
  }

  /**
   * Send error message to client
   */
  private sendError(ws: WebSocket, message: string): void {
    try {
      ws.send(JSON.stringify({ error: message }));
    } catch (error) {
      console.error('[SignalingServer] Error sending error message:', error);
    }
  }

  /**
   * Broadcast message to all authenticated clients
   */
  broadcast(message: any, excludeNodeId?: NodeID): void {
    const messageStr = JSON.stringify(message);

    this.clients.forEach((client, ws) => {
      if (client.authenticated && client.nodeId !== excludeNodeId) {
        try {
          ws.send(messageStr);
        } catch (error) {
          console.error('[SignalingServer] Error broadcasting:', error);
        }
      }
    });
  }

  /**
   * Get connected clients
   */
  getConnectedClients(): NodeID[] {
    return Array.from(this.nodeIdToClient.keys());
  }

  /**
   * Close the server
   */
  close(): void {
    this.wss.close();
    console.log('[SignalingServer] Server closed');
  }
}
