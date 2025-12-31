# AetherCore Mesh - Tactical Mesh Layer

[![License](https://img.shields.io/badge/license-MIT%20OR%20Apache--2.0-blue.svg)](../../../LICENSE)

## Overview

The AetherCore Mesh crate implements a tactical mesh networking layer designed for Hardware-Rooted Truth in contested, multi-domain environments. This is not generic mesh networking—this is **military-grade resilience** engineered for survival under active electronic warfare.

## Core Philosophy

1. **Truth as a Weapon**: Information is only valuable if cryptographically verifiable
2. **Fail-Visible**: Systems never fail silently; operators see network fractures immediately
3. **Survivability**: Assumes constant EW attack; disconnection is the default state

## Key Features

### 🔍 Peer Discovery (The Swarm Senses)
- Decentralized discovery via mDNS and seed peers
- Zero reliance on master nodes
- Dynamic trust scoring based on hardware attestation

### 📡 Aetheric Whisper (Gossip Protocol)
- Lightweight state propagation without central coordination
- Automatic fork detection and resolution
- Consensus based on longest verifiable Hardware-Rooted chain

### 🕸️ Weaver Ant Routing (Multi-Hop Resilience)
- Cost-based routing using SNR, trust score, latency, and PER
- Automatic rerouting on link failure (< 500ms)
- Nodes bridge gaps when direct links unavailable

### 📻 Spectral Agility (EW Hardening)
- Coordinated frequency hopping to evade jamming
- Reactive hopping on PER threshold breach
- Cryptographically synchronized channel selection

### 🏰 Bunker Mode (Offline-First Persistence)
- Graceful handling of total network isolation
- Local SQLite storage for telemetry and commands
- Deferred sync on reconnection

## Installation

Add to your `Cargo.toml`:

```toml
[dependencies]
aethercore-mesh = { path = "../mesh" }
```

## Quick Start

```rust
use aethercore_mesh::{TacticalMesh, PeerInfo};

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    // Create mesh instance
    let mut mesh = TacticalMesh::new(
        "node-alpha-1".to_string(),
        vec!["192.168.1.100:8080".to_string()], // Seed peers
        "chain_store.db"
    )?;

    // Add a peer
    let peer = PeerInfo {
        node_id: "node-bravo-2".to_string(),
        trust_score: 0.95,
        latency_ms: 45,
        last_seen: 1704067200000,
        address: "192.168.1.101:8080".to_string(),
        public_key: vec![/* ... */],
        attestation_verified: true,
    };
    mesh.add_peer(peer)?;

    // Check mesh status
    let status = mesh.get_mesh_status();
    println!("Bunker Mode: {}", status.bunker_mode);
    println!("Jamming Detected: {}", status.jamming_detected);

    Ok(())
}
```

## Architecture

See [ARCHITECTURE.md](./ARCHITECTURE.md) for comprehensive architectural documentation including:
- System stack overview
- Component interactions
- Security invariants
- Failure mode handling
- Performance characteristics

## Security Model

### Hardware-Rooted Trust
- All routing updates signed by TPM keys
- Merkle chain integrity verification
- Trust score decay on verification failures

### Anti-Replay
- Monotonic timestamps on all messages
- 60-second message TTL
- Duplicate message ID detection

### Cryptographic Synchronization
- Frequency hops coordinated via cryptographic epochs
- Pattern generation from shared seed: `BLAKE3(seed || epoch)`

## Testing

Run the test suite:

```bash
cargo test -p aethercore-mesh
```

All 46+ unit tests cover:
- Peer discovery and trust scoring
- Gossip message propagation and conflict detection
- Multi-hop routing scenarios
- Frequency hopping state machine
- Bunker mode state transitions

## Performance

- **Peer Discovery**: < 5s (LAN), < 30s (WAN)
- **Route Convergence**: < 500ms after link failure
- **Gossip Propagation**: < 2s to 90% of swarm
- **Frequency Hop Execution**: < 100ms

## Components

### Core Modules

- `peer.rs` - Peer discovery and trust scoring
- `gossip.rs` - Aetheric Whisper gossip protocol
- `routing.rs` - Weaver Ant multi-hop routing
- `spectral.rs` - Spectral Agility frequency hopping
- `bunker.rs` - Bunker Mode offline persistence
- `tactical.rs` - High-level mesh coordinator

## Integration

### CodeRalphie Client
The mesh layer is designed for integration with CodeRalphie edge clients:
- Async Tokio runtime
- REST API for C2 commands
- WebSocket for real-time status

### Trust Mesh
Trust scores feed into the global trust graph:
- Hardware attestation verification
- Cross-domain identity validation
- Revocation list synchronization

## Terminology

- **CodeRalphie**: Edge-native execution client on tactical hardware
- **Weaver Ant Protocol**: Dynamic routing where nodes bridge mesh gaps
- **Aetheric Whisper**: Gossip protocol for Merkle Root propagation
- **Spectral Agility**: Coordinated frequency hopping capability
- **Bunker Mode**: Offline-first state during network isolation

## Future Work

- [ ] Quantum-resistant cryptography
- [ ] ML-based topology optimization
- [ ] Adaptive frequency hopping patterns
- [ ] Zero-knowledge state proofs
- [ ] Multi-channel bandwidth bonding

## Contributing

See [CONTRIBUTING.md](../../../CONTRIBUTING.md) for contribution guidelines.

## License

Licensed under either of:

- Apache License, Version 2.0 ([LICENSE-APACHE](../../../LICENSE-APACHE) or http://www.apache.org/licenses/LICENSE-2.0)
- MIT license ([LICENSE-MIT](../../../LICENSE-MIT) or http://opensource.org/licenses/MIT)

at your option.

## Acknowledgments

- Inspired by military frequency hopping standards (HAVE QUICK)
- Gossip protocol based on libp2p gossipsub
- Routing algorithms inspired by ant colony optimization

---

**4MIK - The AetherCore Architect**  
*Forging Hardware-Rooted Truth for contested environments*
