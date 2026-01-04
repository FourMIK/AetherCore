//! Test utilities for cross-language integration tests

use aethercore_c2_router::C2GrpcServer;
use aethercore_c2_router::authority::AuthorityVerifier;
use aethercore_identity::grpc_server::proto::identity_registry_server::IdentityRegistryServer;
use aethercore_identity::grpc_server::IdentityRegistryService;
use aethercore_identity::{Attestation, IdentityManager, PlatformIdentity, TpmManager};
use aethercore_trust_mesh::{TrustLevel, TrustScorer};
use aethercore_c2_router::dispatcher::CommandDispatcher;
use aethercore_c2_router::quorum::QuorumGate;
use ed25519_dalek::{Signer, SigningKey};
use rand::{rngs::OsRng, RngCore};
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};
use tokio::time::Duration;

/// Get current timestamp in milliseconds
pub fn current_timestamp_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_millis() as u64
}

/// Get current timestamp in nanoseconds
pub fn current_timestamp_ns() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_nanos() as u64
}

/// Test fixture for a registered device with Ed25519 keys
pub struct TestDevice {
    pub node_id: String,
    pub public_key: Vec<u8>,
    pub signing_key: SigningKey,
}

impl TestDevice {
    /// Create a new test device with generated Ed25519 keypair
    pub fn new() -> Self {
        // Generate 32 random bytes for the secret key
        let mut secret_bytes = [0u8; 32];
        OsRng.fill_bytes(&mut secret_bytes);
        
        let signing_key = SigningKey::from_bytes(&secret_bytes);
        let public_key = signing_key.verifying_key().to_bytes().to_vec();
        let node_id = hex::encode(blake3::hash(&public_key).as_bytes());

        Self {
            node_id,
            public_key,
            signing_key,
        }
    }

    /// Sign a payload with the device's signing key
    pub fn sign(&self, payload: &[u8]) -> Vec<u8> {
        self.signing_key.sign(payload).to_bytes().to_vec()
    }

    /// Register this device in the identity manager
    pub fn register(&self, identity_manager: &mut IdentityManager) {
        let identity = PlatformIdentity {
            id: self.node_id.clone(),
            public_key: self.public_key.clone(),
            attestation: Attestation::Tpm {
                quote: vec![0xAA; 64],
                pcrs: vec![0xFF; 32],
                ak_cert: vec![0xBB; 64],
            },
            created_at: current_timestamp_ms(),
            metadata: HashMap::new(),
        };

        identity_manager.register(identity).unwrap();
    }
}

impl Default for TestDevice {
    fn default() -> Self {
        Self::new()
    }
}

/// Start a test Identity Registry gRPC server
pub async fn start_identity_server(
    identity_manager: Arc<Mutex<IdentityManager>>,
    tpm_manager: Arc<Mutex<TpmManager>>,
) -> String {
    let addr: std::net::SocketAddr = "127.0.0.1:0".parse().unwrap();
    let listener = tokio::net::TcpListener::bind(addr).await.unwrap();
    let local_addr = listener.local_addr().unwrap();
    let server_url = format!("http://{}", local_addr);

    let service = IdentityRegistryService::new(identity_manager, tpm_manager);
    let identity_registry_server = IdentityRegistryServer::new(service);

    tokio::spawn(async move {
        tonic::transport::Server::builder()
            .add_service(identity_registry_server)
            .serve_with_incoming(tokio_stream::wrappers::TcpListenerStream::new(listener))
            .await
            .unwrap();
    });

    // Wait for server to start
    tokio::time::sleep(Duration::from_millis(100)).await;

    server_url
}

/// Start a test C2 Router gRPC server
/// 
/// Note: This creates new instances of Identity Manager and Trust Scorer for the server.
/// Test setup should register devices and set trust scores BEFORE calling this function.
pub async fn start_c2_server_with_state(
    devices: Vec<&TestDevice>,
    trust_levels: Vec<(String, f64, TrustLevel)>,
) -> String {
    let addr: std::net::SocketAddr = "127.0.0.1:0".parse().unwrap();
    let listener = tokio::net::TcpListener::bind(addr).await.unwrap();
    let local_addr = listener.local_addr().unwrap();
    let server_url = format!("http://{}", local_addr);

    // Create new identity manager and register devices
    let mut identity_manager = IdentityManager::new();
    for device in devices {
        device.register(&mut identity_manager);
    }

    // Create new trust scorer and set trust levels
    let trust_scorer = TrustScorer::new();
    for (node_id, score, _level) in trust_levels {
        set_node_trust(&trust_scorer, &node_id, score, _level);
    }

    let dispatcher = CommandDispatcher::new();
    let authority_verifier = AuthorityVerifier::new();
    let quorum_gate = QuorumGate::new(authority_verifier);
    
    let grpc_service = C2GrpcServer::new(
        dispatcher,
        quorum_gate,
        trust_scorer,
        identity_manager,
    );

    let c2_server = aethercore_c2_router::grpc::c2_proto::c2_router_server::C2RouterServer::new(grpc_service);

    tokio::spawn(async move {
        tonic::transport::Server::builder()
            .add_service(c2_server)
            .serve_with_incoming(tokio_stream::wrappers::TcpListenerStream::new(listener))
            .await
            .unwrap();
    });

    // Wait for server to start
    tokio::time::sleep(Duration::from_millis(100)).await;

    server_url
}

/// Create a test trust scorer with predefined trust levels
pub fn create_test_trust_scorer() -> TrustScorer {
    TrustScorer::new()
}

/// Set trust score for a node
pub fn set_node_trust(scorer: &TrustScorer, node_id: &str, target_score: f64, _level: TrustLevel) {
    // Initialize with current score (defaults to 1.0) and update to target
    let current = scorer.get_score(node_id).map(|s| s.score).unwrap_or(1.0);
    let delta = target_score - current;
    scorer.update_score(node_id, delta);
}
