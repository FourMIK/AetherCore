# Aetheric Link - Signed Heartbeat Protocol

## Overview

The Aetheric Link is a cryptographic authentication protocol for the C2 (Command & Control) channel between the Tauri desktop client and the Node.js gateway service. It implements **Application-Layer Mutual Authentication** via signed heartbeats.

## Architecture

### Components

1. **Tauri Backend (Rust)**: `sign_heartbeat_payload` command
   - Uses TPM Manager to sign heartbeat payloads
   - Hardware-rooted trust with TPM 2.0
   - Stub mode for development (BLAKE3 hash)

2. **Frontend (TypeScript)**: WebSocket Manager
   - Runs heartbeat loop every 5 seconds
   - Generates timestamp + nonce payload
   - Signs via Tauri command
   - Sends to gateway via WebSocket

3. **Gateway (Node.js)**: WebSocket Server
   - Verifies heartbeat signatures
   - Freshness check (3s anti-replay)
   - Dead Man's Switch (10s timeout = 2 missed beats)

4. **UI Component**: Connection Indicator
   - Visual states: Green (verified), Amber (pending), Red (severed)
   - Fail-visible error display

## Security Model

### Fail-Visible Doctrine

- **No graceful degradation** for security failures
- If TPM signing fails → SEVER LINK immediately
- If backend verification fails → TERMINATE connection
- Missing 2 heartbeats → DEAD MAN'S SWITCH triggers

### Cryptographic Properties

- **Hardware-Rooted Trust**: Private keys never enter system memory
- **Anti-Replay**: 3-second freshness window
- **Continuous Authentication**: 5-second heartbeat interval
- **Dead Man's Switch**: 10-second timeout enforcement

### Stub Mode vs Production

#### Development/Testing (Stub Mode)
- Uses BLAKE3 hash as signature
- No actual TPM hardware required
- `hardware_available = false` in TpmManager

#### Production Mode
- Requires TPM 2.0 hardware
- Uses TPM-backed Ed25519 or ECDSA
- `hardware_available = true` in TpmManager
- Set `AETHERCORE_PRODUCTION=true` to enforce

## Protocol Flow

```
1. Client connects to Gateway WebSocket (ws://localhost:8080)
   → Status: CONNECTING

2. Connection established
   → Status: UNVERIFIED
   → Start heartbeat loop (5s interval)

3. Every 5 seconds:
   a. Client generates: { ts: Date.now(), nonce: UUID }
   b. Client signs payload via TPM
   c. Client sends: { type: 'HEARTBEAT', payload, signature }

4. Gateway receives heartbeat:
   a. Parse payload
   b. Check freshness (age < 3s)
   c. Verify signature format
   d. Verify signature (in production: Ed25519)
   e. Update last_heartbeat timestamp
   → Send HEARTBEAT_ACK

5. Status: CONNECTED (after first successful heartbeat)

6. Dead Man's Switch (runs every 2s on gateway):
   - If (Date.now() - last_heartbeat) > 10s:
     → Terminate connection
     → Client status: SEVERED
```

## Files Modified/Created

### Rust (Tauri Backend)
- `crates/identity/src/tpm.rs` - Added `sign()` method to TpmManager
- `packages/dashboard/src-tauri/src/commands.rs` - Added `sign_heartbeat_payload` command
- `packages/dashboard/src-tauri/src/lib.rs` - Registered new command

### TypeScript (Frontend)
- `packages/dashboard/src/services/api/WebSocketManager.ts` - NEW: WebSocket manager with heartbeat loop
- `packages/dashboard/src/store/useCommStore.ts` - Added `connectionStatus` and `setConnectionStatus`
- `packages/dashboard/src/components/health/ConnectionIndicator.tsx` - NEW: Visual status indicator
- `packages/dashboard/src/components/hud/TopBar.tsx` - Integrated ConnectionIndicator
- `packages/dashboard/src/App.tsx` - Initialize WebSocket manager on mount
- `packages/dashboard/tailwind.config.js` - Added `pulse-fast` animation

### Node.js (Gateway)
- `services/gateway/src/index.ts` - Complete rewrite with WebSocket server, heartbeat verification, Dead Man's Switch
- `services/gateway/package.json` - Added `ws` and `@types/ws` dependencies

## Configuration

### Environment Variables

#### Frontend (Vite)
```bash
VITE_GATEWAY_URL=ws://localhost:8080  # WebSocket gateway URL
```

#### Gateway
```bash
PORT=8080  # Gateway WebSocket port
```

#### Tauri (Rust)
```bash
AETHERCORE_PRODUCTION=true  # Enforce hardware TPM (production mode)
```

## Testing

### Manual Testing

1. **Start Gateway Service**:
   ```bash
   cd services/gateway
   npm install
   npm run build
   npm start
   ```

2. **Start Dashboard (Tauri)**:
   ```bash
   cd packages/dashboard
   npm run tauri:dev
   ```

3. **Observe Console Logs**:
   - Frontend: `[AETHERIC LINK]` messages
   - Gateway: `[AETHERIC LINK]` and `[SECURITY]` messages

4. **Check Connection Indicator**:
   - Should show "LINK PENDING" (amber) initially
   - After first heartbeat: "LINK ESTABLISHED" (green)
   - If TPM fails: "LINK SEVERED" (red, flashing)

### Test Scenarios

#### 1. Normal Operation
- Green indicator
- Heartbeats every 5s
- Gateway sends ACK

#### 2. TPM Signing Failure
- Simulate by breaking TPM initialization
- Red indicator immediately
- Connection severed client-side

#### 3. Dead Man's Switch
- Stop sending heartbeats (disable interval)
- After 10s: Gateway terminates connection
- Red indicator on client

#### 4. Stale Heartbeat (Anti-Replay)
- Modify timestamp to be > 3s old
- Gateway rejects with VERIFICATION_FAILED
- Connection terminated

## Production Deployment

### Security Checklist

- [ ] Set `AETHERCORE_PRODUCTION=true`
- [ ] Verify TPM 2.0 hardware is present (`/dev/tpm0` on Linux)
- [ ] Use WSS (secure WebSocket) endpoint: `wss://gateway.example.com`
- [ ] Configure TLS 1.3 on gateway
- [ ] Store public keys for signature verification
- [ ] Implement Ed25519 signature verification (not stub)
- [ ] Set up monitoring for heartbeat failures
- [ ] Configure alerting for Dead Man's Switch triggers

### Hardening

1. **Replace Stub Verification**:
   - Install `blake3` npm package or Ed25519 library
   - Implement proper signature verification
   - Store and verify against client public keys

2. **TLS Configuration**:
   - Use WSS with valid certificate
   - Enforce TLS 1.3
   - Configure strong cipher suites

3. **Monitoring**:
   - Log all SECURITY events
   - Alert on LINK SEVERED events
   - Track heartbeat success/failure rates

## Troubleshooting

### Issue: TPM Signing Fails

**Symptoms**: Red indicator, "TPM Link not initialized" error

**Solutions**:
1. Verify TPM hardware is present
2. Check TPM is enabled in BIOS/UEFI
3. Verify `/dev/tpm0` exists (Linux)
4. Run in stub mode for development

### Issue: Connection Always UNVERIFIED

**Symptoms**: Amber indicator persists

**Possible Causes**:
1. Gateway not running
2. WebSocket URL incorrect
3. Firewall blocking connection
4. Signature verification failing

**Debug Steps**:
1. Check gateway console for heartbeat logs
2. Check frontend console for TPM signing errors
3. Verify WebSocket connection in browser DevTools

### Issue: Frequent Disconnects

**Symptoms**: Red indicator, reconnection attempts

**Possible Causes**:
1. Heartbeat interval too long
2. Network latency issues
3. Gateway Dead Man's Switch too aggressive

**Solutions**:
1. Verify heartbeat every 5s
2. Check network stability
3. Adjust Dead Man's Switch threshold if needed

## Future Enhancements

1. **Multi-Factor Authentication**: Combine heartbeat with token-based auth
2. **Adaptive Intervals**: Adjust heartbeat frequency based on network conditions
3. **Cryptographic Binding**: Tie session to specific device identity
4. **Audit Trail**: Log all authentication events to immutable ledger
5. **Zero-Trust Architecture**: Verify every request, not just heartbeats

## References

- **Fail-Visible Doctrine**: System must refuse to operate in degraded security state
- **CodeRalphie**: Hardware root of trust (TPM 2.0/Secure Enclave)
- **Dead Man's Switch**: Automatic action on loss of operator control
- **Anti-Replay Protection**: Prevent reuse of captured authentication tokens
