# Mission Guardian - TPM Signature Verification Integration

## Overview

The Mission Guardian collaboration service implements a **hardware-backed Trust Fabric** for secure Console-to-Console video/voice/chat communications. Unlike standard WebRTC implementations, Mission Guardian does not trust the transport layer (internet); instead, it trusts the **hardware** (CodeRalphie/TPM).

## Architecture

### Trust Protocol - The "Handshake"

All WebRTC signaling messages (SDP offers/answers, ICE candidates) are wrapped in a `SignedEnvelope` that contains:

1. **Payload**: The actual signaling message (serialized JSON)
2. **Signature**: Ed25519 signature of the payload
3. **NodeID**: Public Key Hash of the signing device
4. **Timestamp**: Unix timestamp (prevents replay attacks)
5. **Nonce**: Random nonce (prevents replay attacks)

```typescript
interface SignedEnvelope {
  payload: string;           // JSON serialized GuardianSignal
  signature: string;         // Ed25519 signature (hex)
  nodeId: NodeID;            // Public Key Hash
  timestamp: number;         // Unix timestamp (ms)
  nonce: string;             // Random hex nonce
}
```

### Signature Verification Flow

```
┌─────────────────┐                    ┌──────────────────────┐                    ┌─────────────────┐
│  Client A       │                    │  Signaling Server    │                    │  Client B       │
│  (Console)      │                    │  (Collaboration)     │                    │  (Console)      │
└────────┬────────┘                    └──────────┬───────────┘                    └────────┬────────┘
         │                                        │                                         │
         │  1. Create WebRTC Offer (SDP)         │                                         │
         │────────────────────────────────────────│                                         │
         │                                        │                                         │
         │  2. Sign with TPM Hardware Key         │                                         │
         │     (Ed25519 signature)                │                                         │
         │────────────────────────────────────────│                                         │
         │                                        │                                         │
         │  3. Send SignedSignal                  │                                         │
         │───────────────────────────────────────>│                                         │
         │                                        │                                         │
         │                                        │  4. Verify Signature                    │
         │                                        │     - Check NodeID in identity registry │
         │                                        │     - Validate Ed25519 signature        │
         │                                        │     - Check timestamp (replay attack)   │
         │                                        │────────────────────────────────────────│
         │                                        │                                         │
         │                                        │  5. Forward if Valid                    │
         │                                        │────────────────────────────────────────>│
         │                                        │                                         │
         │                                        │  OR                                     │
         │                                        │                                         │
         │                                        │  5. Drop & Log Security Event           │
         │                                        │     (if signature invalid)              │
         │                                        │────────────────────────────────────────│
```

## TPM Integration Points

### 1. Identity Registry (`crates/identity`)

The identity registry is the source of truth for device enrollment and public keys:

- **Location**: `crates/identity/src/`
- **Functions**:
  - `getPublicKey(nodeId: NodeID)`: Retrieves Ed25519 public key for a NodeID
  - `isNodeEnrolled(nodeId: NodeID)`: Checks if device is enrolled in Trust Fabric

**Production Implementation** (Future):
```rust
// crates/identity/src/registry.rs
pub fn get_public_key(node_id: &NodeId) -> Result<PublicKey, Error> {
    // Query TPM-backed key storage
    // Return Ed25519 public key
}
```

**Current Implementation**:
```typescript
// services/collaboration/src/VerificationService.ts
class MockIdentityRegistry implements IdentityRegistry {
  async getPublicKey(nodeId: NodeID): Promise<string | null> {
    // Mock implementation - returns test keys
    // In production: gRPC call to crates/identity
  }
}
```

### 2. Cryptographic Signing (`crates/crypto`)

Signature creation happens on the client side using TPM-backed hardware keys:

- **Location**: `crates/crypto/src/` (Future)
- **Function**: Sign messages with Ed25519 private key stored in TPM

**Production Implementation** (Future):
```rust
// crates/crypto/src/tpm.rs
pub fn sign_message(message: &[u8], node_id: &NodeId) -> Result<Signature, Error> {
    // Access TPM
    // Retrieve hardware-backed Ed25519 private key
    // Sign message
    // Return signature
}
```

**Current Implementation**:
```typescript
// packages/dashboard/src/services/guardian/CallManager.ts
static async createSignedEnvelope(payload: any, nodeId: NodeID, privateKey: string) {
  // Mock implementation - uses crypto.randomBytes
  // In production: FFI call to crates/crypto/tpm.sign_message
}
```

### 3. Signature Verification

Server-side verification uses Ed25519 public keys from identity registry:

**Current Implementation**:
```typescript
// services/collaboration/src/VerificationService.ts
class VerificationService {
  async verifyEnvelope(envelope: SignedEnvelope): Promise<any | null> {
    // 1. Check if node is enrolled
    const isEnrolled = await this.identityRegistry.isNodeEnrolled(nodeId);
    
    // 2. Get public key from registry
    const publicKey = await this.identityRegistry.getPublicKey(nodeId);
    
    // 3. Verify Ed25519 signature
    const isValid = this.verifyEd25519Signature(payload, signature, publicKey);
    
    // 4. If invalid -> Drop packet & log security event
    if (!isValid) {
      this.logSecurityEvent('invalid_signature', nodeId, 'critical', { envelope });
      return null;
    }
    
    return JSON.parse(payload);
  }
}
```

## Security Events

When signature verification fails, a security event is logged:

```typescript
interface SecurityEvent {
  type: 'invalid_signature' | 'unknown_node' | 'replay_attack' | 'integrity_violation';
  nodeId: NodeID | null;
  description: string;
  severity: 'critical' | 'high' | 'medium' | 'low';
  timestamp: number;
  metadata?: Record<string, unknown>;
}
```

**Security Event Types**:
- `invalid_signature`: Ed25519 signature verification failed
- `unknown_node`: NodeID not found in identity registry
- `replay_attack`: Timestamp outside acceptable window (5 minutes)
- `integrity_violation`: Video stream hash mismatch

## Hardware Handshake

Before establishing a WebRTC PeerConnection, clients perform a challenge/response handshake:

```typescript
// 1. Client A generates challenge
const challenge: HandshakeChallenge = {
  challenge: randomBytes(32).toString('hex'),
  issuerId: localNodeId,
  timestamp: Date.now(),
  expiryMs: 30000,
};

// 2. Client B signs challenge with TPM key
const response: HandshakeResponse = {
  challenge: challenge.challenge,
  signature: await tpm.sign(challenge.challenge),
  responderId: remoteNodeId,
  timestamp: Date.now(),
};

// 3. Client A verifies signature
const publicKey = await identityRegistry.getPublicKey(remoteNodeId);
const isValid = crypto.verify(response.signature, response.challenge, publicKey);

// 4. Only proceed if valid
if (isValid) {
  // Establish PeerConnection
}
```

## Verified Tether - Stream Integrity Monitoring

In addition to signaling verification, video streams are monitored for integrity:

### Sender Side
1. Extract keyframes (I-frames) from video stream
2. Compute BLAKE3 hash of each keyframe
3. Send hash via secure Data Channel (WebRTC)

### Receiver Side
1. Compute BLAKE3 hash of received keyframe
2. Compare with hash received via Data Channel
3. If mismatch → Display "INTEGRITY COMPROMISED" overlay

```typescript
// packages/dashboard/src/services/guardian/StreamMonitor.ts
class StreamMonitor {
  async processIncomingFrame(frame: FrameData) {
    const computedHash = await this.computeBlake3Hash(frame.data);
    const expectedHash = this.pendingHashes.get(frame.sequence);
    
    if (computedHash !== expectedHash) {
      // INTEGRITY VIOLATION
      this.status.isValid = false;
      this.status.showAlert = true;
      this.onIntegrityViolation();
    }
  }
}
```

## Contested Mode - Network Health Auto-Downgrade

When network health drops below 40%, the system automatically downgrades to audio-only:

```typescript
// packages/dashboard/src/services/guardian/CallManager.ts
updateNetworkHealth(health: NetworkHealth) {
  if (health.healthPercent < 40 && !this.isContested) {
    // Disable video tracks to preserve bandwidth for C2 data
    this.localStream.getVideoTracks().forEach(track => {
      track.enabled = false;
    });
    this.setState('contested');
  }
}
```

## Migration Path: From Mock to Production

### Phase 1: Current (Mock)
- ✅ SignedEnvelope protocol defined
- ✅ Verification service structure in place
- ✅ Mock identity registry
- ✅ Mock signature generation

### Phase 2: Integration with Rust Crates
1. Implement gRPC/FFI bridge from TypeScript to Rust
2. Connect `VerificationService` to `crates/identity` via gRPC
3. Connect `CallManager` to `crates/crypto` for TPM signing

### Phase 3: Full Hardware Integration
1. Replace mock signatures with real TPM-backed Ed25519 signatures
2. Implement real BLAKE3 hashing (via `crates/crypto`)
3. Connect to real network health from `crates/unit-status`

## Files Created

### Backend (Signaling Server)
- `services/collaboration/package.json`
- `services/collaboration/src/index.ts`
- `services/collaboration/src/SignalingServer.ts`
- `services/collaboration/src/VerificationService.ts`

### Shared (Protocol)
- `packages/shared/src/types/guardian.ts`

### Frontend (Dashboard)
- `packages/dashboard/src/services/guardian/CallManager.ts`
- `packages/dashboard/src/services/guardian/StreamMonitor.ts`
- `packages/dashboard/src/components/guardian/VideoControls.ts`
- `packages/dashboard/src/components/guardian/ParticipantGrid.ts`
- `packages/dashboard/src/components/guardian/IntegrityOverlay.ts`

## Key Design Decisions

1. **No Usernames**: Identity by NodeID (Public Key Hash) only
2. **Fail-Secure**: Invalid signatures → Drop packet (not forward)
3. **Fail-Visible**: Integrity violations → Prominent UI alert
4. **Bandwidth Preservation**: Contested mode prioritizes C2 data over video
5. **Hardware Root of Trust**: All security anchored in TPM, not passwords/certificates

## References

- Ed25519: [RFC 8032](https://www.rfc-editor.org/rfc/rfc8032)
- BLAKE3: [BLAKE3 Spec](https://github.com/BLAKE3-team/BLAKE3-specs)
- WebRTC: [W3C WebRTC](https://www.w3.org/TR/webrtc/)
- TPM 2.0: [TCG TPM 2.0 Library](https://trustedcomputinggroup.org/resource/tpm-library-specification/)
