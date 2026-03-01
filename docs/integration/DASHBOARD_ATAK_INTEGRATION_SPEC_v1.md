# Dashboard-ATAK Integration Specification v1.0

**Status**: Draft  
**Version**: 1.0.0  
**Last Updated**: 2026-03-01  
**Authors**: AetherCore Integration Team

---

## 1. Overview

This document defines the integration contract between Tactical Glass (AetherCore Dashboard) and ATAK-based RalphieNode deployments. The integration enables:

1. **Node Discovery & Enrollment**: Dashboard discovers and authenticates field nodes
2. **Trust Telemetry Streaming**: Real-time trust state and integrity updates
3. **Identity Management**: Track and verify node identities
4. **Optional Command Path**: Operator-initiated actions (Phase 2)

### 1.1 Design Principles

- **Fail-Visible**: All error states explicit, never silent
- **Deterministic**: Same inputs produce same outputs
- **Versioned**: All messages include schema version
- **Authenticated**: Mutual authentication required
- **Separated Concerns**: UI, transport, domain, crypto isolated

### 1.2 Transport

**Primary**: WebSocket for streaming + REST for queries  
**Alternative**: gRPC streaming (future consideration)

**Rationale**: WebSocket provides:
- Browser-native support
- Bidirectional streaming
- Simpler authentication integration
- Better DDIL reconnect behavior

---

## 2. Core Entities

### 2.1 NodeIdentity

Represents a field node's cryptographic identity.

```typescript
interface NodeIdentity {
  nodeId: string;              // Unique node identifier
  publicKeyFingerprint: string; // SHA256(pubkey) hex
  attestationStatus: AttestationStatus;
  enrollmentEpoch: number;      // Unix timestamp of enrollment
  lastSeen: number;             // Unix timestamp
}

enum AttestationStatus {
  NONE = "none",                // Software-only (dev mode)
  TPM = "tpm",                  // TPM 2.0 backed
  SECURE_ENCLAVE = "secure_enclave", // iOS/Android secure enclave
  UNKNOWN = "unknown"           // Status unknown
}
```

### 2.2 TrustState

Represents the current trust assessment for a node.

```typescript
interface TrustState {
  nodeId: string;
  computedScore: number;        // 0.0 - 1.0, RalphieNode-computed
  reportedScore?: number;       // 0.0 - 1.0, if node self-reports
  lastUpdated: number;          // Unix timestamp
  deltaReason?: TrustDeltaReason;
  signatureVerified: boolean;   // Last signature check result
}

enum TrustDeltaReason {
  SIGNATURE_VALID = "signature_valid",
  SIGNATURE_INVALID = "signature_invalid",
  IDENTITY_REGISTERED = "identity_registered",
  IDENTITY_MISMATCH = "identity_mismatch",
  TRUST_HIGH = "trust_high",
  TRUST_MEDIUM = "trust_medium",
  TRUST_LOW = "trust_low",
  TRUST_UNKNOWN = "trust_unknown"
}
```

### 2.3 StreamIntegrityState

Represents the integrity chain status.

```typescript
interface StreamIntegrityState {
  nodeId: string;
  lastEventHash: string;        // Hex-encoded BLAKE3 hash
  continuityStatus: ContinuityStatus;
  eventsProcessed: number;      // Monotonic counter
  lastVerified: number;         // Unix timestamp
}

enum ContinuityStatus {
  OK = "ok",                    // Chain intact
  UNKNOWN = "unknown",          // Not enough data
  BROKEN = "broken",            // Chain broken (Byzantine!)
  INITIALIZING = "initializing" // First events
}
```

### 2.4 NodeHealth

Represents operational health status.

```typescript
interface NodeHealth {
  nodeId: string;
  daemonUp: boolean;
  pluginUp: boolean;
  transportUp: boolean;
  lastHeartbeat: number;        // Unix timestamp
  batterLevel?: number;         // 0-100, optional
  thermalState?: ThermalState;  // Optional
}

enum ThermalState {
  NORMAL = "normal",
  ELEVATED = "elevated",
  CRITICAL = "critical"
}
```

---

## 3. Message Envelope

All messages follow a common envelope structure:

```typescript
interface MessageEnvelope<T> {
  version: string;              // "1.0.0"
  messageId: string;            // UUID
  messageType: MessageType;
  timestamp: number;            // Unix timestamp (bounded)
  payload: T;
  signature?: string;           // Hex-encoded signature (node messages only)
}

enum MessageType {
  // Discovery & enrollment
  ENROLLMENT_REQUEST = "enrollment_request",
  ENROLLMENT_RESPONSE = "enrollment_response",
  
  // Telemetry streaming
  TRUST_STATE_UPDATE = "trust_state_update",
  IDENTITY_STATUS_UPDATE = "identity_status_update",
  STREAM_INTEGRITY_UPDATE = "stream_integrity_update",
  NODE_HEALTH_UPDATE = "node_health_update",
  
  // Queries
  QUERY_NODE_STATUS = "query_node_status",
  QUERY_TRUST_HISTORY = "query_trust_history",
  
  // Commands (Phase 2)
  OPERATOR_COMMAND = "operator_command",
  COMMAND_RECEIPT = "command_receipt",
  
  // Control
  HEARTBEAT = "heartbeat",
  ERROR = "error"
}
```

---

## 4. Operations

### 4.1 Node Enrollment

**Flow**:
```
Node                              Dashboard
  |                                   |
  |----- ENROLLMENT_REQUEST --------->|
  |  (nodeId, pubKeyFingerprint,      |
  |   attestationStatus)              |
  |                                   |
  |                    [Validate]     |
  |                    [Check allowlist]
  |                                   |
  |<---- ENROLLMENT_RESPONSE ---------|
  |  (sessionToken, accepted)         |
  |                                   |
```

**Request Payload**:
```typescript
interface EnrollmentRequest {
  nodeId: string;
  publicKeyFingerprint: string;
  attestationStatus: AttestationStatus;
  daemonVersion: string;
  pluginVersion: string;
}
```

**Response Payload**:
```typescript
interface EnrollmentResponse {
  accepted: boolean;
  sessionToken?: string;        // If accepted
  reason?: string;              // If rejected
  refreshInterval: number;      // Heartbeat interval (ms)
}
```

### 4.2 Trust State Streaming

**Flow**:
```
Node                              Dashboard
  |                                   |
  |----- TRUST_STATE_UPDATE --------->|
  |  (signed, periodic or on-change)  |
  |                                   |
  |                    [Verify signature]
  |                    [Store time-series]
  |                    [Update UI]     |
  |                                   |
```

**Payload**:
```typescript
interface TrustStateUpdatePayload {
  trustState: TrustState;
  identityStatus: IdentityStatus; // REGISTERED | UNREGISTERED | INVALID
}

enum IdentityStatus {
  REGISTERED = "registered",
  UNREGISTERED = "unregistered",
  INVALID = "invalid",
  KEY_MISMATCH = "key_mismatch"
}
```

### 4.3 Heartbeat

**Flow**: Bidirectional, every N seconds (configurable)

**Payload**:
```typescript
interface HeartbeatPayload {
  nodeId: string;
  timestamp: number;
}
```

---

## 5. Failure Modes

### 5.1 Network Failures

| Failure | Detection | Recovery |
|---------|-----------|----------|
| No link | Connection timeout | Exponential backoff reconnect |
| Degraded link | Heartbeat loss | Mark DEGRADED, continue trying |
| Partial data | Message incomplete | Drop message, log, continue |

### 5.2 Security Failures

| Failure | Detection | Action |
|---------|-----------|--------|
| Invalid signature | Signature verification fails | Reject message, log security event |
| Unknown identity | nodeId not enrolled | Reject, require enrollment |
| Key mismatch | Different key for same nodeId | Reject, log Byzantine warning |
| Replay | Duplicate messageId or old timestamp | Reject, log |
| Stale clock | Timestamp outside bounds | Reject, log clock skew |

### 5.3 Schema Failures

| Failure | Detection | Action |
|---------|-----------|--------|
| Schema mismatch | Payload doesn't match schema | Reject, log version incompatibility |
| Version mismatch | Unsupported version | Reject or fallback if compatible |

---

## 6. Connection State Machine

```
DISCONNECTED
    |
    | connect()
    v
CONNECTING
    |
    | TCP established
    v
AUTHENTICATING
    |
    | enrollment accepted
    v
STREAMING
    |
    | heartbeat loss > threshold
    v
DEGRADED
    |
    | heartbeat restored
    v
STREAMING
    |
    | signature failure or critical error
    v
BLOCKED
```

**States**:
- **DISCONNECTED**: No connection
- **CONNECTING**: TCP handshake in progress
- **AUTHENTICATING**: Enrollment handshake
- **STREAMING**: Normal operation
- **DEGRADED**: Connected but unhealthy (missed heartbeats)
- **BLOCKED**: Security violation, manual intervention required

---

## 7. Security Model (Phase 1 - Basic)

### 7.1 Session-Based Authentication

**Initial Implementation**:
1. Node presents `publicKeyFingerprint` during enrollment
2. Dashboard validates against allowlist
3. Dashboard issues session token (JWT or similar)
4. Node includes session token in subsequent messages
5. Messages include signature over canonical payload

**Signature Scheme**:
- Algorithm: Ed25519
- Signed Data: `BLAKE3(canonical_json(payload))`
- Signature: Hex-encoded

### 7.2 Trust Roots

- Dashboard maintains allowlist of authorized `publicKeyFingerprint` values
- Enrollment requires match against allowlist OR operator approval
- No blind trust of any node

### 7.3 Replay Protection

- Messages include `messageId` (UUID) - tracked to prevent replay
- Messages include `timestamp` - bounded window (±5 minutes)
- Out-of-window messages rejected

---

## 8. Phase 2 Extensions (Future)

### 8.1 Mutual TLS

Replace session-based auth with mTLS:
- Node presents client certificate during TLS handshake
- Dashboard validates certificate against trust store
- Eliminates need for session tokens

### 8.2 Operator Commands

```typescript
interface OperatorCommand {
  actionType: ActionType;
  targetNodeId?: string;
  actionId: string;             // UUID
  issuedAt: number;
  expiresAt: number;
  policyId: string;
  payload: any;                 // Action-specific
  signature: string;            // Operator key signature
}

enum ActionType {
  FORCE_SWEEP = "force_sweep",
  REQUEST_REATTEST = "request_reattest",
  REQUEST_IDENTITY_SYNC = "request_identity_sync",
  QUARANTINE = "quarantine",
  UNQUARANTINE = "unquarantine"
}
```

### 8.3 Evidence Pull

- Dashboard can request last N trust deltas
- Dashboard can request integrity proof summary

---

## 9. Implementation Checklist

### Phase 1A: Foundation
- [ ] Define message schemas (TypeScript + Rust)
- [ ] Implement WebSocket server in dashboard
- [ ] Implement WebSocket client in ATAK daemon
- [ ] Implement enrollment handshake
- [ ] Implement connection state machine

### Phase 1B: Telemetry Flow
- [ ] ATAK daemon publishes trust state updates
- [ ] ATAK daemon publishes identity status updates
- [ ] Dashboard signature verification
- [ ] Dashboard storage layer
- [ ] Dashboard UI display

### Phase 1C: Resilience
- [ ] Heartbeat bidirectional
- [ ] Reconnect with exponential backoff
- [ ] Degraded state handling
- [ ] Message buffering during disconnect

### Phase 2: Commands & Testing
- [ ] Operator command envelope
- [ ] Command authorization
- [ ] Receipt generation
- [ ] Comprehensive test harness
- [ ] Security tests

---

## 10. Compatibility Notes

### 10.1 ATAK CoT Separation

- ATAK plugin handles CoT parsing and ATAK UI
- RalphieNode daemon handles identity/trust logic
- Dashboard consumes only standardized trust telemetry
- Raw CoT is NOT forwarded to dashboard (different channel if needed)

### 10.2 Version Compatibility

- Messages include `version` field
- Dashboard must support at least 2 versions simultaneously
- Deprecation policy: 6 months notice before dropping support

---

## 11. SLAs and Performance

### 11.1 Latency Targets

- Enrollment response: < 500ms
- Trust state update propagation: < 1s
- Heartbeat round-trip: < 200ms

### 11.2 Throughput

- Support 100 concurrent nodes per dashboard instance
- Trust state updates: Up to 10/sec per node
- Message rate limiting: 100 msg/sec per node (burst), 10 msg/sec sustained

### 11.3 Retention

- Trust score time-series: 7 days by default
- Trust delta events: 30 days by default
- Audit logs: 90 days by default

---

## 12. Deployment Profiles

### 12.1 Local Development

- No authentication (allowlist: `["*"]`)
- Dashboard: `ws://localhost:8080`
- Simulated nodes for testing

### 12.2 Field Test

- Session-based authentication
- Dashboard: `wss://tactical-glass.local:8443`
- Certificate pinning recommended

### 12.3 Production

- mTLS authentication (Phase 2)
- Dashboard: Load-balanced, highly available
- Full audit logging
- Monitoring and alerting

---

## Appendix A: Example Messages

### A.1 Enrollment Request

```json
{
  "version": "1.0.0",
  "messageId": "550e8400-e29b-41d4-a716-446655440000",
  "messageType": "enrollment_request",
  "timestamp": 1709251200000,
  "payload": {
    "nodeId": "alpha-01",
    "publicKeyFingerprint": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    "attestationStatus": "none",
    "daemonVersion": "0.2.0",
    "pluginVersion": "0.1.0"
  }
}
```

### A.2 Trust State Update

```json
{
  "version": "1.0.0",
  "messageId": "660e8400-e29b-41d4-a716-446655440001",
  "messageType": "trust_state_update",
  "timestamp": 1709251201000,
  "payload": {
    "trustState": {
      "nodeId": "alpha-01",
      "computedScore": 0.95,
      "reportedScore": null,
      "lastUpdated": 1709251201000,
      "deltaReason": "signature_valid",
      "signatureVerified": true
    },
    "identityStatus": "registered"
  },
  "signature": "3045022100...abc123"
}
```

---

**END OF SPECIFICATION v1.0**
