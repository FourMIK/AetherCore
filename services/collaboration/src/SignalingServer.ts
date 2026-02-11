/**
 * SignalingServer - Mission Guardian Signaling Server (Production)
 * 
 * WebSocket-based signaling server for WebRTC with hardware-backed Trust Fabric verification.
 * All signals must be wrapped in SignedEnvelope and verified via gRPC Identity Registry.
 * 
 * Security Model:
 * - NO GRACEFUL DEGRADATION: Invalid signatures = packet dropped
 * - Identity Registry failures = Byzantine nodes (fail-visible)
 * - All security failures are logged to Tactical Glass dashboard
 */

import { WebSocket, WebSocketServer } from 'ws';
import { createServer, IncomingMessage, ServerResponse } from 'http';
import {
  SignedSignal,
  SignedSignalSchema,
  GuardianSignal,
  GuardianSignalSchema,
  NodeID,
} from '@aethercore/shared';
import {
  VerificationService,
  ConsoleSecurityEventHandler,
} from './VerificationService';
import { IdentityRegistryClient } from './IdentityRegistryClient';

/**
 * Connected client info
 */
interface ConnectedClient {
  ws: WebSocket;
  nodeId: NodeID | null;
  authenticated: boolean;
}

/**
 * SignalingServer Configuration
 */
export interface SignalingServerConfig {
  /** WebSocket server port */
  port: number;
  /** Identity Registry gRPC address */
  identityRegistryAddress: string;
}

/**
 * SignalingServer (Production)
 * Handles WebRTC signaling with hardware-backed signature verification via gRPC
 */
export class SignalingServer {
  private wss: WebSocketServer;
  private clients: Map<WebSocket, ConnectedClient> = new Map();
  private nodeIdToClient: Map<NodeID, WebSocket> = new Map();
  private verificationService: VerificationService;
  private identityRegistryClient: IdentityRegistryClient;

  constructor(config: SignalingServerConfig) {
    // Initialize Identity Registry gRPC client
    this.identityRegistryClient = new IdentityRegistryClient({
      serverAddress: config.identityRegistryAddress,
      timeout: 5000, // 5 second timeout
      maxRetries: 3, // Retry 3 times
      retryDelay: 1000, // 1 second initial delay
    });

    // Initialize verification service with gRPC client
    const eventHandler = new ConsoleSecurityEventHandler();
    this.verificationService = new VerificationService(
      this.identityRegistryClient,
      eventHandler,
    );

    // Create HTTP server with health check endpoint
    const httpServer = createServer((req: IncomingMessage, res: ServerResponse) => {
      if (req.url === '/health' && req.method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'ok' }));
      } else {
        res.writeHead(404);
        res.end();
      }
    });

    // Initialize WebSocket server on the same HTTP server
    this.wss = new WebSocketServer({ server: httpServer });

    // Start listening
    httpServer.listen(config.port);

    this.wss.on('connection', (ws: WebSocket) => {
      this.handleConnection(ws);
    });

    console.log(
      `[SignalingServer] PRODUCTION MODE - Hardware-backed signatures enabled`,
    );
    console.log(`[SignalingServer] Listening on port ${config.port}`);
    console.log(
      `[SignalingServer] Identity Registry: ${config.identityRegistryAddress}`,
    );
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

      // Verify signature against Identity Registry (gRPC)
      let payload: any;
      try {
        payload = await this.verificationService.verifyEnvelope(
          signedSignal.envelope,
        );
      } catch (error) {
        // FAIL-VISIBLE: Identity service failure
        console.error(
          '[SignalingServer] CRITICAL: Identity Registry service failure',
        );
        console.error(
          '  This node may be Byzantine or network is contested/congested',
        );
        this.sendError(ws, 'Identity verification service unavailable');
        return;
      }

      if (!payload) {
        // Signature verification failed - packet dropped (FAIL-VISIBLE)
        console.error(
          '[SignalingServer] SECURITY: Invalid signature - dropping packet',
        );
        this.sendError(ws, 'Invalid signature - packet dropped');
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
        console.log(
          `[SignalingServer] Client authenticated: ${guardianSignal.from} (Hardware-verified)`,
        );
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
      console.warn(
        `[SignalingServer] Destination not connected: ${signal.to}`,
      );
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
    this.identityRegistryClient.close();
    this.wss.close();
    console.log('[SignalingServer] Server closed');
  }
}
