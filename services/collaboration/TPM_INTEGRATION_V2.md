# Mission Guardian - Production TPM Integration (Phase 1-3 Complete)

## Overview

The Mission Guardian collaboration service has been upgraded from mock implementations to production-grade hardware-backed Trust Fabric. This document describes the **completed integration** with:

1. **Identity Registry** (crates/identity) - Hardware-rooted identity verification
2. **Signing Service** (crates/crypto) - TPM-backed Ed25519 signatures (CodeRalphie)
3. **BLAKE3 Integrity** - World's fastest verified hashing

## Architectural Principles

### 1. NO GRACEFUL DEGRADATION

If hardware attestation or identity verification fails, the system treats the node as **Byzantine** (compromised). There are no fallbacks, no workarounds—only fail-visible alerts to the Tactical Glass dashboard.

### 2. HARDWARE ROOT OF TRUST (CodeRalphie)

All cryptographic operations are rooted in hardware:
- **TPM 2.0 / Secure Enclave**: Private keys NEVER leave the secure element
- **Ed25519 Signatures**: < 1ms signing latency for high-velocity streams
- **BLAKE3 Hashing**: Fastest cryptographic hash function available

### 3. CONTESTED/CONGESTED ENVIRONMENT AWARENESS

The system is designed for degraded network conditions:
- **Automatic retries** with exponential backoff
- **Timeout windows** for gRPC calls (5s for identity, 2s for signing)
- **Performance monitoring** to detect latency spikes

## Phase 1: Identity Registry Integration ✅

### Architecture

```
┌─────────────────┐                    ┌──────────────────────┐
│  TypeScript     │                    │  Rust Identity       │
│  Services       │  ──── gRPC ────>   │  Registry Service    │
│  (Collaboration)│                    │  (crates/identity)   │
└─────────────────┘                    └──────────────────────┘
                                                 │
                                                 ▼
                                       ┌──────────────────────┐
                                       │  IdentityManager     │
                                       │  - Enrollment DB     │
                                       │  - Revocation List   │
                                       │  - Public Keys       │
                                       └──────────────────────┘
```

### Implementation

**Rust gRPC Server** (`crates/identity/src/grpc_server.rs`):
- `GetPublicKey(NodeID) -> PublicKey`: Retrieve Ed25519 public key
- `IsNodeEnrolled(NodeID) -> bool`: Check enrollment status
- `VerifySignature(...)`: Full signature verification with replay attack detection
- `RegisterNode(...)`: Enroll new node with TPM attestation
- `RevokeNode(...)`: Aetheric Sweep - revoke compromised nodes

**TypeScript gRPC Client** (`services/collaboration/src/IdentityRegistryClient.ts`):
- Automatic retries (3 attempts) with exponential backoff
- 5-second timeout per request
- Fail-visible error handling (throws on identity service failure)

**Proto Definition** (`crates/identity/proto/identity_registry.proto`):
```protobuf
service IdentityRegistry {
  rpc GetPublicKey(GetPublicKeyRequest) returns (GetPublicKeyResponse);
  rpc IsNodeEnrolled(IsNodeEnrolledRequest) returns (IsNodeEnrolledResponse);
  rpc VerifySignature(VerifySignatureRequest) returns (VerifySignatureResponse);
  rpc RegisterNode(RegisterNodeRequest) returns (RegisterNodeResponse);
  rpc RevokeNode(RevokeNodeRequest) returns (RevokeNodeResponse);
}
```

### Configuration

**Environment Variables**:
- `IDENTITY_REGISTRY_ADDRESS`: gRPC server address (default: `localhost:50051`)

**Rust Build**:
```bash
cargo build -p aethercore-identity --features grpc-server
```

**TypeScript Usage**:
```typescript
import { IdentityRegistryClient } from './IdentityRegistryClient';

const client = new IdentityRegistryClient({
  serverAddress: 'localhost:50051',
  timeout: 5000,
  maxRetries: 3,
});

// Check enrollment
const isEnrolled = await client.isNodeEnrolled(nodeId);

// Get public key
const publicKey = await client.getPublicKey(nodeId);
```

## Phase 2: TPM-Backed Signing (CodeRalphie) ✅

### Architecture

```
┌─────────────────┐                    ┌──────────────────────┐
│  TypeScript     │                    │  Rust Signing        │
│  Clients        │  ──── gRPC ────>   │  Service             │
│  (Dashboard)    │                    │  (crates/crypto)     │
└─────────────────┘                    └──────────────────────┘
                                                 │
                                                 ▼
                                       ┌──────────────────────┐
                                       │  TPM 2.0 / Secure    │
                                       │  Enclave             │
                                       │  (CodeRalphie)       │
                                       │  - Ed25519 Keys      │
                                       │  - Hardware Signing  │
                                       └──────────────────────┘
```

### Implementation

**Rust gRPC Server** (`crates/crypto/src/grpc_server.rs`):
- `SignMessage(message) -> Signature`: Sign raw message with TPM key
- `GetPublicKey(NodeID) -> PublicKey`: Get public key for node
- `CreateSignedEnvelope(payload) -> SignedEnvelope`: Convenience method
- `VerifySignature(...)`: Local signature verification

**TypeScript gRPC Client** (`services/collaboration/src/SigningServiceClient.ts`):
- Automatic retries (3 attempts) with exponential backoff
- 2-second timeout per request (< 1ms target + network overhead)
- Performance monitoring (warns if > 1ms signing latency)
- Fail-visible error handling

**Proto Definition** (`crates/crypto/proto/signing.proto`):
```protobuf
service SigningService {
  rpc SignMessage(SignMessageRequest) returns (SignMessageResponse);
  rpc GetPublicKey(GetPublicKeyRequest) returns (GetPublicKeyResponse);
  rpc CreateSignedEnvelope(CreateSignedEnvelopeRequest) returns (CreateSignedEnvelopeResponse);
  rpc VerifySignature(VerifySignatureRequest) returns (VerifySignatureResponse);
}
```

### Configuration

**Environment Variables**:
- `SIGNING_SERVICE_ADDRESS`: gRPC server address (default: `localhost:50052`)

**Rust Build**:
```bash
cargo build -p aethercore-crypto --features grpc-server
```

**TypeScript Usage**:
```typescript
import { SigningServiceClient } from './SigningServiceClient';

const client = new SigningServiceClient({
  serverAddress: 'localhost:50052',
  timeout: 2000,
  maxRetries: 3,
});

// Create signed envelope
const envelope = await client.createSignedEnvelope(payload, nodeId);

// Sign raw message
const { signatureHex, latencyUs } = await client.signMessage(message, nodeId);

// Performance monitoring
if (latencyUs > 1000) {
  console.warn('Signing latency exceeded 1ms target!');
}
```

### Performance Metrics

Target: **< 1ms median signing latency** on ARM64 edge hardware

The gRPC response includes `latency_us` field for monitoring:
```json
{
  "success": true,
  "signature_hex": "...",
  "latency_us": 850
}
```

## Phase 3: BLAKE3 Integrity ✅

### Architecture

BLAKE3 is used throughout the system for:
1. **Merkle Vines** (Event Chains) - `crates/crypto/src/chain.rs`
2. **Stream Integrity Monitoring** - `packages/dashboard/src/services/guardian/StreamMonitor.ts`
3. **Public Key Hashing** (NodeID derivation) - `crates/identity`

### Implementation

**Rust (Merkle Vines)**:
```rust
use blake3::Hasher;

pub fn compute_event_hash(event: &CanonicalEvent) -> Result<Blake3Hash, ChainError> {
    let serialized = serde_json::to_vec(event)?;
    let mut hasher = Hasher::new();
    hasher.update(&serialized);
    let hash = hasher.finalize();
    Ok(*hash.as_bytes())
}
```

**TypeScript (Stream Monitoring)**:
```typescript
import * as blake3 from 'blake3';

private async computeBlake3Hash(data: Uint8Array): Promise<string> {
  const hash = blake3.hash(data).toString('hex');
  return hash;
}
```

### Performance

BLAKE3 is **significantly faster** than SHA-256:
- **~3.5 GB/s** on modern CPUs (vs ~1 GB/s for SHA-256)
- **SIMD-accelerated** for parallel hashing
- **Cryptographically secure** with 256-bit security level

## Production Deployment

### Starting the Services

**1. Identity Registry Service**:
```bash
# Build with gRPC support
cargo build -p aethercore-identity --features grpc-server --release

# Start server (port 50051)
RUST_LOG=info ./target/release/aethercore-identity-server
```

**2. Signing Service**:
```bash
# Build with gRPC support
cargo build -p aethercore-crypto --features grpc-server --release

# Start server (port 50052)
RUST_LOG=info ./target/release/aethercore-crypto-server
```

**3. Collaboration Service** (Production Mode):
```bash
# Set environment variables
export USE_PRODUCTION=true
export IDENTITY_REGISTRY_ADDRESS=localhost:50051
export SIGNING_SERVICE_ADDRESS=localhost:50052
export PORT=8080

# Start service
npm run start
```

### Configuration Files

**`.env` for Production**:
```bash
USE_PRODUCTION=true
IDENTITY_REGISTRY_ADDRESS=localhost:50051
SIGNING_SERVICE_ADDRESS=localhost:50052
PORT=8080
```

**`.env` for Development** (Mock Mode):
```bash
USE_PRODUCTION=false
PORT=8080
```

## Security Model

### 1. Signature Verification Flow (Production)

```
┌─────────────────┐
│  Client A       │
│  (Console)      │
└────────┬────────┘
         │
         │ 1. Create payload
         │
         ▼
   ┌─────────────────────┐
   │  SigningService     │ ◄─── TPM 2.0 / Secure Enclave
   │  (crates/crypto)    │
   └─────────┬───────────┘
         │
         │ 2. Sign with hardware key
         │
         ▼
   ┌─────────────────────┐
   │  SignedEnvelope     │
   │  - payload          │
   │  - signature        │
   │  - nodeId           │
   │  - timestamp        │
   │  - nonce            │
   └─────────┬───────────┘
         │
         │ 3. Send to server
         │
         ▼
   ┌─────────────────────┐
   │  SignalingServerV2  │
   │  (Collaboration)    │
   └─────────┬───────────┘
         │
         │ 4. Verify signature
         │
         ▼
   ┌─────────────────────┐
   │  IdentityRegistry   │
   │  (crates/identity)  │
   └─────────┬───────────┘
         │
         │ 5a. Valid → Forward
         │ 5b. Invalid → Drop + Log
         │
         ▼
   ┌─────────────────────┐
   │  Client B           │
   │  (Console)          │
   └─────────────────────┘
```

### 2. Fail-Visible Design

**Invalid Signature**:
```
[SECURITY EVENT] [CRITICAL] 2026-01-02T19:30:00.000Z - invalid_signature
================================================================================
  NodeID: abc123...
  Description: Invalid Ed25519 signature on SignedEnvelope
  Metadata: { "envelope": {...}, "failureReason": "..." }
================================================================================
```

**Identity Service Failure**:
```
[SECURITY EVENT] [CRITICAL] 2026-01-02T19:30:00.000Z - unauthorized_access
================================================================================
  NodeID: abc123...
  Description: Unauthorized access attempt or identity service failure
  Metadata: { 
    "error": "Identity Registry unreachable",
    "context": "Treating as Byzantine"
  }
================================================================================
```

### 3. Replay Attack Prevention

Signatures include:
- **Timestamp**: Must be within 5-minute window
- **Nonce**: Random 16-byte hex string (prevents replay)

Both are verified by the Identity Registry service.

## Migration from Mock to Production

### Step 1: Update Service Initialization

**Before (Mock)**:
```typescript
import { startCollaborationService } from './index';
const server = startCollaborationService(8080);
```

**After (Production)**:
```typescript
import { startCollaborationServiceV2 } from './indexV2';
const server = startCollaborationServiceV2(8080, 'localhost:50051');
```

### Step 2: Start Rust Services

```bash
# Terminal 1: Identity Registry
cargo run -p aethercore-identity --features grpc-server

# Terminal 2: Signing Service
cargo run -p aethercore-crypto --features grpc-server

# Terminal 3: Collaboration Service
USE_PRODUCTION=true npm start
```

### Step 3: Verify Production Mode

Check the logs for:
```
[CollaborationService] PRODUCTION MODE - Hardware-backed signatures enabled
[IdentityRegistryClient] Connected to localhost:50051
[SigningServiceClient] Connected to localhost:50052
```

## Next Steps

### Phase 4: Network Health Integration (Contested Mode)
- [ ] WebSocket client for `crates/unit-status`
- [ ] Automated Aetheric Sweep on Byzantine detection
- [ ] Bandwidth preservation (audio-only mode when health < 40%)

### Phase 5: Sovereign Infrastructure Hardening
- [ ] TLS 1.3 / WSS for all communications
- [ ] NIST 800-171 compliance
- [ ] Comprehensive integration tests

## References

- **Ed25519**: [RFC 8032](https://www.rfc-editor.org/rfc/rfc8032)
- **BLAKE3**: [BLAKE3 Spec](https://github.com/BLAKE3-team/BLAKE3-specs)
- **gRPC**: [gRPC Documentation](https://grpc.io/docs/)
- **TPM 2.0**: [TCG TPM 2.0 Library](https://trustedcomputinggroup.org/resource/tpm-library-specification/)
- **Tonic (Rust gRPC)**: [Tonic Documentation](https://github.com/hyperium/tonic)

---

**Sentinel's Note**: "The TPM speaks truth. Mock implementations are lies we tell ourselves during development. In production, only hardware-backed cryptography survives Byzantine conditions."
