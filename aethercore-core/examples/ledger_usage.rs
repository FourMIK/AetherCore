//! Event Ledger Example
//!
//! This example demonstrates how to use the Event Ledger Engine
//! to create an append-only log of signed events.
//!
//! Run with: cargo run --example ledger_usage -p fourmik-core

use blake3::Hasher;
use fourmik_core::{EventLedger, LedgerHealth, SignedEvent};

fn compute_hash(data: &[u8]) -> Vec<u8> {
    let mut hasher = Hasher::new();
    hasher.update(data);
    hasher.finalize().as_bytes().to_vec()
}

fn main() -> Result<(), Box<dyn std::error::Error>> {
    println!("=== Event Ledger Usage Example ===\n");

    // 1. Create or open a ledger
    println!("1. Opening ledger at 'data/example-node.db'");
    let db_path = "data/example-node.db";
    let node_id = "example-node-1";

    let mut ledger = EventLedger::open(db_path, node_id)?;
    println!("   ✓ Ledger opened for node: {}\n", ledger.node_id());

    // 2. Check initial health
    println!("2. Checking ledger health");
    let health = ledger.get_ledger_health();
    match health.status {
        LedgerHealth::Ok => println!("   ✓ Ledger is healthy\n"),
        LedgerHealth::Corrupted { ref error_type, .. } => {
            println!("   ✗ Ledger is corrupted: {}\n", error_type);
            return Err("Ledger corrupted".into());
        }
    }

    // 3. Check if ledger has existing events
    let start_seq = if let Some((seq_no, event)) = ledger.get_latest_event()? {
        println!("3. Found existing events");
        println!("   Latest event: {} at seq_no {}\n", event.event_id, seq_no);
        seq_no + 1
    } else {
        println!("3. Ledger is empty, starting fresh\n");
        1
    };

    // 4. Append some events
    println!("4. Appending events to ledger");
    let num_events = 10;

    for i in 0..num_events {
        let seq = start_seq + i;

        // Create event content
        let event_content = format!("Event {} - Track update from sensor", seq);
        let event_hash = compute_hash(event_content.as_bytes());

        // Get previous event hash
        let prev_event_hash = if seq == 1 {
            vec![0u8; 32] // Genesis hash
        } else {
            ledger.get_event_by_seq_no(seq - 1)?.event_hash
        };

        // Create a mock signature (in production, use actual signing service)
        let mock_signature = vec![0xAA; 64];

        let event = SignedEvent {
            event_id: format!("event-{}", seq),
            timestamp: 1700000000000 + (seq * 1000),
            event_hash: event_hash.clone(),
            prev_event_hash,
            signature: mock_signature,
            public_key_id: format!("key-{}", node_id),
            event_type: Some("track.update".to_string()),
            payload_ref: Some(format!("s3://bucket/payload-{}", seq)),
        };

        let assigned_seq_no = ledger.append_signed_event(event)?;
        println!("   ✓ Appended event-{} as seq_no {}", seq, assigned_seq_no);
    }
    println!();

    // 5. Read events back
    println!("5. Reading events from ledger");
    let events = ledger.iterate_events(start_seq, 5)?;
    for (seq_no, event) in events {
        println!(
            "   Event {}: {} (type: {})",
            seq_no,
            event.event_id,
            event.event_type.as_deref().unwrap_or("none")
        );
    }
    println!();

    // 6. Get specific event
    println!("6. Reading specific event");
    let target_seq = start_seq + 2;
    let event = ledger.get_event_by_seq_no(target_seq)?;
    println!("   Event at seq_no {}: {}", target_seq, event.event_id);
    println!("   Timestamp: {}", event.timestamp);
    println!("   Public key: {}\n", event.public_key_id);

    // 7. Get latest event
    println!("7. Getting latest event");
    if let Some((seq_no, event)) = ledger.get_latest_event()? {
        println!("   Latest: {} at seq_no {}\n", event.event_id, seq_no);
    }

    // 8. Check metrics
    println!("8. Checking metrics");
    let metrics = ledger.metrics();
    println!(
        "   Events appended (total): {}",
        metrics.ledger_events_appended_total
    );
    println!("   Startup checks: {}", metrics.ledger_startup_checks_total);
    println!(
        "   Corruption detections: {}\n",
        metrics.ledger_corruption_detections_total
    );

    // 9. Demonstrate chain validation
    println!("9. Demonstrating chain validation");
    println!("   Attempting to append event with wrong prev_hash...");

    let bad_event = SignedEvent {
        event_id: "bad-event".to_string(),
        timestamp: 1700000000000,
        event_hash: compute_hash(b"bad event"),
        prev_event_hash: vec![0xFF; 32], // Wrong hash!
        signature: vec![0xAA; 64],
        public_key_id: format!("key-{}", node_id),
        event_type: Some("bad.event".to_string()),
        payload_ref: None,
    };

    match ledger.append_signed_event(bad_event) {
        Ok(_) => println!("   ✗ ERROR: Should have rejected bad event!"),
        Err(e) => println!("   ✓ Correctly rejected: {}\n", e),
    }

    // 10. Summary
    println!("10. Summary");
    let final_health = ledger.get_ledger_health();
    println!("   Node ID: {}", final_health.node_id);
    println!("   Health: {:?}", final_health.status);
    println!("   DB Path: {}", ledger.db_path().display());

    println!("\n=== Example Complete ===");
    println!("\nTo view the database:");
    println!("  sqlite3 {}", db_path);
    println!("  sqlite> SELECT seq_no, event_id, event_type FROM ledger_events;");
    println!("\nTo clean up:");
    println!("  rm {}", db_path);
    println!("  rm {}-wal", db_path);
    println!("  rm {}-shm", db_path);

    Ok(())
}
