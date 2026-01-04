//! Integration tests for gRPC boundary between TypeScript and Rust
//!
//! Tests the C2 Router gRPC service with focus on:
//! - TPM-signed payload acceptance
//! - Signature validation and rejection
//! - Trust score gating
//! - Audit event generation
//! - Descriptive error messages for TS clients

use crate::test_utils::*;
use aethercore_c2_router::grpc::c2_proto::c2_router_client::C2RouterClient;
use aethercore_c2_router::grpc::c2_proto::UnitCommandRequest;
use aethercore_identity::IdentityManager;
use aethercore_trust_mesh::{TrustLevel, TrustScorer};
use std::sync::{Arc, RwLock};
use tonic::metadata::MetadataValue;
use tonic::Request;

#[tokio::test]
async fn test_valid_tpm_signed_payload_accepted() {
    // Setup: Create test device and register it
    let device = TestDevice::new();
    let mut identity_manager = IdentityManager::new();
    device.register(&mut identity_manager);

    // Setup trust scorer with healthy trust level
    let mut trust_scorer = create_test_trust_scorer();
    set_node_trust(&mut trust_scorer, &device.node_id, 0.95, TrustLevel::Healthy);

    let identity_mgr = Arc::new(RwLock::new(identity_manager));
    let trust_mgr = Arc::new(RwLock::new(trust_scorer));

    // Start C2 server
    let server_url = start_c2_server(identity_mgr, trust_mgr).await;

    // Create gRPC client
    let mut client = C2RouterClient::connect(server_url)
        .await
        .expect("Failed to connect to C2 server");

    // Create a valid command
    let command_json = serde_json::json!({
        "Navigate": {
            "waypoint": {"lat": 45.0, "lon": -122.0, "alt": 100.0},
            "speed": 10.0,
            "altitude": 100.0
        }
    })
    .to_string();

    // Sign the command
    let command_hash = blake3::hash(command_json.as_bytes());
    let signature = device.sign(command_hash.as_bytes());
    let signature_b64 = base64::encode(&signature);

    // Create request with metadata
    let mut request = Request::new(UnitCommandRequest {
        unit_id: "unit-001".to_string(),
        command_json: command_json.clone(),
        signatures: vec![hex::encode(&signature)],
        timestamp_ns: current_timestamp_ns(),
    });

    // Add authentication metadata
    request
        .metadata_mut()
        .insert("x-device-id", MetadataValue::from_str(&device.node_id).unwrap());
    request
        .metadata_mut()
        .insert("x-signature", MetadataValue::from_str(&signature_b64).unwrap());

    // Execute command
    let response = client.execute_unit_command(request).await;

    // Assert: Command should be accepted
    assert!(
        response.is_ok(),
        "Valid TPM-signed command should be accepted"
    );

    let response = response.unwrap().into_inner();
    assert!(response.success, "Command dispatch should succeed");
}

#[tokio::test]
async fn test_malformed_signature_rejected_with_descriptive_error() {
    // Setup
    let device = TestDevice::new();
    let mut identity_manager = IdentityManager::new();
    device.register(&mut identity_manager);

    let mut trust_scorer = create_test_trust_scorer();
    set_node_trust(&mut trust_scorer, &device.node_id, 0.95, TrustLevel::Healthy);

    let identity_mgr = Arc::new(RwLock::new(identity_manager));
    let trust_mgr = Arc::new(RwLock::new(trust_scorer));

    let server_url = start_c2_server(identity_mgr, trust_mgr).await;

    let mut client = C2RouterClient::connect(server_url)
        .await
        .expect("Failed to connect to C2 server");

    let command_json = serde_json::json!({
        "Navigate": {
            "waypoint": {"lat": 45.0, "lon": -122.0, "alt": 100.0},
            "speed": 10.0,
            "altitude": 100.0
        }
    })
    .to_string();

    // Create request with malformed signature (empty)
    let mut request = Request::new(UnitCommandRequest {
        unit_id: "unit-001".to_string(),
        command_json,
        signatures: vec!["malformed_signature".to_string()],
        timestamp_ns: current_timestamp_ns(),
    });

    request
        .metadata_mut()
        .insert("x-device-id", MetadataValue::from_str(&device.node_id).unwrap());
    request
        .metadata_mut()
        .insert("x-signature", MetadataValue::from_str("").unwrap()); // Empty signature

    // Execute command
    let response = client.execute_unit_command(request).await;

    // Assert: Should fail with descriptive error
    assert!(response.is_err(), "Malformed signature should be rejected");

    let error = response.unwrap_err();
    assert_eq!(error.code(), tonic::Code::Unauthenticated);
    assert!(
        error.message().contains("signature") || error.message().contains("Empty"),
        "Error message should mention signature issue: {}",
        error.message()
    );
}

#[tokio::test]
async fn test_missing_device_id_rejected() {
    // Setup minimal infrastructure
    let identity_mgr = Arc::new(RwLock::new(IdentityManager::new()));
    let trust_mgr = Arc::new(RwLock::new(create_test_trust_scorer()));

    let server_url = start_c2_server(identity_mgr, trust_mgr).await;

    let mut client = C2RouterClient::connect(server_url)
        .await
        .expect("Failed to connect to C2 server");

    let command_json = serde_json::json!({"Navigate": {}}).to_string();

    // Create request WITHOUT x-device-id metadata
    let request = Request::new(UnitCommandRequest {
        unit_id: "unit-001".to_string(),
        command_json,
        signatures: vec!["dummy_sig".to_string()],
        timestamp_ns: current_timestamp_ns(),
    });

    // Execute command
    let response = client.execute_unit_command(request).await;

    // Assert: Should fail with missing device-id error
    assert!(
        response.is_err(),
        "Request without device ID should be rejected"
    );

    let error = response.unwrap_err();
    assert_eq!(error.code(), tonic::Code::Unauthenticated);
    assert!(
        error.message().contains("device-id") || error.message().contains("x-device-id"),
        "Error should mention missing device-id: {}",
        error.message()
    );
}

#[tokio::test]
async fn test_quarantined_node_rejected_with_trust_level() {
    // Setup: Create device and quarantine it
    let device = TestDevice::new();
    let mut identity_manager = IdentityManager::new();
    device.register(&mut identity_manager);

    // Set trust level to Quarantined
    let mut trust_scorer = create_test_trust_scorer();
    set_node_trust(
        &mut trust_scorer,
        &device.node_id,
        0.3,
        TrustLevel::Quarantined,
    );

    let identity_mgr = Arc::new(RwLock::new(identity_manager));
    let trust_mgr = Arc::new(RwLock::new(trust_scorer));

    let server_url = start_c2_server(identity_mgr, trust_mgr).await;

    let mut client = C2RouterClient::connect(server_url)
        .await
        .expect("Failed to connect to C2 server");

    let command_json = serde_json::json!({
        "Navigate": {
            "waypoint": {"lat": 45.0, "lon": -122.0, "alt": 100.0}
        }
    })
    .to_string();

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

    // Execute command
    let response = client.execute_unit_command(request).await;

    // Assert: Should fail with PermissionDenied and mention Quarantined
    assert!(
        response.is_err(),
        "Quarantined node should be rejected"
    );

    let error = response.unwrap_err();
    assert_eq!(
        error.code(),
        tonic::Code::PermissionDenied,
        "Should return PermissionDenied for quarantined nodes"
    );
    assert!(
        error.message().contains("Quarantined") || error.message().contains("quarantine"),
        "Error should mention quarantine status: {}",
        error.message()
    );
}

#[tokio::test]
async fn test_suspect_node_below_threshold_rejected() {
    // Setup: Create device with low trust score (below threshold of 0.8)
    let device = TestDevice::new();
    let mut identity_manager = IdentityManager::new();
    device.register(&mut identity_manager);

    // Set trust level to Suspect (0.7 < 0.8 threshold)
    let mut trust_scorer = create_test_trust_scorer();
    set_node_trust(&mut trust_scorer, &device.node_id, 0.7, TrustLevel::Suspect);

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

    // Execute command
    let response = client.execute_unit_command(request).await;

    // Assert: Should fail with trust score below threshold
    assert!(
        response.is_err(),
        "Node with trust score below threshold should be rejected"
    );

    let error = response.unwrap_err();
    assert_eq!(error.code(), tonic::Code::PermissionDenied);
    assert!(
        error.message().contains("Trust Score") || error.message().contains("Threshold"),
        "Error should mention trust score issue: {}",
        error.message()
    );
}

#[tokio::test]
async fn test_unregistered_device_rejected() {
    // Setup: Create device but DON'T register it
    let device = TestDevice::new();
    let identity_manager = IdentityManager::new(); // Empty registry

    let identity_mgr = Arc::new(RwLock::new(identity_manager));
    let trust_mgr = Arc::new(RwLock::new(create_test_trust_scorer()));

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

    // Execute command
    let response = client.execute_unit_command(request).await;

    // Assert: Should fail with unknown device error
    assert!(response.is_err(), "Unregistered device should be rejected");

    let error = response.unwrap_err();
    assert_eq!(error.code(), tonic::Code::Unauthenticated);
    assert!(
        error.message().contains("Unknown") || error.message().contains("device"),
        "Error should mention unknown device: {}",
        error.message()
    );
}
