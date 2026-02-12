# Mock C2 Server

WebSocket server for testing AetherCore C2 integration.

## Features

- WebSocket server on configurable port
- Message echoing for all C2 message types
- Heartbeat response simulation
- Call invitation auto-acceptance (1 second delay)
- Configurable latency
- Configurable message drop rate (packet loss simulation)
- Configurable heartbeat delay (for degraded state testing)
- Random connection drops (reconnection testing)
- Metrics logging

## Usage

### Basic Start

```bash
npm start
```

Server starts on `ws://localhost:8080`

### With Latency Simulation

```bash
LATENCY_MS=100 npm start
```

Adds 100ms delay to all message responses.

### With Packet Loss Simulation

```bash
DROP_RATE=0.1 npm start
```

Drops 10% of messages randomly (simulates unreliable network).

### With Heartbeat Delay

```bash
HEARTBEAT_DELAY_MS=5000 npm start
```

Delays heartbeat responses by 5 seconds (triggers DEGRADED state in client).

### Combined

```bash
LATENCY_MS=200 DROP_RATE=0.05 HEARTBEAT_DELAY_MS=3000 npm start
```

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `PORT` | Server port | `8080` |
| `LATENCY_MS` | Response latency in milliseconds | `0` |
| `DROP_RATE` | Message drop probability (0-1) | `0` |
| `HEARTBEAT_DELAY_MS` | Heartbeat response delay in milliseconds | `0` |

## Supported Message Types

- `heartbeat` - Echoed back immediately (or with delay if configured)
- `chat` - Echoed back with "Server received: {content}" response
- `call_invite` - Auto-accepted after 1 second
- `call_accept` - Acknowledged
- `call_reject` - Acknowledged
- `call_end` - Acknowledged
- `presence` - Echoed back to sender

## Testing Scenarios

### Test Reconnection

1. Start server
2. Connect client
3. Stop server (Ctrl+C)
4. Client should enter BACKOFF state
5. Restart server
6. Client should reconnect automatically

### Test Degraded State

```bash
HEARTBEAT_DELAY_MS=11000 npm start
```

Client heartbeat timeout is 10 seconds, so 11-second delay triggers DEGRADED state.

### Test Unreliable Network

```bash
LATENCY_MS=500 DROP_RATE=0.2 npm start
```

Simulates poor network conditions (500ms latency, 20% packet loss).

### Test Message Queueing

1. Start client
2. Send messages
3. Stop server
4. Client queues messages
5. Restart server
6. Client flushes queued messages

## Metrics

Server logs metrics every 30 seconds:
- Active connections
- Total connections since start
- Total messages received
- Dropped messages (if DROP_RATE > 0)
- Server uptime

## Automatic Connection Drops

Server randomly drops connections every 60 seconds (20% probability) to test reconnection logic.

## Logs

All messages are logged to console:
```
[Mock C2 Server] Client connected: client-xxx from ::1
[Mock C2 Server] Received from client-xxx: chat
[Mock C2 Server] Metrics: { activeConnections: 1, totalMessages: 42, ... }
```

## Shutdown

Press `Ctrl+C` for graceful shutdown. All clients are notified and connections are closed cleanly.

## Integration with Dashboard

Configure dashboard to connect to mock server:

```env
# packages/dashboard/.env
VITE_C2_ENDPOINT=ws://localhost:8080
VITE_DEV_ALLOW_INSECURE_LOCALHOST=true
```

Then start dashboard:
```bash
cd packages/dashboard
npm run dev
```

## Troubleshooting

**Port already in use:**
```bash
PORT=8081 npm start
```

**Client not connecting:**
- Verify endpoint URL
- Check firewall settings
- Ensure DEV_ALLOW_INSECURE_LOCALHOST=true for ws:// (not wss://)

**Heartbeat timeout not triggering:**
- Increase HEARTBEAT_DELAY_MS beyond client's heartbeatTimeoutMs (default 10000)
- Client logs should show "Heartbeat timeout - missed X heartbeat(s)"
