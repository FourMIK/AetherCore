# Direct Messenger and Video Calling Implementation

## Overview

This implementation adds **hardware-rooted, cryptographically-verified P2P messaging and video calling** to the AetherCore C2 Dashboard. Every message and video frame is wrapped in a **Merkle Vine** structure with BLAKE3 hashing and Ed25519 signatures, following the **Fail-Visible** design philosophy.

## Key Features

### 1. P2P Messaging with Merkle Vine Integrity

**File:** `packages/dashboard/src/services/operator/P2PMessagingClient.ts`

- Every message is a `CanonicalEvent` with chain linkage (`prev_hash`)
- BLAKE3 hashing for all event hashes
- Ed25519 signature verification (dev mode simulation, production uses TPM gRPC)
- Chain validation: `GENESIS_HASH → prev_hash → current_hash`
- Store-and-forward with exponential backoff for contested networks
- Byzantine fault detection via broken chain = `SPOOFED` status

**Architecture:**
```typescript
interface CanonicalEvent {
  event_id: string;
  event_type: 'MESSAGE' | 'SIGNAL' | 'FRAME_HASH' | 'REVOCATION';
  timestamp: number;
  device_id: NodeID;
  sequence: number;           // Monotonic sequence
  prev_hash: string;          // BLAKE3 hash of previous event
  chain_height: number;       // Chain position
  payload: unknown;
  event_hash: string;         // BLAKE3 hash of this event
  signature: string;          // Ed25519 signature
  public_key: string;
}
```

### 2. Video Frame Integrity with StreamAuthenticator

**File:** `packages/dashboard/src/services/guardian/StreamAuthenticator.ts`

- Merkle Vine chain for video frame hashes
- BLAKE3 hash every keyframe (30-frame interval)
- Frame hashes wrapped as `CanonicalEvent` with chain linkage
- Real-time integrity verification
- Fail-Visible: Hash mismatch = `SPOOFED` + IntegrityOverlay alert

**Usage:**
```typescript
const authenticator = new StreamAuthenticator({
  localNodeId: 'abc...',
  remoteNodeId: 'def...',
  sessionId: 'call-123',
  privateKey: '...',
  publicKey: '...',
  dataChannel: rtcDataChannel,
  onIntegrityViolation: (reason) => {
    console.error('Stream compromised:', reason);
  },
});

// Sender side
await authenticator.processOutgoingFrame(frameData, timestamp, isKeyframe);

// Receiver side
const valid = await authenticator.verifyFrame(frameData, frameSequence);
```

### 3. MessagingPanel UI Component

**File:** `packages/dashboard/src/components/messaging/MessagingPanel.tsx`

- Two-pane layout: Conversation list + active chat
- Hardware attestation filtering (verified operators only, trust >= 70%)
- MerkleChainIndicator on every message
- Link quality from `useMeshStore`
- Trust score badges
- Platform type indicators
- Message input with hardware signature notice

**Features:**
- Filters operators by `verified && trustScore >= 70 && status !== 'offline'`
- Shows PlatformType (Operator/Commander/USV/UAS)
- Displays link quality (excellent/good/fair/poor/contested)
- Real-time verification status on messages

### 4. MerkleChainIndicator Component

**File:** `packages/dashboard/src/components/messaging/MerkleChainIndicator.tsx`

Fail-visible verification status indicator with three states:

- **VERIFIED**: Green shield with checkmark ✓
- **STATUS_UNVERIFIED**: Yellow shield with question mark
- **SPOOFED**: Red shield with X (Byzantine node detected)

**Features:**
- Compact mode (icon only) for message bubbles
- Detailed mode (badge with label) for headers
- Tooltip with chain height, hash algorithm, signature type
- Fail-Visible philosophy footer

### 5. IntegrityOverlay Component

**File:** `packages/dashboard/src/components/guardian/IntegrityOverlay.tsx`

Full-screen alert overlay for stream integrity violations:

- Displays when `status.showAlert === true`
- Shows invalid/valid/total frame counts
- Calculates compromise rate percentage
- Provides terminate/acknowledge actions
- Animated warning icons with pulse effect
- Critical (red) vs Warning (yellow) severity levels

### 6. VideoCallPanel Integration

**File:** `packages/dashboard/src/components/comms/VideoCallPanel.tsx`

Enhanced with integrity monitoring:

- `IntegrityStatus` state tracking
- `MerkleChainIndicator` in header (real-time verification display)
- `IntegrityOverlay` integration for violations
- `handleTerminateOnIntegrityFailure` handler
- `handleDismissIntegrityAlert` handler

### 7. Great Gospel Revocation Integration

**Files:**
- `packages/dashboard/src/store/useCommStore.ts` (revocation actions)
- `packages/dashboard/src/hooks/useGreatGospel.ts` (Gospel ledger integration)

**Features:**

**useCommStore:**
- `revokedNodes: Set<string>` for Byzantine node tracking
- `revokeNode(nodeId, reason)` terminates:
  - Active/incoming calls with revoked participants
  - WebRTC peer connections
  - Media streams
  - Message conversations
  - Operator presence in UI
- `isNodeRevoked(nodeId)` checker for filtering

**useGreatGospel Hook:**
- WebSocket connection to Gospel ledger
- Auto-reconnect with exponential backoff
- Revocation event parsing and dispatch
- Manual revoke for operator override
- Revocation event log tracking

**Revocation Flow:**
```
Gospel Ledger → WebSocket → useGreatGospel → revokeNode → useCommStore
                                                              ↓
                                                    Terminate Sessions
                                                              ↓
                                                    Remove from UI
                                                              ↓
                                                   (Future: AethericSweep)
```

## Architecture Diagrams

### Messaging Data Flow

```
User Input → MessageComposer
                ↓
         P2PMessagingClient
                ↓
         Create CanonicalEvent
                ↓
         Compute BLAKE3 hash
                ↓
         Sign with Ed25519
                ↓
         Update local chain state
                ↓
         WebSocket transmission
                ↓
    (Network: contested/degraded)
                ↓
         Receive at peer
                ↓
    Verify signature & chain
                ↓
         Update remote chain state
                ↓
         MessagingPanel display
                ↓
         MerkleChainIndicator
```

### Video Stream Data Flow

```
Video Frame → StreamAuthenticator
                ↓
         Detect keyframe
                ↓
         Compute BLAKE3 hash
                ↓
         Wrap in CanonicalEvent
                ↓
         Sign with Ed25519
                ↓
         Update frame chain state
                ↓
         Send via RTCDataChannel
                ↓
    (Network: contested/degraded)
                ↓
         Receive hash at peer
                ↓
    Verify signature & chain
                ↓
         Receive actual frame
                ↓
         Compute frame hash
                ↓
         Compare with expected
                ↓
    Match? → VERIFIED
    Mismatch? → SPOOFED → IntegrityOverlay
```

### Revocation Flow

```
Byzantine Behavior Detected
         ↓
    Gospel Ledger
         ↓
    WebSocket Event
         ↓
    useGreatGospel Hook
         ↓
    revokeNode(nodeId, reason)
         ↓
    useCommStore Actions:
    - Close WebRTC connections
    - Stop media streams
    - Remove from operators Map
    - Delete conversations
    - Add to revokedNodes Set
         ↓
    UI Updates:
    - Operator list refresh
    - Call termination
    - Message panel clear
    - (Future: AethericSweep animation)
```

## Development Status

### ✅ Completed

1. **Core Services**
   - P2PMessagingClient with Merkle Vine integration
   - StreamAuthenticator for video frame validation
   - Both use BLAKE3 hashing and Ed25519 signatures

2. **UI Components**
   - MessagingPanel with hardware attestation filtering
   - MerkleChainIndicator for verification display
   - IntegrityOverlay React component
   - VideoCallPanel integration

3. **Great Gospel Integration**
   - Revocation event handling in useCommStore
   - useGreatGospel hook for ledger integration
   - Automatic session termination on revocation

### 🚧 Todo (Future Work)

1. **gRPC Integration**
   - Replace dev mode signature simulation with gRPC calls to `crates/crypto` EventSigningService
   - Replace signature verification with gRPC calls to `crates/identity` VerifySignature
   - Wire TPM-backed signing for production

2. **WebRTC Integration**
   - Wire StreamAuthenticator to actual video stream in VideoCallPanel
   - Implement frame extraction from MediaStream
   - Connect RTCDataChannel to authenticator

3. **AethericSweep Animation**
   - Wire revocation events to trigger AethericSweep visualization
   - Connect useGreatGospel to AethericSweep component
   - Implement node purge animations

4. **Testing**
   - Unit tests for P2PMessagingClient chain validation
   - Unit tests for StreamAuthenticator frame verification
   - Integration tests for revocation flow
   - End-to-end messaging tests
   - End-to-end video call tests with integrity violations

5. **Signal Protocol Integration**
   - As mentioned in the task, integrate Signal app patterns for E2E encryption
   - Implement Double Ratchet algorithm for forward secrecy
   - Add key management for encrypted sessions

## Production Deployment Checklist

- [ ] Replace dev mode signing with gRPC calls to `crates/crypto`
- [ ] Replace signature verification with gRPC calls to `crates/identity`
- [ ] Ensure TPM 2.0 / Secure Enclave is available on all nodes
- [ ] Configure Gospel ledger WebSocket endpoint
- [ ] Enable hardware attestation checks (no software fallback)
- [ ] Set up TLS 1.3 / WSS for all transports
- [ ] Configure NATS or MQTT for message transport
- [ ] Deploy with proper key rotation policies
- [ ] Enable audit logging for all revocation events
- [ ] Test in contested network environments
- [ ] Validate Byzantine fault detection
- [ ] Load test with 100+ operators
- [ ] Penetration testing for deepfake injection attempts

## Security Considerations

1. **No Mocks in Production**: All dev mode simulations (signing, verification) must be replaced with real TPM/Secure Enclave calls via gRPC.

2. **Fail-Visible Design**: All integrity violations must be immediately visible to operators. No silent failures.

3. **Merkle Vine Integrity**: Once a chain is established, any retroactive message injection will break the chain and be flagged as `SPOOFED`.

4. **Byzantine Detection**: Nodes with broken chains are adversaries, not degraded peers. They must be immediately quarantined.

5. **Revocation Finality**: Great Gospel revocations are absolute. All sessions with revoked nodes are instantly terminated.

6. **Store-and-Forward**: Messages are queued during network outages and transmitted when connectivity is restored. This ensures mission-critical communications in contested environments.

## References

- **Merkle Vine**: `crates/core/src/merkle_vine.rs`
- **CanonicalEvent**: `crates/domain/src/canonical_event.rs`
- **Identity Service**: `crates/identity/src/grpc_server.rs`
- **Signing Service**: `crates/crypto/src/signing.rs`
- **Stream Integrity**: `crates/stream/src/integrity.rs`
- **AethericSweep**: `packages/dashboard/src/components/animations/AethericSweep.tsx`

## Contact

For questions about this implementation, refer to:
- **Architecture**: `ARCHITECTURE.md`
- **Security Scope**: `SECURITY_SCOPE.md`
- **Contributing**: `CONTRIBUTING.md`
- **4MIK Invariants**: Custom instructions in `.github/agents/`

---

**Status**: Core implementation complete. Ready for gRPC integration and production deployment.
