# Tactical Mesh Layer - Architectural Overview

## Executive Summary

The Tactical Mesh Layer provides Hardware-Rooted Truth mechanisms for contested, multi-domain environments (Land, Sea, Air). This system enables CodeRalphie nodes to form a self-healing, peer-to-peer network that functions in the absence of cloud connectivity and under active electronic warfare (EW) attacks.

## System Architecture

### Stack Overview

```
┌──────────────────────────────────────────────────────────┐
│              Application Layer (C2/ISR)                   │
├──────────────────────────────────────────────────────────┤
│            Tactical Mesh Coordinator                      │
│  ┌─────────────┬───────────────┬────────────────────┐   │
│  │   Gossip    │   Routing     │  Frequency Hopping │   │
│  │  Protocol   │   (Weaver)    │  (Spectral Agility)│   │
│  └─────────────┴───────────────┴────────────────────┘   │
├──────────────────────────────────────────────────────────┤
│              Peer Discovery & Trust Scoring              │
├──────────────────────────────────────────────────────────┤
│            Offline-First Persistence (Bunker)            │
├──────────────────────────────────────────────────────────┤
│              Radio/RF Communication Layer                │
└──────────────────────────────────────────────────────────┘
```

### Component Details

#### 1. Peer Discovery & Topology (The Swarm Senses)

**Purpose**: Decentralized node discovery without reliance on master nodes.

**Mechanisms**:
- **mDNS (Multicast DNS)**: For local LAN discovery
- **Seed Peer List**: For WAN bootstrapping
- **Trust Scoring**: Dynamic trust evaluation (0.0 - 1.0)

**Data Structure**: `PeerTable`
```rust
struct PeerInfo {
    node_id: String,
    trust_score: f64,        // Hardware attestation + behavior
    latency_ms: u64,
    last_seen: u64,
    address: String,
    public_key: Vec<u8>,
    attestation_verified: bool,
}
```

**Key Features**:
- Zero master node dependency
- Automatic peer eviction based on trust scores
- Bunker mode detection (peer_count == 0)

#### 2. The Aetheric Whisper (Gossip Protocol)

**Purpose**: State propagation across the swarm without central coordination.

**Protocol**:
- Lightweight gossip inspired by libp2p gossipsub
- Propagates Merkle Roots of global ledger
- Automatic fork detection and resolution

**Message Flow**:
```
Node A: New Block (Height 100, Root: 0xABC...)
  ↓ Gossip
Node B: Receives, validates, forwards
  ↓ Gossip
Node C: Conflict detected! Different root at same height
  → Triggers "Branch Sync" based on longest Hardware-Rooted chain
```

**Consensus Mechanism**:
- If conflicting Merkle Root at same height → Fork detected
- Resolution: Longest verifiable Hardware-Rooted chain wins
- Peers ahead trigger sync requests

#### 3. Weaver Ant Routing (Link Resilience)

**Purpose**: Multi-hop capability with automatic rerouting.

**Routing Metrics** (Cost Calculation):
```
Cost = f(SNR, Trust, Latency, PER)
  SNR_factor    = 1 / (1 + SNR_dB)
  Trust_factor  = 1 / (0.1 + trust_score)
  Latency_factor = latency_ms / 100
  PER_factor    = 1 + (packet_error_rate × 10)
```

**Scenario Example**:
```
Node A ←→ Node B ←→ Node C

If Link(A,C) fails due to jamming:
- Node B bridges as relay
- Route update propagates < 500ms
- Traffic reroutes through B
```

**Fail-Fast Behavior**:
- Link degradation (PER > threshold) triggers immediate reroute
- Stale routes pruned after 30 seconds
- Failed neighbors automatically removed from routing table

#### 4. Spectral Agility (EW Hardening)

**Purpose**: Coordinated frequency hopping to evade jamming.

**Triggers**:
1. **Scheduled**: Dwell time expires on current channel
2. **Reactive**: Packet Error Rate (PER) exceeds threshold (e.g., 10%)
3. **Synchronized**: Cryptographic epoch-based coordination

**State Machine**:
```
[Normal Operation] 
    ↓ PER > threshold
[Jamming Detected]
    ↓ Execute hop
[Frequency Jump] → New Channel
    ↓ Broadcast to peers
[Synchronized Hop]
```

**Fail-Visible**:
- Nodes that fail to hop → Marked as "Ghost/Jam-Stranded"
- Visible on tactical map as degraded/offline

**Pattern Generation**:
- Deterministic from cryptographic seed
- All nodes with same seed converge on same sequence
- Epoch synchronization ensures coordination

#### 5. Bunker Mode (Offline-First Persistence)

**Purpose**: Total network isolation handling.

**State Transitions**:
```
Connected → (peer_count == 0) → Isolated (Bunker)
Isolated → (peer detected) → Syncing
Syncing → (all data uploaded) → Connected
```

**Storage**:
- SQLite `chain_store` for blocks
- SQLite `event_store` for telemetry/C2 commands
- All writes tagged with `synced` flag

**Deferred Sync Protocol**:
1. Upon reconnection, query `SELECT * WHERE synced = 0`
2. Upload local blocks to swarm
3. Download missing blocks from peers
4. Mark as `synced = 1` after confirmation

## Security Invariants

### Hardware-Rooted Trust Requirements

1. **TPM-Based Attestation**
   - All routing updates MUST be signed by a valid TPM key
   - Attestation failure → Trust score = 0.0
   - No attestation → Node rejected from mesh

2. **Message Authentication**
   - All gossip messages MUST include Ed25519 signature
   - Signature verification MUST succeed before forwarding
   - Invalid signatures → Message dropped + peer trust degraded

3. **Merkle Chain Integrity**
   - Each block MUST reference previous block hash
   - Merkle Root MUST be verifiable against local state
   - Fork resolution MUST prefer chain with most TPM-attested blocks

4. **Cryptographic Timing**
   - Frequency hops MUST be synchronized via cryptographic epochs
   - Epoch = BLAKE3(seed || timestamp / dwell_time)
   - Prevents predictable jamming patterns

5. **Replay Protection**
   - All messages MUST include monotonic timestamps
   - Messages older than 60 seconds → Dropped
   - Duplicate message IDs → Dropped

6. **Trust Score Decay**
   - Trust scores MUST decay over time without positive confirmation
   - Failed signature verification → Trust score × 0.5
   - Repeated failures → Peer evicted

### Access Control

- Only peers with `trust_score >= 0.5` can participate in routing
- Only peers with `attestation_verified = true` can gossip Merkle Roots
- Bunker mode data MUST be encrypted at rest (future enhancement)

## Failure Modes & Recovery

### Split-Brain Scenario

**Problem**: Two isolated swarms operate independently, then reconnect.

**Detection**:
```
Swarm A: Height 150, Root 0xAAA
Swarm B: Height 145, Root 0xBBB
```

**Resolution**:
1. Gossip protocol detects conflicting roots
2. Each swarm broadcasts its chain metadata
3. Nodes download missing blocks from both chains
4. Verification: Count TPM-attested blocks in each chain
5. **Winner**: Chain with most valid attestations
6. Losing chain nodes perform rollback and resync

### Jamming Attack

**Detection**: PER > threshold (e.g., 10%)

**Response**:
1. Frequency hopper triggers immediate hop
2. New channel broadcast via control channel
3. Nodes that fail to hop marked as "Ghost"
4. Routing table updated to bypass ghosts
5. If all channels jammed → Enter Bunker Mode

### Byzantine Peer

**Detection**: 
- Gossips invalid Merkle Roots
- Routes are black holes (high PER via this node)
- Signature verification failures

**Response**:
1. Trust score degraded exponentially
2. When trust < 0.5 → Remove from routing table
3. When trust < 0.1 → Revoke from peer table
4. Broadcast "Peer Revocation" message to swarm

### Total Isolation (Bunker Mode)

**Scenario**: All links severed, no peers visible.

**Behavior**:
1. Detect `peer_count == 0`
2. Transition to Bunker State
3. Continue mission: Store all data locally
4. Await reconnection
5. On reconnection: Upload local vine, download missing blocks

**Data Integrity**:
- All blocks stored with cryptographic hashes
- On resync, verify integrity before marking synced
- Corrupted blocks → Re-request from peers

## Performance Characteristics

### Latency Targets
- Peer discovery: < 5 seconds (LAN), < 30 seconds (WAN)
- Route convergence: < 500ms after link failure
- Gossip propagation: < 2 seconds to reach 90% of swarm
- Frequency hop: < 100ms execution time

### Scalability
- Max peers per node: 100
- Max routing table entries: 500
- Gossip message deduplication: Last 10,000 messages
- Bunker mode storage: Limited by disk (SQLite)

### Resource Requirements
- Memory: ~10 MB per node baseline
- CPU: < 5% on ARM Cortex-A series
- Network: < 100 KB/s gossip overhead per peer
- Storage: ~1 MB per 1000 blocks

## Integration Points

### CodeRalphie Client
- Mesh client runs as async Tokio task
- Exposes REST API for C2 commands
- WebSocket feed for real-time mesh status
- Integration with TPM for attestation

### ISR System
- Mesh telemetry feeds ISR correlation engine
- Peer locations → Tactical map overlay
- Jamming detection → Intelligence report

### Trust Mesh
- Mesh trust scores feed global trust graph
- Cross-domain attestation verification
- Revocation lists synchronized via gossip

## Future Enhancements

1. **Quantum-Resistant Cryptography**: Transition to post-quantum signatures
2. **Mesh Topology Optimization**: Machine learning for optimal peer selection
3. **Adaptive Frequency Hopping**: Dynamic pattern adjustment based on jammer behavior
4. **Zero-Knowledge Proofs**: Privacy-preserving state verification
5. **Multi-Channel Bonding**: Aggregate bandwidth across multiple frequencies

## References

- **Weaver Ant Protocol**: Inspired by ant colony optimization algorithms
- **Aetheric Whisper**: Based on gossipsub protocol (libp2p)
- **Spectral Agility**: Military frequency hopping standards (e.g., HAVE QUICK)
- **Hardware-Rooted Trust**: TPM 2.0 specification, TCG standards

---

**Document Version**: 1.0  
**Last Updated**: 2025-12-31  
**Classification**: UNCLASSIFIED  
**Distribution**: Approved for AetherCore contributors
