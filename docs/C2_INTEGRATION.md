# C2 Integration Guide

## Overview

The AetherCore C2 (Command & Control) integration provides robust, deterministic communication for the Tactical Glass dashboard. This guide covers the architecture, configuration, and testing procedures.

## Architecture

### State Machine

The C2Client implements a deterministic finite state machine:

```
IDLE → CONNECTING → CONNECTED → DEGRADED → BACKOFF → DISCONNECTED
                  ↓             ↓
                  └──────────────┘ (reconnection)
```

**States:**
- **IDLE**: Initial state, not connected
- **CONNECTING**: Establishing WebSocket connection
- **CONNECTED**: Fully operational, exchanging messages
- **DEGRADED**: Connection quality degraded (heartbeat timeout)
- **BACKOFF**: Waiting to reconnect (exponential backoff)
- **DISCONNECTED**: Connection closed

**Events:**
- CONNECT_REQUESTED
- CONNECTED
- DISCONNECTED
- MESSAGE_RX (message received)
- MESSAGE_TX (message transmitted)
- ERROR
- BACKOFF_SCHEDULED
- HEARTBEAT_TIMEOUT

### Message Envelope Schema

All C2 messages use a versioned envelope format:

```typescript
{
  schema_version: "1.0",
  message_id: "uuid",
  timestamp: number (ms since epoch),
  type: "chat" | "call_invite" | "call_accept" | "call_reject" | "call_end" | "presence" | "ack" | "control" | "heartbeat",
  from: "sender-id",
  payload: any,
  signature: "hex-encoded-signature" (optional),
  trust_status: "verified" | "unverified" | "invalid" (optional)
}
```

### Transport Layer

- **Protocol**: WebSocket (wss:// for production, ws:// for localhost dev)
- **Heartbeat**: 30-second interval to detect connection issues
- **Reconnection**: Exponential backoff with jitter (1s → 30s max)
- **TLS**: Enforced for remote endpoints (see TLS_ENFORCEMENT.md)

## Configuration

### Dashboard Initialization

Initialize the C2 client in your app:

```typescript
import { useCommStore } from './store/useCommStore';

// Initialize C2 client
const { initC2Client, connectC2 } = useCommStore();

initC2Client(
  'wss://c2.example.com:8443',  // Endpoint
  'operator-001'                  // Client ID
);

// Connect
await connectC2();
```

### Environment Variables

Set in `packages/dashboard/.env`:

```env
# C2 Endpoint (production)
VITE_C2_ENDPOINT=wss://c2.aethercore.local:8443

# For local development (requires DEV_ALLOW_INSECURE_LOCALHOST=true)
VITE_C2_ENDPOINT=ws://localhost:8080

# Allow insecure localhost (dev only)
VITE_DEV_ALLOW_INSECURE_LOCALHOST=true
```

### Runtime Configuration

C2Client accepts configuration:

```typescript
interface C2ClientConfig {
  endpoint: string;                     // WebSocket URL
  clientId: string;                     // Unique client identifier
  signingEnabled: boolean;              // Enable message signing (false for Sprint 1)
  heartbeatIntervalMs: number;          // Heartbeat send interval (default: 30000)
  heartbeatTimeoutMs: number;           // Heartbeat timeout threshold (default: 10000)
  maxReconnectAttempts: number;         // Max reconnection attempts (default: 10)
  initialBackoffMs: number;             // Initial backoff delay (default: 1000)
  maxBackoffMs: number;                 // Maximum backoff delay (default: 30000)
  maxMissedHeartbeats?: number;         // Max missed heartbeats before disconnect (default: 3)
  rttSmoothingFactor?: number;          // RTT exponential moving average factor (default: 0.8)
  onStateChange?: (state, event) => void;
  onMessage?: (envelope) => void;
  onError?: (error) => void;
}
```

## Features

### 1. Messaging

Send chat messages:

```typescript
const { sendMessage } = useCommStore();

await sendMessage('operator-002', 'Mission status update');
```

The message is automatically:
- Queued if disconnected
- Signed (if enabled)
- Formatted with envelope schema
- Sent via WebSocket

### 2. Call Signaling

Initiate WebRTC calls:

```typescript
const { initiateCall, acceptCall, rejectCall, endCall } = useCommStore();

// Start a call
await initiateCall('operator-002');

// Accept incoming call
acceptCall('call-12345');

// Reject incoming call
rejectCall('call-12345');

// End active call
endCall();
```

### 3. Presence

Update operator presence:

```typescript
// Send presence update
c2Client.sendMessage('presence', {
  status: 'busy',
  trustScore: 0.95,
});
```

### Connection Monitoring

Monitor connection state in UI:

```typescript
const { connectionStatus, c2State, getC2Status } = useCommStore();

// connectionStatus: 'disconnected' | 'connecting' | 'connected' | 'unverified' | 'severed'
// c2State: 'IDLE' | 'CONNECTING' | 'CONNECTED' | 'DEGRADED' | 'DISCONNECTED' | 'BACKOFF'

const status = getC2Status();
// {
//   state: 'CONNECTED',
//   endpoint: 'wss://...',
//   rttMs: 120,
//   missedHeartbeats: 0,
//   queuedMessages: 0,
//   lastMessageReceived: Date,
//   lastMessageSent: Date,
//   ...
// }
```

**New UI Components:**

`C2StatusPanel` - Detailed diagnostics panel:
- Real-time state display
- Last RX/TX timestamps ("Xs ago" format)
- RTT display in milliseconds
- Missed heartbeats counter
- Queued messages count
- Reconnection attempts (X/10)
- Last error with copy-to-clipboard
- Quick action buttons (Connect, Disconnect, Reconnect Now)

`C2StatusIndicator` - Compact top-bar indicator:
- Color-coded state icon
- Missed heartbeats badge
- Click to expand full status panel

## Testing

### Mock C2 Server

A mock WebSocket server is provided for testing:

```bash
cd tests/mock-servers
npm install
npm start
```

The server:
- Accepts connections on `ws://localhost:8080` (configurable via PORT)
- Echoes messages back with mock responses
- Simulates call acceptance (1 second delay)
- Periodically drops connections to test reconnection (20% probability every 60s)
- Logs all activity to console
- Supports configurable behavior via environment variables

**Advanced Testing:**

```bash
# Add 100ms latency to all responses
LATENCY_MS=100 npm start

# Simulate 10% packet loss
DROP_RATE=0.1 npm start

# Delay heartbeat responses by 11 seconds (triggers DEGRADED state)
HEARTBEAT_DELAY_MS=11000 npm start

# Combine multiple conditions
LATENCY_MS=500 DROP_RATE=0.2 HEARTBEAT_DELAY_MS=5000 npm start
```

See `tests/mock-servers/README.md` for complete documentation.

### Testing Workflow

1. **Start Mock Server**
   ```bash
   cd tests/mock-servers
   npm start
   ```

2. **Configure Dashboard**
   ```env
   VITE_C2_ENDPOINT=ws://localhost:8080
   VITE_DEV_ALLOW_INSECURE_LOCALHOST=true
   ```

3. **Start Dashboard**
   ```bash
   cd packages/dashboard
   npm run dev
   ```

4. **Test Scenarios**

   **Connection Test:**
   - Verify C2 connects on startup
   - Check connection status indicator

   **Messaging Test:**
   - Send a chat message
   - Verify echo response from server
   - Check message appears in conversation

   **Reconnection Test:**
   - Stop mock server
   - Observe dashboard enters BACKOFF state
   - Restart mock server
   - Verify automatic reconnection
   - Verify queued messages are sent

   **Heartbeat Test:**
   - Connect and observe heartbeat logs
   - Verify heartbeat responses
   - Simulate network delay to trigger DEGRADED state

   **Call Signaling Test:**
   - Initiate a call
   - Verify call invitation sent
   - Verify acceptance received (1 second delay)
   - Check call state transitions

### Integration Tests

Run C2 integration tests:

```bash
cd packages/dashboard
npm test -- src/services/c2
```

### Manual Testing Checklist

- [ ] Dashboard connects to C2 on startup
- [ ] Connection status visible in UI
- [ ] Send chat message successfully
- [ ] Receive incoming messages
- [ ] Initiate call and see status change
- [ ] Accept/reject incoming calls
- [ ] Server disconnect triggers reconnection
- [ ] Reconnection succeeds with backoff
- [ ] Messages queued during disconnect are sent after reconnect
- [ ] Heartbeat timeouts trigger degraded state
- [ ] State transitions logged to console

## Message Signing (Future)

Currently, message signing is disabled for Sprint 1. To enable:

1. Set `signingEnabled: true` in C2ClientConfig
2. Implement TPM integration in `C2Client.signMessage()`
3. Implement signature verification in `C2Client.verifyMessage()`

Placeholder signing is used for development.

## Troubleshooting

### "Invalid C2 endpoint" Error

**Cause**: Endpoint fails TLS validation

**Solution**: Check endpoint URL format and TLS settings (see TLS_ENFORCEMENT.md)


### Containerized Local Stack Uses Service DNS (Not localhost)

**Cause**: When running in Docker Compose, `localhost:50051` points to the current container, not the C2 service.

**Solution**:
- Set `C2_ADDR=c2-router:50051`
- Set `AETHER_BUNKER_ENDPOINT=c2-router:50051`
- Use your compose service DNS name if your gRPC service name differs from `c2-router`

If gateway detects `localhost` while running in container, it logs a warning with the recommended endpoint format.

### "WebSocket connection error"

**Cause**: Network unreachable, certificate invalid, or server not running

**Solutions**:
- Verify server is running
- Check firewall/network settings
- Verify certificate trust (for wss://)
- Check endpoint URL

### Connection Stays in BACKOFF

**Cause**: Max reconnection attempts reached or repeated failures

**Solution**: 
- Check server availability
- Verify endpoint configuration
- Check browser console for error details
- Restart dashboard to reset attempt counter

### Messages Not Received

**Causes**:
- Not connected (check connectionStatus)
- Server not echoing messages
- Message parsing errors

**Solutions**:
- Verify connectionStatus === 'connected'
- Check browser console for parsing errors
- Verify message format in network tab
- Check mock server logs

### Heartbeat Timeout

**Cause**: Network latency or server not responding

**Solutions**:
- Check network quality
- Verify server is sending heartbeat responses
- Increase heartbeatTimeoutMs in config
- Check for half-open connections

## Performance Considerations

### Message Queue

- Messages sent while disconnected are queued
- Queue is flushed on reconnection
- No queue limit (consider adding for production)

### Heartbeat Overhead

- Default: 30-second interval
- Minimal bandwidth: ~100 bytes/30s
- Adjust based on network conditions

### Reconnection Strategy

- Exponential backoff prevents server overload
- Jitter prevents thundering herd
- Max attempts prevents infinite loops

## Security

### Authentication

- Currently using client ID (placeholder)
- Future: TPM-backed identity attestation

### Encryption

- TLS for transport layer (wss://)
- End-to-end encryption: planned for message payload

### Integrity

- Message signatures (disabled for Sprint 1)
- Trust status tracked on received messages

## Production Deployment

### Requirements

1. **WebSocket Server**: Running on port 8443 with TLS
2. **Certificate**: Valid TLS certificate for domain
3. **Load Balancer**: Support WebSocket upgrades
4. **Monitoring**: Track connection metrics and errors

### Configuration

```env
VITE_C2_ENDPOINT=wss://c2.aethercore.production:8443
VITE_DEV_ALLOW_INSECURE_LOCALHOST=false
VITE_TPM_ENABLED=true
```

### Health Checks

Monitor:
- Active connections count
- Reconnection rate
- Message throughput
- Heartbeat success rate
- Average RTT

## References

- [TLS Enforcement](./TLS_ENFORCEMENT.md)
- [Message Schema](../packages/shared/src/c2-message-schema.ts)
- [C2 Client Source](../packages/dashboard/src/services/c2/C2Client.ts)
- [Comm Store](../packages/dashboard/src/store/useCommStore.ts)
