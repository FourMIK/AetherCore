# Merkle Aggregation Service

Production-grade Merkle tree aggregation for batch verification of events.

## Overview

The Merkle aggregation service provides deterministic Merkle tree construction for batches of event hashes, enabling efficient batch verification without storing individual events. It's designed to integrate with the event ledger to periodically fold events into compact Merkle roots.

## Features

- **Deterministic Construction**: Sorted leaf preprocessing ensures identical roots from identical input sets
- **BLAKE3 Hashing**: Fast, secure hashing for all tree operations
- **Proof Generation & Verification**: Complete Merkle proof system with sibling hashes and direction bits
- **Configurable Aggregation**: Time-based or count-based batch triggers
- **CLI Tool**: Standalone tool for building trees, generating proofs, and verifying proofs
- **Performance**: Handles thousands of leaves efficiently

## Core Concepts

### Merkle Tree Structure

A Merkle tree is built bottom-up from sorted leaves:

```
          Root
         /    \
       H01    H23
      /  \   /  \
     H0  H1 H2  H3
     |   |  |   |
    L0  L1 L2  L3  (Sorted Leaves)
```

- Each leaf is a 32-byte BLAKE3 hash
- Internal nodes: `H(left || right)` using BLAKE3
- Odd leaves are promoted unchanged to the next level

### Deterministic Preprocessing

Before building a tree:
1. Convert event hashes to 32-byte arrays
2. Sort lexicographically
3. Use sorted list as tree input

This ensures that different orderings of the same events produce the same root.

### Merkle Proofs

A proof demonstrates that a specific leaf is part of the tree:

```rust
pub struct MerkleProof {
    pub leaf_hash: Hash,          // The leaf being proven
    pub leaf_index: usize,         // Position in sorted list
    pub sibling_hashes: Vec<Hash>, // Siblings along path to root
    pub direction_bits: Vec<bool>, // true = sibling on right
    pub root_hash: Hash,           // Expected root
}
```

Verification recomputes the root by combining the leaf with siblings according to direction bits.

## Usage

### Building a Merkle Tree

```rust
use fourmik_core::{MerkleTree, preprocess_leaves};

// Event hashes from ledger
let event_hashes = vec![
    vec![0x01; 32],
    vec![0x02; 32],
    vec![0x03; 32],
    vec![0x04; 32],
];

// Preprocess and sort deterministically
let sorted_leaves = preprocess_leaves(&event_hashes);

// Build tree
let tree = MerkleTree::build(sorted_leaves)?;

println!("Root: {}", hex::encode(tree.root()));
println!("Leaves: {}", tree.leaf_count());
```

### Generating and Verifying Proofs

```rust
// Generate proof for leaf at index 2
let proof = tree.generate_proof(2)?;

// Verify proof
match MerkleTree::verify_proof(&proof) {
    Ok(true) => println!("Proof is valid!"),
    Ok(false) => println!("Proof is invalid!"),
    Err(e) => println!("Verification error: {}", e),
}
```

### Aggregation Scheduler

```rust
use fourmik_core::{MerkleAggregator, AggregationConfig};

// Configure aggregation triggers
let config = AggregationConfig {
    time_interval_ms: 1000, // Aggregate every 1 second
    count_threshold: 100,    // Or when 100 events accumulated
};

let mut aggregator = MerkleAggregator::new(config);

// Add events from ledger
for (seq_no, event) in ledger.iterate_events(1, 1000)? {
    // Automatically triggers aggregation when threshold reached
    if let Some(batch) = aggregator.add_event_hash(seq_no, event.event_hash) {
        println!("Batch {} aggregated:", batch.batch_id);
        println!("  Root: {}", hex::encode(batch.root_hash));
        println!("  Events: {}-{}", batch.start_seq_no, batch.end_seq_no);
        println!("  Count: {}", batch.event_count);
    }
}

// Or manually trigger aggregation
let batch = aggregator.aggregate_batch()?;
```

### Accessing Batch Metadata

```rust
// Get specific batch
if let Some(batch) = aggregator.get_batch(batch_id) {
    println!("Root: {}", hex::encode(batch.root_hash));
    println!("Seq range: {}-{}", batch.start_seq_no, batch.end_seq_no);
    println!("Created: {}", batch.created_at);
}

// Get all batches
for batch in aggregator.get_all_batches() {
    // Process batch metadata
}
```

## CLI Tool

The `merkle-cli` tool provides standalone Merkle tree operations.

### Installation

```bash
cargo build --release -p fourmik-core --bin merkle-cli
```

The binary will be at `target/release/merkle-cli`.

### Usage

#### Build a Merkle Tree

Create a file with event hashes (one per line, hex-encoded):

```bash
# hashes.txt
68656c6c6f000000000000000000000000000000000000000000000000000000
776f726c64000000000000000000000000000000000000000000000000000000
666f6f0000000000000000000000000000000000000000000000000000000000
626172000000000000000000000000000000000000000000000000000000000000
```

Build the tree:

```bash
merkle-cli build --input hashes.txt --output tree.json

# Output:
# Root hash: b4cd68150ee681b10796e5de9947bb100108f5fbe8ccb0c6ad0abb00d31eaf4c
# Leaf count: 4
# Tree saved to: tree.json
```

#### Generate a Proof

```bash
merkle-cli prove --tree tree.json --leaf-index 1 --output proof.json

# Output:
# Proof generated for leaf 1
# Leaf hash: 666f6f0000000000000000000000000000000000000000000000000000000000
# Root hash: b4cd68150ee681b10796e5de9947bb100108f5fbe8ccb0c6ad0abb00d31eaf4c
# Sibling count: 2
# Proof saved to: proof.json
```

#### Verify a Proof

```bash
merkle-cli verify --proof proof.json

# Output:
# ✓ Proof is VALID
#   Leaf: 666f6f0000000000000000000000000000000000000000000000000000000000
#   Root: b4cd68150ee681b10796e5de9947bb100108f5fbe8ccb0c6ad0abb00d31eaf4c

# Exit code: 0 (success)
```

If the proof is invalid:

```bash
# Exit code: 1 (failure)
# ✗ Proof is INVALID
```

#### JSON Output

For automation and scripting:

```bash
merkle-cli build --input hashes.txt --json
merkle-cli prove --tree tree.json --leaf-index 1 --json
merkle-cli verify --proof proof.json --json
```

Example JSON output:

```json
{
  "valid": true,
  "leaf_hash": "666f6f0000000000000000000000000000000000000000000000000000000000",
  "root_hash": "b4cd68150ee681b10796e5de9947bb100108f5fbe8ccb0c6ad0abb00d31eaf4c",
  "message": "Proof is valid"
}
```

## Integration with Event Ledger

### Periodic Aggregation

```rust
use fourmik_core::{EventLedger, MerkleAggregator, AggregationConfig};

// Open ledger
let ledger = EventLedger::open("data/node.db", "node-1")?;

// Create aggregator
let config = AggregationConfig::default();
let mut aggregator = MerkleAggregator::new(config);

// Aggregate events periodically
let mut last_seq_no = 0;
loop {
    // Get new events since last aggregation
    let events = ledger.iterate_events(last_seq_no + 1, 1000)?;
    
    if events.is_empty() {
        std::thread::sleep(std::time::Duration::from_secs(1));
        continue;
    }
    
    // Add to aggregator
    for (seq_no, event) in &events {
        aggregator.add_event_hash(*seq_no, event.event_hash.clone());
    }
    
    last_seq_no = events.last().unwrap().0;
}
```

### Batch Verification

Instead of verifying each event individually, verify batches:

```rust
// Client wants to verify events 1000-2000

// 1. Get batch that covers this range
let batch = aggregator.get_batch(batch_id)?;

// 2. Verify batch root matches (signed by node)
verify_signature(&batch.root_hash, &batch_signature)?;

// 3. If client needs specific event proof:
let proof = generate_proof_for_event(event_id, batch_id)?;
MerkleTree::verify_proof(&proof)?;

// Now confident event is in the batch without checking all events
```

## Performance

Benchmarked on standard x86_64 hardware:

| Operation | Time (5000 leaves) | Notes |
|-----------|-------------------|-------|
| Build tree | ~5ms | BLAKE3 hashing |
| Generate proof | <0.1ms | O(log n) |
| Verify proof | <0.1ms | O(log n) |
| Preprocess | ~1ms | Sorting |

The aggregator can efficiently handle batches of thousands of events with minimal overhead.

## Security Properties

### What the Merkle Aggregator Provides

- ✅ **Tamper Detection**: Any modification to a leaf changes the root
- ✅ **Inclusion Proofs**: Can prove any leaf is in the tree without revealing all leaves
- ✅ **Determinism**: Same input always produces same root
- ✅ **Efficiency**: O(log n) proof size and verification

### What It Does NOT Provide

- ❌ **Signature Verification**: Doesn't verify event signatures (delegated to signing service)
- ❌ **Ordering**: Sorts leaves, so doesn't preserve original event order
- ❌ **Confidentiality**: Merkle trees are public structures

### Threat Model

Protects against:
- Data tampering (modified events)
- Missing data (incomplete batches)
- Reordering within batch (sorted deterministically)

Does not protect against:
- Malicious aggregator (roots must be signed by trusted node)
- Complete batch omission (need sequence number continuity checks)

## Best Practices

1. **Sign Batch Roots**: Always cryptographically sign aggregation batch roots
2. **Link to Ledger**: Store batch metadata with seq_no ranges for auditability
3. **Periodic Aggregation**: Use time-based triggers to ensure regular batches
4. **Proof Storage**: Consider storing proofs for frequently queried leaves
5. **Batch Size**: Balance between aggregation efficiency and proof size (100-1000 events recommended)

## Troubleshooting

### Verification Fails

```rust
Err(ProofVerificationFailed { computed: "abc...", expected: "def..." })
```

**Causes:**
- Proof was generated for different tree
- Leaf was tampered with
- Sibling hash was modified
- Direction bits are incorrect

**Solution:** Regenerate proof from original tree.

### Empty Leaves Error

```rust
Err(EmptyLeaves)
```

**Causes:**
- Tried to build tree with no leaves
- Aggregator buffer is empty

**Solution:** Add events before building tree or calling aggregate_batch().

### Invalid Leaf Index

```rust
Err(InvalidLeafIndex { index: 10, count: 5 })
```

**Causes:**
- Leaf index out of bounds
- Tree has fewer leaves than expected

**Solution:** Check tree.leaf_count() before generating proof.

## Examples

See `crates/core/examples/` for complete examples:
- `merkle_basic.rs` - Basic tree construction and verification
- `merkle_aggregator.rs` - Using the aggregation scheduler
- `merkle_ledger_integration.rs` - Integrating with event ledger

## References

- BLAKE3: https://github.com/BLAKE3-team/BLAKE3
- Merkle Trees: https://en.wikipedia.org/wiki/Merkle_tree
- Event Ledger: See `crates/core/LEDGER.md`
