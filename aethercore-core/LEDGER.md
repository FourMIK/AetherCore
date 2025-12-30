# Event Ledger Engine

A production-grade, append-only event ledger with SQLite backend for the 4MIK system.

## Overview

The Event Ledger Engine provides durable, append-only storage for signed events with cryptographic chain validation. It's designed for use in distributed trust mesh systems where event integrity and auditability are critical.

## Features

- **Append-Only Storage**: Events cannot be modified or deleted once written
- **Chain Validation**: Each event cryptographically links to the previous event via BLAKE3 hashes
- **Startup Integrity Checks**: Automatic verification of ledger continuity on startup
- **Corruption Detection**: Detects missing events, hash mismatches, and sequence anomalies
- **SQLite Backend**: WAL mode for durability and crash recovery
- **Performance**: 7,000+ events/sec append, 290,000+ events/sec verification
- **Metrics & Observability**: Built-in metrics and structured logging

## Architecture

### Event Structure

Each signed event contains:

- `seq_no`: Monotonically increasing sequence number (auto-assigned)
- `event_id`: Unique event identifier
- `timestamp`: Event creation time (Unix milliseconds)
- `event_hash`: BLAKE3 hash of the event content
- `prev_event_hash`: Hash of the previous event (chain pointer)
- `signature`: Cryptographic signature (e.g., Ed25519)
- `public_key_id`: Identifier of the signing key
- `event_type`: Optional event type
- `payload_ref`: Optional reference to compressed payload

### Storage Schema

```sql
CREATE TABLE ledger_events (
    seq_no INTEGER PRIMARY KEY AUTOINCREMENT,
    event_id TEXT NOT NULL UNIQUE,
    timestamp INTEGER NOT NULL,
    event_hash BLOB NOT NULL,
    prev_event_hash BLOB NOT NULL,
    signature BLOB NOT NULL,
    public_key_id TEXT NOT NULL,
    event_type TEXT,
    payload_ref TEXT,
    created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now') * 1000)
);
```

### Chain Validation

The ledger maintains a cryptographic chain where:
1. The first event has `prev_event_hash = [0; 32]` (genesis hash)
2. Each subsequent event's `prev_event_hash` must match the previous event's `event_hash`
3. Sequence numbers must be strictly increasing by 1

## Usage

### Opening a Ledger

```rust
use fourmik_core::EventLedger;

// Open or create a ledger
let ledger = EventLedger::open("data/node-1.db", "node-1")
    .expect("Failed to open ledger");

// Check health after startup
let health = ledger.get_ledger_health();
assert!(health.status.is_ok());
```

### Appending Events

```rust
use fourmik_core::SignedEvent;
use blake3::Hasher;

// Create a signed event
let event = SignedEvent {
    event_id: "event-123".to_string(),
    timestamp: 1700000000000,
    event_hash: compute_hash(b"event-data"),
    prev_event_hash: vec![0u8; 32], // Genesis or previous event hash
    signature: vec![1, 2, 3, 4],
    public_key_id: "key-1".to_string(),
    event_type: Some("track.update".to_string()),
    payload_ref: Some("s3://bucket/payload-123".to_string()),
};

// Append to ledger
let mut ledger = ledger;
let seq_no = ledger.append_signed_event(event)
    .expect("Failed to append event");

println!("Event appended with seq_no: {}", seq_no);
```

### Reading Events

```rust
// Get the latest event
if let Some((seq_no, event)) = ledger.get_latest_event()? {
    println!("Latest event: {} at seq_no {}", event.event_id, seq_no);
}

// Get a specific event by sequence number
let event = ledger.get_event_by_seq_no(42)?;

// Iterate through events
let events = ledger.iterate_events(1, 100)?;
for (seq_no, event) in events {
    println!("Event {}: {}", seq_no, event.event_id);
}
```

### Checking Ledger Health

```rust
let health = ledger.get_ledger_health();

match health.status {
    LedgerHealth::Ok => {
        println!("Ledger is healthy");
    }
    LedgerHealth::Corrupted { 
        last_good_seq_no, 
        first_bad_seq_no, 
        error_type 
    } => {
        eprintln!(
            "Ledger corrupted at seq_no {}: {}",
            first_bad_seq_no, error_type
        );
    }
}
```

### Accessing Metrics

```rust
let metrics = ledger.metrics();
println!("Events appended: {}", metrics.ledger_events_appended_total);
println!("Startup checks: {}", metrics.ledger_startup_checks_total);
println!("Corruptions detected: {}", metrics.ledger_corruption_detections_total);
```

## Guarantees

### Append-Only Semantics

- **No Updates**: Once written, events cannot be modified
- **No Deletes**: Events cannot be removed (except through archival procedures)
- **Strict Ordering**: `seq_no` increases by 1 for each event
- **Chain Continuity**: `prev_event_hash` must match the previous event's `event_hash`

### Durability

- **WAL Mode**: SQLite Write-Ahead Logging for crash recovery
- **Synchronous Mode**: NORMAL for balance of safety and performance
- **Automatic Checkpointing**: WAL checkpoints on close

### Corruption Detection

On startup, the ledger performs a full continuity check:

1. Verifies chain hashes from genesis to head
2. Checks sequence numbers are strictly increasing
3. Detects missing or duplicated events
4. Returns detailed error information if corruption is found

If corruption is detected:
- The ledger enters a degraded state
- New appends are rejected
- Detailed error information is logged
- The application can decide how to handle the failure

## Performance

Benchmarks on standard hardware (x86_64):

| Operation | Throughput | Notes |
|-----------|-----------|-------|
| Append | 7,600+ events/sec | WAL mode, synchronous commits |
| Verify (startup) | 290,000+ events/sec | Full chain validation |
| Read (iterate) | 150,000+ events/sec | Sequential read with limit |
| Random read | ~100,000 ops/sec | Indexed by seq_no |

For 5,000 events:
- Append: ~650ms
- Verify: ~17ms
- Read all: ~33ms

## Error Handling

The ledger provides detailed error types:

```rust
pub enum LedgerError {
    DatabaseError(rusqlite::Error),
    ChainOrderingViolation { expected: String, actual: String },
    SequenceViolation { expected: u64, actual: u64 },
    DuplicateSequence { seq_no: u64 },
    DuplicateEventId { event_id: String },
    EventNotFound { seq_no: u64 },
    CorruptionDetected(String),
    IoError(std::io::Error),
    InvalidEvent(String),
}
```

## Integration with Other Components

### With Event Signing Service

```rust
use fourmik_crypto::{EventSigningService, CanonicalEvent};
use fourmik_core::{EventLedger, SignedEvent};

// Sign an event
let signing_service = EventSigningService::new(/* ... */);
let canonical_event = CanonicalEvent {
    event_type: "track.update".to_string(),
    timestamp: 1700000000000,
    source_id: "node-1".to_string(),
    sequence: 1,
    payload: HashMap::new(),
};

let signature_result = signing_service.sign_event(&canonical_event)?;

// Append to ledger
let signed_event = SignedEvent {
    event_id: canonical_event.source_id.clone(),
    timestamp: canonical_event.timestamp,
    event_hash: compute_event_hash(&canonical_event)?,
    prev_event_hash: ledger.get_chain_head(),
    signature: signature_result.signature,
    public_key_id: signature_result.public_key_id,
    event_type: Some(canonical_event.event_type),
    payload_ref: None,
};

ledger.append_signed_event(signed_event)?;
```

### With Trust Mesh

The ledger can be used as the persistence layer for the trust mesh:

```rust
use fourmik_trust_mesh::{TrustMeshService, TrustMeshConfig};

let ledger = EventLedger::open("data/trust-mesh.db", "node-1")?;
let trust_mesh = TrustMeshService::new(
    TrustMeshConfig::default(),
    ledger,
)?;
```

## Testing

Run unit tests:
```bash
cargo test -p fourmik-core ledger::tests
```

Run integration tests:
```bash
cargo test -p fourmik-core --test ledger_integration
```

## Security Considerations

### Threat Model

The ledger is designed to detect:
- **Tampering**: Any modification to stored events breaks the chain
- **Deletion**: Missing events are detected during startup checks
- **Replay**: Sequence numbers prevent replay attacks
- **Reordering**: Chain hashes prevent event reordering

### Out of Scope

The ledger does NOT:
- Verify signatures (use the signing service for that)
- Encrypt data at rest (use filesystem encryption)
- Handle Byzantine faults (use consensus protocols above this layer)
- Auto-repair corrupted ledgers (intentionally fail-closed)

### Best Practices

1. **Verify signatures before appending**: Don't trust unverified events
2. **Monitor health metrics**: Track corruption detection counters
3. **Plan for corruption scenarios**: Have procedures for manual recovery
4. **Secure the database file**: Use filesystem permissions appropriately
5. **Back up regularly**: The ledger is append-only but not immutable against filesystem manipulation

## License

MIT
