# Mission Guardian Collaboration Service

**Secure Console-to-Console Video/Voice/Chat over AetherCore Trust Fabric**

## Overview

Mission Guardian replaces legacy instant messaging systems with a hardware-backed, trust-fabric-secured WebRTC collaboration layer. Unlike standard WebRTC applications, Mission Guardian does not trust the transport (internet); it trusts the **hardware** (CodeRalphie/TPM).

## Key Features

### 🔐 Hardware-Backed Security
- **Ed25519 Signatures**: All signaling messages signed with TPM-backed hardware keys
- **Identity Verification**: Signatures verified against `crates/identity` registry
- **No Passwords**: Authentication via NodeID (Public Key Hash)
- **Fail-Secure**: Invalid signatures → Packet dropped, security event logged

### 📹 Verified Tether (Stream Integrity)
- **Keyframe Hashing**: BLAKE3 hashes of video I-frames
- **Side-Channel Verification**: Hashes transmitted via secure WebRTC Data Channel
- **Fail-Visible**: Integrity violations → Prominent "INTEGRITY COMPROMISED" UI alert
- **Real-Time Monitoring**: Frame-by-frame integrity checking

### 🌐 Contested Mode
- **Network Health Monitoring**: Integration with `crates/unit-status`
- **Auto-Downgrade**: When health < 40%, automatically switch to audio-only
- **Bandwidth Preservation**: Prioritizes C2 data over video in degraded conditions
- **Automatic Recovery**: Restores video when network improves

### 🎨 TacticalGlass UI
- **NodeID Display**: No usernames, identity by Public Key Hash
- **Network Health Indicators**: Real-time latency, packet loss, bandwidth display
- **Connection Quality**: Per-participant quality metrics
- **Responsive Grid**: Adaptive layout for 1-N participants

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         Mission Guardian                                 │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  ┌──────────────┐         ┌──────────────┐         ┌──────────────┐    │
│  │   Console A  │         │  Signaling   │         │   Console B  │    │
│  │              │◄───────►│    Server    │◄───────►│              │    │
│  │  (Dashboard) │         │(Collaboration)│        │  (Dashboard) │    │
│  └──────┬───────┘         └──────┬───────┘         └──────┬───────┘    │
│         │                        │                         │            │
│         │  SignedEnvelope        │  Verify Signature       │            │
│         │  (Ed25519)             │  (crates/identity)      │            │
│         │                        │                         │            │
│         │◄───────────────────────┴────────────────────────►│            │
│         │           WebRTC PeerConnection                  │            │
│         │           + Data Channel (Hashes)                │            │
│         │                                                  │            │
│         └──────────────────────────────────────────────────┘            │
│                  Verified Tether (BLAKE3)                               │
└─────────────────────────────────────────────────────────────────────────┘
```

## Quick Start

### 1. Install Dependencies

```bash
cd /home/runner/work/AetherCore/AetherCore
pnpm install --frozen-lockfile
```

### 2. Build Packages

```bash
pnpm run build
```

### 3. Start Signaling Server

```bash
cd services/collaboration
node dist/index.js
# Listening on port 8080 by default
```

### 4. Use in Dashboard

```typescript
import { CallManager, StreamMonitor } from '@aethercore/dashboard';

// Initialize CallManager
const callManager = new CallManager({
  localNodeId: 'abc123...', // Your NodeID (Public Key Hash)
  signalingServerUrl: 'ws://localhost:8080',
  privateKey: '...', // TPM-backed key (in production)
  contestedThreshold: 40, // Network health threshold
}, {
  onStateChange: (state) => console.log('Call state:', state),
  onRemoteStream: (nodeId, stream) => {
    // Attach remote stream to video element
  },
});

// Connect and initiate call
await callManager.connect();
await callManager.initiateCall('def456...', { video: true, audio: true });

// Monitor network health
callManager.updateNetworkHealth({
  healthPercent: 75,
  latencyMs: 50,
  packetLossPercent: 0.5,
  bandwidthKbps: 5000,
  timestamp: Date.now(),
  isContested: false,
});
```

## Protocol

### SignedEnvelope

All signaling messages wrapped in cryptographic envelope:

```typescript
{
  payload: string;        // JSON serialized GuardianSignal
  signature: string;      // Ed25519 signature (128 hex chars)
  nodeId: NodeID;         // Public Key Hash (64 hex chars)
  timestamp: number;      // Unix timestamp (ms)
  nonce: string;          // Random nonce (32 hex chars)
}
```

### GuardianSignal

WebRTC signaling message types:

```typescript
{
  type: 'offer' | 'answer' | 'ice-candidate' | 'ice-complete' | 'hangup';
  from: NodeID;
  to: NodeID;
  sessionId: string;      // UUID
  sdp?: SDP;              // For offer/answer
  iceCandidate?: ICECandidate;  // For ice-candidate
  timestamp: number;
}
```

### StreamIntegrityHash

Side-channel integrity verification:

```typescript
{
  sessionId: string;
  nodeId: NodeID;
  frameSequence: number;
  hash: string;           // BLAKE3 hash (64 hex chars)
  timestamp: number;
  isKeyframe: boolean;
}
```

## Security Events

Logged when verification fails:

- `invalid_signature`: Ed25519 signature verification failed
- `unknown_node`: NodeID not enrolled in identity registry
- `replay_attack`: Timestamp outside 5-minute window
- `integrity_violation`: Video frame hash mismatch

## Components

### Backend (`services/collaboration`)

- **SignalingServer**: WebSocket server for WebRTC signaling (Production)
- **VerificationService**: Ed25519 signature verification via gRPC (Production)
- **IdentityRegistryClient**: gRPC client for `crates/identity` (Production)

**✅ Production Implementation Active:**
- ✅ MockIdentityRegistry removed - replaced with gRPC integration
- ✅ Hardware-backed Ed25519 verification via `crates/identity`
- ✅ TPM-backed signatures (CodeRalphie)
- ✅ Fail-visible security model enforced

### Frontend (`packages/dashboard`)

**Services:**
- **CallManager**: WebRTC PeerConnection lifecycle, hardware handshake
- **StreamMonitor**: Video integrity verification, keyframe hashing

**Components:**
- **VideoControls**: Call controls with network health display
- **ParticipantGrid**: Responsive participant video grid
- **IntegrityOverlay**: Security alert UI for integrity violations

### Shared (`packages/shared`)

- **Protocol Types**: Zod schemas for all Guardian messages
- **Type Safety**: Full TypeScript type definitions

## Development

### Run Tests

```bash
pnpm run test
```

### Lint Code

```bash
pnpm run lint
```

### Clean Build

```bash
pnpm run clean
pnpm run build
```

## Migration from Legacy

This service replaces:
- `AuthynticOne/packages/im` → `services/collaboration` + `packages/dashboard/services/guardian`
- `AuthynticOne/packages/streaming` → `packages/dashboard/services/guardian/StreamMonitor`
- `AuthynticOne/packages/ui-components/src/modules/im` → `packages/dashboard/components/guardian`

**Key Changes:**
- ❌ Username-based auth → ✅ NodeID (Public Key Hash)
- ❌ Password login → ✅ Hardware key signatures
- ❌ Trust transport → ✅ Trust hardware (TPM)
- ❌ No integrity checks → ✅ BLAKE3 keyframe verification

## Production Deployment

### ✅ Operation Ironclad - Phase 4 Complete

The collaboration service now uses **production gRPC integration**:

1. **✅ Mock Identity Registry Removed**
   - Replaced with `IdentityRegistryClient` (gRPC)
   - Connects to `crates/identity` service on port 50051

2. **✅ Hardware-Backed Signatures**
   - All signature verification via `crates/crypto` gRPC service
   - TPM-backed Ed25519 keys (CodeRalphie)
   - Private keys never enter Node.js memory

3. **✅ BLAKE3 Hashing**
   - All hashing delegated to Rust implementation
   - No SHA-256 in codebase

### Prerequisites

Start the required Rust gRPC servers:

```bash
# Terminal 1: Identity Registry (Port 50051)
cd crates/identity
cargo run --release --features grpc-server --bin identity-grpc-server

# Terminal 2: Signing Service (Port 50052)
cd crates/crypto
cargo run --release --features grpc-server --bin signing-grpc-server

# Terminal 3: Collaboration Service
cd services/collaboration
pnpm run build
pnpm start
```

### Configuration

```bash
# Default configuration
PORT=8080 IDENTITY_REGISTRY_ADDRESS=localhost:50051 npm start

# Production with TLS
PORT=8443 IDENTITY_REGISTRY_ADDRESS=identity-service.aethercore.local:50051 npm start
```

### Remaining Tasks

4. **Add TURN Servers**
   - Configure TURN servers for NAT traversal
   - Add to RTCConfiguration

5. **Implement Network Health**
   - Connect to `crates/unit-status` for real-time metrics
   - Update contested mode thresholds

## Documentation

See [TPM_INTEGRATION.md](./TPM_INTEGRATION.md) for detailed architecture and integration guide.

## License

MIT OR Apache-2.0
