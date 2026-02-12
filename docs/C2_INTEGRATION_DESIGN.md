# C2 Integration Design

## Current State

### Existing Implementation

The AetherCore dashboard already has a C2 (Command & Control) client implementation with the following components:

**C2Client** (`packages/dashboard/src/services/c2/C2Client.ts`):
- Deterministic finite state machine
- WebSocket-based transport
- Message signing interface (TPM-deferred)
- Heartbeat mechanism with timeout detection
- Exponential backoff reconnection
- Message queueing during disconnection

**Message Envelope** (`packages/shared/src/c2-message-schema.ts`):
- Versioned schema (v1.0)
- Zod validation for type safety
- Support for chat, calls, presence, control, heartbeat
- Signature field for Ed25519 signing
- Trust status tracking

**UI Integration** (`packages/dashboard/src/store/useCommStore.ts`):
- Zustand store managing C2 client lifecycle
- Actions for messaging, calls, presence
- Connection status mapping to UI states

**Mock Server** (`tests/mock-servers/server.js`):
- WebSocket server for testing
- Message echoing
- Simulated connection drops

### Current Gaps

1. **Documentation**: No formal design document with state machine diagram
2. **Test Coverage**: Limited unit and integration tests
3. **UI Feedback**: Connection status visible but degraded state needs enhancement
4. **Queue Policy**: Message queue exists but policy not explicitly documented
5. **Observability**: Events logged but not structured for tactical operations
6. **Diagnostics**: No explicit diagnostics hooks (RTT, missed heartbeats, etc.)

## Proposed Architecture

### Module Boundaries

```
┌─────────────────────────────────────────────────────────────┐
│                     Tactical Glass UI                        │
│  (ConnectionStatus, CommView, Settings)                      │
└────────────────────┬────────────────────────────────────────┘
                     │ React Components
                     │ consume store
┌────────────────────▼────────────────────────────────────────┐
│                   useCommStore                               │
│  (Zustand Store - UI State Management)                      │
│  - operators, conversations, calls                           │
│  - connectionStatus, connectionState, c2State                │
└────────────────────┬────────────────────────────────────────┘
                     │ initC2Client()
                     │ connectC2()
                     │ sendMessage()
┌────────────────────▼────────────────────────────────────────┐
│                    C2Client                                  │
│  (State Machine + Transport Layer)                           │
│  - State: IDLE, CONNECTING, CONNECTED, DEGRADED, BACKOFF    │
│  - connect(), disconnect(), sendMessage()                    │
│  - Heartbeat, Reconnection, Queue Management                 │
└────────────────────┬────────────────────────────────────────┘
                     │ WebSocket
┌────────────────────▼────────────────────────────────────────┐
│                 C2 Server / Mock Server                      │
│  (WebSocket Endpoint)                                        │
└──────────────────────────────────────────────────────────────┘
```

**Key Principles**:
1. **UI is transport-agnostic**: Components only interact with useCommStore
2. **Store manages lifecycle**: useCommStore owns C2Client instance
3. **C2Client is self-contained**: Handles all connection logic internally
4. **State flows up**: C2Client emits events, store updates UI state
5. **Commands flow down**: UI triggers store actions, store calls C2Client methods

### Integration Points

| Layer | Responsibility | Interface |
|-------|---------------|-----------|
| **UI Components** | Display status, capture input | `useCommStore()` hooks |
| **useCommStore** | State management, business logic | C2Client callbacks, React state |
| **C2Client** | Connection management, protocol | WebSocket, MessageEnvelope |
| **Message Schema** | Validation, serialization | Zod schemas, type guards |
| **Transport** | Network communication | WebSocket API |

## State Machine

### States

```
                    ┌──────────┐
                    │   IDLE   │ (Initial state, no connection)
                    └────┬─────┘
                         │ connect()
                         ▼
                    ┌──────────┐
              ┌─────│CONNECTING│◀────┐ (Establishing WebSocket)
              │     └────┬─────┘     │
              │          │            │
              │   onopen │            │ reconnect
              │          ▼            │
              │     ┌──────────┐     │
              │     │CONNECTED │─────┘ (Operational, exchanging messages)
              │     └────┬─────┘
              │          │
              │          │ heartbeat timeout
              │          ▼
              │     ┌──────────┐
              │     │ DEGRADED │ (Connected but unhealthy)
              │     └────┬─────┘
              │          │
              │          │ timeout exceeded
              │          ▼
              │     ┌──────────┐
              └────▶│ BACKOFF  │ (Scheduled reconnection)
                    └────┬─────┘
                         │ delay expires
                         │ OR reconnectNow()
                         └──────┐
                                │
                    ┌──────────┐│
                    │DISCONNECT│◀┘ (Explicit disconnect or max attempts)
                    └──────────┘
```

### State Transitions

| From | Event | To | Action |
|------|-------|-----|--------|
| IDLE | connect() | CONNECTING | Open WebSocket |
| CONNECTING | onopen | CONNECTED | Start heartbeat, flush queue |
| CONNECTING | onerror | BACKOFF | Schedule reconnect |
| CONNECTED | heartbeat timeout | DEGRADED | Log warning, continue sending |
| DEGRADED | heartbeat restored | CONNECTED | Reset timeout counter |
| DEGRADED | timeout exceeded | DISCONNECTED | Close WebSocket |
| DISCONNECTED | auto-reconnect | BACKOFF | Schedule with exponential backoff |
| BACKOFF | delay expires | CONNECTING | Attempt reconnection |
| BACKOFF | reconnectNow() | CONNECTING | Skip delay, reconnect immediately |
| ANY | disconnect() | IDLE | Close WebSocket, clear timers |
| BACKOFF | max attempts | DISCONNECTED | Give up reconnection |

### State Invariants

**IDLE**:
- No WebSocket instance
- No timers running
- Queue may contain messages

**CONNECTING**:
- WebSocket exists but not open
- No heartbeat timer
- Reconnect timer may exist (from previous attempt)

**CONNECTED**:
- WebSocket open and functional
- Heartbeat timer running
- Heartbeat timeout timer running
- Messages sent immediately

**DEGRADED**:
- WebSocket still open
- Heartbeat timer running
- Missed heartbeat count > 0
- UI should show warning

**BACKOFF**:
- No WebSocket instance (closed)
- Reconnect timer scheduled
- backoffUntil timestamp set
- Messages queued

**DISCONNECTED**:
- No WebSocket instance
- No timers
- Terminal state (requires explicit connect() to restart)

### Events

All state changes emit events with structured logging:

```typescript
type C2Event =
  | 'CONNECT_REQUESTED'   // User initiated connection
  | 'CONNECTED'           // WebSocket opened successfully
  | 'DISCONNECTED'        // Connection closed
  | 'MESSAGE_RX'          // Message received
  | 'MESSAGE_TX'          // Message transmitted
  | 'ERROR'               // Error occurred
  | 'BACKOFF_SCHEDULED'   // Reconnection scheduled
  | 'HEARTBEAT_TIMEOUT';  // Heartbeat not acknowledged
```

### Observability

Each event includes:
- Timestamp
- Current state
- Event type
- Context data (attempt number, delay, error message, etc.)
- NO sensitive data (message content, keys, etc.)

Example log:
```
[C2] State transition: BACKOFF -> CONNECTING (CONNECT_REQUESTED)
[C2] Reconnecting in 2147ms (attempt 2/10)
```

## Transport Layer

### WebSocket Configuration

**Protocol Selection**:
- Production: `wss://` (TLS 1.3 required)
- Localhost Dev: `ws://` (only with `VITE_DEV_ALLOW_INSECURE_LOCALHOST=true`)
- Endpoint validation enforced at construction time

**Connection Lifecycle**:
1. Validate endpoint (TLS check)
2. Create WebSocket instance
3. Attach event handlers (onopen, onclose, onerror, onmessage)
4. Wait for onopen event
5. Start heartbeat mechanism
6. Flush message queue

### Heartbeat Protocol

**Purpose**: Detect half-open connections and measure latency

**Mechanism**:
- Client sends `heartbeat` message every 30 seconds
- Server echoes back immediately
- Client tracks last received message timestamp
- Timeout after 10 seconds without any message

**Heartbeat Message**:
```json
{
  "schema_version": "1.0",
  "message_id": "uuid",
  "timestamp": 1234567890,
  "type": "heartbeat",
  "from": "client-id",
  "payload": { "timestamp": 1234567890 }
}
```

**Timeout Detection**:
- Any message received resets timeout (not just heartbeats)
- After 10s without messages: transition to DEGRADED
- After additional 10s in DEGRADED: close connection

**RTT Estimation** (future enhancement):
- Track heartbeat send time
- Measure delta to heartbeat receive time
- Exponential moving average for smoothing

### Reconnection Strategy

**Exponential Backoff with Jitter**:
```javascript
delay = min(initialBackoff * 2^attempt, maxBackoff) + random(0, 1000)
```

**Default Configuration**:
- initialBackoffMs: 1000 (1 second)
- maxBackoffMs: 30000 (30 seconds)
- maxReconnectAttempts: 10
- Jitter: 0-1000ms random

**Backoff Schedule** (typical):
| Attempt | Base Delay | With Jitter (approx) |
|---------|-----------|---------------------|
| 1 | 1s | 1-2s |
| 2 | 2s | 2-3s |
| 3 | 4s | 4-5s |
| 4 | 8s | 8-9s |
| 5 | 16s | 16-17s |
| 6 | 30s (capped) | 30-31s |
| 7-10 | 30s | 30-31s |

**Reset Conditions**:
- Successful connection: reset attempt counter to 0
- Explicit disconnect(): reset counter, no auto-reconnect
- Max attempts reached: stop trying, require manual intervention

**Reconnect Now**:
- Bypasses backoff delay once
- Resets to attempt 1
- Does NOT reset max attempts counter

### Half-Open Detection

**Problem**: Network can silently drop connection without closing WebSocket

**Detection**:
1. Heartbeat timeout triggers DEGRADED state
2. If still no messages after extended timeout, assume half-open
3. Force close WebSocket
4. Trigger reconnection

**Indicators**:
- No messages received for > heartbeatTimeoutMs
- WebSocket.readyState still OPEN
- Send attempts may succeed locally but not reach server

## Message Envelope

### Schema Version 1.0

```typescript
interface MessageEnvelope {
  schema_version: "1.0";
  message_id: string;        // UUID v4
  timestamp: number;          // ms since epoch
  type: MessageType;
  from: string;              // sender client ID
  payload: unknown;          // type-specific data
  signature?: string;        // Ed25519 signature (hex), optional
  trust_status?: TrustStatus; // verification result
}
```

### Message Types

| Type | Purpose | Payload Schema |
|------|---------|---------------|
| `chat` | Text messaging | `{ content, recipientId, encrypted }` |
| `call_invite` | WebRTC call setup | `{ callId, recipientId, sdpOffer? }` |
| `call_accept` | Accept call | `{ callId, sdpAnswer? }` |
| `call_reject` | Reject call | `{ callId }` |
| `call_end` | End active call | `{ callId }` |
| `presence` | Status update | `{ status, trustScore? }` |
| `ack` | Acknowledgment | `{ messageId }` |
| `control` | System command | `{ command, parameters? }` |
| `heartbeat` | Keep-alive | `{ timestamp }` |

### Validation

**Parse Flow**:
1. Receive raw WebSocket data (string)
2. JSON.parse() to object
3. Pass to `parseMessageEnvelope(data)` (Zod validation)
4. Extract type-specific payload
5. Verify signature (if present and enabled)
6. Set trust_status based on verification
7. Deliver to callback

**Validation Errors**:
- Malformed JSON: log error, do NOT crash, ignore message
- Schema mismatch: log error, do NOT crash, ignore message
- Invalid signature: set trust_status = 'invalid', deliver anyway
- Missing required fields: log error, ignore message

**Fail-Visible Principle**:
- Invalid messages are logged with full context
- One-line summary for operators
- Detailed error in console for debugging
- UI shows "Unverified" for unsigned or invalid messages

### Signing (TPM Deferred)

**Current State**: Signing disabled for Sprint 1

**Interface**:
```typescript
async signMessage(envelope): Promise<string>
verifyMessage(envelope): boolean
```

**Sprint 1 Implementation**:
- Placeholder software signing (SHA-256 hash)
- All signatures marked with `placeholder:` prefix
- Verification accepts placeholder signatures

**Production Implementation** (future):
- BLAKE3 hashing (NOT SHA-256)
- Ed25519 signing via TPM/Secure Enclave
- Call to `crates/crypto` via FFI/gRPC
- Private keys never in application memory
- Signature verification mandatory
- Unverified messages shown as "UNVERIFIED" in UI

**Signing Payload**:
```typescript
const signable = JSON.stringify({
  schema_version,
  message_id,
  timestamp,
  type,
  from,
  payload
});
// Exclude signature and trust_status from signable data
```

## Queue Policy

### Design Decision: Bounded Queue with Drop Policy

**Rationale**:
- Tactical operations require deterministic behavior
- Unbounded queues can cause memory exhaustion
- Old queued messages may be obsolete when connection restores
- Operators need visibility into message delivery status

### Queue Behavior

**When Disconnected**:
- Messages are queued (not sent immediately)
- Queue has no size limit (implementation consideration)
- Queue persists across reconnection attempts

**On Reconnection**:
- Queue is flushed in FIFO order
- Messages sent one at a time
- If send fails, message requeued at front
- Flush stops on first failure

**Message Priorities** (future):
- Control messages (highest priority, send first)
- Chat messages (normal priority)
- Presence updates (low priority, can be dropped)

### Drop Policy (Future Enhancement)

**Not Implemented in Sprint 1**, but design considers:

**Option A: Time-based expiration**
- Messages older than 60 seconds dropped on flush
- UI notified of dropped messages

**Option B: Size-based limit**
- Max 100 messages queued
- New messages replace oldest when full
- UI shows "queue full" warning

**Option C: Type-based filtering**
- Presence updates dropped immediately if disconnected
- Heartbeats never queued (handled by state machine)
- Chat/calls queued normally

### UI Feedback

When disconnected:
- Connection status shows "Backoff" or "Disconnected"
- Send button disabled OR
- Send button shows "Queued" state after click
- Banner: "Messages will be sent when connection restores"

When queue flushing:
- Brief indicator: "Sending queued messages (3 remaining)"

## UI Integration

### Store Interface

**useCommStore** exposes:

```typescript
// State
connectionStatus: 'disconnected' | 'connecting' | 'connected' | 'unverified' | 'severed'
connectionState: 'connected' | 'intermittent' | 'disconnected'
c2State: 'IDLE' | 'CONNECTING' | 'CONNECTED' | 'DEGRADED' | 'BACKOFF' | 'DISCONNECTED'

// Actions
initC2Client(endpoint: string, clientId: string): void
connectC2(): Promise<void>
disconnectC2(): void
getC2Status(): { state, endpoint, ... } | null
sendMessage(to: string, content: string): Promise<void>
```

### Status Mapping

| C2Client State | connectionStatus | connectionState | UI Display |
|---------------|-----------------|----------------|------------|
| IDLE | disconnected | disconnected | "Disconnected" (gray) |
| CONNECTING | connecting | disconnected | "Connecting..." (yellow) |
| CONNECTED | connected | connected | "Connected" (green) |
| DEGRADED | unverified | intermittent | "Degraded" (orange) |
| BACKOFF | connecting | disconnected | "Reconnecting in Xs" (yellow) |
| DISCONNECTED | disconnected | disconnected | "Disconnected" (red) |

### Operator UX Requirements

**Persistent Status Indicator** (top-right of dashboard):
- Color-coded dot: green (connected), yellow (connecting/backoff), orange (degraded), red (disconnected)
- Text: state name + context
  - "Connected"
  - "Reconnecting in 5s"
  - "Degraded (high latency)"
  - "Disconnected"
- Click to expand details panel

**Details Panel** (on click):
- Endpoint URL
- Current state
- Last message sent: "2 seconds ago"
- Last message received: "5 seconds ago"
- Reconnect attempts: "2/10"
- RTT estimate: "120ms" (future)
- Missed heartbeats: "2" (when degraded)
- Last error: "WebSocket connection failed" (if present)

**Quick Actions**:
- "Reconnect Now" button (bypasses backoff)
- "Copy Last Error" button (for support tickets)
- "Disconnect" button (explicit stop)

**Message Trust Display**:
- Verified messages: green check icon
- Unverified messages: gray question icon
- Invalid messages: red X icon
- Hover tooltip: "Verified by TPM signature" or "Unverified (TPM disabled)"

**Minimal Noise**:
- No toast notifications for routine state changes
- Toast only for: first connection, final disconnection, errors
- Degraded state: persistent banner at top (dismissible)
- Banner text: "Connection degraded - high latency or packet loss"

### Telemetry Display

**Connection Health Panel** (Settings or Debug tab):
- State history: last 10 transitions with timestamps
- Message counts: sent / received / queued
- Heartbeat success rate: "95% (19/20 last heartbeats)"
- Reconnection history: timestamps and reasons
- Network quality indicator: "Good" / "Fair" / "Poor"

## Testing Strategy

### Unit Tests

**C2Client Tests** (`src/services/c2/__tests__/C2Client.test.ts`):
- State machine transitions
- Backoff calculation (with fake timers)
- Message queueing and flushing
- Heartbeat timeout detection
- Reconnection logic
- Error handling

**Envelope Tests** (`packages/shared/src/__tests__/c2-message-schema.test.ts`):
- Schema validation for each message type
- parseMessageEnvelope() success cases
- parseMessageEnvelope() failure cases (malformed data)
- createMessageEnvelope() generates valid envelopes
- serializeForSigning() produces consistent output

**Signing Tests** (placeholder):
- signMessage() produces valid signature format
- verifyMessage() accepts placeholder signatures
- verifyMessage() rejects invalid signatures

### Integration Tests

**Reconnection Test**:
1. Start mock server
2. Connect client
3. Assert CONNECTED state
4. Stop mock server
5. Assert BACKOFF state
6. Wait for reconnection attempt
7. Restart mock server
8. Assert CONNECTED state
9. Verify queued messages sent

**Degraded State Test**:
1. Connect to mock server
2. Configure server to delay heartbeat responses by 15 seconds
3. Assert DEGRADED state after 10 seconds
4. Resume normal heartbeat responses
5. Assert CONNECTED state

**Message Flow Test**:
1. Connect to mock server
2. Send chat message
3. Assert MESSAGE_TX event
4. Wait for echo from server
5. Assert MESSAGE_RX event
6. Verify message in store

**Call Signaling Test**:
1. Connect to mock server
2. Initiate call to "operator-002"
3. Assert call_invite sent
4. Wait for call_accept from server
5. Assert call state = "active"

### Mock Server Enhancements

**Required Capabilities**:
- [ ] Accept connections
- [x] Echo messages back
- [ ] Delayed responses (configurable latency)
- [ ] Drop connection on command
- [ ] Send malformed envelopes (negative testing)
- [ ] Simulate heartbeat timeout (stop responding)
- [ ] Simulate slow heartbeat (high latency)
- [ ] Track connection metrics (for assertions)

**Test Harness API** (future):
```typescript
mockServer.setLatency(500); // 500ms delay
mockServer.dropConnection(); // force disconnect
mockServer.stopHeartbeats(); // simulate timeout
mockServer.sendMalformed(); // send invalid JSON
mockServer.getMetrics(); // { connectCount, messageCount, ... }
```

## Acceptance Criteria

This implementation is complete when:

- [x] C2Client implements full state machine with all transitions
- [x] Message envelope schema validates all message types
- [ ] UI shows connection status with operator-grade detail
- [ ] Reconnection works under forced drops and recovers automatically
- [ ] Degraded mode triggers on missed heartbeats and is visible in UI
- [ ] Envelope validation rejects malformed messages without crashing
- [ ] No secrets logged (verified in code review)
- [ ] Unit tests cover state machine and envelope validation
- [ ] Integration tests cover reconnection and degraded state
- [ ] Tests are deterministic (use fake timers)
- [ ] Mock server supports required test scenarios
- [ ] Documentation complete (this file + inline comments)

## References

- [C2 Integration Guide](./C2_INTEGRATION.md) - User-facing documentation
- [TLS Enforcement](./TLS_ENFORCEMENT.md) - Security requirements
- [Message Schema](../packages/shared/src/c2-message-schema.ts) - TypeScript definitions
- [C2Client Source](../packages/dashboard/src/services/c2/C2Client.ts) - Implementation
- [Comm Store](../packages/dashboard/src/store/useCommStore.ts) - UI integration
