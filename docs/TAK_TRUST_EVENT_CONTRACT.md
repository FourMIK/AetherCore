# TAK Trust Event Contract Specification

**Version**: 1.0  
**Last Updated**: 2026-03-01  
**Status**: Canonical

---

## Purpose

This document defines the **canonical trust event contract** for cross-system integration between:
- AetherCore TAK Bridge (Rust)
- ATAK-Civ Trust Overlay Plugin (Kotlin/Java)
- Tactical Glass Dashboard (TypeScript/React)

All trust event flows **MUST** conform to this specification. Deviations result in explicit fail-visible rejection.

---

## 1. Canonical Upstream Format

The **source of truth** for trust events is the `tak-bridge.external.v1` JSON schema emitted by the Rust TAK bridge (`crates/tak-bridge/src/transport.rs`).

### 1.1 Schema Version

```
"tak-bridge.external.v1"
```

This version identifier MUST be present in all bridge-emitted events.

### 1.2 Event Kinds

Two event kinds are supported:

- `node_snapshot` - Node trust/integrity state
- `revocation` - Node revocation due to Byzantine detection or policy violation

### 1.3 Node Snapshot Payload Structure

```json
{
  "schema_version": "tak-bridge.external.v1",
  "event_kind": "node_snapshot",
  "envelope": {
    "key_id": "ops-key-1",
    "signature": "<hex-encoded-ed25519-signature>",
    "freshness": {
      "timestamp_ns": 1700000000123456789,
      "timestamp_ms": 1700000000123
    }
  },
  "payload": {
    "node_id": "node-alpha",
    "trust_score_0_100": 93,
    "trust_label": "trusted",           // "trusted", "degraded", "quarantined"
    "integrity_label": "integrity_ok",  // "integrity_ok", "integrity_degraded", "integrity_compromised", "integrity_unknown"
    "root_agreement_ratio": 0.875,
    "signature_failure_count": 1,
    "chain_break_count": 2,
    "telemetry_trust_score_0_1": 0.91,
    "last_seen_ns": 1700000000000000000,
    "lat": 35.0,
    "lon": -120.5,
    "alt_m": 10.0
  }
}
```

### 1.4 Revocation Payload Structure

```json
{
  "schema_version": "tak-bridge.external.v1",
  "event_kind": "revocation",
  "envelope": {
    "key_id": "issuer-1",
    "signature": "<hex-encoded-ed25519-signature>",
    "freshness": {
      "timestamp_ns": 1700000222000000000,
      "timestamp_ms": 1700000222000
    }
  },
  "payload": {
    "node_id": "node-alpha",
    "revocation_reason": "ByzantineDetection",
    "issuer_id": "issuer-1",
    "merkle_root": "001122aabbcc"
  }
}
```

---

## 2. ATAK CoT Adapter Mapping

The ATAK plugin consumes CoT XML with type `a-f-AETHERCORE-TRUST`. An **adapter service** MUST convert `tak-bridge.external.v1` JSON to CoT XML.

### 2.1 Required Mapping: JSON → CoT

| Bridge JSON Field | CoT XML Mapping | Notes |
|------------------|----------------|-------|
| `envelope.freshness.timestamp_ms` | `<event time="...">` | Convert ms to ISO 8601 UTC |
| `envelope.freshness.timestamp_ms` | `<event start="...">` | Same as `time` |
| `envelope.freshness.timestamp_ms + 300s` | `<event stale="...">` | Default 5-minute TTL |
| `payload.node_id` | `<event uid="...">` | Direct mapping |
| - | `<event type="a-f-AETHERCORE-TRUST">` | Fixed type |
| `payload.lat` | `<point lat="...">` | Direct if present, else `0.0` |
| `payload.lon` | `<point lon="...">` | Direct if present, else `0.0` |
| `payload.alt_m` | `<point hae="...">` | Direct if present, else `0.0` |
| `payload.trust_score_0_100` | `<trust trust_score="...">` | Normalize to 0.0-1.0: `score_0_100 / 100.0` |
| `envelope.freshness.timestamp_ms` | `<trust last_updated="...">` | ISO 8601 UTC |
| `payload.trust_label` | `<trust trust_level="...">` | Map: `trusted→healthy`, `degraded→suspect`, `quarantined→quarantined` |
| `envelope.key_id` | `<trust signer_node_id="...">` | Identity of signer |
| `envelope.signature` | `<trust signature_hex="...">` | Direct hex string |
| `payload.root_agreement_ratio` | `<trust integrity_packet_loss="...">` | `1.0 - root_agreement_ratio` (inverted semantic) |
| `payload.signature_failure_count` | `<trust integrity_signature_fail_count="...">` | Direct counter |
| `payload.chain_break_count` | `<trust integrity_chain_break_count="...">` | Direct counter |

### 2.2 Adapter Output Example

```xml
<event version="2.0"
       uid="node-alpha"
       type="a-f-AETHERCORE-TRUST"
       how="m-g"
       time="2023-11-14T07:46:40.123Z"
       start="2023-11-14T07:46:40.123Z"
       stale="2023-11-14T07:51:40.123Z">
  <point lat="35.0" lon="-120.5" hae="10.0" ce="20.0" le="20.0"/>
  <detail>
    <trust trust_score="0.93"
           last_updated="2023-11-14T07:46:40.123Z"
           trust_level="healthy"
           signer_node_id="ops-key-1"
           signature_hex="deadbeef..."
           integrity_packet_loss="0.125"
           integrity_signature_fail_count="1"
           integrity_chain_break_count="2"/>
  </detail>
</event>
```

---

## 3. Signature Verification Requirements

### 3.1 Verification Input

For node snapshot events, the canonical signing input is defined in `crates/tak-bridge/src/lib.rs::canonicalize_snapshot_input()`:

```
node_id=<node_id>;trust_score_0_100=<score>;trust_level=<level>;mesh_integrity=<integrity>;
root_agreement_ratio_bits=<f64_bits>;chain_break_count=<count>;signature_failure_count=<count>;
telemetry_trust_score_0_1_bits=<f32_bits|null>;telemetry_trust_score_0_100=<u8|null>;
lat_bits=<f64_bits|null>;lon_bits=<f64_bits|null>;alt_m_bits=<f32_bits|null>;
last_seen_ns=<ns>;timestamp_ns=<ns>;key_id=<key_id>
```

### 3.2 Algorithm

- **Signing**: Ed25519 with TPM-backed private key (CodeRalphie)
- **Encoding**: Hex-encoded signature string
- **Key Material**: Public keys resolved via `key_id` from identity registry

### 3.3 Verification Semantics

1. **Parse** `envelope.signature` as hex string
2. **Reconstruct** canonical input from `payload` + `envelope.freshness.timestamp_ns` + `envelope.key_id`
3. **Resolve** public key for `key_id` from identity registry (gRPC/FFI/local cache)
4. **Verify** signature using Ed25519
5. **Reject** entire event if verification fails → emit telemetry → render as `UNVERIFIED` in UI

### 3.4 Fail-Visible Behavior

- ❌ **Invalid signature** → Event rejected, logged, UI shows `UNVERIFIED` badge
- ❌ **Missing signature fields** → Event rejected
- ❌ **Unknown `key_id`** → Event rejected (cannot verify without key material)
- ❌ **Stale timestamp** (age > 300s) → Event rejected as stale
- ❌ **Replay detected** (duplicate payload hash within freshness window) → Event rejected

---

## 4. Tactical Glass Dashboard Integration

### 4.1 Transport Protocol

**Decision**: Move dashboard to **native WebSocket** protocol (not SignalR).

Rationale:
- Gateway currently implements plain `ws` WebSocketServer
- SignalR adds unnecessary complexity for trust event streaming
- Native WebSocket aligns with C2 Router gRPC-Web→WebSocket bridge pattern

### 4.2 Message Format

Dashboard receives the **same** `tak-bridge.external.v1` JSON format:

```typescript
interface TrustEventMessage {
  schema_version: "tak-bridge.external.v1";
  event_kind: "node_snapshot" | "revocation";
  envelope: {
    key_id: string;
    signature: string;
    freshness: {
      timestamp_ns: number;
      timestamp_ms: number;
    };
  };
  payload: NodeSnapshotPayload | RevocationPayload;
}
```

### 4.3 Verification on Dashboard

Dashboard MUST verify signatures before rendering trust state:

1. Receive JSON message over WebSocket
2. Extract `envelope.signature`, `envelope.key_id`, `payload`
3. Invoke Tauri command `verify_trust_event_signature(payload, signature, key_id)`
4. If verification fails → render node as `UNVERIFIED` (red marker, degraded state)
5. If verification succeeds → render trust score/level normally

### 4.4 Device Identity

Replace hardcoded `deviceId = 'ALPHA-TEST-DEVICE-001'` with Tauri command:

```typescript
const deviceId = await invoke<string>('get_hardware_identity');
```

Tauri command retrieves TPM-backed identity from `crates/identity`.

---

## 5. Publication Path Architecture

### 5.1 Flow Diagram

```
Trust Mesh (Rust)
    ↓
TAK Bridge (crates/tak-bridge)
    ↓ [JSON: tak-bridge.external.v1]
    ├─→ ATAK Adapter Service
    │       ↓ [CoT XML: a-f-AETHERCORE-TRUST]
    │   ATAK Plugin (TrustCoTSubscriber)
    │
    └─→ Gateway WebSocket Server
            ↓ [JSON: tak-bridge.external.v1]
        Dashboard WebSocket Client
```

### 5.2 Required Components

1. **ATAK Adapter Service** (NEW)
   - Consumes JSON from TAK bridge
   - Emits CoT XML to ATAK CoT transport
   - Deployed as sidecar or integrated into C2 Router

2. **Gateway Trust Event Stream** (ENHANCED)
   - Subscribe to TAK bridge events
   - Forward to connected dashboard clients
   - Handle signature metadata forwarding

3. **C2 Router Integration** (ENHANCED)
   - Expose trust event publication topic
   - Bridge mesh events to external transports

---

## 6. Validation & Testing

### 6.1 Unit Tests

- [ ] Adapter: JSON→CoT transformation correctness
- [ ] Adapter: Timestamp/staleness calculation
- [ ] Adapter: Field mapping completeness
- [ ] Signature verification: Valid signature acceptance
- [ ] Signature verification: Invalid signature rejection
- [ ] Signature verification: Stale event rejection
- [ ] Signature verification: Replay detection

### 6.2 Integration Tests

- [ ] End-to-end: Trust mesh → Bridge → Adapter → ATAK rendering
- [ ] End-to-end: Trust mesh → Bridge → Gateway → Dashboard rendering
- [ ] Cross-surface parity: Same upstream event → consistent ATAK + Dashboard state
- [ ] Fail-visible: Tampered signature → explicit rejection + telemetry
- [ ] Fail-visible: Stale event → rejection + UI degradation
- [ ] Fail-visible: Replay attack → rejection + alert

### 6.3 Acceptance Criteria

✅ Signed trust event from mesh appears in ATAK overlay with correct trust score/level  
✅ Same event appears in Tactical Glass with matching state  
✅ Invalid signature causes both surfaces to render `UNVERIFIED`  
✅ Stale events (age > 300s) are rejected and logged  
✅ Replay attempts are detected and blocked  
✅ Dashboard uses TPM-backed device identity, not hardcoded placeholder  

---

## 7. Security Guarantees

### 7.1 Cryptographic Anchoring

- All trust events MUST be signed with Ed25519 (TPM-backed)
- Signatures MUST be verified before rendering trust state
- Key material MUST be rooted in hardware identity (CodeRalphie)

### 7.2 Freshness & Replay Protection

- Events with `timestamp_ns` older than 300s MUST be rejected
- Duplicate payload hashes within freshness window MUST be rejected as replays

### 7.3 Fail-Visible Doctrine

- **No silent fallbacks** for signature verification failures
- **No graceful degradation** for security-critical paths
- All failures MUST be logged and visible to operators

### 7.4 Zero-Trust Defaults

- Unknown `key_id` → reject (cannot verify)
- Missing signature fields → reject
- Mesh integrity `UNKNOWN` → render as degraded, block operational use

---

## 8. Migration Path

### 8.1 Phase 0: Documentation (DONE)
- This contract specification

### 8.2 Phase 1: Adapter Implementation
1. Create `crates/atak-adapter` or `services/atak-adapter`
2. Implement JSON→CoT transformation
3. Add unit tests
4. Wire to TAK bridge output

### 8.3 Phase 2: Signature Verification
1. Complete JNI `nativeVerifySignature()` in `external/aethercore-jni`
2. Update `TrustEventParser.kt` to verify signatures
3. Add signature verification to dashboard via Tauri command
4. Add fail-visible telemetry

### 8.4 Phase 3: Protocol Alignment
1. Remove SignalR from dashboard
2. Implement native WebSocket client
3. Add hardware identity Tauri command
4. Test heartbeat authentication

### 8.5 Phase 4: Integration Validation
1. Create E2E test fixtures
2. Validate ATAK + Dashboard parity
3. Test attack scenarios (replay, tamper, stale)
4. Document operator validation workflow

---

## 9. References

- [ATAK CoT Schema](./atak-trust-cot-schema.md)
- TAK Bridge Implementation: `crates/tak-bridge/src/lib.rs`
- TAK Bridge Transport: `crates/tak-bridge/src/transport.rs`
- ATAK Parser: `plugins/atak-trust-overlay/src/main/kotlin/.../TrustEventParser.kt`
- Dashboard WebSocket: `packages/dashboard/src/services/api/WebSocketManager.ts`
- Gateway WebSocket: `services/gateway/src/index.ts`

---

**Status**: This contract is now the canonical specification for all ATAK-Civ ↔ Tactical Glass trust integration. All implementations MUST conform.
