# Event Chain Module - BLAKE3 Integrity Chain

This document describes the Event Chain implementation for the 4MIK ledger/trust layer.

## Overview

The Event Chain module provides a cryptographic chain of events using BLAKE3 hashes, where each event links to the previous event via a hash pointer. This creates an immutable audit trail with the following properties:

- **Tamper Detection**: Any modification to an event breaks the chain
- **Missing Event Detection**: Gaps in the sequence are immediately visible  
- **Reordering Detection**: Events out of sequence break chain continuity
- **Efficient Verification**: Chain integrity can be verified sequentially in O(n)

## Architecture

```
┌──────────────────────────────────────────────────────────┐
│                     Event Chain                          │
│                                                          │
│  Event 0 (Genesis)         Event 1              Event 2  │
│  ┌──────────────┐         ┌──────────────┐    ┌────────┐│
│  │ event_hash   │◄────────│ prev_hash    │◄───│ prev   ││
│  │ GENESIS_HASH │         │ event_hash   │    │ event  ││
│  └──────────────┘         └──────────────┘    └────────┘│
│                                                          │
│  Each event cryptographically commits to previous event │
└──────────────────────────────────────────────────────────┘
```

## Core Components

### 1. Canonical Hash Computation

**Function**: `compute_event_hash(canonical_event) -> Blake3Hash`

Computes a BLAKE3 hash of a canonical event using the same deterministic serialization as the signing service.

```rust
let event = CanonicalEvent {
    event_type: "sensor.reading".to_string(),
    timestamp: 1700000000000,
    source_id: "sensor-001".to_string(),
    sequence: 1,
    payload: HashMap::new(),
};

let hash = compute_event_hash(&event)?;
// hash is a 32-byte BLAKE3 hash
```

### 2. Pointer Computation

**Function**: `compute_pointer(current_hash, previous_hash) -> Blake3Hash`

Creates a compound hash that commits to both the current event and the entire history:

```rust
let pointer = compute_pointer(current_hash, previous_hash);
// Cryptographically links two events
```

### 3. Chained Event Structure

```rust
pub struct ChainedEvent {
    pub event: CanonicalEvent,      // The event data
    pub event_hash: Blake3Hash,     // BLAKE3 hash of this event
    pub prev_event_hash: Blake3Hash, // Hash of previous event
}
```

### 4. Chain Manager

The `ChainManager` maintains the event chain state and provides the primary interface:

```rust
pub struct ChainManager {
    events: Vec<ChainedEvent>,
    metrics: ChainMetrics,
}
```

## API

### Building a Chain

```rust
use fourmik_crypto::chain::ChainManager;

let mut manager = ChainManager::new();

// Append events to chain
for i in 0..100 {
    let event = create_event(i);
    let hash = manager.append_to_chain(event)?;
    println!("Event {} added with hash: {:?}", i, hash);
}

// Get chain head (most recent event hash)
let head = manager.get_chain_head();
```

### Verifying a Chain

```rust
// Verify entire chain from start
let result = manager.verify_chain_from_start();
match result {
    VerifyResult::Ok => println!("Chain is valid"),
    VerifyResult::Error { error_type, index } => {
        println!("Chain break at index {}: {}", index, error_type);
    }
}

// Verify from specific index
let result = manager.verify_chain_from(1000);
```

### Accessing Chain Data

```rust
// Get number of events
let count = manager.len();

// Get specific event
if let Some(event) = manager.get_event(42) {
    println!("Event 42: {:?}", event.event);
}

// Get all events
let events = manager.events();
```

### Metrics

```rust
let metrics = manager.metrics();
println!("Events added: {}", metrics.chain_events_total);
println!("Breaks detected: {}", metrics.chain_breaks_detected_total);
```

## Chain Verification

The `verify_chain()` function checks:

1. **Genesis Event**: First event has `GENESIS_HASH` as `prev_event_hash`
2. **Hash Correctness**: Each event's hash matches its computed hash
3. **Link Continuity**: Each event's `prev_event_hash` equals the previous event's `event_hash`

### Verification Algorithm

```rust
for (i, event) in events.iter().enumerate() {
    // 1. Verify event hash is correct
    if compute_event_hash(&event.event)? != event.event_hash {
        return Error("hash_mismatch", i);
    }
    
    // 2. Verify link to previous
    if i > 0 {
        let expected_prev = events[i-1].event_hash;
        if event.prev_event_hash != expected_prev {
            return Error("broken_link", i);
        }
    }
}
```

## Error Detection

The chain module detects the following anomalies:

### 1. Missing Event

```
Event 0 → Event 1 → Event 3 (Event 2 missing)
                     ↑
                     Chain break: prev_hash doesn't match Event 1
```

### 2. Modified Event

```
Event 0 → Event 1' → Event 2
          (tampered)
          ↑
          Chain break: hash mismatch
```

### 3. Reordered Events

```
Event 0 → Event 2 → Event 1 (swapped)
          ↑
          Chain break: prev_hash doesn't match
```

### 4. Corrupted Pointer

```
Event 0 → Event 1 → Event 2
                    (bad prev_hash)
                    ↑
                    Chain break: prev_hash mismatch
```

## Performance

### Benchmarks (Debug Build)

| Operation | 10k Events | 100k Events | Target |
|-----------|------------|-------------|--------|
| **Build** | ~60-100ms | ~600ms | <150ms for 10k |
| **Verify** | ~45-70ms | ~460ms | <150ms for 10k |
| **Hash** | ~4-7μs/event | ~5-6μs/event | <10μs |

### Release Build Performance (Expected)

- Build: ~20-30ms for 10k events
- Verify: ~15-20ms for 10k events
- Hash: ~1-2μs per event
- Throughput: >500k events/sec

BLAKE3 is extremely fast:
- ~223k hashes/sec in debug build
- >1M hashes/sec in release build expected

## Usage Examples

### Complete Example

```rust
use fourmik_crypto::chain::{ChainManager, VerifyResult};
use fourmik_crypto::signing::CanonicalEvent;
use std::collections::HashMap;

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let mut manager = ChainManager::new();
    
    // Add 1000 events
    for i in 0..1000 {
        let event = CanonicalEvent {
            event_type: "data.update".to_string(),
            timestamp: 1700000000000 + i * 1000,
            source_id: "device-001".to_string(),
            sequence: i,
            payload: HashMap::new(),
        };
        
        manager.append_to_chain(event)?;
    }
    
    println!("Chain length: {}", manager.len());
    
    // Verify chain
    match manager.verify_chain_from_start() {
        VerifyResult::Ok => {
            println!("✓ Chain verified successfully");
        }
        VerifyResult::Error { error_type, index } => {
            println!("✗ Chain break at {}: {}", index, error_type);
        }
    }
    
    // Get metrics
    let metrics = manager.metrics();
    println!("Total events: {}", metrics.chain_events_total);
    println!("Breaks detected: {}", metrics.chain_breaks_detected_total);
    
    Ok(())
}
```

### Detecting Tampering

```rust
// Build a chain
let mut manager = ChainManager::new();
for i in 0..10 {
    let event = create_event(i);
    manager.append_to_chain(event)?;
}

// Simulate tampering by directly accessing events
// (In production, events should be immutable)
let mut events = manager.events().to_vec();
events[5].event.sequence = 999; // Tamper with event data

// Verification will fail
let result = verify_chain(&events);
// Result: Error { error_type: "hash_mismatch", index: 5 }
```

## Integration with Signing Service

The chain module uses the same `CanonicalEvent` structure as the signing service:

```rust
use fourmik_crypto::signing::EventSigningService;
use fourmik_crypto::chain::ChainManager;

// Sign events
let mut signing_service = EventSigningService::new();
let mut chain_manager = ChainManager::new();

let event = create_event(0);

// 1. Sign the event
let signature = signing_service.sign_event(&event)?;

// 2. Add to chain
let hash = chain_manager.append_to_chain(event)?;

// Now you have both:
// - A signature for authentication (who created it)
// - A chain hash for integrity (hasn't been tampered)
```

## Security Properties

1. **Immutability**: Once an event is in the chain, any modification is detectable
2. **Completeness**: Missing events are detectable
3. **Ordering**: Events must be in correct sequence
4. **Deterministic**: Same events always produce same hashes
5. **Fast Verification**: Linear time O(n) verification

## Testing

The module includes comprehensive tests:

### Unit Tests (14 tests)
- Hash computation and determinism
- Chained event creation and verification
- Chain verification happy path
- Empty chain detection
- Invalid genesis detection
- Dropped event detection
- Modified prev_hash detection
- Swapped event detection
- Chain manager operations

### Performance Tests (5 benchmarks)
- Build 10k event chain
- Verify 10k event chain
- Build and verify 100k event chain (stress test)
- Partial chain verification
- Hash computation throughput

All tests pass and enforce performance requirements.

## Future Enhancements

Potential improvements (not in current scope):

1. **Parallel Verification**: Use multiple threads for large chains
2. **Checkpoints**: Periodic snapshots for faster partial verification
3. **Compression**: Store chains more efficiently
4. **Merkle Tree**: Alternative structure for O(log n) proofs
5. **Persistence**: Save/load chains to disk
6. **Network Sync**: Synchronize chains across nodes

## References

- BLAKE3: https://github.com/BLAKE3-team/BLAKE3
- Hash chains: https://en.wikipedia.org/wiki/Hash_chain
- Blockchain structure: Similar concept to blockchain but simpler
