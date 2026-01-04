# Offline Mode and Guardian-Gated Sync

## Overview

Operation Dark Circuit implements offline resilience for AetherCore nodes operating in Contested/Congested environments. When the link to the "Great Gospel" (global ledger) fails, nodes transition to **Autonomous Local Mode**, cryptographically queueing all commands and events. Upon reconnection, a **Mission Guardian** (admin with Sovereign trust level) must audit and approve the offline buffer before merging into the live truth stream.

## Architecture

### Components

1. **Materia Buffer** (`OfflineMateriaBuffer`)
   - Persistent local-first storage using SQLite with WAL mode
   - Encrypted event storage (encryption at rest via TPM-derived keys - to be implemented)
   - Merkle Vine chain integrity tracking
   - Configurable buffer capacity (default: 10,000 events)

2. **Connection States**
   - `Online`: Normal operation with C2 link active
   - `OfflineAutonomous`: Blackout mode, events queued locally
   - `ReconnectPending`: Link restored, awaiting admin approval to sync

3. **Guardian Gate**
   - Admin-approved resynchronization protocol
   - Requires Sovereign-level signature
   - Merkle root verification across the offline gap
   - Fail-visible UI support for operator awareness

## State Machine

```
┌─────────┐  Connection Lost   ┌───────────────────┐
│ Online  │──────────────────▶ │ OfflineAutonomous │
└─────────┘                    └───────────────────┘
     ▲                                │
     │                                │ Connection Restored
     │                                ▼
     │ Sync Approved          ┌──────────────────┐
     └────────────────────────┤ ReconnectPending │
                              └──────────────────┘
```

## Usage

### Initialization

```rust
use aethercore_c2_router::OfflineMateriaBuffer;
use std::path::PathBuf;

// Create offline buffer
let storage_path = PathBuf::from("/var/lib/aethercore/offline_buffer.db");
let buffer = OfflineMateriaBuffer::new(storage_path, "node-001".to_string())
    .expect("Failed to initialize offline buffer");
```

### Transitioning to Offline Mode

```rust
// Detect connection loss
if !is_c2_link_active() {
    buffer.enter_offline_mode()
        .expect("Failed to enter offline mode");
}
```

### Queueing Events During Blackout

```rust
use aethercore_c2_router::EncryptedPacket;

// While in OfflineAutonomous state
let event = EncryptedPacket {
    event_id: "cmd-12345".to_string(),
    timestamp_ns: current_timestamp_ns(),
    encrypted_payload: encrypt_command(&command),
    nonce: generate_nonce(),
    event_hash: blake3::hash(&command_bytes).as_bytes().to_vec(),
    prev_event_hash: get_last_event_hash(),
    signature: sign_with_tpm(&command_hash),
    public_key_id: "tpm-key-001".to_string(),
};

buffer.queue_signed_event(event)
    .expect("Failed to queue event");
```

### Reconnection Protocol

```rust
// Detect reconnection
if is_c2_link_restored() {
    buffer.enter_reconnect_pending()
        .expect("Failed to enter reconnect pending");
    
    // Do NOT automatically sync - wait for Guardian approval
}
```

### Admin-Approved Sync

```rust
// Guardian reviews the offline gap
let gap_info = buffer.get_gap_info()
    .expect("Failed to get gap info");

println!("Queued events: {}", gap_info.queued_count);
println!("Chain intact: {}", gap_info.chain_intact);
println!("Buffer utilization: {:.1}%", gap_info.buffer_utilization * 100.0);

// Guardian authorizes sync
if gap_info.chain_intact && admin_approves() {
    // Get all queued events
    let events = buffer.get_all_events()
        .expect("Failed to get events");
    
    // Replay to ledger
    for event in events {
        replay_to_ledger(event);
    }
    
    // Clear buffer and return to online mode
    buffer.clear_buffer()
        .expect("Failed to clear buffer");
    buffer.enter_online_mode()
        .expect("Failed to enter online mode");
}
```

## gRPC API

### GetOfflineGapInfo

Request visibility into the offline buffer for Tactical Glass dashboard.

**Request:**
```protobuf
message OfflineGapRequest {
  string node_id = 1;
}
```

**Response:**
```protobuf
message OfflineGapResponse {
  uint64 queued_count = 1;
  uint64 offline_since_ns = 2;
  uint64 reconnect_at_ns = 3;
  bool chain_intact = 4;
  double buffer_utilization = 5;
  string connection_state = 6;
}
```

**Example:**
```bash
grpcurl -d '{"node_id": "node-001"}' \
  -H "x-device-id: admin-device" \
  -H "x-signature: <base64-sig>" \
  localhost:50051 aethercore.c2.C2Router/GetOfflineGapInfo
```

### AuthorizeSyncBundle

Authorize synchronization of offline buffer (requires Sovereign signature).

**Request:**
```protobuf
message SyncAuthorizationRequest {
  string node_id = 1;
  string admin_signature = 2;  // Sovereign-level signature
  string admin_public_key_id = 3;
  uint64 timestamp_ns = 4;
}
```

**Response:**
```protobuf
message SyncAuthorizationResponse {
  bool success = 1;
  string message = 2;
  uint64 events_synced = 3;
  uint64 timestamp_ns = 4;
  bool merkle_verified = 5;
  string status = 6;  // "synced", "verification_failed", "unauthorized"
}
```

**Example:**
```bash
grpcurl -d '{
  "node_id": "node-001",
  "admin_signature": "<base64-encoded-sovereign-sig>",
  "admin_public_key_id": "sovereign-key-001",
  "timestamp_ns": 1704326400000000000
}' \
  -H "x-device-id: admin-device" \
  -H "x-signature: <base64-sig>" \
  localhost:50051 aethercore.c2.C2Router/AuthorizeSyncBundle
```

## Security Guarantees

### Chain Integrity

Every offline event extends the local Merkle Vine:
- Each event hash chains to the previous event's hash
- Chain breaks are detected immediately
- Buffer marked as "Identity Collapse Detected" if chain broken
- Merkle root verified against first online transaction after sync

### No Automatic Resync

**Zero automatic resynchronization is a security invariant.** This prevents:
- Replay injection attacks from captured nodes
- Byzantine nodes flooding the system with fake historical data
- Compromised nodes injecting malicious commands during the gap

### Fail-Visible

If issues occur, they are explicitly surfaced:
- **Buffer Exhausted**: "Data Loss Imminent" alert on UI
- **Chain Break**: "Identity Collapse Detected" status
- **Merkle Mismatch**: "Unverified/Potential Spoof" marking
- **Authorization Failed**: "Unauthorized sync attempt" audit log

### Trust Preservation

During offline mode:
- Local trust scores are maintained (to be implemented)
- Malicious behavior is tracked locally
- Nodes can be quarantined locally before sync occurs
- Trust state is preserved across the offline gap

## Buffer Management

### Capacity Limits

Default buffer capacity: **10,000 events**

When approaching capacity:
- Warning at 80% utilization
- Critical alert at 95% utilization
- Hard reject at 100% with explicit error

### Storage Format

SQLite table schema:
```sql
CREATE TABLE offline_buffer (
    seq_no INTEGER PRIMARY KEY AUTOINCREMENT,
    event_id TEXT NOT NULL UNIQUE,
    timestamp_ns INTEGER NOT NULL,
    encrypted_payload BLOB NOT NULL,
    nonce BLOB NOT NULL,
    event_hash BLOB NOT NULL,
    prev_event_hash BLOB NOT NULL,
    signature BLOB NOT NULL,
    public_key_id TEXT NOT NULL,
    created_at INTEGER NOT NULL
);

CREATE INDEX idx_timestamp ON offline_buffer(timestamp_ns);
```

### Encryption at Rest

**TODO**: Implement TPM-derived key encryption
- Each entry encrypted with key derived from TPM
- Nonce/IV stored alongside ciphertext
- Key never stored in system memory
- Hardware root of trust for decryption

## Monitoring and Observability

### Metrics

- `offline_buffer_size`: Current number of queued events
- `offline_buffer_utilization`: Percentage of buffer capacity used
- `offline_duration_seconds`: Time spent in offline mode
- `offline_chain_breaks`: Number of detected chain integrity violations
- `offline_sync_authorizations`: Count of admin-approved syncs

### Audit Logs

Every operation is logged with structured fields:
```
OFFLINE_MODE_ENTERED: node_id=node-001 timestamp=<ts>
EVENT_QUEUED: node_id=node-001 event_id=cmd-12345 seq_no=42
RECONNECT_DETECTED: node_id=node-001 queued_count=127
SYNC_AUTHORIZED: node_id=node-001 admin=sovereign-key-001 events=127
CHAIN_BREAK_DETECTED: node_id=node-001 seq_no=84
```

## Error Scenarios

### Buffer Exhaustion

```
Error: Buffer exhausted: Data loss imminent
Current: 10000 / Max: 10000
```

**Resolution**: 
1. Increase buffer capacity if possible
2. Prioritize critical commands only
3. Seek immediate reconnection
4. Consider partial sync if connection intermittent

### Chain Break Detection

```
Error: Identity collapse detected: chain break at sequence 84
```

**Resolution**:
1. DO NOT sync automatically
2. Investigate potential compromise
3. Guardian must manually review all events
4. Consider rejecting entire buffer if compromise suspected
5. Initiate Aetheric Sweep if Byzantine behavior detected

### Merkle Root Mismatch

```
Error: Merkle root mismatch after sync
Offline: 0x1a2b3c...
Online:  0x4d5e6f...
```

**Resolution**:
1. Mark synced data as "Unverified/Potential Spoof"
2. Trigger Aetheric Sweep for Byzantine node detection
3. Quarantine the node until manual investigation
4. Do not trust any commands from this node

## Future Enhancements

### Phase 2: Encryption
- [ ] Implement TPM-derived key encryption for payload
- [ ] Add secure key derivation function
- [ ] Implement key rotation policy

### Phase 3: Trust Integration
- [ ] Local trust score computation during offline mode
- [ ] Queue trust updates alongside events
- [ ] Prevent quarantined nodes from queueing commands

### Phase 4: Compression
- [ ] Add optional compression for large payloads
- [ ] Implement compression level configuration
- [ ] Add metrics for compression ratios

### Phase 5: Partial Sync
- [ ] Support incremental sync for large buffers
- [ ] Add checkpoint-based resume capability
- [ ] Implement priority-based sync ordering

## References

- [IMPLEMENTATION_SUMMARY.md](../IMPLEMENTATION_SUMMARY.md) - Overall system architecture
- [Trust Mesh](../crates/trust_mesh/README.md) - Trust scoring and Byzantine detection
- [Identity](../crates/identity/README.md) - Hardware-rooted identity and attestation
- [C2 Router](../crates/c2-router/README.md) - Command routing and dispatch

## Testing

Run offline mode tests:
```bash
cargo test --package aethercore-c2-router --lib offline
```

Expected output:
```
running 3 tests
test offline::tests::test_cannot_queue_while_online ... ok
test offline::tests::test_queue_event ... ok
test offline::tests::test_state_transitions ... ok

test result: ok. 3 passed; 0 failed; 0 ignored
```

## Support

For issues or questions:
- File an issue: https://github.com/FourMIK/AetherCore/issues
- Security concerns: security@aethercore.io (PGP key available)
- Operator support: ops@aethercore.io
