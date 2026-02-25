/**
 * Mock C2 WebSocket Server
 * 
 * Enhanced WebSocket server for testing AetherCore C2 integration.
 * Supports configurable latency, connection drops, and malformed messages.
 * 
 * Environment variables:
 * - PORT: Server port (default: 8080)
 * - LATENCY_MS: Simulated latency in milliseconds (default: 0)
 * - DROP_RATE: Probability of dropping messages (0-1, default: 0)
 * - HEARTBEAT_DELAY_MS: Delay heartbeat responses (default: 0)
 */

import { WebSocketServer } from 'ws';

const PORT = process.env.PORT || 8080;
const HEARTBEAT_INTERVAL = 30000; // 30 seconds
const LATENCY_MS = parseInt(process.env.LATENCY_MS || '0', 10);
const DROP_RATE = parseFloat(process.env.DROP_RATE || '0');
const HEARTBEAT_DELAY_MS = parseInt(process.env.HEARTBEAT_DELAY_MS || '0', 10);

// Server state
const clients = new Map();
let messageCounter = 0;
let metrics = {
  totalConnections: 0,
  totalMessages: 0,
  droppedMessages: 0,
};

// Create WebSocket server
const wss = new WebSocketServer({ port: PORT });

console.log(`[Mock C2 Server] Starting on ws://localhost:${PORT}`);
console.log(`[Mock C2 Server] Configuration:`);
console.log(`  - Latency: ${LATENCY_MS}ms`);
console.log(`  - Drop rate: ${DROP_RATE * 100}%`);
console.log(`  - Heartbeat delay: ${HEARTBEAT_DELAY_MS}ms`);

wss.on('connection', (ws, req) => {
  const clientId = `client-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  console.log(`[Mock C2 Server] Client connected: ${clientId} from ${req.socket.remoteAddress}`);

  metrics.totalConnections++;

  // Store client info
  clients.set(ws, {
    id: clientId,
    connectedAt: new Date(),
    lastHeartbeat: new Date(),
    messageCount: 0,
  });

  // Send welcome message
  const welcomeMessage = createMessage('control', 'server', {
    command: 'welcome',
    serverId: 'mock-c2-001',
    clientId,
    timestamp: Date.now(),
    metrics,
  });
  ws.send(JSON.stringify(welcomeMessage));

  // Handle incoming messages
  ws.on('message', (data) => {
    try {
      const message = JSON.parse(data.toString());
      metrics.totalMessages++;
      
      const clientInfo = clients.get(ws);
      if (clientInfo) {
        clientInfo.messageCount++;
      }

      console.log(`[Mock C2 Server] Received from ${clientId}: ${message.type}`);

      // Simulate message dropping
      if (DROP_RATE > 0 && Math.random() < DROP_RATE) {
        console.log(`[Mock C2 Server] Dropping message (simulated packet loss)`);
        metrics.droppedMessages++;
        return;
      }

      // Simulate latency
      if (LATENCY_MS > 0) {
        setTimeout(() => handleMessage(ws, clientId, message), LATENCY_MS);
      } else {
        handleMessage(ws, clientId, message);
      }
    } catch (error) {
      console.error(`[Mock C2 Server] Error parsing message:`, error);
      ws.send(JSON.stringify({
        error: 'Invalid message format',
      }));
    }
  });

  // Handle disconnection
  ws.on('close', (code, reason) => {
    console.log(`[Mock C2 Server] Client disconnected: ${clientId}, code: ${code}, reason: ${reason}`);
    clients.delete(ws);
  });

  // Handle errors
  ws.on('error', (error) => {
    console.error(`[Mock C2 Server] Error with client ${clientId}:`, error);
    clients.delete(ws);
  });

  // Start periodic heartbeat responses
  const heartbeatInterval = setInterval(() => {
    if (ws.readyState === ws.OPEN) {
      const heartbeatResponse = createMessage('heartbeat', 'server', {
        timestamp: Date.now(),
        clientId,
      });
      ws.send(JSON.stringify(heartbeatResponse));
    } else {
      clearInterval(heartbeatInterval);
    }
  }, HEARTBEAT_INTERVAL);
});

/**
 * Handle different message types
 */
function handleMessage(ws, clientId, message) {
  const clientInfo = clients.get(ws);
  if (!clientInfo) return;

  switch (message.type) {
    case 'heartbeat':
      // Update last heartbeat
      clientInfo.lastHeartbeat = new Date();
      
      // Echo heartbeat with optional delay
      const sendHeartbeat = () => {
        const heartbeatResponse = createMessage('heartbeat', 'server', {
          timestamp: Date.now(),
          clientId,
        });
        if (ws.readyState === ws.OPEN) {
          ws.send(JSON.stringify(heartbeatResponse));
        }
      };

      if (HEARTBEAT_DELAY_MS > 0) {
        setTimeout(sendHeartbeat, HEARTBEAT_DELAY_MS);
      } else {
        sendHeartbeat();
      }
      break;

    case 'chat':
      // Echo chat message back
      console.log(`[Mock C2 Server] Chat from ${clientId}: ${message.payload?.content}`);
      
      const chatResponse = createMessage('chat', 'server', {
        content: `Server received: ${message.payload?.content}`,
        recipientId: clientId,
        encrypted: false,
      });
      ws.send(JSON.stringify(chatResponse));
      break;

    case 'call_invite':
      console.log(`[Mock C2 Server] Call invitation from ${clientId} to ${message.payload?.recipientId}`);
      
      // Simulate acceptance after 1 second
      setTimeout(() => {
        const callAccept = createMessage('call_accept', 'server', {
          callId: message.payload?.callId,
        });
        ws.send(JSON.stringify(callAccept));
      }, 1000);
      break;

    case 'call_accept':
    case 'call_reject':
    case 'call_end':
      console.log(`[Mock C2 Server] Call ${message.type} from ${clientId}`);
      
      // Acknowledge
      const ack = createMessage('ack', 'server', {
        messageId: message.message_id,
      });
      ws.send(JSON.stringify(ack));
      break;

    case 'presence':
      console.log(`[Mock C2 Server] Presence update from ${clientId}: ${message.payload?.status}`);
      
      // Broadcast to other clients (simulation)
      const presenceNotification = createMessage('presence', clientId, {
        status: message.payload?.status,
        trustScore: message.payload?.trustScore,
      });
      
      // Echo back as confirmation
      ws.send(JSON.stringify(presenceNotification));
      break;

    default:
      console.log(`[Mock C2 Server] Unknown message type: ${message.type}`);
  }
}

/**
 * Create a message envelope
 */
function createMessage(type, from, payload) {
  return {
    schema_version: '1.0',
    message_id: `msg-${Date.now()}-${messageCounter++}`,
    timestamp: Date.now(),
    type,
    from,
    payload,
    signature: `mock-signature-${Math.random().toString(36).substr(2, 9)}`,
  };
}

// Simulate connection drops for testing reconnection
// Randomly disconnect a client every 60 seconds
setInterval(() => {
  if (clients.size > 0 && Math.random() < 0.2) {
    const clientEntries = Array.from(clients.entries());
    const [ws, info] = clientEntries[Math.floor(Math.random() * clientEntries.length)];
    
    console.log(`[Mock C2 Server] Simulating connection drop for ${info.id}`);
    ws.close(1006, 'Simulated network interruption');
  }
}, 60000);

// Server metrics logging
setInterval(() => {
  console.log(`[Mock C2 Server] Metrics:`, {
    activeConnections: clients.size,
    totalConnections: metrics.totalConnections,
    totalMessages: metrics.totalMessages,
    droppedMessages: metrics.droppedMessages,
    uptime: process.uptime().toFixed(0) + 's',
  });
}, 30000);

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\n[Mock C2 Server] Shutting down...');
  console.log('[Mock C2 Server] Final metrics:', metrics);
  
  // Close all client connections
  wss.clients.forEach((ws) => {
    ws.close(1000, 'Server shutdown');
  });
  
  wss.close(() => {
    console.log('[Mock C2 Server] Server closed');
    process.exit(0);
  });
});

console.log('[Mock C2 Server] Ready to accept connections');
console.log('[Mock C2 Server] Press Ctrl+C to stop');
console.log('[Mock C2 Server] Tip: Use environment variables to configure behavior:');
console.log('  LATENCY_MS=100 npm start        # Add 100ms latency');
console.log('  DROP_RATE=0.1 npm start         # Drop 10% of messages');
console.log('  HEARTBEAT_DELAY_MS=5000 npm start  # Delay heartbeats by 5 seconds');
