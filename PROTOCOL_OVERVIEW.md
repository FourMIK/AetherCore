# AetherCore Protocol Overview

**Last Updated:** 2025-01-23  
**Purpose:** Conceptual description of core protocols without implementation details

---

## Overview

AetherCore implements a distributed protocol for tamper-evident data streaming in contested multi-domain environments. The protocol combines cryptographic integrity verification, trust-based mesh networking, and Byzantine fault detection.

This document describes protocol **concepts** at a high level. For implementation specifics, see the Rust crate documentation.

## Core Concepts

### Tamper-Evident Streaming

Data integrity is maintained through cryptographic chaining:

```
Event₀ → Event₁ → Event₂ → Event₃ → ...
         ↑        ↑        ↑
      hash(E₀) hash(E₁) hash(E₂)
```

Each event contains:
- **Payload:** Telemetry, command, or status data
- **Ancestor Hash:** Cryptographic hash of previous event
- **Signature:** Digital signature by originating node

This structure creates a **Merkle Vine** - a tamper-evident chain where any modification to historical events is detectable.

### Properties

**Tamper-Evidence:**
- Any modification breaks the hash chain
- Recipients detect integrity violations immediately
- No silent corruption possible

**Non-Repudiation:**
- Digital signatures bind events to originating nodes
- Nodes cannot plausibly deny authorship
- Provides accountability trail

**Ordered History:**
- Chain structure preserves temporal ordering
- Ancestry relationships maintained
- Enables causal reasoning

## Trust Mesh

Nodes participate in a decentralized trust network where trust is earned through verified behavior.

### Trust Scoring

Each node maintains trust scores for its peers:

```
Trust(Node A → Node B) = f(verification_history, connectivity, peer_reports)
```

Trust increases when:
- Events verify successfully
- Signatures validate correctly
- Hash chains remain intact

Trust decreases when:
- Verification fails
- Signatures invalid
- Hash chain breaks
- Peer reports negative behavior

### Trust Dissemination

Trust scores propagate via **gossip protocol:**

1. Nodes periodically exchange trust vectors
2. Recipients update local trust tables
3. Weighted consensus emerges over time
4. Byzantine nodes become isolated

### Trust-Weighted Consensus

Decisions use trust-weighted voting:

```
Decision = argmax Σ(vote_i × trust_i)
```

Higher-trust nodes have more influence. Byzantine nodes with low trust have minimal impact.

## Byzantine Fault Detection

The protocol detects and isolates misbehaving nodes through continuous monitoring.

### Detection Triggers

**Verification Failures:**
- Invalid signatures
- Broken hash chains
- Malformed events

**Inconsistent Behavior:**
- Contradictory statements to different peers
- Equivocation (signing conflicting events)
- Timing anomalies

**Peer Reports:**
- Multiple peers report same node as faulty
- Trust scores drop below threshold
- Network-wide consensus on Byzantine behavior

### Isolation Protocol (Aetheric Sweep)

When Byzantine behavior is detected:

1. **Quarantine:** Node is isolated from mesh
2. **Alert:** All peers notified of suspicious behavior
3. **Verification:** Trust scores recalculated network-wide
4. **Decision:** Consensus reached on permanent expulsion or reinstatement

The "Aetheric Sweep" is a visual representation of this isolation process in the operator interface.

### False Positive Mitigation

To prevent accidental isolation of legitimate nodes:

- **Multi-peer verification:** Requires multiple reports
- **Temporal correlation:** Looks for sustained misbehavior
- **Grace period:** Allows transient failures
- **Reputation recovery:** Permits trust rebuilding

## Gossip Protocol

Nodes exchange state via lightweight gossip:

### Message Types

**Trust Updates:**
- Peer trust scores
- Verification statistics
- Behavioral observations

**Topology Information:**
- Known peers and their connectivity
- Network path metrics
- Routing table updates

**Event Propagation:**
- Recent telemetry events
- Command distribution
- Status synchronization

### Gossip Cadence

```
Every T seconds:
  1. Select random subset of peers
  2. Exchange state summaries
  3. Request missing events
  4. Update local state
```

Gossip is:
- **Asynchronous:** No coordination required
- **Eventually consistent:** State converges over time
- **Fault-tolerant:** Continues despite node failures

## Merkle Vine Structure

Unlike traditional Merkle trees, Merkle Vines are **linear chains** optimized for streaming:

### Structure

```
Root Event (genesis)
    ↓ hash
Event 1
    ↓ hash
Event 2
    ↓ hash
Event 3
    ↓ hash
...
```

Each event cryptographically commits to its entire history.

### Verification

To verify Event N:
1. Check signature of Event N
2. Verify hash of Event N-1 matches recorded ancestor
3. Recursively verify backward to trusted root (or last checkpoint)

### Advantages

**Streaming-Friendly:**
- Append-only structure
- No tree rebalancing
- Constant-time append

**Partial Verification:**
- Can verify recent history without full chain
- Checkpoints enable bounded verification
- Efficient for high-volume telemetry

**Simplicity:**
- Linear structure easier to reason about
- No tree traversal complexity
- Straightforward verification logic

## Network Topology

### Mesh Connectivity

Nodes form a **partial mesh** where each node connects to subset of peers:

```
Node A ←→ Node B
  ↕         ↕
Node C ←→ Node D ←→ Node E
          ↕
        Node F
```

Connections are:
- **Bidirectional:** Peers exchange data symmetrically
- **Dynamic:** New connections formed as nodes discovered
- **Resilient:** Multiple paths exist between any two nodes

### Routing

Messages route via **gossip flooding with exponential suppression:**

1. Node receives message
2. Forwards to all peers except sender
3. Recipients suppress duplicate forwards
4. Message reaches all reachable nodes

Optimization: Trust-weighted routing prefers high-trust paths.

### Network Partitions

When network partitions occur:
- Each partition operates independently
- Trust scores local to partition
- Upon reconnection, partitions reconcile state via gossip

Reconciliation requires:
- Resolving conflicting trust scores (weighted merge)
- Detecting divergent event chains (fork resolution)
- Re-establishing global trust consensus

## Command and Control

Operators issue commands via secure C2 protocol:

### Command Flow

```
Operator → Tactical Glass → Auth Service → C2 Router
        → Mesh → Target Node(s) → Execution → Acknowledgment
```

### Command Structure

Each command contains:
- **Operator ID:** Authenticated operator identity
- **Target Specification:** Node ID or group selector
- **Command Payload:** Action and parameters
- **Signature:** Operator's digital signature

### Authorization

Commands execute only if:
1. Signature valid
2. Operator authorized for command type
3. Target node trusts operator (sufficient trust score)
4. Command semantically valid

### Acknowledgment

Target nodes send acknowledgment via reverse path:
- **Success:** Command executed successfully
- **Failure:** Command rejected with reason
- **Partial:** Some nodes succeeded, others failed (multi-target)

## Security Considerations

### Cryptographic Primitives

**Hashing:** BLAKE3
- Fast, cryptographically secure
- 256-bit output
- Collision-resistant

**Signatures:** Ed25519
- Elliptic curve digital signatures
- 256-bit security level
- Fast verification

### Attack Resistance

**Sybil Attacks:**
- Trust scoring limits impact of newly joined nodes
- Requires sustained good behavior to gain trust
- Peer identity registry prevents identity forgery (in production)

**Eclipse Attacks:**
- Gossip protocol ensures connectivity to honest nodes
- Multiple peer connections required
- Periodic topology reshuffling

**Replay Attacks:**
- Timestamps and nonces prevent replayed messages
- Event sequence numbers enforce ordering
- Signature prevents unauthorized modification

**Man-in-the-Middle:**
- TLS 1.3 encrypts all network communication
- Certificate pinning prevents certificate substitution (production)
- End-to-end signatures provide additional authentication

### Limitations

**Trust Bootstrapping:**
- New nodes start with zero trust
- Requires time to build reputation
- Cold-start problem for network formation

**Consensus Finality:**
- Gossip provides eventual consistency, not immediate finality
- Byzantine detection has latency
- Window exists where faulty node may operate

**Performance vs Security Trade-offs:**
- More frequent verification → higher CPU usage
- More gossip rounds → higher network overhead
- Shorter verification chains → higher storage requirements

## Protocol Evolution

### Versioning

Protocol messages include version field:
- Enables backward compatibility
- Allows gradual rollout of updates
- Nodes negotiate common version

### Extensibility

Protocol designed for extension:
- Custom telemetry types via schema registry
- Pluggable trust metrics
- Modular command handlers

---

## Implementation Notes

**This document describes concepts only.** Actual implementation details are in:

- `crates/stream` - Merkle Vine streaming implementation
- `crates/trust_mesh` - Trust scoring and Byzantine detection
- `crates/mesh` - Mesh networking and gossip protocol
- `crates/crypto` - Cryptographic primitives
- `crates/c2-router` - Command routing logic

See [ARCHITECTURE.md](ARCHITECTURE.md) for component organization.

---

## Further Reading

- [ARCHITECTURE.md](ARCHITECTURE.md) - System architecture
- [DEV_MODE.md](DEV_MODE.md) - Development mode capabilities
- [SECURITY_SCOPE.md](SECURITY_SCOPE.md) - Security boundaries
- [docs/trust-mesh-design.md](docs/trust-mesh-design.md) - Trust mesh detailed design
