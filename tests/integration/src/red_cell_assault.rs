//! Red Cell Assault - Byzantine Attack Simulation
//!
//! This test suite validates the system's ability to detect and reject
//! adversarial nodes that attempt to subvert the Trust Fabric.
//!
//! # Test Scenarios
//!
//! 1. **Ghost Node with Invalid Merkle Root**: Node broadcasts mathematically impossible chain data
//! 2. **Quarantined Node Rejection**: Nodes with low trust scores are blocked from executing commands
//! 3. **Zero Trust Default**: Unknown nodes are denied access
//! 4. **Multiple Byzantine Nodes**: System handles coordinated attacks
//!
//! # Expected Outcomes
//!
//! - Trust mesh detects mathematical impossibilities in Merkle chains
//! - C2 Router rejects commands from quarantined nodes with detailed error messages
//! - Byzantine nodes are isolated while legitimate nodes continue operating
//! - Dashboard events propagate quarantine status for operator visibility

use aethercore_c2_router::grpc::{C2GrpcServer, C2Router, UnitCommandRequest};
use aethercore_c2_router::{
    authority::AuthorityVerifier, command_types::UnitCommand, dispatcher::CommandDispatcher,
    quorum::QuorumGate,
};
use aethercore_crypto::chain::GENESIS_HASH;
use aethercore_crypto::signing::CanonicalEvent;
use aethercore_identity::{Attestation, IdentityManager, PlatformIdentity};
use aethercore_trust_mesh::TrustScorer;
use std::collections::HashMap;
use tonic::metadata::MetadataValue;
use tonic::Request;

/// Utility functions for Red Cell test scenarios
mod test_utils {
    use super::*;

    /// Create a valid node identity for testing
    pub fn create_node_identity(node_id: &str) -> PlatformIdentity {
        PlatformIdentity {
            id: node_id.to_string(),
            public_key: vec![1, 2, 3, 4],
            attestation: Attestation::Software {
                certificate: vec![5, 6, 7, 8],
            },
            created_at: current_timestamp_ms(),
            metadata: HashMap::new(),
        }
    }

    /// Get current timestamp in milliseconds
    pub fn current_timestamp_ms() -> u64 {
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_millis() as u64
    }

    /// Get current timestamp in nanoseconds
    pub fn current_timestamp_ns() -> u64 {
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos() as u64
    }

    /// Create a navigate command for testing
    pub fn create_navigate_command() -> UnitCommand {
        UnitCommand::Navigate {
            waypoint: aethercore_c2_router::command_types::Coordinate {
                lat: 45.0,
                lon: -122.0,
                alt: Some(100.0),
            },
            speed: Some(10.0),
            altitude: None,
        }
    }

    /// Create a unit command request with metadata
    pub fn create_command_request(
        device_id: &'static str,
        command: &UnitCommand,
    ) -> Request<UnitCommandRequest> {
        let mut request = Request::new(UnitCommandRequest {
            unit_id: "unit-1".to_string(),
            command_json: serde_json::to_string(command).unwrap(),
            signatures: vec!["test-sig".to_string()],
            timestamp_ns: current_timestamp_ns(),
        });

        request
            .metadata_mut()
            .insert("x-device-id", MetadataValue::from_static(device_id));
        request
            .metadata_mut()
            .insert("x-signature", MetadataValue::from_static("dGVzdC1zaWduYXR1cmU="));

        request
    }
}

/// Setup a C2 server with specific nodes and trust scores
fn setup_server_with_nodes(nodes: &[(&str, f64)]) -> C2GrpcServer {
    let dispatcher = CommandDispatcher::new();
    let verifier = AuthorityVerifier::new();
    let quorum_gate = QuorumGate::new(verifier);

    // Configure trust scorer with specified scores
    let trust_scorer = TrustScorer::new();
    for (node_id, delta) in nodes {
        trust_scorer.update_score(node_id, *delta);
    }

    // Register all nodes in identity manager
    let mut identity_manager = IdentityManager::new();
    for (node_id, _) in nodes {
        let identity = test_utils::create_node_identity(node_id);
        identity_manager.register(identity).unwrap();
    }

    C2GrpcServer::new(dispatcher, quorum_gate, trust_scorer, identity_manager)
}

/// Test 1: Ghost Node with Invalid Merkle Root
///
/// # Scenario
/// 1. Create a node that broadcasts events with impossible Merkle chain
/// 2. Trust mesh stream processor detects the mathematical impossibility
/// 3. Stream is marked as compromised
/// 4. Node's trust score is quarantined
/// 5. C2 Router rejects subsequent commands from the compromised node
#[tokio::test]
async fn test_ghost_node_invalid_merkle_root() {
    use aethercore_stream::processor::{MerkleEnforcer, StreamEvent, StreamProcessor};
    use test_utils::*;

    const GHOST_NODE_ID: &str = "ghost-node-001";

    // Phase 1: Setup stream processor to detect Merkle violations
    let mut enforcer = MerkleEnforcer::new();

    // Add valid first event
    let event1 = CanonicalEvent {
        event_type: "test.event".to_string(),
        timestamp: current_timestamp_ms(),
        source_id: GHOST_NODE_ID.to_string(),
        sequence: 0,
        payload: HashMap::new(),
    };

    let stream_event1 = StreamEvent::new(event1.clone(), GHOST_NODE_ID.to_string(), GENESIS_HASH);
    let _hash1 = enforcer.process_event(stream_event1).unwrap();

    // Phase 2: Ghost node attempts Byzantine attack - broadcasts impossible hash
    let event2 = CanonicalEvent {
        event_type: "test.event".to_string(),
        timestamp: current_timestamp_ms() + 1000,
        source_id: GHOST_NODE_ID.to_string(),
        sequence: 1,
        payload: HashMap::new(),
    };

    // Use WRONG previous hash (impossible - Byzantine behavior)
    let impossible_hash = [0xFF; 32];
    let stream_event2 = StreamEvent::new(event2, GHOST_NODE_ID.to_string(), impossible_hash);

    // Phase 3: Verify stream processor detects the violation
    let result = enforcer.process_event(stream_event2);
    assert!(
        result.is_err(),
        "Impossible Merkle root should be rejected"
    );
    assert!(
        enforcer.is_stream_compromised(GHOST_NODE_ID),
        "Stream should be marked as compromised"
    );

    println!("✓ Ghost Node Merkle Violation DETECTED");
    println!("  - Invalid chain continuity detected");
    println!("  - Stream marked as compromised");

    // Phase 4: Setup C2 server with ghost node quarantined
    let server = setup_server_with_nodes(&[(GHOST_NODE_ID, -0.7)]); // Score = 0.3 (Quarantined)

    // Phase 5: Attempt command execution - should be blocked
    let command = create_navigate_command();
    let request = create_command_request(GHOST_NODE_ID, &command);

    let result = server.execute_unit_command(request).await;

    // Verify rejection
    assert!(
        result.is_err(),
        "Quarantined node command should be rejected"
    );
    let err = result.unwrap_err();
    assert_eq!(err.code(), tonic::Code::PermissionDenied);
    assert!(
        err.message().contains("Quarantined") || err.message().contains("COMMAND REJECTED"),
        "Error message should indicate quarantine: {}",
        err.message()
    );

    println!("✓ Ghost Node Command BLOCKED");
    println!("  - C2 Router rejected command from quarantined node");
    println!("  - Error: {}", err.message());
}

/// Test 2: Quarantined Node Command Rejection
///
/// # Scenario
/// 1. Node starts with healthy trust score
/// 2. Command executes successfully
/// 3. Trust score drops below quarantine threshold
/// 4. Subsequent commands are blocked with detailed error messages
#[tokio::test]
async fn test_quarantined_node_command_rejection() {
    use test_utils::*;

    const NODE_ID: &str = "test-node-quarantine";

    // Phase 1: Setup with healthy trust score
    let server_healthy = setup_server_with_nodes(&[(NODE_ID, 0.0)]); // Score = 1.0 (Healthy)

    let command = create_navigate_command();
    let request1 = create_command_request(NODE_ID, &command);

    // Verify command succeeds with healthy trust
    let result1 = server_healthy.execute_unit_command(request1).await;
    assert!(
        result1.is_ok(),
        "Command should succeed with healthy trust score"
    );

    println!("✓ Initial Command SUCCEEDED (Healthy Trust)");

    // Phase 2: Trust score drops to quarantine level
    let server_quarantined = setup_server_with_nodes(&[(NODE_ID, -0.7)]); // Score = 0.3 (Quarantined)

    let request2 = create_command_request(NODE_ID, &command);
    let result2 = server_quarantined.execute_unit_command(request2).await;

    // Verify rejection with detailed error
    assert!(
        result2.is_err(),
        "Command should be rejected when quarantined"
    );
    let err = result2.unwrap_err();
    assert_eq!(err.code(), tonic::Code::PermissionDenied);

    let error_message = err.message();
    assert!(
        error_message.contains("Quarantined") || error_message.contains("COMMAND REJECTED"),
        "Error should indicate quarantine"
    );
    assert!(
        error_message.contains(NODE_ID),
        "Error should include node ID"
    );

    println!("✓ Quarantined Node Command BLOCKED");
    println!("  - Trust score: 0.3 (Below 0.6 threshold)");
    println!("  - Error: {}", error_message);
    println!("  - Includes node ID and detailed reason");
}

/// Test 3: Zero Trust Default
///
/// # Scenario
/// 1. Unknown node (not registered) attempts to execute command
/// 2. System applies zero trust default
/// 3. Command is rejected at identity check
#[tokio::test]
async fn test_zero_trust_default() {
    use test_utils::*;

    const UNKNOWN_NODE_ID: &str = "unknown-adversary";

    // Setup server WITHOUT registering the unknown node
    let server = setup_server_with_nodes(&[]); // Empty - no nodes registered

    let command = create_navigate_command();
    let request = create_command_request(UNKNOWN_NODE_ID, &command);

    let result = server.execute_unit_command(request).await;

    // Verify rejection at identity check (before trust check)
    assert!(result.is_err(), "Unknown node should be rejected");
    let err = result.unwrap_err();
    assert_eq!(err.code(), tonic::Code::Unauthenticated);
    assert!(err.message().contains("Unknown device"));

    println!("✓ Zero Trust Default APPLIED");
    println!("  - Unknown node rejected at identity check");
    println!("  - Error: {}", err.message());
}

/// Test 4: Multiple Byzantine Nodes with Legitimate Nodes
///
/// # Scenario
/// 1. Setup network with multiple nodes (Byzantine + Legitimate)
/// 2. Byzantine nodes have low trust scores
/// 3. Legitimate node has healthy trust
/// 4. Verify Byzantine nodes are blocked while legitimate operates normally
#[tokio::test]
async fn test_multiple_byzantine_nodes() {
    use test_utils::*;

    const GHOST_NODE: &str = "ghost-byzantine-001";
    const REPLAY_NODE: &str = "replay-byzantine-001";
    const LEGITIMATE_NODE: &str = "legitimate-node-001";

    // Setup server with mixed trust scores
    let server = setup_server_with_nodes(&[
        (GHOST_NODE, -0.7),        // Score = 0.3 (Quarantined)
        (REPLAY_NODE, -0.5),       // Score = 0.5 (Quarantined)
        (LEGITIMATE_NODE, 0.0),    // Score = 1.0 (Healthy)
    ]);

    let command = create_navigate_command();

    // Test Byzantine node 1: Should be blocked
    let request1 = create_command_request(GHOST_NODE, &command);
    let result1 = server.execute_unit_command(request1).await;
    assert!(result1.is_err(), "Ghost node should be blocked");

    // Test Byzantine node 2: Should be blocked
    let request2 = create_command_request(REPLAY_NODE, &command);
    let result2 = server.execute_unit_command(request2).await;
    assert!(result2.is_err(), "Replay node should be blocked");

    // Test Legitimate node: Should succeed
    let request3 = create_command_request(LEGITIMATE_NODE, &command);
    let result3 = server.execute_unit_command(request3).await;
    assert!(result3.is_ok(), "Legitimate node should succeed");

    println!("✓ Multiple Byzantine Nodes Test PASSED");
    println!("  - Ghost node (score 0.3): BLOCKED");
    println!("  - Replay node (score 0.5): BLOCKED");
    println!("  - Legitimate node (score 1.0): ALLOWED");
    println!("  - Byzantine nodes isolated, legitimate operations continue");
}

/// Test 5: Trust Score Boundary Conditions
///
/// # Scenario
/// 1. Test nodes at exact threshold boundaries
/// 2. Verify precise enforcement of trust thresholds
#[tokio::test]
async fn test_trust_score_boundaries() {
    use test_utils::*;

    // Quarantine threshold is 0.6
    // Healthy threshold is 0.9
    // Operational threshold (TRUST_THRESHOLD) is 0.8

    let command = create_navigate_command();

    // Test 1: Just below quarantine (0.59) - Should be BLOCKED
    let server1 = setup_server_with_nodes(&[("node-below-quarantine", -0.41)]);
    let result1 = server1
        .execute_unit_command(create_command_request("node-below-quarantine", &command))
        .await;
    assert!(
        result1.is_err(),
        "Node below quarantine threshold should be blocked"
    );

    // Test 2: Just at quarantine (0.6) - Should be BLOCKED (operational threshold is 0.8)
    let server2 = setup_server_with_nodes(&[("node-at-quarantine", -0.4)]);
    let result2 = server2
        .execute_unit_command(create_command_request("node-at-quarantine", &command))
        .await;
    assert!(
        result2.is_err(),
        "Node at quarantine threshold should be blocked (below operational)"
    );

    // Test 3: Below operational threshold (0.7) - Should be BLOCKED
    let server3 = setup_server_with_nodes(&[("node-below-operational", -0.3)]);
    let result3 = server3
        .execute_unit_command(create_command_request("node-below-operational", &command))
        .await;
    assert!(
        result3.is_err(),
        "Node below operational threshold should be blocked"
    );

    // Test 4: Just above operational (0.85) - Should SUCCEED
    let server4 = setup_server_with_nodes(&[("node-above-operational", -0.15)]);
    let result4 = server4
        .execute_unit_command(create_command_request("node-above-operational", &command))
        .await;
    assert!(
        result4.is_ok(),
        "Node above operational threshold should succeed"
    );

    // Test 5: Healthy (0.95) - Should SUCCEED
    let server5 = setup_server_with_nodes(&[("node-healthy", -0.05)]);
    let result5 = server5
        .execute_unit_command(create_command_request("node-healthy", &command))
        .await;
    assert!(result5.is_ok(), "Healthy node should succeed");

    println!("✓ Trust Score Boundary Test PASSED");
    println!("  - Score 0.59: BLOCKED (Quarantined)");
    println!("  - Score 0.60: BLOCKED (Below operational)");
    println!("  - Score 0.70: BLOCKED (Below operational)");
    println!("  - Score 0.85: ALLOWED");
    println!("  - Score 0.95: ALLOWED (Healthy)");
}

/// Test 6: Stream Integrity with Chain Validation
///
/// # Scenario
/// 1. Valid chain of events is processed successfully
/// 2. Invalid chain link triggers compromise detection
/// 3. Verifies Merkle-Vine enforcement works correctly
#[tokio::test]
async fn test_stream_integrity_chain_validation() {
    use aethercore_stream::processor::{MerkleEnforcer, StreamEvent, StreamProcessor};
    use test_utils::*;

    const STREAM_ID: &str = "integrity-test-stream";
    let mut enforcer = MerkleEnforcer::new();

    // Build valid chain
    let event1 = CanonicalEvent {
        event_type: "telemetry.update".to_string(),
        timestamp: current_timestamp_ms(),
        source_id: STREAM_ID.to_string(),
        sequence: 0,
        payload: HashMap::new(),
    };

    let stream_event1 = StreamEvent::new(event1.clone(), STREAM_ID.to_string(), GENESIS_HASH);
    let hash1 = enforcer.process_event(stream_event1).unwrap();

    // Second event with correct previous hash
    let event2 = CanonicalEvent {
        event_type: "telemetry.update".to_string(),
        timestamp: current_timestamp_ms() + 100,
        source_id: STREAM_ID.to_string(),
        sequence: 1,
        payload: HashMap::new(),
    };

    let stream_event2 = StreamEvent::new(event2, STREAM_ID.to_string(), hash1);
    let _hash2 = enforcer.process_event(stream_event2).unwrap();

    // Verify valid chain is not compromised
    assert!(!enforcer.is_stream_compromised(STREAM_ID));

    // Third event with INCORRECT previous hash (Byzantine behavior)
    let event3 = CanonicalEvent {
        event_type: "telemetry.update".to_string(),
        timestamp: current_timestamp_ms() + 200,
        source_id: STREAM_ID.to_string(),
        sequence: 2,
        payload: HashMap::new(),
    };

    let wrong_hash = [0xAB; 32]; // Incorrect hash
    let stream_event3 = StreamEvent::new(event3, STREAM_ID.to_string(), wrong_hash);
    let result3 = enforcer.process_event(stream_event3);

    // Verify Byzantine behavior is detected
    assert!(result3.is_err(), "Invalid chain link should be detected");
    assert!(
        enforcer.is_stream_compromised(STREAM_ID),
        "Stream should be marked compromised"
    );

    let status = enforcer.get_integrity_status(STREAM_ID).unwrap();
    assert_eq!(status.valid_events, 2);
    assert_eq!(status.broken_events, 1);

    println!("✓ Stream Integrity Chain Validation PASSED");
    println!("  - Valid chain: 2 events processed");
    println!("  - Invalid link detected on event 3");
    println!("  - Stream marked as compromised");
    println!("  - Merkle-Vine enforcement working correctly");
}

/// Test 7: Spoofed Signature Rejection
///
/// # Scenario
/// 1. Generate a valid data packet
/// 2. Sign it with a random Ed25519 key (NOT the enrolled TPM key)
/// 3. Inject into gateway service
/// 4. Assert that the system returns 401 Unauthorized or drops the packet
///
/// This test validates that the system strictly enforces signature verification
/// and rejects packets signed with unauthorized keys.
#[tokio::test]
async fn test_spoofed_signature_rejection() {
    use ed25519_dalek::{SigningKey, Signer};
    use rand::rngs::OsRng;
    use test_utils::*;

    const DEVICE_ID: &str = "legitimate-device-001";
    const SPOOFED_DEVICE: &str = "spoofed-attacker-001";

    // Phase 1: Create legitimate device with enrolled key
    let server = setup_server_with_nodes(&[(DEVICE_ID, 0.0)]); // Healthy trust

    // Phase 2: Generate RANDOM Ed25519 key (attacker's key, NOT enrolled)
    let spoofed_key = SigningKey::generate(&mut OsRng);
    
    // Phase 3: Create valid command data
    let command = create_navigate_command();
    let command_json = serde_json::to_string(&command).unwrap();
    let timestamp_ns = current_timestamp_ns();
    
    // Phase 4: Sign with spoofed key
    let message = format!("{}:{}:{}", DEVICE_ID, command_json, timestamp_ns);
    let spoofed_signature = spoofed_key.sign(message.as_bytes());
    let spoofed_sig_b64 = base64::encode(spoofed_signature.to_bytes());

    // Phase 5: Create request with spoofed signature
    let mut request = Request::new(UnitCommandRequest {
        unit_id: "unit-1".to_string(),
        command_json,
        signatures: vec![spoofed_sig_b64.clone()],
        timestamp_ns,
    });

    request
        .metadata_mut()
        .insert("x-device-id", MetadataValue::from_str(DEVICE_ID).unwrap());
    request
        .metadata_mut()
        .insert("x-signature", MetadataValue::from_str(&spoofed_sig_b64).unwrap());

    // Phase 6: Attempt command execution with spoofed signature
    let result = server.execute_unit_command(request).await;

    // Phase 7: Verify rejection
    assert!(
        result.is_err(),
        "Command with spoofed signature MUST be rejected"
    );
    
    let err = result.unwrap_err();
    
    // Should be Unauthenticated (401) or PermissionDenied (403)
    assert!(
        err.code() == tonic::Code::Unauthenticated || err.code() == tonic::Code::PermissionDenied,
        "Expected Unauthenticated or PermissionDenied, got: {:?}",
        err.code()
    );
    
    assert!(
        err.message().contains("signature") || 
        err.message().contains("verification") ||
        err.message().contains("unauthorized"),
        "Error message should indicate signature failure: {}",
        err.message()
    );

    println!("✓ Spoofed Signature REJECTED");
    println!("  - Random Ed25519 key generated by attacker");
    println!("  - Valid packet structure, invalid signature");
    println!("  - System rejected with: {}", err.message());
    println!("  - Error code: {:?}", err.code());
    println!("  - Hardware-rooted trust enforced successfully");
}

/// Test 8: Replay Attack with Sequence ID
///
/// # Scenario  
/// 1. Send a valid event with sequence ID 1
/// 2. Send the SAME event again (replay attack)
/// 3. Verify the system detects and rejects the replay
#[tokio::test]
async fn test_replay_attack_sequence_rejection() {
    use aethercore_stream::integrity::StreamIntegrityTracker;
    use test_utils::*;

    const STREAM_ID: &str = "replay-test-stream";
    
    let mut tracker = StreamIntegrityTracker::new();

    // Phase 1: Send valid event with sequence 1
    let result1 = tracker.validate_sequence(STREAM_ID, 1);
    assert!(result1.is_ok(), "First event should be accepted");

    // Phase 2: Send valid event with sequence 2
    let result2 = tracker.validate_sequence(STREAM_ID, 2);
    assert!(result2.is_ok(), "Second event should be accepted");

    // Phase 3: Replay attack - try to replay sequence 1
    let result_replay = tracker.validate_sequence(STREAM_ID, 1);
    assert!(
        result_replay.is_err(),
        "Replay attack MUST be rejected"
    );
    assert!(
        result_replay.unwrap_err().contains("Replay attack"),
        "Error should indicate replay attack"
    );

    // Phase 4: Replay attack - try to replay sequence 2
    let result_replay2 = tracker.validate_sequence(STREAM_ID, 2);
    assert!(
        result_replay2.is_err(),
        "Replay of sequence 2 MUST be rejected"
    );

    // Phase 5: Valid continuation should still work
    let result3 = tracker.validate_sequence(STREAM_ID, 3);
    assert!(result3.is_ok(), "Valid next sequence should work");

    println!("✓ Replay Attack Detection PASSED");
    println!("  - Sequence 1: ACCEPTED");
    println!("  - Sequence 2: ACCEPTED");
    println!("  - Replay of sequence 1: REJECTED");
    println!("  - Replay of sequence 2: REJECTED");
    println!("  - Sequence 3: ACCEPTED");
    println!("  - Replay protection enforced via sequence ID validation");
}
