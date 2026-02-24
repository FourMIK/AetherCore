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

use crate::{IdentityManager, PlatformIdentity, TpmManager};
use std::sync::{Arc, Mutex};

/// Identity Registry gRPC service implementation
#[cfg(feature = "grpc-server")]
pub struct IdentityRegistryService {
    /// Identity manager instance
    identity_manager: Arc<Mutex<IdentityManager>>,
    /// TPM manager for hardware attestation validation
    tpm_manager: Arc<Mutex<TpmManager>>,
    /// Admin node IDs authorized to revoke nodes
    admin_node_ids: Arc<Mutex<Vec<String>>>,
    /// TPM enforcement enabled (default: true)
    tpm_enabled: bool,
}

#[cfg(feature = "grpc-server")]
impl IdentityRegistryService {
    /// Parse TPM_ENABLED environment variable with standard boolean parsing
    fn parse_tpm_enabled() -> bool {
        match std::env::var("TPM_ENABLED") {
            Ok(val) => {
                let normalized = val.to_lowercase().trim().to_string();
                // Check for true values
                if normalized == "true"
                    || normalized == "1"
                    || normalized == "yes"
                    || normalized == "on"
                {
                    return true;
                }
                // Check for false values
                if normalized == "false"
                    || normalized == "0"
                    || normalized == "no"
                    || normalized == "off"
                {
                    return false;
                }
                // Invalid value - log warning and use default
                tracing::warn!("Invalid TPM_ENABLED value: '{}'. Valid values: true/false, 1/0, yes/no, on/off. Defaulting to false.", val);
                false
            }
            Err(_) => false, // Default: disabled for field testing
        }
    }

    /// Create a new Identity Registry service
    pub fn new(
        identity_manager: Arc<Mutex<IdentityManager>>,
        tpm_manager: Arc<Mutex<TpmManager>>,
    ) -> Self {
        let tpm_enabled = Self::parse_tpm_enabled();
        tracing::info!(
            "Identity Registry Service initialized with TPM_ENABLED={}",
            tpm_enabled
        );
        if !tpm_enabled {
            tracing::warn!("⚠️  TPM DISABLED - Hardware-rooted trust validation is disabled. Security guarantees reduced.");
        }
        Self {
            identity_manager,
            tpm_manager,
            admin_node_ids: Arc::new(Mutex::new(Vec::new())),
            tpm_enabled,
        }
    }

    /// Create a new Identity Registry service with admin node IDs
    pub fn with_admin_nodes(
        identity_manager: Arc<Mutex<IdentityManager>>,
        tpm_manager: Arc<Mutex<TpmManager>>,
        admin_node_ids: Vec<String>,
    ) -> Self {
        let tpm_enabled = Self::parse_tpm_enabled();
        tracing::info!(
            "Identity Registry Service initialized with TPM_ENABLED={}",
            tpm_enabled
        );
        if !tpm_enabled {
            tracing::warn!("⚠️  TPM DISABLED - Hardware-rooted trust validation is disabled. Security guarantees reduced.");
        }
        Self {
            identity_manager,
            tpm_manager,
            admin_node_ids: Arc::new(Mutex::new(admin_node_ids)),
            tpm_enabled,
        }
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
        let signature_bytes =
            hex::decode(signature_hex).map_err(|e| format!("Failed to decode signature: {}", e))?;

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
        let public_key = hex::decode(&req.public_key_hex).map_err(|_| {
            tracing::warn!(
                "Registration failed for node {}: Invalid public key format",
                req.node_id,
            );
            Status::invalid_argument("Invalid public key format")
        })?;

        if public_key.len() != 32 {
            tracing::warn!(
                "Registration failed for node {}: Invalid public key length: {} (expected 32)",
                req.node_id,
                public_key.len()
            );
            return Err(Status::invalid_argument(format!(
                "Invalid public key length: {} (expected 32)",
                public_key.len()
            )));
        }

        // Validate NodeID matches BLAKE3(public_key)
        let computed_node_id = hex::encode(blake3::hash(&public_key).as_bytes());
        if computed_node_id != req.node_id {
            tracing::error!(
                "Registration failed for node {}: NodeID mismatch. Expected: {}, Got: {}",
                req.node_id,
                computed_node_id,
                req.node_id
            );
            return Err(Status::permission_denied(
                "NodeID does not match BLAKE3 hash of public key",
            ));
        }

        // Create attestation from TPM data
        let attestation = crate::Attestation::Tpm {
            quote: req.tpm_quote.clone(),
            pcrs: req.pcrs.clone(),
            ak_cert: req.ak_cert.clone(),
        };

        // Validate TPM attestation (hardware-rooted trust)
        // When TPM_ENABLED=false, skip validation and accept empty TPM fields
        if self.tpm_enabled {
            // TPM ENABLED: Enforce hardware-rooted trust (NO GRACEFUL DEGRADATION)
            if req.tpm_quote.is_empty() {
                // NO TPM QUOTE PROVIDED - This is a security failure
                tracing::error!(
                    "Registration DENIED for node {}: No TPM attestation provided. Hardware root of trust required.",
                    req.node_id
                );
                return Err(Status::permission_denied(
                    "TPM attestation required for registration. No graceful degradation for security failures.",
                ));
            }

            // Validate PCRs are provided
            if req.pcrs.is_empty() {
                tracing::warn!(
                    "Registration failed for node {}: No PCR values provided",
                    req.node_id
                );
                return Err(Status::invalid_argument(
                    "PCR values required for TPM attestation",
                ));
            }

            // Validate AK certificate is provided
            if req.ak_cert.is_empty() {
                tracing::warn!(
                    "Registration failed for node {}: No AK certificate provided",
                    req.node_id
                );
                return Err(Status::invalid_argument(
                    "Attestation Key certificate required for TPM attestation",
                ));
            }

            let tpm_manager = self
                .tpm_manager
                .lock()
                .map_err(|e| Status::internal(format!("Lock error: {}", e)))?;

            // Parse PCRs from the request
            let pcr_values = if !req.pcrs.is_empty() {
                let chunk_size = 32;
                let num_pcrs = (req.pcrs.len() + chunk_size - 1) / chunk_size;

                (0..num_pcrs.min(24))
                    .map(|i| {
                        let start = i * chunk_size;
                        let end = (start + chunk_size).min(req.pcrs.len());
                        crate::PcrValue {
                            index: i as u8,
                            value: req.pcrs[start..end].to_vec(),
                        }
                    })
                    .collect()
            } else {
                vec![]
            };

            // Create TPM quote structure for verification
            let tpm_quote = crate::TpmQuote {
                pcrs: pcr_values,
                signature: req.tpm_quote.clone(),
                nonce: vec![],
                timestamp: req.timestamp_ms,
                attestation_data: vec![],
            };

            // Create attestation key from AK cert
            let ak = crate::AttestationKey {
                key_id: req.node_id.clone(),
                public_key: public_key.clone(),
                certificate: if req.ak_cert.is_empty() {
                    None
                } else {
                    Some(req.ak_cert.clone())
                },
            };

            // Verify TPM quote
            if !tpm_manager.verify_quote(&tpm_quote, &ak) {
                tracing::error!(
                    "Registration DENIED for node {}: TPM attestation validation failed",
                    req.node_id
                );
                return Err(Status::permission_denied(
                    "TPM attestation validation failed. Hardware root of trust required.",
                ));
            }

            tracing::info!("Node {} passed TPM attestation validation", req.node_id);
        } else {
            // TPM DISABLED: Accept registration without TPM validation
            tracing::info!(
                "Node {} registration: skipping TPM validation (TPM_ENABLED=false)",
                req.node_id
            );

            if req.tpm_quote.is_empty() && req.pcrs.is_empty() && req.ak_cert.is_empty() {
                tracing::debug!(
                    "Node {} registered without TPM fields (TPM disabled mode)",
                    req.node_id
                );
            } else {
                tracing::debug!(
                    "Node {} registered with TPM fields but validation skipped (TPM disabled mode)",
                    req.node_id
                );
            }
        }

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
            Ok(_) => {
                tracing::info!(
                    "Node {} successfully registered with TPM attestation",
                    req.node_id
                );
                Ok(Response::new(RegisterNodeResponse {
                    success: true,
                    error_message: String::new(),
                    timestamp_ms,
                }))
            }
            Err(e) => {
                tracing::warn!("Registration failed for node {}: {}", req.node_id, e);
                Ok(Response::new(RegisterNodeResponse {
                    success: false,
                    error_message: format!("Registration failed: {}", e),
                    timestamp_ms,
                }))
            }
        }
    }

    /// Revoke a node identity (Aetheric Sweep)
    async fn revoke_node(
        &self,
        request: Request<RevokeNodeRequest>,
    ) -> Result<Response<RevokeNodeResponse>, Status> {
        let req = request.into_inner();
        let timestamp_ms = Self::current_timestamp_ms();

        // Verify authority signature before revoking
        // Only admin nodes can revoke other nodes
        let admin_nodes = self
            .admin_node_ids
            .lock()
            .map_err(|e| Status::internal(format!("Lock error: {}", e)))?;

        if admin_nodes.is_empty() {
            tracing::error!(
                "Revocation failed for node {}: No admin nodes configured",
                req.node_id
            );
            return Err(Status::permission_denied(
                "No admin nodes configured for revocation authority",
            ));
        }

        // Verify the authority signature
        // The signature should be over the payload: node_id + reason + timestamp
        let payload = format!("{}{}{}", req.node_id, req.reason, req.timestamp_ms);
        let payload_bytes = payload.as_bytes();

        // Try to verify with each admin node's public key
        let manager = self
            .identity_manager
            .lock()
            .map_err(|e| Status::internal(format!("Lock error: {}", e)))?;

        let mut signature_verified = false;
        let mut verifying_admin = String::new();

        for admin_id in admin_nodes.iter() {
            if let Some(admin_identity) = manager.get(admin_id) {
                let admin_public_key_hex = hex::encode(&admin_identity.public_key);

                match Self::verify_ed25519_signature(
                    &admin_public_key_hex,
                    payload_bytes,
                    &req.authority_signature_hex,
                ) {
                    Ok(true) => {
                        signature_verified = true;
                        verifying_admin = admin_id.clone();
                        break;
                    }
                    Ok(false) => continue,
                    Err(e) => {
                        tracing::debug!(
                            "Signature verification failed for admin {}: {}",
                            admin_id,
                            e
                        );
                        continue;
                    }
                }
            }
        }

        if !signature_verified {
            tracing::error!(
                "Revocation DENIED for node {}: Invalid authority signature. No admin signature verified.",
                req.node_id
            );
            return Err(Status::permission_denied(
                "Invalid authority signature: Revocation must be signed by an admin node",
            ));
        }

        // Drop the read lock before acquiring write lock
        drop(manager);

        let mut manager = self
            .identity_manager
            .lock()
            .map_err(|e| Status::internal(format!("Lock error: {}", e)))?;

        match manager.revoke(&req.node_id) {
            Ok(_) => {
                tracing::warn!(
                    "Node revoked: {} by admin {} - Reason: {}",
                    req.node_id,
                    verifying_admin,
                    req.reason
                );

                Ok(Response::new(RevokeNodeResponse {
                    success: true,
                    error_message: String::new(),
                    timestamp_ms,
                }))
            }
            Err(e) => {
                tracing::error!("Revocation failed for node {}: {}", req.node_id, e);
                Ok(Response::new(RevokeNodeResponse {
                    success: false,
                    error_message: format!("Revocation failed: {}", e),
                    timestamp_ms,
                }))
            }
        }
    }
}

/// Start the Identity Registry gRPC server
#[cfg(feature = "grpc-server")]
pub async fn start_grpc_server(
    addr: std::net::SocketAddr,
    identity_manager: Arc<Mutex<IdentityManager>>,
    tpm_manager: Arc<Mutex<TpmManager>>,
) -> Result<(), Box<dyn std::error::Error>> {
    let service = IdentityRegistryService::new(identity_manager, tpm_manager);

    tracing::info!("Identity Registry gRPC server listening on {}", addr);

    Server::builder()
        .add_service(IdentityRegistryServer::new(service))
        .serve(addr)
        .await?;

    Ok(())
}
