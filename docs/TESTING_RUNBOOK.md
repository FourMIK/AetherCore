# AetherCore Testing Runbook

## Overview

This runbook provides step-by-step procedures for testing the three major functional improvements:
1. TLS Enforcement
2. C2 Integration
3. Link Quality Metrics

## Prerequisites

### System Requirements

- Node.js 20.x
- pnpm 9.15.0
- Rust 1.75+ (for backend services)
- Git

### Setup

1. **Clone and Install**
   ```bash
   git clone https://github.com/FourMIK/AetherCore
   cd AetherCore
   pnpm install
   ```

2. **Build Packages**
   ```bash
   pnpm build
   ```

## Test Suite 1: TLS Enforcement

### Objective
Verify that TLS is enforced for all network communications with proper dev exceptions.

### Test 1.1: Endpoint Validation Unit Tests

```bash
cd packages/dashboard
pnpm test src/utils/__tests__/endpoint-validation.test.ts
```

**Expected**: All tests pass
- ✓ Accept wss:// for remote endpoints
- ✓ Reject ws:// for remote endpoints
- ✓ Accept ws://localhost with DEV_ALLOW_INSECURE_LOCALHOST
- ✓ Reject ws://localhost without dev flag
- ✓ Similar tests for HTTP/HTTPS and gRPC

### Test 1.2: WebSocket TLS Enforcement

**Setup:**
```bash
# Terminal 1: Start mock server (insecure)
cd tests/mock-servers
npm install
npm start
```

**Test Case A: Insecure Localhost WITHOUT Dev Flag**

```env
# packages/dashboard/.env
VITE_C2_ENDPOINT=ws://localhost:8080
VITE_DEV_ALLOW_INSECURE_LOCALHOST=false
```

```bash
# Terminal 2: Start dashboard
cd packages/dashboard
npm run dev
```

**Expected Result**: ❌ Connection fails with error:
```
[AETHERIC LINK] Invalid WebSocket endpoint: Insecure localhost WebSocket (ws://) requires DEV_ALLOW_INSECURE_LOCALHOST=true environment variable.
```

**Test Case B: Insecure Localhost WITH Dev Flag**

```env
# packages/dashboard/.env
VITE_C2_ENDPOINT=ws://localhost:8080
VITE_DEV_ALLOW_INSECURE_LOCALHOST=true
```

Restart dashboard.

**Expected Result**: ✓ Connection succeeds with warning:
```
[AETHERIC LINK] INSECURE LOCALHOST MODE: Using ws:// for localhost. This is only allowed in development...
```

**Test Case C: Insecure Remote Endpoint**

```env
VITE_C2_ENDPOINT=ws://example.com:8080
VITE_DEV_ALLOW_INSECURE_LOCALHOST=true
```

Restart dashboard.

**Expected Result**: ❌ Connection fails:
```
[AETHERIC LINK] Invalid WebSocket endpoint: Remote WebSocket endpoints MUST use wss://...
```

### Test 1.3: Secure Endpoint (wss://)

**Setup:** Would require a server with TLS certificate. For testing, verify validation passes:

```typescript
// In browser console
import { validateWebSocketEndpoint } from './utils/endpoint-validation';
validateWebSocketEndpoint('wss://c2.aethercore.local:8443');
// Expected: { valid: true, protocol: 'wss', isLocalhost: false }
```

### TLS Test Results Checklist

- [ ] Endpoint validation unit tests pass
- [ ] ws://localhost rejected without dev flag
- [ ] ws://localhost accepted with dev flag
- [ ] ws://remote.com always rejected
- [ ] wss:// always accepted
- [ ] Warning logged for insecure localhost mode

---

## Test Suite 2: C2 Integration

### Objective
Verify C2 client state machine, message exchange, and reconnection logic.

### Test 2.1: Basic Connection

**Setup:**
```bash
# Terminal 1: Mock server
cd tests/mock-servers
npm start

# Terminal 2: Dashboard
cd packages/dashboard
# Set .env
VITE_C2_ENDPOINT=ws://localhost:8080
VITE_DEV_ALLOW_INSECURE_LOCALHOST=true
npm run dev
```

**Test Procedure:**
1. Open browser to dashboard
2. Open browser console
3. Observe connection logs

**Expected Console Output:**
```
[C2] State transition: IDLE -> CONNECTING (CONNECT_REQUESTED)
[C2] Connected to ws://localhost:8080
[C2] State transition: CONNECTING -> CONNECTED (CONNECTED)
[Mock C2 Server] Client connected: client-xxx
```

**Verify:**
- [ ] Connection status shows "connected"
- [ ] No errors in console
- [ ] Mock server logs client connection

### Test 2.2: Message Exchange

**In browser console:**
```javascript
const { sendMessage } = window.__ZUSTAND_STORE__.useCommStore.getState();

// Set current operator first
const { setCurrentOperator } = window.__ZUSTAND_STORE__.useCommStore.getState();
setCurrentOperator({
  id: 'test-operator-001',
  name: 'Test Operator',
  role: 'operator',
  status: 'online',
  verified: true,
  trustScore: 0.9,
  lastSeen: new Date(),
});

// Send message
await sendMessage('operator-002', 'Test message from console');
```

**Expected:**
- Message sent to server
- Echo response received
- Message appears in conversation (check store)

**Server logs should show:**
```
[Mock C2 Server] Received from client-xxx: chat
[Mock C2 Server] Chat from client-xxx: Test message from console
```

**Verify:**
- [ ] Message sent successfully
- [ ] Server receives and logs message
- [ ] Echo response appears in store
- [ ] No errors

### Test 2.3: Heartbeat Mechanism

**Test Procedure:**
1. Connect to C2
2. Wait 30 seconds
3. Observe console logs

**Expected every 30 seconds:**
```
[C2] Sending heartbeat
[Mock C2 Server] Received from client-xxx: heartbeat
```

**Verify:**
- [ ] Heartbeats sent every 30s
- [ ] Server responds to heartbeats
- [ ] Connection stays CONNECTED

### Test 2.4: Reconnection Logic

**Test Procedure:**
1. Connect to C2 (verify CONNECTED)
2. Stop mock server (Ctrl+C in server terminal)
3. Observe dashboard behavior
4. Wait for backoff attempts (observe console)
5. Restart mock server
6. Observe reconnection

**Expected Behavior:**

**On disconnect:**
```
[C2] Connection closed: 1006 
[C2] State transition: CONNECTED -> DISCONNECTED (DISCONNECTED)
[C2] Reconnecting in 1234ms (attempt 1/10)
[C2] State transition: DISCONNECTED -> BACKOFF (BACKOFF_SCHEDULED)
```

**After backoff:**
```
[C2] State transition: BACKOFF -> CONNECTING (CONNECT_REQUESTED)
```

**If server still down:**
```
[C2] Reconnecting in 2567ms (attempt 2/10)
[C2] Reconnecting in 5123ms (attempt 3/10)
...
```

**After server restart:**
```
[C2] Connected to ws://localhost:8080
[C2] State transition: CONNECTING -> CONNECTED (CONNECTED)
```

**Verify:**
- [ ] Disconnect detected immediately
- [ ] Reconnection scheduled with backoff
- [ ] Exponential backoff observed (delays increase)
- [ ] Successful reconnection after server restart
- [ ] Reconnection attempts limited to 10

### Test 2.5: Message Queueing

**Test Procedure:**
1. Connect to C2
2. Stop mock server
3. Send a message while disconnected
4. Restart mock server
5. Wait for reconnection

**Expected:**
```
[C2] Not connected, queueing message
[C2] Connected to ws://localhost:8080
[C2] Flushing 1 queued messages
[Mock C2 Server] Received from client-xxx: chat
```

**Verify:**
- [ ] Message queued when disconnected
- [ ] Message sent after reconnection
- [ ] No message loss

### Test 2.6: Call Signaling

**In browser console:**
```javascript
const { initiateCall, acceptCall, rejectCall, endCall } = 
  window.__ZUSTAND_STORE__.useCommStore.getState();

// Initiate call
await initiateCall('operator-002');

// Check active call
const { activeCall } = window.__ZUSTAND_STORE__.useCommStore.getState();
console.log(activeCall);

// Wait 1 second for mock acceptance

// End call
endCall();
```

**Expected:**
- Call invitation sent
- Mock server accepts after 1s
- Call state transitions visible
- End call succeeds

**Verify:**
- [ ] Call invitation sent
- [ ] Server responds with acceptance
- [ ] Call state updated in store
- [ ] End call works correctly

### C2 Test Results Checklist

- [ ] Connection establishes successfully
- [ ] Messages sent and received
- [ ] Heartbeats sent periodically
- [ ] Reconnection works with exponential backoff
- [ ] Messages queued during disconnect
- [ ] Call signaling works

---

## Test Suite 3: Link Quality Metrics

### Objective
Verify link quality metrics are computed correctly and displayed in UI.

### Test 3.1: Mesh Store Unit Tests

```bash
cd packages/dashboard
pnpm test src/store/__tests__/useMeshStore.test.ts
```

**Expected**: All tests pass
- ✓ Compute link score for excellent connection
- ✓ Compute link score for poor connection
- ✓ Compute aggregate stats
- ✓ Update existing metrics
- ✓ Remove peer and update stats
- ✓ Clear all metrics

### Test 3.2: Link Quality UI Display

**Setup:**
```bash
cd packages/dashboard
npm run dev
```

**Test Procedure:**
1. Navigate to Mesh Network workspace
2. Inject test data in console:

```javascript
const { updateLinkMetrics } = window.__ZUSTAND_STORE__.useMeshStore.getState();

// Add excellent link
updateLinkMetrics('peer-001', {
  peerName: 'Node-Alpha',
  rttMs: 15,
  packetLossPercent: 0.001,
  trustScore: 0.95,
  snrDb: 28,
});

// Add good link
updateLinkMetrics('peer-002', {
  peerName: 'Node-Bravo',
  rttMs: 45,
  packetLossPercent: 0.02,
  trustScore: 0.85,
  snrDb: 18,
});

// Add fair link
updateLinkMetrics('peer-003', {
  peerName: 'Node-Charlie',
  rttMs: 120,
  packetLossPercent: 0.08,
  trustScore: 0.7,
  snrDb: 10,
});

// Add poor link
updateLinkMetrics('peer-004', {
  peerName: 'Node-Delta',
  rttMs: 280,
  packetLossPercent: 0.18,
  trustScore: 0.5,
  snrDb: 3,
});
```

**Expected UI Updates:**
1. **Network Stats Panel:**
   - Mesh Nodes: 0 (no nodes, only link metrics)
   - Connections: 3-4 (based on link score > 0.3)
   - Throughput: Updated based on link quality
   - Avg Latency: ~115ms

2. **Link Quality Metrics Panel:**
   - Four peer entries displayed
   - Each with:
     - Peer name
     - Quality label (EXCELLENT/GOOD/FAIR/POOR)
     - Score percentage
     - RTT, Loss, Trust, SNR values
     - Progress bar colored by quality

**Verify:**
- [ ] Stats update automatically
- [ ] All 4 peers displayed
- [ ] Quality labels correct
- [ ] Colors match quality (green/yellow/red)
- [ ] Progress bars show correct percentage
- [ ] Metrics values display correctly

### Test 3.3: Dynamic Metric Updates

**Test Procedure:**
1. With metrics from 3.2 loaded
2. Degrade a link:

```javascript
const { updateLinkMetrics } = window.__ZUSTAND_STORE__.useMeshStore.getState();

// Degrade Node-Alpha
updateLinkMetrics('peer-001', {
  rttMs: 350,
  packetLossPercent: 0.25,
});
```

**Expected:**
- Node-Alpha quality changes from EXCELLENT to POOR/CRITICAL
- Color changes to red
- Progress bar shrinks
- Aggregate stats update

**Verify:**
- [ ] Quality label updates
- [ ] Color changes
- [ ] Progress bar animates
- [ ] Aggregate stats recalculate

### Test 3.4: Remove Peer

```javascript
const { removePeer } = window.__ZUSTAND_STORE__.useMeshStore.getState();
removePeer('peer-004');
```

**Expected:**
- Node-Delta removed from display
- Connections count decreases
- Aggregate stats update

**Verify:**
- [ ] Peer removed from UI
- [ ] Stats update correctly

### Link Quality Test Results Checklist

- [ ] Unit tests pass
- [ ] Metrics display in UI
- [ ] Quality labels accurate
- [ ] Colors match quality
- [ ] Progress bars correct
- [ ] Dynamic updates work
- [ ] Aggregate stats compute correctly
- [ ] Peer removal works

---

## Smoke Test: End-to-End Flow

### Objective
Verify all three features work together in a realistic scenario.

### Procedure

1. **Start Mock C2 Server**
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

4. **Test Flow:**

   **Step 1: Verify TLS Warning**
   - Check console for insecure localhost warning
   - ✓ Warning present

   **Step 2: Verify C2 Connection**
   - Check connection status indicator
   - ✓ Shows "connected"

   **Step 3: Send Message**
   - Navigate to Comms workspace
   - Send a test message
   - ✓ Message sent and echo received

   **Step 4: View Mesh Metrics**
   - Navigate to Mesh Network workspace
   - Inject test link metrics (see 3.2)
   - ✓ Metrics displayed correctly

   **Step 5: Simulate Network Disruption**
   - Stop mock server
   - ✓ C2 enters BACKOFF state
   - ✓ UI shows "connecting" or "disconnected"

   **Step 6: Verify Reconnection**
   - Restart mock server
   - ✓ C2 reconnects automatically
   - ✓ UI shows "connected"

   **Step 7: Verify Message During Disruption**
   - Stop server
   - Send message
   - ✓ Message queued
   - Restart server
   - ✓ Message sent after reconnect

### Smoke Test Checklist

- [ ] TLS warning displayed for insecure localhost
- [ ] C2 connects successfully
- [ ] Messages sent and received
- [ ] Link metrics display correctly
- [ ] Network disruption handled gracefully
- [ ] Automatic reconnection works
- [ ] Message queueing works

---

## Troubleshooting

### Dashboard Won't Start

**Check:**
- Node version: `node --version` (should be 20.x)
- Dependencies installed: `pnpm install`
- No port conflicts: port 1420 (default Tauri dev port)

### Mock Server Won't Start

**Check:**
- Port 8080 available: `lsof -i :8080`
- Dependencies installed: `npm install` in tests/mock-servers

### Tests Fail

**Check:**
- Build is up to date: `pnpm build`
- No lingering processes
- Environment variables set correctly

### Console Errors

**Common errors:**
- "Cannot find module": Run `pnpm install`
- "Invalid endpoint": Check TLS configuration
- "Connection refused": Verify server is running

---

## Success Criteria

All tests passing indicates:
- ✅ TLS enforcement working correctly
- ✅ C2 integration operational and robust
- ✅ Link quality metrics accurate and real-time
- ✅ System ready for controlled test bed deployment

## Next Steps

After successful testing:
1. Deploy to test bed environment
2. Monitor logs for production issues
3. Gather operator feedback
4. Iterate on UX improvements
5. Plan TPM integration for Sprint 2
