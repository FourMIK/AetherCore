# Fourmik Core Crate

## Overview

The `fourmik-core` crate provides foundational types, error handling, and cryptographic verification structures used across the 4MIK ecosystem. It implements the truth stack infrastructure that ensures all signals and data are cryptographically bound to verified identities.

## Key Components

### Trust Chain (`trust_chain.rs`)

Implements a verifiable chain of trust linking identities, messages, and actions. Each link is cryptographically signed and independently verifiable.

**Data Contracts:**
```rust
pub struct TrustLink {
    pub id: String,
    pub previous_hash: Vec<u8>,
    pub hash: Vec<u8>,
    pub identity_id: String,
    pub signature: Vec<u8>,
    pub timestamp: u64,
    pub action_type: String,
    pub payload: Vec<u8>,
}

pub struct TrustChain {
    pub chain_id: String,
    // Internal state...
}
```

**API Surface:**
- `TrustChain::new(chain_id)` - Create new chain
- `add_genesis(link)` - Initialize chain with genesis link
- `add_link(link)` - Add new link to chain
- `verify_chain()` - Verify entire chain integrity
- `iter_forward()` - Iterate through chain from genesis to head

**Security Hooks:**
- All links must be cryptographically signed
- Chain integrity verified through hash linkage
- Broken or cyclic chains detected and rejected

### Merkle-Vine (`merkle_vine.rs`)

Extends Merkle trees for streaming scenarios, enabling incremental building and efficient verification without the entire dataset.

**Data Contracts:**
```rust
pub struct VineNode {
    pub hash: Vec<u8>,
    pub index: u64,
    pub left: Option<Vec<u8>>,
    pub right: Option<Vec<u8>>,
    pub data: Option<Vec<u8>>,
    pub timestamp: u64,
}

pub struct MerkleVine {
    pub vine_id: String,
    // Internal state...
}

pub struct InclusionProof {
    pub leaf_hash: Vec<u8>,
    pub leaf_index: u64,
    pub root_hash: Vec<u8>,
    pub path: Vec<Vec<u8>>,
    pub directions: Vec<bool>,
}
```

**API Surface:**
- `MerkleVine::new(vine_id)` - Create new vine
- `add_leaf(data, hash, timestamp)` - Add leaf to vine
- `generate_proof(index)` - Generate inclusion proof for leaf
- `verify_proof(proof)` - Verify inclusion proof
- `get_root()` - Get current root hash

**Security Hooks:**
- Root hash updated incrementally as leaves are added
- Inclusion proofs enable efficient verification
- Tampered leaves detectable through root mismatch

### Event Schema (`event.rs`)

Standardized event types for system-wide operations with identity attribution and audit trails.

**Data Contracts:**
```rust
pub struct Event {
    pub event_id: String,
    pub timestamp: u64,
    pub severity: EventSeverity,
    pub category: EventCategory,
    pub event_type: String,
    pub identity_id: Option<String>,
    pub source: String,
    pub message: String,
    pub metadata: EventMetadata,
}

pub enum EventSeverity {
    Info, Warning, Error, Critical
}

pub enum EventCategory {
    Identity, Trust, Security, Network, Operational, Configuration
}
```

**API Surface:**
- `EventBuilder::new(event_type, source)` - Create event builder
- `severity(level)` - Set severity
- `category(cat)` - Set category
- `identity(id)` - Bind to identity
- `message(msg)` - Set message
- `metadata(key, value)` - Add metadata
- `build()` - Finalize event

**Security Hooks:**
- All events timestamped and attributed to source
- Identity binding for authentication events
- Severity levels for security event prioritization

## Common Types (`types.rs`)

Core types used throughout the system:
- `NodeId` - Unique node identifier
- `MeshId` - Mesh network identifier
- `Message` - Standard message envelope with source/dest/payload

## Error Handling (`error.rs`)

Unified error types for the entire system:
- `Error::Config` - Configuration errors
- `Error::Network` - Network communication errors
- `Error::Identity` - Identity and authentication errors
- `Error::Processing` - Data processing errors
- `Result<T>` - Standard result type

## Hardware Dependencies

None. This crate is pure Rust with no hardware dependencies.

## Feature Flags

None currently. All functionality is always available.

## Security Invariants

1. **Trust Chain Integrity**: Chains cannot be modified without detection
2. **Hash Linkage**: Each link cryptographically bound to previous
3. **No Downgrade**: Trust cannot be silently degraded
4. **Event Attribution**: All critical events must have identity attribution
5. **Immutability**: Once added to chain/vine, data cannot be altered

## Integration Points

### With Identity Crate
- Events reference identity IDs for attribution
- Trust chains bind to verified identities

### With Crypto Crate
- Hashing and signature verification delegated to crypto
- Trust chain signatures use crypto primitives

### With Edge/Mesh Crates
- Event schema used for operational logging
- Trust chains verify message sequences

## Testing

Run tests with:
```bash
cargo test -p fourmik-core
```

Current test coverage: 20 unit tests covering all core functionality.

## Production Considerations

1. **Hash Function**: Current implementation uses simplified hashing. In production, use BLAKE3 or SHA-256.
2. **Signature Verification**: Integrate with crypto crate for actual signature verification.
3. **Performance**: Trust chain operations are O(n) for traversal. Consider indexing for large chains.
4. **Storage**: For long-lived chains, implement archival and pruning strategies.
