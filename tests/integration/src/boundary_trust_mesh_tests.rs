//! Trust mesh integration tests
//!
//! Tests trust scoring behavior at the gRPC boundary

use crate::test_utils::*;
use aethercore_c2_router::grpc::c2_proto::c2_router_client::C2RouterClient;
use aethercore_c2_router::grpc::c2_proto::UnitCommandRequest;
use aethercore_identity::IdentityManager;
use aethercore_trust_mesh::TrustLevel;
use std::sync::{Arc, RwLock};
use tonic::metadata::MetadataValue;
use tonic::Request;

#[tokio::test]
async fn test_no_trust_score_defaults_to_deny() {
    // Setup: Register device but DON'T set a trust score
    let device = TestDevice::new();
    let mut identity_manager = IdentityManager::new();
    device.register(&mut identity_manager);

    // Create empty trust scorer (no scores set)
    let trust_scorer = create_test_trust_scorer();

    let identity_mgr = Arc::new(RwLock::new(identity_manager));
    let trust_mgr = Arc::new(RwLock::new(trust_scorer));

    let server_url = start_c2_server(identity_mgr, trust_mgr).await;

    let mut client = C2RouterClient::connect(server_url)
        .await
        .expect("Failed to connect to C2 server");

    let command_json = serde_json::json!({"Navigate": {}}).to_string();
    let command_hash = blake3::hash(command_json.as_bytes());
    let signature = device.sign(command_hash.as_bytes());
    let signature_b64 = base64::encode(&signature);

    let mut request = Request::new(UnitCommandRequest {
        unit_id: "unit-001".to_string(),
        command_json,
        signatures: vec![hex::encode(&signature)],
        timestamp_ns: current_timestamp_ns(),
    });

    request
        .metadata_mut()
        .insert("x-device-id", MetadataValue::from_str(&device.node_id).unwrap());
    request
        .metadata_mut()
        .insert("x-signature", MetadataValue::from_str(&signature_b64).unwrap());

    let response = client.execute_unit_command(request).await;

    // Assert: Zero Trust - no score means deny by default
    assert!(
        response.is_err(),
        "Device without trust score should be denied (Zero Trust)"
    );

    let error = response.unwrap_err();
    assert_eq!(error.code(), tonic::Code::PermissionDenied);
    assert!(
        error.message().contains("No trust score") || error.message().contains("Zero Trust"),
        "Error should mention missing trust score: {}",
        error.message()
    );
}

#[tokio::test]
async fn test_healthy_node_at_threshold_boundary() {
    // Test the exact threshold boundary (0.8)
    let device = TestDevice::new();
    let mut identity_manager = IdentityManager::new();
    device.register(&mut identity_manager);

    let mut trust_scorer = create_test_trust_scorer();
    // Set score exactly at threshold
    set_node_trust(&mut trust_scorer, &device.node_id, 0.8, TrustLevel::Healthy);

    let identity_mgr = Arc::new(RwLock::new(identity_manager));
    let trust_mgr = Arc::new(RwLock::new(trust_scorer));

    let server_url = start_c2_server(identity_mgr, trust_mgr).await;

    let mut client = C2RouterClient::connect(server_url)
        .await
        .expect("Failed to connect to C2 server");

    let command_json = serde_json::json!({"Navigate": {}}).to_string();
    let command_hash = blake3::hash(command_json.as_bytes());
    let signature = device.sign(command_hash.as_bytes());
    let signature_b64 = base64::encode(&signature);

    let mut request = Request::new(UnitCommandRequest {
        unit_id: "unit-001".to_string(),
        command_json,
        signatures: vec![hex::encode(&signature)],
        timestamp_ns: current_timestamp_ns(),
    });

    request
        .metadata_mut()
        .insert("x-device-id", MetadataValue::from_str(&device.node_id).unwrap());
    request
        .metadata_mut()
        .insert("x-signature", MetadataValue::from_str(&signature_b64).unwrap());

    let response = client.execute_unit_command(request).await;

    // Assert: Score at threshold (0.8) should be accepted
    assert!(
        response.is_ok(),
        "Node at exact threshold should be accepted: {:?}",
        response.err()
    );
}

#[tokio::test]
async fn test_just_below_threshold_rejected() {
    // Test slightly below threshold (0.79)
    let device = TestDevice::new();
    let mut identity_manager = IdentityManager::new();
    device.register(&mut identity_manager);

    let mut trust_scorer = create_test_trust_scorer();
    // Set score just below threshold
    set_node_trust(&mut trust_scorer, &device.node_id, 0.79, TrustLevel::Suspect);

    let identity_mgr = Arc::new(RwLock::new(identity_manager));
    let trust_mgr = Arc::new(RwLock::new(trust_scorer));

    let server_url = start_c2_server(identity_mgr, trust_mgr).await;

    let mut client = C2RouterClient::connect(server_url)
        .await
        .expect("Failed to connect to C2 server");

    let command_json = serde_json::json!({"Navigate": {}}).to_string();
    let command_hash = blake3::hash(command_json.as_bytes());
    let signature = device.sign(command_hash.as_bytes());
    let signature_b64 = base64::encode(&signature);

    let mut request = Request::new(UnitCommandRequest {
        unit_id: "unit-001".to_string(),
        command_json,
        signatures: vec![hex::encode(&signature)],
        timestamp_ns: current_timestamp_ns(),
    });

    request
        .metadata_mut()
        .insert("x-device-id", MetadataValue::from_str(&device.node_id).unwrap());
    request
        .metadata_mut()
        .insert("x-signature", MetadataValue::from_str(&signature_b64).unwrap());

    let response = client.execute_unit_command(request).await;

    // Assert: Score just below threshold should be rejected
    assert!(
        response.is_err(),
        "Node just below threshold (0.79) should be rejected"
    );

    let error = response.unwrap_err();
    assert_eq!(error.code(), tonic::Code::PermissionDenied);
}

#[tokio::test]
async fn test_trust_level_overrides_score() {
    // Test that Quarantined level overrides even high score
    // (Shouldn't happen in practice, but validates priority)
    let device = TestDevice::new();
    let mut identity_manager = IdentityManager::new();
    device.register(&mut identity_manager);

    let mut trust_scorer = create_test_trust_scorer();
    // Set HIGH score but QUARANTINED level (conflict scenario)
    set_node_trust(&mut trust_scorer, &device.node_id, 0.95, TrustLevel::Quarantined);

    let identity_mgr = Arc::new(RwLock::new(identity_manager));
    let trust_mgr = Arc::new(RwLock::new(trust_scorer));

    let server_url = start_c2_server(identity_mgr, trust_mgr).await;

    let mut client = C2RouterClient::connect(server_url)
        .await
        .expect("Failed to connect to C2 server");

    let command_json = serde_json::json!({"Navigate": {}}).to_string();
    let command_hash = blake3::hash(command_json.as_bytes());
    let signature = device.sign(command_hash.as_bytes());
    let signature_b64 = base64::encode(&signature);

    let mut request = Request::new(UnitCommandRequest {
        unit_id: "unit-001".to_string(),
        command_json,
        signatures: vec![hex::encode(&signature)],
        timestamp_ns: current_timestamp_ns(),
    });

    request
        .metadata_mut()
        .insert("x-device-id", MetadataValue::from_str(&device.node_id).unwrap());
    request
        .metadata_mut()
        .insert("x-signature", MetadataValue::from_str(&signature_b64).unwrap());

    let response = client.execute_unit_command(request).await;

    // Assert: Quarantined level should override high score
    assert!(
        response.is_err(),
        "Quarantined level should reject even with high score"
    );

    let error = response.unwrap_err();
    assert_eq!(error.code(), tonic::Code::PermissionDenied);
    assert!(
        error.message().contains("Quarantined"),
        "Error should mention quarantine: {}",
        error.message()
    );
}
