//! Integration tests for the Identity Registry gRPC Server
//!
//! Tests cover:
//! - Node registration with TPM attestation
//! - TPM validation failures
//! - Node enrollment checks
//! - Signature verification
//! - Node revocation with authority signatures

#[cfg(feature = "grpc-server")]
mod grpc_tests {
    use aethercore_identity::grpc_server::proto::identity_registry_client::IdentityRegistryClient;
    use aethercore_identity::grpc_server::proto::*;
    use aethercore_identity::grpc_server::IdentityRegistryService;
    use aethercore_identity::{Attestation, IdentityManager, PlatformIdentity, TpmManager};
    use std::collections::HashMap;
    use std::sync::{Arc, Mutex};
    use std::time::{SystemTime, UNIX_EPOCH};
    use tokio::time::Duration;
    use tonic::transport::Server;

    fn current_timestamp_ms() -> u64 {
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_millis() as u64
    }

    async fn start_test_server(
        identity_manager: Arc<Mutex<IdentityManager>>,
        tpm_manager: Arc<Mutex<TpmManager>>,
    ) -> String {
        let addr: std::net::SocketAddr = "127.0.0.1:0".parse().unwrap();
        let listener = tokio::net::TcpListener::bind(addr).await.unwrap();
        let local_addr = listener.local_addr().unwrap();
        let server_url = format!("http://{}", local_addr);

        let service = IdentityRegistryService::new(identity_manager, tpm_manager);
        let identity_registry_server =
            aethercore_identity::grpc_server::proto::identity_registry_server::IdentityRegistryServer::new(
                service,
            );

        tokio::spawn(async move {
            Server::builder()
                .add_service(identity_registry_server)
                .serve_with_incoming(tokio_stream::wrappers::TcpListenerStream::new(listener))
                .await
                .unwrap();
        });

        // Wait for server to start
        tokio::time::sleep(Duration::from_millis(100)).await;

        server_url
    }

    #[tokio::test]
    async fn test_register_node_with_tpm_attestation() {
        let identity_manager = Arc::new(Mutex::new(IdentityManager::new()));
        let tpm_manager = Arc::new(Mutex::new(TpmManager::new(false))); // Use stub TPM

        let server_url = start_test_server(identity_manager.clone(), tpm_manager.clone()).await;

        let mut client = IdentityRegistryClient::connect(server_url)
            .await
            .expect("Failed to connect to server");

        // Generate a test identity with Ed25519 key
        let public_key = vec![1u8; 32]; // 32-byte public key
        let node_id = hex::encode(blake3::hash(&public_key).as_bytes());

        // Generate TPM quote (stub)
        let tpm_quote = vec![0xAA; 64]; // Stub TPM signature
        let pcrs = vec![0xFF; 32]; // Stub PCR values
        let ak_cert = vec![0xBB; 64]; // Stub AK certificate

        let request = tonic::Request::new(RegisterNodeRequest {
            node_id: node_id.clone(),
            public_key_hex: hex::encode(&public_key),
            tpm_quote,
            pcrs,
            ak_cert,
            timestamp_ms: current_timestamp_ms(),
        });

        let response = client.register_node(request).await.unwrap().into_inner();

        assert!(
            response.success,
            "Registration should succeed: {}",
            response.error_message
        );
    }

    #[tokio::test]
    async fn test_register_node_without_tpm_quote_fails() {
        let identity_manager = Arc::new(Mutex::new(IdentityManager::new()));
        let tpm_manager = Arc::new(Mutex::new(TpmManager::new(false)));

        let server_url = start_test_server(identity_manager.clone(), tpm_manager.clone()).await;

        let mut client = IdentityRegistryClient::connect(server_url)
            .await
            .expect("Failed to connect to server");

        let public_key = vec![1u8; 32];
        let node_id = hex::encode(blake3::hash(&public_key).as_bytes());

        let request = tonic::Request::new(RegisterNodeRequest {
            node_id,
            public_key_hex: hex::encode(&public_key),
            tpm_quote: vec![], // NO TPM QUOTE
            pcrs: vec![0xFF; 32],
            ak_cert: vec![0xBB; 64],
            timestamp_ms: current_timestamp_ms(),
        });

        let response = client.register_node(request).await;

        // Should get PermissionDenied status
        assert!(response.is_err());
        let err = response.unwrap_err();
        assert_eq!(err.code(), tonic::Code::PermissionDenied);
        assert!(err.message().contains("TPM attestation required"));
    }

    #[tokio::test]
    async fn test_register_node_invalid_node_id_fails() {
        let identity_manager = Arc::new(Mutex::new(IdentityManager::new()));
        let tpm_manager = Arc::new(Mutex::new(TpmManager::new(false)));

        let server_url = start_test_server(identity_manager.clone(), tpm_manager.clone()).await;

        let mut client = IdentityRegistryClient::connect(server_url)
            .await
            .expect("Failed to connect to server");

        let public_key = vec![1u8; 32];
        let wrong_node_id = "invalid_node_id_not_matching_hash".to_string();

        let request = tonic::Request::new(RegisterNodeRequest {
            node_id: wrong_node_id,
            public_key_hex: hex::encode(&public_key),
            tpm_quote: vec![0xAA; 64],
            pcrs: vec![0xFF; 32],
            ak_cert: vec![0xBB; 64],
            timestamp_ms: current_timestamp_ms(),
        });

        let response = client.register_node(request).await;

        // Should get PermissionDenied for NodeID mismatch
        assert!(response.is_err());
        let err = response.unwrap_err();
        assert_eq!(err.code(), tonic::Code::PermissionDenied);
        assert!(err.message().contains("NodeID does not match"));
    }

    #[tokio::test]
    async fn test_is_node_enrolled() {
        let identity_manager = Arc::new(Mutex::new(IdentityManager::new()));
        let tpm_manager = Arc::new(Mutex::new(TpmManager::new(false)));

        // Pre-register a node
        let public_key = vec![2u8; 32];
        let node_id = hex::encode(blake3::hash(&public_key).as_bytes());
        let identity = PlatformIdentity {
            id: node_id.clone(),
            public_key: public_key.clone(),
            attestation: Attestation::Tpm {
                quote: vec![0xAA; 64],
                pcrs: vec![0xFF; 32],
                ak_cert: vec![0xBB; 64],
            },
            created_at: current_timestamp_ms(),
            metadata: HashMap::new(),
        };

        identity_manager
            .lock()
            .unwrap()
            .register(identity)
            .unwrap();

        let server_url = start_test_server(identity_manager.clone(), tpm_manager.clone()).await;

        let mut client = IdentityRegistryClient::connect(server_url)
            .await
            .expect("Failed to connect to server");

        let request = tonic::Request::new(IsNodeEnrolledRequest {
            node_id: node_id.clone(),
        });

        let response = client.is_node_enrolled(request).await.unwrap().into_inner();

        assert!(response.success);
        assert!(response.is_enrolled);
    }

    #[tokio::test]
    async fn test_get_public_key() {
        let identity_manager = Arc::new(Mutex::new(IdentityManager::new()));
        let tpm_manager = Arc::new(Mutex::new(TpmManager::new(false)));

        // Pre-register a node
        let public_key = vec![3u8; 32];
        let node_id = hex::encode(blake3::hash(&public_key).as_bytes());
        let identity = PlatformIdentity {
            id: node_id.clone(),
            public_key: public_key.clone(),
            attestation: Attestation::Software {
                certificate: vec![],
            },
            created_at: current_timestamp_ms(),
            metadata: HashMap::new(),
        };

        identity_manager
            .lock()
            .unwrap()
            .register(identity)
            .unwrap();

        let server_url = start_test_server(identity_manager.clone(), tpm_manager.clone()).await;

        let mut client = IdentityRegistryClient::connect(server_url)
            .await
            .expect("Failed to connect to server");

        let request = tonic::Request::new(GetPublicKeyRequest {
            node_id: node_id.clone(),
        });

        let response = client.get_public_key(request).await.unwrap().into_inner();

        assert!(response.success);
        assert_eq!(response.public_key_hex, hex::encode(&public_key));
    }

    #[tokio::test]
    async fn test_verify_signature_with_enrolled_node() {
        let identity_manager = Arc::new(Mutex::new(IdentityManager::new()));
        let tpm_manager = Arc::new(Mutex::new(TpmManager::new(false)));

        // Pre-register a node with a known Ed25519 key
        let public_key = vec![4u8; 32];
        let node_id = hex::encode(blake3::hash(&public_key).as_bytes());
        let identity = PlatformIdentity {
            id: node_id.clone(),
            public_key: public_key.clone(),
            attestation: Attestation::Software {
                certificate: vec![],
            },
            created_at: current_timestamp_ms(),
            metadata: HashMap::new(),
        };

        identity_manager
            .lock()
            .unwrap()
            .register(identity)
            .unwrap();

        let server_url = start_test_server(identity_manager.clone(), tpm_manager.clone()).await;

        let mut client = IdentityRegistryClient::connect(server_url)
            .await
            .expect("Failed to connect to server");

        let payload = b"test message";
        // For this test, we'll use a dummy signature that won't verify
        let signature_hex = hex::encode(vec![0u8; 64]);

        let request = tonic::Request::new(VerifySignatureRequest {
            node_id: node_id.clone(),
            payload: payload.to_vec(),
            signature_hex,
            timestamp_ms: current_timestamp_ms(),
            nonce_hex: hex::encode(b"test_nonce"),
        });

        let response = client
            .verify_signature(request)
            .await
            .unwrap()
            .into_inner();

        // Signature should fail verification (dummy signature)
        assert!(!response.is_valid);
        // Debug: print the actual failure reason
        println!("Failure reason: {}", response.failure_reason);
        assert!(
            response.failure_reason.contains("verification")
                || response.failure_reason.contains("Ed25519")
                || response.failure_reason.contains("signature")
        );
    }

    #[tokio::test]
    async fn test_revoke_node_without_authority_fails() {
        let identity_manager = Arc::new(Mutex::new(IdentityManager::new()));
        let tpm_manager = Arc::new(Mutex::new(TpmManager::new(false)));

        // Pre-register a node
        let public_key = vec![5u8; 32];
        let node_id = hex::encode(blake3::hash(&public_key).as_bytes());
        let identity = PlatformIdentity {
            id: node_id.clone(),
            public_key: public_key.clone(),
            attestation: Attestation::Software {
                certificate: vec![],
            },
            created_at: current_timestamp_ms(),
            metadata: HashMap::new(),
        };

        identity_manager
            .lock()
            .unwrap()
            .register(identity)
            .unwrap();

        let server_url = start_test_server(identity_manager.clone(), tpm_manager.clone()).await;

        let mut client = IdentityRegistryClient::connect(server_url)
            .await
            .expect("Failed to connect to server");

        let request = tonic::Request::new(RevokeNodeRequest {
            node_id: node_id.clone(),
            reason: "Test revocation".to_string(),
            authority_signature_hex: hex::encode(vec![0u8; 64]),
            timestamp_ms: current_timestamp_ms(),
        });

        let response = client.revoke_node(request).await;

        // Should fail because no admin nodes are configured
        assert!(response.is_err());
        let err = response.unwrap_err();
        assert_eq!(err.code(), tonic::Code::PermissionDenied);
        assert!(err.message().contains("No admin nodes configured"));
    }
}
