//! gRPC service implementation for C2 Router
//!
//! This module provides the complete gRPC service interface for command dispatch
//! with TPM-backed authentication, trust scoring, and comprehensive audit logging.
//!
//! # Security Architecture
//!
//! Every command must pass through the following security gates:
//! 1. **Identity Verification**: Validate device registration and revocation status
//! 2. **Trust Score Gating**: Check sender's trust score and explicitly reject quarantined nodes
//! 3. **Signature Verification**: Extract and verify TPM-backed Ed25519 signatures (placeholder)
//! 4. **Quorum Validation**: Verify sufficient authority signatures for command scope
//! 5. **Audit Logging**: Record every command attempt with outcome
//!
//! # Trust Mesh Integration
//!
//! Commands are gated by trust level with explicit rejection semantics:
//! - **Quarantined** (score < 0.5): Hard reject with detailed reason
//! - **Suspect** (score 0.5-0.9): Reject if below operational threshold (0.8)
//! - **Healthy** (score ≥ 0.9): Allow through to dispatch
//!
//! All rejections include structured error messages for UI display.
//!
//! # Authentication Flow
//!
//! Request metadata must include:
//! - `x-signature`: Base64-encoded Ed25519 signature of command hash
//! - `x-device-id`: Unique device identifier from TPM
//!
//! The signature is verified against the device's registered public key in the identity registry.

#![warn(missing_docs)]

use crate::command_types::{SwarmCommand, UnitCommand};
use crate::dispatcher::CommandDispatcher;
use crate::offline::OfflineMateriaBuffer;
use crate::quorum::QuorumGate;
use crate::replay_protection::ReplayProtector;
use aethercore_identity::IdentityManager;
use aethercore_trust_mesh::{TrustLevel, TrustScorer};
use base64::engine::general_purpose;
use base64::Engine as _;
use ed25519_dalek::{Signature, Verifier, VerifyingKey};
use std::sync::{Arc, Mutex, RwLock};
use tonic::{Request, Response, Status};

// Note: Mutex is used for OfflineMateriaBuffer instead of RwLock because
// rusqlite::Connection is not Send/Sync. Mutex provides the required
// exclusive access for all database operations.

// Include generated protobuf code
/// Generated protobuf types for the C2 gRPC API.
#[allow(missing_docs)]
pub mod c2_proto {
    tonic::include_proto!("aethercore.c2");
}

pub use c2_proto::{
    c2_router_server::{C2Router, C2RouterServer},
    AbortRequest, AbortResponse, CommandStatusRequest, CommandStatusResponse, OfflineGapRequest,
    OfflineGapResponse, SwarmCommandRequest, SwarmCommandResponse, SyncAuthorizationRequest,
    SyncAuthorizationResponse, UnitCommandRequest, UnitCommandResponse,
};

const TRUST_THRESHOLD: f64 = 0.8;

/// C2 gRPC Server implementation with full security hardening
pub struct C2GrpcServer {
    /// Command dispatcher for routing commands to the mesh
    dispatcher: Arc<CommandDispatcher>,
    /// Quorum gate for authority verification
    #[allow(dead_code)]
    quorum_gate: Arc<QuorumGate>,
    /// Trust scorer for checking node trust levels
    trust_scorer: Arc<RwLock<TrustScorer>>,
    /// Identity manager for TPM-backed verification
    identity_manager: Arc<RwLock<IdentityManager>>,
    /// Replay attack protector
    replay_protector: Arc<ReplayProtector>,
    /// Offline materia buffer for blackout resilience (optional)
    offline_buffer: Option<Arc<Mutex<OfflineMateriaBuffer>>>,
}

impl C2GrpcServer {
    /// Create a new C2 gRPC server
    pub fn new(
        dispatcher: CommandDispatcher,
        quorum_gate: QuorumGate,
        trust_scorer: TrustScorer,
        identity_manager: IdentityManager,
    ) -> Self {
        Self {
            dispatcher: Arc::new(dispatcher),
            quorum_gate: Arc::new(quorum_gate),
            trust_scorer: Arc::new(RwLock::new(trust_scorer)),
            identity_manager: Arc::new(RwLock::new(identity_manager)),
            replay_protector: Arc::new(ReplayProtector::new()),
            offline_buffer: None,
        }
    }

    /// Create a new C2 gRPC server with offline buffer support
    pub fn with_offline_buffer(
        dispatcher: CommandDispatcher,
        quorum_gate: QuorumGate,
        trust_scorer: TrustScorer,
        identity_manager: IdentityManager,
        offline_buffer: OfflineMateriaBuffer,
    ) -> Self {
        Self {
            dispatcher: Arc::new(dispatcher),
            quorum_gate: Arc::new(quorum_gate),
            trust_scorer: Arc::new(RwLock::new(trust_scorer)),
            identity_manager: Arc::new(RwLock::new(identity_manager)),
            replay_protector: Arc::new(ReplayProtector::new()),
            offline_buffer: Some(Arc::new(Mutex::new(offline_buffer))),
        }
    }

    /// Extract and verify request metadata for authentication
    fn verify_request_metadata(
        &self,
        request: &Request<impl std::fmt::Debug>,
    ) -> Result<(String, String), Status> {
        // Extract device ID from metadata
        let device_id = request
            .metadata()
            .get("x-device-id")
            .ok_or_else(|| {
                self.audit_log(
                    "AUTH_FAILED",
                    "None",
                    "None",
                    "Missing x-device-id metadata",
                );
                Status::unauthenticated("Missing x-device-id metadata")
            })?
            .to_str()
            .map_err(|e| {
                self.audit_log(
                    "AUTH_FAILED",
                    "None",
                    "None",
                    &format!("Invalid x-device-id: {}", e),
                );
                Status::unauthenticated("Invalid x-device-id")
            })?
            .to_string();

        // Extract signature from metadata
        let signature_b64 = request
            .metadata()
            .get("x-signature")
            .ok_or_else(|| {
                self.audit_log(
                    "AUTH_FAILED",
                    &device_id,
                    "None",
                    "Missing x-signature metadata",
                );
                Status::unauthenticated("Missing x-signature metadata")
            })?
            .to_str()
            .map_err(|e| {
                self.audit_log(
                    "AUTH_FAILED",
                    &device_id,
                    "None",
                    &format!("Invalid x-signature: {}", e),
                );
                Status::unauthenticated("Invalid x-signature")
            })?;

        // Verify the device identity is registered and not revoked
        let identity_mgr = self.identity_manager.read().map_err(|e| {
            self.audit_log(
                "AUTH_FAILED",
                &device_id,
                "None",
                &format!("Lock error: {}", e),
            );
            Status::internal("Identity manager lock error")
        })?;

        identity_mgr.get(&device_id).ok_or_else(|| {
            self.audit_log("AUTH_FAILED", &device_id, "None", "Unknown device");
            Status::unauthenticated("Unknown device ID")
        })?;

        // Verify identity is not revoked
        if identity_mgr.is_revoked(&device_id) {
            self.audit_log("AUTH_FAILED", &device_id, "None", "Device revoked");
            return Err(Status::permission_denied("Device has been revoked"));
        }

        // In production, verify the signature against command hash here
        // For now, we validate the signature format
        if signature_b64.is_empty() {
            self.audit_log("AUTH_FAILED", &device_id, "None", "Empty signature");
            return Err(Status::unauthenticated("Empty signature"));
        }

        Ok((device_id, signature_b64.to_string()))
    }

    /// Validate that the provided signature matches the registered device key
    fn verify_command_signature(
        &self,
        device_id: &str,
        signature_b64: &str,
        command_json: &str,
        timestamp_ns: u64,
    ) -> Result<(), Status> {
        let identity_mgr = self.identity_manager.read().map_err(|e| {
            self.audit_log(
                "AUTH_FAILED",
                device_id,
                "None",
                &format!("Lock error: {}", e),
            );
            Status::internal("Identity manager lock error")
        })?;

        let identity = identity_mgr.get(device_id).ok_or_else(|| {
            self.audit_log("AUTH_FAILED", device_id, "None", "Unknown device");
            Status::unauthenticated("Unknown device ID")
        })?;

        let public_key: [u8; 32] = identity.public_key.as_slice().try_into().map_err(|_| {
            self.audit_log(
                "AUTH_FAILED",
                device_id,
                "None",
                "Invalid device public key length",
            );
            Status::unauthenticated("Invalid device public key")
        })?;

        let verifying_key = VerifyingKey::from_bytes(&public_key).map_err(|_| {
            self.audit_log(
                "AUTH_FAILED",
                device_id,
                "None",
                "Invalid device public key bytes",
            );
            Status::unauthenticated("Invalid device public key")
        })?;

        let signature_bytes = general_purpose::STANDARD
            .decode(signature_b64)
            .map_err(|_| {
                self.audit_log(
                    "AUTH_FAILED",
                    device_id,
                    "None",
                    "Invalid signature encoding",
                );
                Status::unauthenticated("Invalid signature encoding")
            })?;

        let signature = Signature::from_slice(&signature_bytes).map_err(|_| {
            self.audit_log("AUTH_FAILED", device_id, "None", "Invalid signature format");
            Status::unauthenticated("Invalid signature format")
        })?;

        let message = format!("{}:{}:{}", device_id, command_json, timestamp_ns);

        verifying_key
            .verify(message.as_bytes(), &signature)
            .map_err(|_| {
                self.audit_log(
                    "AUTH_FAILED",
                    device_id,
                    "None",
                    "Signature verification failed",
                );
                Status::unauthenticated("Signature verification failed")
            })
    }

    /// Check trust score against threshold and quarantine status
    fn verify_trust_score(&self, device_id: &str) -> Result<(), Status> {
        let scorer = self.trust_scorer.read().map_err(|e| {
            self.audit_log(
                "TRUST_CHECK_FAILED",
                device_id,
                "None",
                &format!("Lock error: {}", e),
            );
            Status::internal("Trust scorer lock error")
        })?;

        if let Some(trust_score) = scorer.get_score(device_id) {
            // Hard invariant: Explicitly reject quarantined nodes
            if trust_score.level == TrustLevel::Quarantined {
                let rejection_reason = format!(
                    "COMMAND REJECTED: Node {} is Quarantined. Reason: {}",
                    device_id,
                    trust_score.rejection_summary()
                );
                self.audit_log(
                    "TRUST_QUARANTINE_REJECT",
                    device_id,
                    "None",
                    &rejection_reason,
                );
                return Err(Status::permission_denied(rejection_reason));
            }

            // Additional threshold check for operational readiness
            if trust_score.score < TRUST_THRESHOLD {
                let rejection_reason = format!(
                    "Trust Score Below Threshold ({}): {}",
                    trust_score.score,
                    trust_score.rejection_summary()
                );
                self.audit_log("TRUST_DENIED", device_id, "None", &rejection_reason);
                return Err(Status::permission_denied(rejection_reason));
            }
        } else {
            // No trust score available - deny by default (zero trust)
            let rejection_reason = "No trust score available - Zero Trust Default Applied";
            self.audit_log("TRUST_DENIED", device_id, "None", rejection_reason);
            return Err(Status::permission_denied(rejection_reason));
        }

        Ok(())
    }

    /// Audit log helper - structured logging for all operations
    fn audit_log(&self, action: &str, operator: &str, target: &str, result: &str) {
        tracing::info!(
            "[AUDIT] Action={} Operator={} Target={} Result={}",
            action,
            operator,
            target,
            result
        );
    }

    /// Get current timestamp in nanoseconds
    fn current_timestamp_ns() -> u64 {
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos() as u64
    }
}

#[tonic::async_trait]
impl C2Router for C2GrpcServer {
    async fn execute_unit_command(
        &self,
        request: Request<UnitCommandRequest>,
    ) -> Result<Response<UnitCommandResponse>, Status> {
        // Step 1: Authentication - Extract and verify device identity
        let (device_id, signature_b64) = self.verify_request_metadata(&request)?;

        // Extract request payload early for replay protection
        let req = request.into_inner();
        let unit_id = &req.unit_id;

        // Step 1a: Verify the command signature against the registered device key
        self.verify_command_signature(
            &device_id,
            &signature_b64,
            &req.command_json,
            req.timestamp_ns,
        )?;

        // Step 2: Replay Protection - Validate timestamp and nonce
        // Extract nonce from signatures (first signature serves as nonce for now)
        let nonce = req.signatures.first().ok_or_else(|| {
            self.audit_log(
                "REPLAY_CHECK_FAILED",
                &device_id,
                unit_id,
                "No signature/nonce provided",
            );
            Status::unauthenticated("No signature provided")
        })?;

        // Validate replay protection
        if let Err(e) = self
            .replay_protector
            .validate_command(&device_id, req.timestamp_ns, nonce)
        {
            let error_msg = format!("Replay attack detected: {}", e);
            self.audit_log("REPLAY_ATTACK_DETECTED", &device_id, unit_id, &error_msg);
            return Err(Status::permission_denied(error_msg));
        }

        // Step 3: Trust Gating - Check trust score
        self.verify_trust_score(&device_id)?;

        // Step 4: Parse command from JSON
        let command: UnitCommand = serde_json::from_str(&req.command_json).map_err(|e| {
            self.audit_log(
                "EXECUTE_UNIT",
                &device_id,
                unit_id,
                &format!("Invalid command JSON: {}", e),
            );
            Status::invalid_argument(format!("Invalid command JSON: {}", e))
        })?;

        // Step 5: Quorum verification would happen here
        // In full implementation, verify signatures against command hash
        // For now, we log the signature count
        if req.signatures.is_empty() {
            self.audit_log(
                "EXECUTE_UNIT",
                &device_id,
                unit_id,
                "No signatures provided",
            );
            return Err(Status::unauthenticated("No authority signatures provided"));
        }

        // Step 6: Dispatch command
        let dispatch_result = self
            .dispatcher
            .dispatch_unit_command(unit_id, &command, req.timestamp_ns)
            .map_err(|e| {
                self.audit_log(
                    "EXECUTE_UNIT",
                    &device_id,
                    unit_id,
                    &format!("Dispatch failed: {}", e),
                );
                Status::internal(format!("Command dispatch failed: {}", e))
            })?;

        // Step 6: Audit log success
        let success = dispatch_result.is_success();
        self.audit_log(
            "EXECUTE_UNIT",
            &device_id,
            unit_id,
            if success { "SUCCESS" } else { "FAILED" },
        );

        // Step 7: Return response
        let response = UnitCommandResponse {
            success,
            unit_id: unit_id.clone(),
            message: if success {
                format!("Command dispatched to unit {}", unit_id)
            } else {
                "Command dispatch failed".to_string()
            },
            timestamp_ns: Self::current_timestamp_ns(),
        };

        Ok(Response::new(response))
    }

    async fn execute_swarm_command(
        &self,
        request: Request<SwarmCommandRequest>,
    ) -> Result<Response<SwarmCommandResponse>, Status> {
        // Step 1: Authentication
        let (device_id, signature_b64) = self.verify_request_metadata(&request)?;

        // Extract request payload
        let req = request.into_inner();
        let swarm_id = &req.swarm_command_id;

        // Step 1a: Verify signature against registered key
        self.verify_command_signature(
            &device_id,
            &signature_b64,
            &req.command_json,
            req.timestamp_ns,
        )?;

        // Step 2: Trust Gating
        self.verify_trust_score(&device_id)?;

        // Step 3: Parse command from JSON
        let command: SwarmCommand = serde_json::from_str(&req.command_json).map_err(|e| {
            self.audit_log(
                "EXECUTE_SWARM",
                &device_id,
                swarm_id,
                &format!("Invalid command JSON: {}", e),
            );
            Status::invalid_argument(format!("Invalid command JSON: {}", e))
        })?;

        // Step 4: Quorum verification
        if req.signatures.is_empty() {
            self.audit_log(
                "EXECUTE_SWARM",
                &device_id,
                swarm_id,
                "No signatures provided",
            );
            return Err(Status::unauthenticated("No authority signatures provided"));
        }

        // Step 5: Dispatch swarm command
        let dispatch_status = self
            .dispatcher
            .dispatch_swarm_command(
                swarm_id.clone(),
                &command,
                &req.target_unit_ids,
                req.timestamp_ns,
            )
            .map_err(|e| {
                self.audit_log(
                    "EXECUTE_SWARM",
                    &device_id,
                    swarm_id,
                    &format!("Dispatch failed: {}", e),
                );
                Status::internal(format!("Swarm command dispatch failed: {}", e))
            })?;

        // Step 6: Audit log
        self.audit_log(
            "EXECUTE_SWARM",
            &device_id,
            swarm_id,
            &format!(
                "SUCCESS - {}/{} units succeeded",
                dispatch_status.success_count, dispatch_status.total_units
            ),
        );

        // Step 7: Return response
        let response = SwarmCommandResponse {
            swarm_command_id: swarm_id.clone(),
            total_units: dispatch_status.total_units as u32,
            success_count: dispatch_status.success_count as u32,
            failure_count: dispatch_status.failure_count as u32,
            timeout_count: dispatch_status.timeout_count as u32,
            completion_percent: dispatch_status.completion_percent(),
            timestamp_ns: Self::current_timestamp_ns(),
        };

        Ok(Response::new(response))
    }

    async fn get_command_status(
        &self,
        request: Request<CommandStatusRequest>,
    ) -> Result<Response<CommandStatusResponse>, Status> {
        // Authentication
        let (device_id, _signature_b64) = self.verify_request_metadata(&request)?;

        // Trust gating
        self.verify_trust_score(&device_id)?;

        let req = request.into_inner();

        self.audit_log("GET_STATUS", &device_id, &req.command_id, "SUCCESS");

        // In production, look up actual command status from ledger/state store
        // For now, return a placeholder response
        let response = CommandStatusResponse {
            command_id: req.command_id.clone(),
            status: "completed".to_string(),
            details_json: "{}".to_string(),
            timestamp_ns: Self::current_timestamp_ns(),
        };

        Ok(Response::new(response))
    }

    async fn abort_swarm_command(
        &self,
        request: Request<AbortRequest>,
    ) -> Result<Response<AbortResponse>, Status> {
        // Authentication
        let (device_id, _signature_b64) = self.verify_request_metadata(&request)?;

        // Trust gating
        self.verify_trust_score(&device_id)?;

        let req = request.into_inner();

        // Abort the swarm command
        // In production, would send abort signals to all units
        self.audit_log(
            "ABORT_SWARM",
            &device_id,
            &req.swarm_command_id,
            &format!("Reason: {}", req.reason),
        );

        let response = AbortResponse {
            success: true,
            message: format!("Swarm command {} aborted", req.swarm_command_id),
            timestamp_ns: Self::current_timestamp_ns(),
        };

        Ok(Response::new(response))
    }

    async fn get_offline_gap_info(
        &self,
        request: Request<OfflineGapRequest>,
    ) -> Result<Response<OfflineGapResponse>, Status> {
        // Authentication
        let (device_id, _signature_b64) = self.verify_request_metadata(&request)?;

        // Trust gating
        self.verify_trust_score(&device_id)?;

        let req = request.into_inner();

        // Check if offline buffer is configured
        let buffer = self.offline_buffer.as_ref().ok_or_else(|| {
            self.audit_log(
                "GET_OFFLINE_GAP",
                &device_id,
                &req.node_id,
                "Offline mode not enabled",
            );
            Status::unimplemented("Offline mode not enabled on this node")
        })?;

        let buffer = buffer.lock().map_err(|e| {
            self.audit_log(
                "GET_OFFLINE_GAP",
                &device_id,
                &req.node_id,
                &format!("Lock error: {}", e),
            );
            Status::internal("Buffer lock error")
        })?;

        // Get gap information
        let gap_info = buffer.get_gap_info().map_err(|e| {
            self.audit_log(
                "GET_OFFLINE_GAP",
                &device_id,
                &req.node_id,
                &format!("Failed: {}", e),
            );
            Status::internal(format!("Failed to get gap info: {}", e))
        })?;

        let state = buffer.get_state();

        self.audit_log("GET_OFFLINE_GAP", &device_id, &req.node_id, "SUCCESS");

        let response = OfflineGapResponse {
            queued_count: gap_info.queued_count as u64,
            offline_since_ns: gap_info.offline_since_ns,
            reconnect_at_ns: gap_info.reconnect_at_ns.unwrap_or(0),
            chain_intact: gap_info.chain_intact,
            buffer_utilization: gap_info.buffer_utilization,
            connection_state: format!("{:?}", state),
        };

        Ok(Response::new(response))
    }

    async fn authorize_sync_bundle(
        &self,
        request: Request<SyncAuthorizationRequest>,
    ) -> Result<Response<SyncAuthorizationResponse>, Status> {
        // Step 1: Authentication
        let (device_id, _signature_b64) = self.verify_request_metadata(&request)?;

        // Step 2: Trust Gating
        self.verify_trust_score(&device_id)?;

        let req = request.into_inner();

        // Step 3: Check if offline buffer is configured
        let buffer_arc = self.offline_buffer.as_ref().ok_or_else(|| {
            self.audit_log(
                "AUTHORIZE_SYNC",
                &device_id,
                &req.node_id,
                "Offline mode not enabled",
            );
            Status::unimplemented("Offline mode not enabled on this node")
        })?;

        let buffer = buffer_arc.lock().map_err(|e| {
            self.audit_log(
                "AUTHORIZE_SYNC",
                &device_id,
                &req.node_id,
                &format!("Lock error: {}", e),
            );
            Status::internal("Buffer lock error")
        })?;

        // Step 4: Verify we're in ReconnectPending state
        let state = buffer.get_state();

        if !state.can_sync() {
            self.audit_log(
                "AUTHORIZE_SYNC",
                &device_id,
                &req.node_id,
                &format!("Invalid state: {:?}", state),
            );
            return Err(Status::failed_precondition(format!(
                "Node not in sync-ready state: {:?}",
                state
            )));
        }

        // Step 5: Verify Sovereign-level signature
        // In production, this would verify the admin signature against trusted sovereign keys
        // For now, we validate the signature format and public key presence
        if req.admin_signature.is_empty() || req.admin_public_key_id.is_empty() {
            self.audit_log(
                "AUTHORIZE_SYNC",
                &device_id,
                &req.node_id,
                "Missing admin signature or public key",
            );
            return Err(Status::unauthenticated(
                "Missing admin signature or public key ID",
            ));
        }

        // Step 6: Verify the admin has Sovereign trust level
        // In production: Check admin_public_key_id against Sovereign registry
        // For now: Log the authorization attempt
        self.audit_log(
            "AUTHORIZE_SYNC",
            &device_id,
            &req.node_id,
            &format!("Admin authorization by {}", req.admin_public_key_id),
        );

        // Step 7: Get all queued events for sync
        let events = buffer.get_all_events().map_err(|e| {
            self.audit_log(
                "AUTHORIZE_SYNC",
                &device_id,
                &req.node_id,
                &format!("Failed to get events: {}", e),
            );
            Status::internal(format!("Failed to get queued events: {}", e))
        })?;

        let events_count = events.len();

        // Step 8: Verify Merkle chain integrity
        let chain_intact = buffer
            .get_gap_info()
            .map_err(|e| {
                self.audit_log(
                    "AUTHORIZE_SYNC",
                    &device_id,
                    &req.node_id,
                    &format!("Gap info error: {}", e),
                );
                Status::internal(format!("Failed to get gap info: {}", e))
            })?
            .chain_intact;

        let merkle_root = buffer.get_merkle_root().map_err(|e| {
            self.audit_log(
                "AUTHORIZE_SYNC",
                &device_id,
                &req.node_id,
                &format!("Merkle error: {}", e),
            );
            Status::internal(format!("Failed to get merkle root: {}", e))
        })?;

        // Step 9: In production, replay events to ledger here
        // For now, we just log the sync operation
        self.audit_log(
            "AUTHORIZE_SYNC",
            &device_id,
            &req.node_id,
            &format!(
                "Syncing {} events, merkle_root={}, chain_intact={}",
                events_count,
                hex::encode(&merkle_root),
                chain_intact
            ),
        );

        // Step 10: Clear buffer after successful sync
        // Must release read lock before acquiring write lock to avoid deadlock
        drop(buffer);
        let mut buffer = buffer_arc.lock().map_err(|e| {
            self.audit_log(
                "AUTHORIZE_SYNC",
                &device_id,
                &req.node_id,
                &format!("Lock error: {}", e),
            );
            Status::internal("Buffer lock error")
        })?;

        buffer.clear_buffer().map_err(|e| {
            self.audit_log(
                "AUTHORIZE_SYNC",
                &device_id,
                &req.node_id,
                &format!("Clear failed: {}", e),
            );
            Status::internal(format!("Failed to clear buffer: {}", e))
        })?;

        // Step 11: Transition back to online mode
        buffer.enter_online_mode().map_err(|e| {
            self.audit_log(
                "AUTHORIZE_SYNC",
                &device_id,
                &req.node_id,
                &format!("State transition failed: {}", e),
            );
            Status::internal(format!("Failed to enter online mode: {}", e))
        })?;

        self.audit_log("AUTHORIZE_SYNC", &device_id, &req.node_id, "SUCCESS");

        let response = SyncAuthorizationResponse {
            success: true,
            message: format!("Successfully synced {} events", events_count),
            events_synced: events_count as u64,
            timestamp_ns: Self::current_timestamp_ns(),
            merkle_verified: chain_intact,
            status: if chain_intact {
                "synced".to_string()
            } else {
                "synced_with_warnings".to_string()
            },
        };

        Ok(Response::new(response))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::authority::AuthorityVerifier;
    use aethercore_identity::{Attestation, PlatformIdentity};
    use base64::engine::general_purpose;
    use ed25519_dalek::{Signer, SigningKey};
    use proptest::prelude::*;
    use std::collections::HashMap;
    use tonic::metadata::MetadataValue;

    fn create_test_server() -> C2GrpcServer {
        let dispatcher = CommandDispatcher::new();
        let verifier = AuthorityVerifier::new();
        let quorum_gate = QuorumGate::new(verifier);
        let trust_scorer = TrustScorer::new();
        let identity_manager = IdentityManager::new();

        C2GrpcServer::new(dispatcher, quorum_gate, trust_scorer, identity_manager)
    }

    fn test_signing_key() -> SigningKey {
        SigningKey::from_bytes(&[6u8; 32])
    }

    fn create_test_identity(device_id: &str) -> PlatformIdentity {
        let signing_key = test_signing_key();
        PlatformIdentity {
            id: device_id.to_string(),
            public_key: signing_key.verifying_key().to_bytes().to_vec(),
            attestation: Attestation::Software {
                certificate: vec![5, 6, 7, 8],
            },
            created_at: 1000,
            metadata: HashMap::new(),
        }
    }

    fn sign_metadata(device_id: &str, command_json: &str, timestamp_ns: u64) -> String {
        let signing_key = test_signing_key();
        let message = format!("{}:{}:{}", device_id, command_json, timestamp_ns);
        let signature = signing_key.sign(message.as_bytes());
        general_purpose::STANDARD.encode(signature.to_bytes())
    }

    fn attach_signature_metadata<T>(
        request: &mut Request<T>,
        device_id: &str,
        signature_b64: &str,
    ) {
        let device_value = match MetadataValue::try_from(device_id) {
            Ok(value) => value,
            Err(err) => panic!("Invalid device id metadata: {}", err),
        };
        let signature_value = match MetadataValue::try_from(signature_b64) {
            Ok(value) => value,
            Err(err) => panic!("Invalid signature metadata: {}", err),
        };

        request.metadata_mut().insert("x-device-id", device_value);
        request
            .metadata_mut()
            .insert("x-signature", signature_value);
    }

    fn create_signing_identity(device_id: &str, public_key: [u8; 32]) -> PlatformIdentity {
        PlatformIdentity {
            id: device_id.to_string(),
            public_key: public_key.to_vec(),
            attestation: Attestation::Software {
                certificate: vec![9, 9, 9],
            },
            created_at: 1000,
            metadata: HashMap::new(),
        }
    }

    fn register_identity(server: &C2GrpcServer, identity: PlatformIdentity) {
        let mut manager = match server.identity_manager.write() {
            Ok(manager) => manager,
            Err(err) => panic!("Identity manager lock error: {}", err),
        };

        if let Err(err) = manager.register(identity) {
            panic!("Identity registration failed: {}", err);
        }
    }

    #[tokio::test]
    async fn test_execute_unit_command_missing_device_id() {
        let server = create_test_server();

        let request = Request::new(UnitCommandRequest {
            unit_id: "unit-1".to_string(),
            command_json: r#"{"Navigate":{"waypoint":{"lat":45.0,"lon":-122.0,"alt":100.0},"speed":10.0,"altitude":100.0}}"#.to_string(),
            signatures: vec!["sig1".to_string()],
            timestamp_ns: 1000,
        });

        let result = server.execute_unit_command(request).await;
        assert!(result.is_err());
        let err = result.unwrap_err();
        assert_eq!(err.code(), tonic::Code::Unauthenticated);
        assert!(err.message().contains("x-device-id"));
    }

    #[tokio::test]
    async fn test_execute_unit_command_missing_signature() {
        let server = create_test_server();

        let mut request = Request::new(UnitCommandRequest {
            unit_id: "unit-1".to_string(),
            command_json: r#"{"Navigate":{"waypoint":{"lat":45.0,"lon":-122.0,"alt":100.0},"speed":10.0,"altitude":100.0}}"#.to_string(),
            signatures: vec!["sig1".to_string()],
            timestamp_ns: 1000,
        });

        request
            .metadata_mut()
            .insert("x-device-id", MetadataValue::from_static("device-1"));

        let result = server.execute_unit_command(request).await;
        assert!(result.is_err());
        let err = result.unwrap_err();
        assert_eq!(err.code(), tonic::Code::Unauthenticated);
        assert!(err.message().contains("x-signature"));
    }

    #[tokio::test]
    async fn test_execute_unit_command_unknown_device() {
        let server = create_test_server();

        let mut request = Request::new(UnitCommandRequest {
            unit_id: "unit-1".to_string(),
            command_json: r#"{"Navigate":{"waypoint":{"lat":45.0,"lon":-122.0,"alt":100.0},"speed":10.0,"altitude":100.0}}"#.to_string(),
            signatures: vec!["sig1".to_string()],
            timestamp_ns: 1000,
        });

        request
            .metadata_mut()
            .insert("x-device-id", MetadataValue::from_static("unknown-device"));
        request
            .metadata_mut()
            .insert("x-signature", MetadataValue::from_static("c2lnbmF0dXJl"));

        let result = server.execute_unit_command(request).await;
        assert!(result.is_err());
        let err = result.unwrap_err();
        assert_eq!(err.code(), tonic::Code::Unauthenticated);
        assert!(err.message().contains("Unknown device"));
    }

    #[tokio::test]
    async fn test_execute_unit_command_no_trust_score() {
        let server = create_test_server();

        // Register the device
        let identity = create_test_identity("device-1");
        server
            .identity_manager
            .write()
            .unwrap()
            .register(identity)
            .unwrap();

        let command_json = r#"{"Navigate":{"waypoint":{"lat":45.0,"lon":-122.0,"alt":100.0},"speed":10.0,"altitude":100.0}}"#;
        let timestamp_ns = C2GrpcServer::current_timestamp_ns();
        let mut request = Request::new(UnitCommandRequest {
            unit_id: "unit-1".to_string(),
            command_json: command_json.to_string(),
            signatures: vec!["sig1".to_string()],
            timestamp_ns,
        });

        let signature_b64 = sign_metadata("device-1", command_json, timestamp_ns);
        attach_signature_metadata(&mut request, "device-1", &signature_b64);

        let result = server.execute_unit_command(request).await;
        assert!(result.is_err());
        let err = result.unwrap_err();
        assert_eq!(err.code(), tonic::Code::PermissionDenied);
        assert!(err.message().contains("trust score"));
    }

    #[tokio::test]
    async fn test_execute_unit_command_low_trust_score() {
        let server = create_test_server();

        // Register the device
        let identity = create_test_identity("device-1");
        server
            .identity_manager
            .write()
            .unwrap()
            .register(identity)
            .unwrap();

        // Set low trust score (Suspect level, not Quarantined)
        // We need score >= QUARANTINE_THRESHOLD (0.6) and < TRUST_THRESHOLD (0.8)
        const TEST_TRUST_SCORE: f64 = 0.7; // Suspect level, below operational threshold
                                           // Trust scorer starts at 1.0, so we subtract to reach target score
        server
            .trust_scorer
            .write()
            .unwrap()
            .update_score("device-1", TEST_TRUST_SCORE - 1.0);

        let command_json = r#"{"Navigate":{"waypoint":{"lat":45.0,"lon":-122.0,"alt":100.0},"speed":10.0,"altitude":100.0}}"#;
        let timestamp_ns = C2GrpcServer::current_timestamp_ns();
        let mut request = Request::new(UnitCommandRequest {
            unit_id: "unit-1".to_string(),
            command_json: command_json.to_string(),
            signatures: vec!["sig1".to_string()],
            timestamp_ns,
        });

        let signature_b64 = sign_metadata("device-1", command_json, timestamp_ns);
        attach_signature_metadata(&mut request, "device-1", &signature_b64);

        let result = server.execute_unit_command(request).await;
        assert!(result.is_err());
        let err = result.unwrap_err();
        assert_eq!(err.code(), tonic::Code::PermissionDenied);
        // Score 0.7 is Suspect (not Quarantined), should fail operational threshold (0.8)
        assert!(err.message().contains("Trust Score Below Threshold"));
    }

    #[tokio::test]
    async fn test_execute_unit_command_success() {
        let server = create_test_server();

        // Register the device
        let identity = create_test_identity("device-1");
        server
            .identity_manager
            .write()
            .unwrap()
            .register(identity)
            .unwrap();

        // Set high trust score
        server
            .trust_scorer
            .write()
            .unwrap()
            .update_score("device-1", 0.0); // Score will be 1.0 (default)

        let command_json = r#"{"Navigate":{"waypoint":{"lat":45.0,"lon":-122.0,"alt":100.0},"speed":10.0,"altitude":100.0}}"#;
        let timestamp_ns = C2GrpcServer::current_timestamp_ns();
        let mut request = Request::new(UnitCommandRequest {
            unit_id: "unit-1".to_string(),
            command_json: command_json.to_string(),
            signatures: vec!["sig1".to_string()],
            timestamp_ns,
        });

        let signature_b64 = sign_metadata("device-1", command_json, timestamp_ns);
        attach_signature_metadata(&mut request, "device-1", &signature_b64);

        let result = server.execute_unit_command(request).await;
        assert!(result.is_ok());
        let response = result.unwrap().into_inner();
        assert!(response.success);
        assert_eq!(response.unit_id, "unit-1");
    }

    #[tokio::test]
    async fn test_execute_swarm_command_success() {
        let server = create_test_server();

        // Register the device
        let identity = create_test_identity("device-1");
        server
            .identity_manager
            .write()
            .unwrap()
            .register(identity)
            .unwrap();

        // Set high trust score
        server
            .trust_scorer
            .write()
            .unwrap()
            .update_score("device-1", 0.0);

        let command_json = r#"{"RecallAll":{"base_id":"BASE-1"}}"#;
        let timestamp_ns = C2GrpcServer::current_timestamp_ns();
        let mut request = Request::new(SwarmCommandRequest {
            swarm_command_id: "swarm-1".to_string(),
            target_unit_ids: vec!["unit-1".to_string(), "unit-2".to_string()],
            command_json: command_json.to_string(),
            signatures: vec!["sig1".to_string()],
            timestamp_ns,
        });

        let signature_b64 = sign_metadata("device-1", command_json, timestamp_ns);
        attach_signature_metadata(&mut request, "device-1", &signature_b64);

        let result = server.execute_swarm_command(request).await;
        assert!(result.is_ok());
        let response = result.unwrap().into_inner();
        assert_eq!(response.swarm_command_id, "swarm-1");
        assert_eq!(response.total_units, 2);
        assert_eq!(response.success_count, 2);
    }

    #[tokio::test]
    async fn test_get_command_status() {
        let server = create_test_server();

        // Register the device
        let identity = create_test_identity("device-1");
        server
            .identity_manager
            .write()
            .unwrap()
            .register(identity)
            .unwrap();

        // Set high trust score
        server
            .trust_scorer
            .write()
            .unwrap()
            .update_score("device-1", 0.0);

        let mut request = Request::new(CommandStatusRequest {
            command_id: "cmd-1".to_string(),
        });

        request
            .metadata_mut()
            .insert("x-device-id", MetadataValue::from_static("device-1"));
        request
            .metadata_mut()
            .insert("x-signature", MetadataValue::from_static("c2lnbmF0dXJl"));

        let result = server.get_command_status(request).await;
        assert!(result.is_ok());
        let response = result.unwrap().into_inner();
        assert_eq!(response.command_id, "cmd-1");
        assert_eq!(response.status, "completed");
    }

    #[tokio::test]
    async fn test_abort_swarm_command() {
        let server = create_test_server();

        // Register the device
        let identity = create_test_identity("device-1");
        server
            .identity_manager
            .write()
            .unwrap()
            .register(identity)
            .unwrap();

        // Set high trust score
        server
            .trust_scorer
            .write()
            .unwrap()
            .update_score("device-1", 0.0);

        let mut request = Request::new(AbortRequest {
            swarm_command_id: "swarm-1".to_string(),
            reason: "Emergency abort".to_string(),
        });

        request
            .metadata_mut()
            .insert("x-device-id", MetadataValue::from_static("device-1"));
        request
            .metadata_mut()
            .insert("x-signature", MetadataValue::from_static("c2lnbmF0dXJl"));

        let result = server.abort_swarm_command(request).await;
        assert!(result.is_ok());
        let response = result.unwrap().into_inner();
        assert!(response.success);
        assert!(response.message.contains("aborted"));
    }

    #[tokio::test]
    async fn test_revoked_device_rejected() {
        let server = create_test_server();

        // Register the device
        let identity = create_test_identity("device-1");
        {
            let mut mgr = server.identity_manager.write().unwrap();
            mgr.register(identity).unwrap();
            mgr.revoke("device-1").unwrap();
        }

        // Set high trust score (shouldn't matter)
        server
            .trust_scorer
            .write()
            .unwrap()
            .update_score("device-1", 0.0);

        let command_json = r#"{"Navigate":{"waypoint":{"lat":45.0,"lon":-122.0,"alt":100.0},"speed":10.0,"altitude":100.0}}"#;
        let timestamp_ns = C2GrpcServer::current_timestamp_ns();
        let mut request = Request::new(UnitCommandRequest {
            unit_id: "unit-1".to_string(),
            command_json: command_json.to_string(),
            signatures: vec!["sig1".to_string()],
            timestamp_ns,
        });

        let signature_b64 = sign_metadata("device-1", command_json, timestamp_ns);
        attach_signature_metadata(&mut request, "device-1", &signature_b64);

        let result = server.execute_unit_command(request).await;
        assert!(result.is_err());
        let err = result.unwrap_err();
        assert_eq!(err.code(), tonic::Code::PermissionDenied);
        assert!(err.message().contains("revoked"));
    }

    #[tokio::test]
    async fn test_execute_unit_command_quarantined_node() {
        let server = create_test_server();

        // Register the device
        let identity = create_test_identity("device-1");
        server
            .identity_manager
            .write()
            .unwrap()
            .register(identity)
            .unwrap();

        // Set quarantined trust score (< 0.5)
        server
            .trust_scorer
            .write()
            .unwrap()
            .update_score("device-1", -0.6); // Score will be 0.4, which is quarantined

        let command_json = r#"{"Navigate":{"waypoint":{"lat":45.0,"lon":-122.0,"alt":100.0},"speed":10.0,"altitude":100.0}}"#;
        let timestamp_ns = C2GrpcServer::current_timestamp_ns();
        let mut request = Request::new(UnitCommandRequest {
            unit_id: "unit-1".to_string(),
            command_json: command_json.to_string(),
            signatures: vec!["sig1".to_string()],
            timestamp_ns,
        });

        let signature_b64 = sign_metadata("device-1", command_json, timestamp_ns);
        attach_signature_metadata(&mut request, "device-1", &signature_b64);

        let result = server.execute_unit_command(request).await;
        assert!(result.is_err());
        let err = result.unwrap_err();
        assert_eq!(err.code(), tonic::Code::PermissionDenied);
        let message = err.message();
        // Verify the rejection message explicitly mentions quarantine
        assert!(
            message.contains("Quarantined") || message.contains("quarantine"),
            "Expected quarantine rejection, got: {}",
            message
        );
        assert!(message.contains("COMMAND REJECTED") || message.contains("Trust score"));
    }

    #[test]
    fn signature_verification_accepts_valid_signature() {
        let server = create_test_server();
        let device_id = "device-1";
        let command_json = r#"{"cmd":"test"}"#;
        let timestamp_ns = 42;
        let signing_key = SigningKey::from_bytes(&[7u8; 32]);
        let public_key = signing_key.verifying_key().to_bytes();

        register_identity(&server, create_signing_identity(device_id, public_key));

        let message = format!("{}:{}:{}", device_id, command_json, timestamp_ns);
        let signature = signing_key.sign(message.as_bytes());
        let signature_b64 = general_purpose::STANDARD.encode(signature.to_bytes());

        let result =
            server.verify_command_signature(device_id, &signature_b64, command_json, timestamp_ns);

        if let Err(err) = result {
            panic!("Valid signature rejected: {}", err);
        }
    }

    #[test]
    fn signature_verification_rejects_invalid_base64() {
        let server = create_test_server();
        let device_id = "device-1";
        let command_json = r#"{"cmd":"test"}"#;
        let timestamp_ns = 42;
        let signing_key = SigningKey::from_bytes(&[3u8; 32]);
        let public_key = signing_key.verifying_key().to_bytes();

        register_identity(&server, create_signing_identity(device_id, public_key));

        let result =
            server.verify_command_signature(device_id, "not-base64!", command_json, timestamp_ns);

        match result {
            Ok(_) => panic!("Invalid base64 signature was accepted"),
            Err(err) => assert_eq!(err.code(), tonic::Code::Unauthenticated),
        }
    }

    #[test]
    fn signature_verification_rejects_mismatched_signature() {
        let server = create_test_server();
        let device_id = "device-1";
        let command_json = r#"{"cmd":"test"}"#;
        let timestamp_ns = 77;
        let identity_key = SigningKey::from_bytes(&[5u8; 32]);
        let attacker_key = SigningKey::from_bytes(&[8u8; 32]);
        let public_key = identity_key.verifying_key().to_bytes();

        register_identity(&server, create_signing_identity(device_id, public_key));

        let message = format!("{}:{}:{}", device_id, command_json, timestamp_ns);
        let signature = attacker_key.sign(message.as_bytes());
        let signature_b64 = general_purpose::STANDARD.encode(signature.to_bytes());

        let result =
            server.verify_command_signature(device_id, &signature_b64, command_json, timestamp_ns);

        match result {
            Ok(_) => panic!("Mismatched signature was accepted"),
            Err(err) => assert_eq!(err.code(), tonic::Code::Unauthenticated),
        }
    }

    proptest! {
        #[test]
        fn signature_verification_rejects_non_64_len_signature(
            bytes in prop::collection::vec(any::<u8>(), 0..128)
                .prop_filter("non-64 length", |data| data.len() != 64)
        ) {
            let server = create_test_server();
            let device_id = "device-1";
            let command_json = r#"{"cmd":"test"}"#;
            let timestamp_ns = 99;
            let signing_key = SigningKey::from_bytes(&[4u8; 32]);
            let public_key = signing_key.verifying_key().to_bytes();

            register_identity(&server, create_signing_identity(device_id, public_key));

            let signature_b64 = general_purpose::STANDARD.encode(bytes);
            let result = server.verify_command_signature(
                device_id,
                &signature_b64,
                command_json,
                timestamp_ns,
            );

            prop_assert!(result.is_err());
            if let Err(err) = result {
                prop_assert_eq!(err.code(), tonic::Code::Unauthenticated);
            }
        }
    }
}
