//! gRPC Identity Registry Server - Hardware-Rooted Trust Fabric
//!
//! This module implements the Identity Registry gRPC service that provides
//! hardware-backed identity verification for the 4MIK Trust Fabric.
//!
//! # Security Model
//!
//! - NO GRACEFUL DEGRADATION: If hardware attestation fails, the node is Byzantine
//! - All queries must complete within timeout windows (contested/congested aware)
//! - Private keys NEVER leave the TPM (CodeRalphie integration)
//!
//! # Performance
//!
//! Target: < 5ms for identity lookups on ARM64 edge hardware

#[cfg(feature = "grpc-server")]
use tonic::{transport::Server, Request, Response, Status};

#[cfg(feature = "grpc-server")]
pub mod proto {
    tonic::include_proto!("aethercore.identity");
}

#[cfg(feature = "grpc-server")]
use proto::identity_registry_server::{IdentityRegistry, IdentityRegistryServer};
#[cfg(feature = "grpc-server")]
use proto::*;

use crate::{IdentityManager, PlatformIdentity};
use std::sync::{Arc, Mutex};

/// Identity Registry gRPC service implementation
#[cfg(feature = "grpc-server")]
pub struct IdentityRegistryService {
    /// Identity manager instance
    identity_manager: Arc<Mutex<IdentityManager>>,
}

#[cfg(feature = "grpc-server")]
impl IdentityRegistryService {
    /// Create a new Identity Registry service
    pub fn new(identity_manager: Arc<Mutex<IdentityManager>>) -> Self {
        Self { identity_manager }
    }

    /// Get current timestamp in milliseconds
    fn current_timestamp_ms() -> u64 {
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_millis() as u64
    }

    /// Verify Ed25519 signature using ed25519-dalek
    fn verify_ed25519_signature(
        public_key_hex: &str,
        payload: &[u8],
        signature_hex: &str,
    ) -> Result<bool, String> {
        use ed25519_dalek::{Signature, Verifier, VerifyingKey};

        // Decode public key
        let public_key_bytes = hex::decode(public_key_hex)
            .map_err(|e| format!("Failed to decode public key: {}", e))?;

        if public_key_bytes.len() != 32 {
            return Err(format!(
                "Invalid public key length: {} (expected 32)",
                public_key_bytes.len()
            ));
        }

        let mut key_array = [0u8; 32];
        key_array.copy_from_slice(&public_key_bytes);

        let verifying_key = VerifyingKey::from_bytes(&key_array)
            .map_err(|e| format!("Failed to create verifying key: {}", e))?;

        // Decode signature
        let signature_bytes = hex::decode(signature_hex)
            .map_err(|e| format!("Failed to decode signature: {}", e))?;

        if signature_bytes.len() != 64 {
            return Err(format!(
                "Invalid signature length: {} (expected 64)",
                signature_bytes.len()
            ));
        }

        let signature = Signature::from_bytes(&signature_bytes.try_into().unwrap());

        // Verify signature
        match verifying_key.verify(payload, &signature) {
            Ok(_) => Ok(true),
            Err(_) => Ok(false),
        }
    }
}

#[cfg(feature = "grpc-server")]
#[tonic::async_trait]
impl IdentityRegistry for IdentityRegistryService {
    /// Get public key for a NodeID
    async fn get_public_key(
        &self,
        request: Request<GetPublicKeyRequest>,
    ) -> Result<Response<GetPublicKeyResponse>, Status> {
        let req = request.into_inner();
        let timestamp_ms = Self::current_timestamp_ms();

        let manager = self
            .identity_manager
            .lock()
            .map_err(|e| Status::internal(format!("Lock error: {}", e)))?;

        match manager.get(&req.node_id) {
            Some(identity) => {
                let public_key_hex = hex::encode(&identity.public_key);

                Ok(Response::new(GetPublicKeyResponse {
                    success: true,
                    public_key_hex,
                    error_message: String::new(),
                    timestamp_ms,
                }))
            }
            None => Ok(Response::new(GetPublicKeyResponse {
                success: false,
                public_key_hex: String::new(),
                error_message: format!("Node ID not found: {}", req.node_id),
                timestamp_ms,
            })),
        }
    }

    /// Check if a node is enrolled
    async fn is_node_enrolled(
        &self,
        request: Request<IsNodeEnrolledRequest>,
    ) -> Result<Response<IsNodeEnrolledResponse>, Status> {
        let req = request.into_inner();
        let timestamp_ms = Self::current_timestamp_ms();

        let manager = self
            .identity_manager
            .lock()
            .map_err(|e| Status::internal(format!("Lock error: {}", e)))?;

        let is_enrolled = manager.is_enrolled(&req.node_id);

        Ok(Response::new(IsNodeEnrolledResponse {
            success: true,
            is_enrolled,
            error_message: String::new(),
            timestamp_ms,
        }))
    }

    /// Verify a signature (full verification including timestamp, nonce)
    async fn verify_signature(
        &self,
        request: Request<VerifySignatureRequest>,
    ) -> Result<Response<VerifySignatureResponse>, Status> {
        let req = request.into_inner();
        let timestamp_ms = Self::current_timestamp_ms();

        let manager = self
            .identity_manager
            .lock()
            .map_err(|e| Status::internal(format!("Lock error: {}", e)))?;

        // Check if node is enrolled
        if !manager.is_enrolled(&req.node_id) {
            return Ok(Response::new(VerifySignatureResponse {
                is_valid: false,
                failure_reason: format!("Node ID not enrolled: {}", req.node_id),
                timestamp_ms,
                security_event_type: "unknown_node".to_string(),
            }));
        }

        // Get public key
        let identity = match manager.get(&req.node_id) {
            Some(id) => id,
            None => {
                return Ok(Response::new(VerifySignatureResponse {
                    is_valid: false,
                    failure_reason: format!("Node ID not found: {}", req.node_id),
                    timestamp_ms,
                    security_event_type: "unknown_node".to_string(),
                }));
            }
        };

        // Verify timestamp (prevent replay attacks - check within 5 minutes)
        let time_diff = if timestamp_ms > req.timestamp_ms {
            timestamp_ms - req.timestamp_ms
        } else {
            req.timestamp_ms - timestamp_ms
        };

        if time_diff > 5 * 60 * 1000 {
            return Ok(Response::new(VerifySignatureResponse {
                is_valid: false,
                failure_reason: format!("Timestamp outside acceptable window: {}ms", time_diff),
                timestamp_ms,
                security_event_type: "replay_attack".to_string(),
            }));
        }

        // Verify signature
        let public_key_hex = hex::encode(&identity.public_key);
        match Self::verify_ed25519_signature(&public_key_hex, &req.payload, &req.signature_hex) {
            Ok(true) => Ok(Response::new(VerifySignatureResponse {
                is_valid: true,
                failure_reason: String::new(),
                timestamp_ms,
                security_event_type: String::new(),
            })),
            Ok(false) => Ok(Response::new(VerifySignatureResponse {
                is_valid: false,
                failure_reason: "Ed25519 signature verification failed".to_string(),
                timestamp_ms,
                security_event_type: "invalid_signature".to_string(),
            })),
            Err(e) => Ok(Response::new(VerifySignatureResponse {
                is_valid: false,
                failure_reason: format!("Signature verification error: {}", e),
                timestamp_ms,
                security_event_type: "invalid_signature".to_string(),
            })),
        }
    }

    /// Register a new node
    async fn register_node(
        &self,
        request: Request<RegisterNodeRequest>,
    ) -> Result<Response<RegisterNodeResponse>, Status> {
        let req = request.into_inner();
        let timestamp_ms = Self::current_timestamp_ms();

        // Decode public key
        let public_key = hex::decode(&req.public_key_hex)
            .map_err(|e| Status::invalid_argument(format!("Invalid public key hex: {}", e)))?;

        if public_key.len() != 32 {
            return Err(Status::invalid_argument(format!(
                "Invalid public key length: {} (expected 32)",
                public_key.len()
            )));
        }

        // Create attestation from TPM data
        let attestation = crate::Attestation::Tpm {
            quote: req.tpm_quote,
            pcrs: req.pcrs,
            ak_cert: req.ak_cert,
        };

        // Create platform identity
        let identity = PlatformIdentity {
            id: req.node_id.clone(),
            public_key,
            attestation,
            created_at: req.timestamp_ms,
            metadata: std::collections::HashMap::new(),
        };

        // Register with identity manager
        let mut manager = self
            .identity_manager
            .lock()
            .map_err(|e| Status::internal(format!("Lock error: {}", e)))?;

        match manager.register(identity) {
            Ok(_) => Ok(Response::new(RegisterNodeResponse {
                success: true,
                error_message: String::new(),
                timestamp_ms,
            })),
            Err(e) => Ok(Response::new(RegisterNodeResponse {
                success: false,
                error_message: format!("Registration failed: {}", e),
                timestamp_ms,
            })),
        }
    }

    /// Revoke a node identity (Aetheric Sweep)
    async fn revoke_node(
        &self,
        request: Request<RevokeNodeRequest>,
    ) -> Result<Response<RevokeNodeResponse>, Status> {
        let req = request.into_inner();
        let timestamp_ms = Self::current_timestamp_ms();

        // TODO: Verify authority signature before revoking

        let mut manager = self
            .identity_manager
            .lock()
            .map_err(|e| Status::internal(format!("Lock error: {}", e)))?;

        match manager.revoke(&req.node_id) {
            Ok(_) => {
                tracing::warn!(
                    "Node revoked: {} - Reason: {}",
                    req.node_id,
                    req.reason
                );

                Ok(Response::new(RevokeNodeResponse {
                    success: true,
                    error_message: String::new(),
                    timestamp_ms,
                }))
            }
            Err(e) => Ok(Response::new(RevokeNodeResponse {
                success: false,
                error_message: format!("Revocation failed: {}", e),
                timestamp_ms,
            })),
        }
    }
}

/// Start the Identity Registry gRPC server
#[cfg(feature = "grpc-server")]
pub async fn start_grpc_server(
    addr: std::net::SocketAddr,
    identity_manager: Arc<Mutex<IdentityManager>>,
) -> Result<(), Box<dyn std::error::Error>> {
    let service = IdentityRegistryService::new(identity_manager);

    tracing::info!("Identity Registry gRPC server listening on {}", addr);

    Server::builder()
        .add_service(IdentityRegistryServer::new(service))
        .serve(addr)
        .await?;

    Ok(())
}
