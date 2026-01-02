# AetherCore Trust Mesh Design

## Architectural Blueprint for Sovereign Revocation

### Executive Summary

The AetherCore Trust Mesh implements a hardware-rooted, Byzantine-resistant sovereign identity fabric designed for contested electromagnetic environments. This document defines the architectural invariants, protocols, and operational procedures for transitioning from a "Best-Effort" network to a **Hardened Sovereign Fabric**.

---

## 1. Foundational Security Invariants

### 1.1 Hardware-Rooted Trust (CodeRalphie)

All nodes entering the AetherCore mesh must prove their identity via TPM 2.0 / Secure Enclave attestation:

- **No software-only identities**: Every platform must present a hardware-backed Ed25519 public key derived from the TPM's Endorsement Key hierarchy.
- **Attestation Chain**: Node enrollment requires a signed Quote from the TPM + a Genesis Bundle containing the Federation Root Certificate.
- **Private Key Isolation**: Private keys NEVER reside in system RAM; all signing operations occur within the TPM secure boundary.

**Sentinel Rule**: If a node cannot produce a valid TPM attestation within 30 seconds of connection, it is marked `STATUS_UNVERIFIED` and purged from the mesh.

### 1.2 Cryptographic Primitives

- **Hashing**: BLAKE3 exclusively. All SHA-256 implementations are deprecated and prohibited.
- **Signing**: Ed25519 via TPM-backed keys (CodeRalphie).
- **Merkle Vines**: Every telemetry event MUST contain a `parent_hash` field referencing its immediate ancestor. Data streams form cryptographic chains.

### 1.3 Fail-Visible Design

Network anomalies are **never silently tolerated**:

- Attestation failures → `STATUS_SPOOFED`
- Stale telemetry (> 30s) → `STATUS_DEGRADED`
- Merkle ancestry breaks → `STATUS_UNVERIFIED`
- Byzantine root drift → Node flagged for Aetheric Sweep

All integrity violations must be projected to the **Tactical Glass** dashboard with sub-second latency.

---

## 2. The Great Gospel: Sovereign Revocation Ledger

### 2.1 Purpose

The Great Gospel is the system-wide **revocation ledger**. It is the single source of truth for which nodes have been expelled from the mesh due to Byzantine behavior, attestation failure, or operator intervention.

### 2.2 Structure

```rust
pub struct RevocationCertificate {
    pub node_id: String,
    pub revocation_reason: RevocationReason,
    pub issuer_id: String,
    pub timestamp_ns: u64,
    pub signature: [u8; 64], // Ed25519 signature from Federation Authority
    pub merkle_root: [u8; 32], // BLAKE3 root of ledger state
}

pub enum RevocationReason {
    AttestationFailure,
    ByzantineDetection,
    OperatorOverride,
    IdentityCollapse, // Duplicate NodeIDs or clock-drift anomalies
}
```

### 2.3 Distribution Protocol

Revocation certificates propagate via the **Aetheric Sweep** protocol:

1. Federation Authority issues a `RevocationCertificate`
2. Certificate is broadcast to all mesh nodes via WebSocket multicast
3. Each node updates its local Gospel replica and re-validates peer connections
4. Revoked nodes are disconnected immediately (no grace period)

**Contested Mode Assumption**: The Aetheric Sweep must tolerate 80% packet loss and active jamming. Certificates are retransmitted with exponential backoff until ACK is received from a quorum of nodes.

---

## 3. Byzantine Detection: Identity Collapse Signatures

### 3.1 Monitored Anomalies

The AetherCore Network Sentinel continuously monitors for:

- **Duplicated NodeIDs**: Two nodes presenting identical platform identities
- **Clock-Drift Anomalies**: Telemetry timestamps diverging > 5 seconds from NTP consensus
- **Non-Sequential Merkle Indices**: Gaps or rewinds in the Merkle Vine sequence
- **Root Disagreement**: Node's Merkle root deviates from peer majority (> 20% drift)

### 3.2 Challenge-Response Attestation

When anomalies are detected, the Sentinel issues a **Challenge**:

```rust
pub struct AttestationChallenge {
    pub challenge_nonce: [u8; 32],
    pub requested_quote_pcrs: Vec<u8>, // TPM PCR indices to include
    pub deadline_ns: u64, // Response must arrive before this timestamp
}
```

The challenged node must respond with a fresh TPM Quote signed over the nonce. Failure to respond or invalid quote → immediate revocation.

---

## 4. The Aetheric Sweep: Node Purge Protocol

### 4.1 Trigger Conditions

An Aetheric Sweep is initiated when:

- Attestation challenge fails
- Byzantine behavior persists across 3 consecutive telemetry windows
- Operator manually flags a node for purge

### 4.2 Execution Flow

```
1. Sentinel → Generates RevocationCertificate
2. Sentinel → Broadcasts certificate to mesh (WebSocket multicast)
3. All nodes → Update local Gospel replica
4. All nodes → Drop TCP/WebSocket connections to revoked node
5. Revoked node → Isolated from mesh (quarantine state)
6. Tactical Glass → Displays purge animation with node ID and reason
```

### 4.3 Visual Representation

The **Tactical Glass** dashboard renders an **Aetheric Sweep animation**:

- Revoked node icon pulses red
- Expanding concentric circles indicate propagation of revocation
- Neighboring nodes briefly highlight as they process the certificate
- Final state: Revoked node grayed out and marked `PURGED`

---

## 5. Network Health Metrics

### 5.1 Node Health Status

```rust
pub enum NodeHealthStatus {
    HEALTHY,      // Root agreement > 95%, no anomalies
    DEGRADED,     // Root agreement 80-95%, minor drift
    COMPROMISED,  // Root agreement < 80%, chain breaks detected
    UNKNOWN,      // No metrics available (zero-trust default)
}
```

### 5.2 Real-Time WebSocket Telemetry

`crates/unit-status` exposes a WebSocket endpoint for Tactical Glass:

```
ws://sentinel.aethercore.local/mesh/health
```

**Message Format**:
```json
{
  "node_id": "unit-alpha-7",
  "status": "HEALTHY",
  "trust_score": 0.98,
  "last_seen_ns": 1704153600000000000,
  "metrics": {
    "root_agreement_ratio": 0.99,
    "chain_break_count": 0,
    "signature_failure_count": 0
  }
}
```

**Update Frequency**: 1 Hz (every second) under normal conditions; 10 Hz during Aetheric Sweep.

---

## 6. Zero-Trust Transport Layer

### 6.1 TLS 1.3 / WSS Mandatory

All inter-node communication and dashboard-to-service pathways MUST use:

- **TLS 1.3** for gRPC calls (identity ↔ crypto, mesh ↔ unit-status)
- **WSS (WebSocket Secure)** for real-time telemetry feeds

**Cipher Suites**: Only AEAD modes (ChaCha20-Poly1305, AES-256-GCM) are permitted. Weak ciphers are rejected at the handshake layer.

### 6.2 Certificate Pinning

Dashboard clients pin the Federation Root Certificate at compile-time. Any TLS handshake presenting a non-pinned cert is aborted.

---

## 7. NIST 800-171 Compliance

### 7.1 Non-Repudiation

Every actuation command (e.g., Node Purge, Configuration Change) is:

- Signed by the operator's hardware token
- Logged with timestamp, operator ID, and action details
- Immutably stored in the audit trail (write-once log)

### 7.2 Audit Trail Format

```rust
pub struct AuditEvent {
    pub event_id: String,        // UUID v4
    pub timestamp_ns: u64,       // Monotonic clock
    pub operator_id: String,     // Authenticated user
    pub action: AuditAction,     // Enum: NodePurge, ConfigUpdate, etc.
    pub target: String,          // Affected entity (node ID, config key)
    pub signature: [u8; 64],     // Ed25519 operator signature
    pub merkle_proof: Vec<[u8; 32]>, // Proof of inclusion in audit Merkle tree
}
```

### 7.3 Tamper Detection

The audit trail is a Merkle Tree. The root hash is periodically published to the Federation's timestamping authority. Any modification to historical events invalidates the cryptographic chain.

---

## 8. Production Deployment Playbook

### 8.1 Pre-Deployment Checklist

- [ ] All nodes have TPM 2.0 firmware ≥ version 1.38
- [ ] Genesis Bundle distributed to all platforms (OOB or via secure USB)
- [ ] Federation Root Certificate installed in dashboard trust store
- [ ] NTP servers configured for clock synchronization (≤ 1s drift)
- [ ] Firewall rules permit WSS on port 443, gRPC on port 50051

### 8.2 Performance Benchmarks

Run `aethercore-bench` on each platform:

```bash
$ cargo run --bin aethercore-bench --release
```

**Expected Results**:
- BLAKE3 hash rate: > 2 GB/s
- Ed25519 sign (TPM): < 50ms per operation
- Ed25519 verify: < 1ms per operation
- Merkle Vine append: < 10µs per event

### 8.3 Attestation Checkout

Before joining the mesh, each node runs:

```bash
$ cargo run --bin tpm-attestation-test
```

This utility:
1. Generates a TPM Quote over PCRs [0, 1, 2, 7]
2. Signs the Quote with the platform's Ed25519 AIK
3. Verifies the signature locally
4. Outputs the public key in PEM format for enrollment

**Pass Criteria**: Signature verification succeeds + PCR values match expected baseline.

---

## 9. Operational Procedures

### 9.1 Node Enrollment

1. Operator generates Genesis Bundle (contains Federation Root Cert + initial Merkle root)
2. Node boots and loads Genesis Bundle from secure storage
3. Node generates TPM Quote and requests enrollment via gRPC
4. Federation Authority validates Quote, issues `PlatformIdentity`, signs with Root Key
5. Node stores `PlatformIdentity` in TPM NVRAM and joins mesh

### 9.2 Emergency Purge

If the operator suspects a node is compromised:

1. Issue `aether-ctl purge <node-id> --reason="OperatorOverride"`
2. Sentinel generates `RevocationCertificate` with operator's signature
3. Aetheric Sweep propagates certificate
4. Node is quarantined and marked for physical inspection

### 9.3 Mesh Recovery

After connectivity is restored following jamming:

1. Nodes re-synchronize Gospel ledger via gossip protocol
2. Stale nodes re-attest to prove they haven't been tampered with
3. Tactical Glass displays "Mesh Resync" progress bar
4. Once quorum reaches 75%, mesh transitions to `HEALTHY` state

---

## 10. Contested Environment Assumptions

The AetherCore mesh is designed to operate in:

- **80% packet loss**: Protocols use aggressive retransmission + Reed-Solomon FEC
- **Active jamming**: Frequency-hopping spread spectrum (if RF layer supports)
- **GPS denial**: Nodes use crystal oscillator drift compensation for time sync
- **Physical tampering**: TPM measures boot sequence; altered PCRs trigger lockout

**Design Philosophy**: If you can't prove your identity, you don't exist on the mesh.

---

## 11. Future Work

- **Quantum-Resistant Signatures**: Transition to ML-KEM + SLH-DSA post-quantum algorithms
- **Zero-Knowledge Proofs**: Prove node compliance without revealing telemetry details
- **Mesh Partitioning**: Support for isolated sub-meshes during extended comms blackout

---

## Sentinel's Note

> *"In the AetherCore, we don't 'hope' the network is healthy. We mathematically prove it, or we burn the compromised links."*

The Trust Mesh is not a suggestion—it is the operational reality. Every line of code, every protocol message, every UI element must reinforce the invariant: **Zero-Trust, Hardware-Rooted, Fail-Visible**.

End of Document.
