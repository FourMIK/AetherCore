/**
 * Mock C2 WebSocket Server
 * 
 * Simple WebSocket server for testing AetherCore C2 integration.
 * Accepts connections, echoes messages, and simulates various scenarios.
 */

import { WebSocketServer } from 'ws';

const PORT = process.env.PORT || 8080;
const HEARTBEAT_INTERVAL = 30000; // 30 seconds

// Server state
const clients = new Map();
let messageCounter = 0;

// Create WebSocket server
const wss = new WebSocketServer({ port: PORT });

console.log(`[Mock C2 Server] Starting on ws://localhost:${PORT}`);

wss.on('connection', (ws, req) => {
  const clientId = `client-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  console.log(`[Mock C2 Server] Client connected: ${clientId} from ${req.socket.remoteAddress}`);

  // Store client info
  clients.set(ws, {
    id: clientId,
    connectedAt: new Date(),
    lastHeartbeat: new Date(),
  });

  // Send welcome message
  const welcomeMessage = createMessage('control', clientId, {
    command: 'welcome',
    serverId: 'mock-c2-001',
    timestamp: Date.now(),
  });
  ws.send(JSON.stringify(welcomeMessage));

  // Handle incoming messages
  ws.on('message', (data) => {
    try {
      const message = JSON.parse(data.toString());
      console.log(`[Mock C2 Server] Received from ${clientId}:`, message.type);

      handleMessage(ws, clientId, message);
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
      
      // Echo heartbeat
      const heartbeatResponse = createMessage('heartbeat', 'server', {
        timestamp: Date.now(),
        clientId,
      });
      ws.send(JSON.stringify(heartbeatResponse));
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
  if (clients.size > 0 && Math.random() < 0.3) {
    const clientEntries = Array.from(clients.entries());
    const [ws, info] = clientEntries[Math.floor(Math.random() * clientEntries.length)];
    
    console.log(`[Mock C2 Server] Simulating connection drop for ${info.id}`);
    ws.close(1006, 'Simulated network interruption');
  }
}, 60000);

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\n[Mock C2 Server] Shutting down...');
  
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
