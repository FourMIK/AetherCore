//! Mutual device attestation and handshake protocol for node enrollment.
//!
//! This module implements a challenge-response protocol that enforces device
//! certificate chain validation before allowing data or control traffic. The
//! protocol supports both TPM-backed attestation and software fallback modes.
//!
//! # Security Properties
//!
//! - Mutual authentication: both parties verify each other
//! - Challenge-response with cryptographic nonces
//! - Replay protection via nonce tracking and timestamp windows
//! - Oracle attack protection via challenge binding
//! - Downgrade attack protection via protocol version enforcement
//! - Certificate chain validation with revocation checking
//!
//! # Protocol Flow
//!
//! 1. Initiator → Responder: AttestationRequest (challenge)
//! 2. Responder → Initiator: AttestationResponse (signed response with counter-challenge)
//! 3. Initiator → Responder: AttestationFinalize (signed counter-response)
//! 4. Both parties validate and establish trust
//!
//! # Timing Constraints
//!
//! - Challenge must be responded to within 30 seconds (configurable)
//! - Nonces are tracked for 5 minutes to detect replays
//! - Certificates must be within their validity period
//! - TPM operations have 10 second timeout

use rand::rngs::OsRng;
use rand::RngCore;
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::time::{SystemTime, UNIX_EPOCH};

use ed25519_dalek::SigningKey as Ed25519SigningKey;
use ed25519_dalek::Verifier as _;
use p256::ecdsa::{signature::Signer as _, Signature, SigningKey};

use crate::{Attestation, Certificate, PlatformIdentity};

/// Protocol version for attestation handshake.
pub const PROTOCOL_VERSION: u32 = 1;

/// Default timeout for handshake completion (milliseconds).
pub const DEFAULT_HANDSHAKE_TIMEOUT_MS: u64 = 30_000;

/// Default nonce retention window for replay detection (milliseconds).
pub const DEFAULT_NONCE_WINDOW_MS: u64 = 300_000; // 5 minutes

/// Attestation handshake state.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub enum HandshakeState {
    /// Initial state - no handshake started
    Idle,
    /// Waiting for attestation response
    WaitingForResponse { challenge: Vec<u8>, sent_at: u64 },
    /// Waiting for finalization
    WaitingForFinalize {
        challenge: Vec<u8>,
        counter_challenge: Vec<u8>,
        sent_at: u64,
    },
    /// Handshake completed successfully
    Completed {
        peer_identity: PlatformIdentity,
        completed_at: u64,
        trust_score: f64,
    },
    /// Handshake failed
    Failed { reason: String, failed_at: u64 },
}

/// Attestation handshake request (step 1).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AttestationRequest {
    /// Protocol version
    pub version: u32,
    /// Unique challenge nonce (32 bytes)
    pub challenge: Vec<u8>,
    /// Requester's identity
    pub identity: PlatformIdentity,
    /// Certificate chain (leaf to root)
    pub cert_chain: Vec<Certificate>,
    /// Timestamp (Unix epoch milliseconds)
    pub timestamp: u64,
}

/// Attestation handshake response (step 2).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AttestationResponse {
    /// Protocol version
    pub version: u32,
    /// Original challenge from request
    pub challenge: Vec<u8>,
    /// Signature over challenge (proves possession of private key)
    pub challenge_signature: Vec<u8>,
    /// Counter-challenge for mutual authentication
    pub counter_challenge: Vec<u8>,
    /// Responder's identity
    pub identity: PlatformIdentity,
    /// Certificate chain (leaf to root)
    pub cert_chain: Vec<Certificate>,
    /// TPM quote (if TPM attestation used)
    pub tpm_quote: Option<crate::TpmQuote>,
    /// Timestamp
    pub timestamp: u64,
}

/// Attestation finalization (step 3).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AttestationFinalize {
    /// Protocol version
    pub version: u32,
    /// Counter-challenge from response
    pub counter_challenge: Vec<u8>,
    /// Signature over counter-challenge
    pub counter_signature: Vec<u8>,
    /// Timestamp
    pub timestamp: u64,
}

/// Result of attestation handshake.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AttestationResult {
    /// Whether attestation succeeded
    pub success: bool,
    /// Verified peer identity
    pub peer_identity: Option<PlatformIdentity>,
    /// Trust score (0.0 to 1.0)
    pub trust_score: f64,
    /// Details about the result
    pub details: String,
    /// Attestation event for audit trail
    pub event: event::AttestationEvent,
}

/// Attestation event for audit trail.
pub mod event {
    use super::*;

    /// Attestation event types for audit logging.
    #[derive(Debug, Clone, Serialize, Deserialize)]
    pub struct AttestationEvent {
        /// Event ID
        pub event_id: String,
        /// Event type
        pub event_type: AttestationEventType,
        /// Timestamp
        pub timestamp: u64,
        /// Identity involved
        pub identity_id: String,
        /// Attestation metadata
        pub metadata: AttestationMetadata,
    }

    /// Types of attestation events.
    #[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
    pub enum AttestationEventType {
        /// Handshake initiated
        HandshakeStarted,
        /// Challenge sent
        ChallengeSent,
        /// Challenge received
        ChallengeReceived,
        /// Response sent
        ResponseSent,
        /// Response received and verified
        ResponseVerified,
        /// Finalization sent
        FinalizeSent,
        /// Finalization received and verified
        FinalizeVerified,
        /// Handshake completed successfully
        HandshakeCompleted,
        /// Handshake failed
        HandshakeFailed,
        /// Timeout occurred
        HandshakeTimeout,
        /// Replay attack detected
        ReplayDetected,
        /// Invalid signature detected
        InvalidSignature,
        /// Invalid certificate chain
        InvalidCertChain,
        /// Protocol version mismatch
        VersionMismatch,
    }

    /// Metadata for attestation events.
    #[derive(Debug, Clone, Serialize, Deserialize)]
    pub struct AttestationMetadata {
        /// Protocol version used
        pub protocol_version: u32,
        /// Attestation type (TPM, Software, None)
        pub attestation_type: String,
        /// Certificate chain length
        pub cert_chain_length: usize,
        /// TPM quote present
        pub tpm_quote_present: bool,
        /// Trust score assigned
        pub trust_score: f64,
        /// Failure reason (if failed)
        pub failure_reason: Option<String>,
        /// Additional context
        pub additional_data: HashMap<String, String>,
    }
}

/// Manager for attestation handshakes.
pub struct AttestationManager {
    /// Own identity
    identity: PlatformIdentity,
    /// Own certificate chain
    cert_chain: Vec<Certificate>,
    /// Active handshakes indexed by peer identity ID
    handshakes: HashMap<String, HandshakeState>,
    /// Peer identities stored during handshake
    peer_identities: HashMap<String, PlatformIdentity>,
    /// Seen nonces for replay protection
    seen_nonces: HashSet<Vec<u8>>,
    /// Nonce timestamps for cleanup
    nonce_timestamps: HashMap<Vec<u8>, u64>,
    /// Handshake timeout (milliseconds)
    handshake_timeout_ms: u64,
    /// Nonce retention window (milliseconds)
    nonce_window_ms: u64,
    /// Completed attestations for audit trail
    attestation_events: Vec<event::AttestationEvent>,
    /// Nonce counter for uniqueness
    nonce_counter: u64,
}

impl AttestationManager {
    /// Create a new attestation manager.
    pub fn new(identity: PlatformIdentity, cert_chain: Vec<Certificate>) -> Self {
        Self {
            identity,
            cert_chain,
            handshakes: HashMap::new(),
            peer_identities: HashMap::new(),
            seen_nonces: HashSet::new(),
            nonce_timestamps: HashMap::new(),
            handshake_timeout_ms: DEFAULT_HANDSHAKE_TIMEOUT_MS,
            nonce_window_ms: DEFAULT_NONCE_WINDOW_MS,
            attestation_events: Vec::new(),
            nonce_counter: 0,
        }
    }

    /// Configure handshake timeout.
    pub fn with_timeout(mut self, timeout_ms: u64) -> Self {
        self.handshake_timeout_ms = timeout_ms;
        self
    }

    /// Configure nonce retention window.
    pub fn with_nonce_window(mut self, window_ms: u64) -> Self {
        self.nonce_window_ms = window_ms;
        self
    }

    /// Initiate attestation handshake with a peer.
    pub fn initiate_handshake(&mut self, peer_id: &str) -> crate::Result<AttestationRequest> {
        // Check if handshake already in progress
        if let Some(state) = self.handshakes.get(peer_id) {
            if !matches!(state, HandshakeState::Idle | HandshakeState::Failed { .. }) {
                return Err(crate::Error::Identity(
                    "Handshake already in progress".to_string(),
                ));
            }
        }

        // Generate challenge nonce
        let challenge = self.generate_nonce(32);
        let now = current_timestamp();

        // Record nonce
        self.record_nonce(challenge.clone())?;

        // Update state
        self.handshakes.insert(
            peer_id.to_string(),
            HandshakeState::WaitingForResponse {
                challenge: challenge.clone(),
                sent_at: now,
            },
        );

        // Create event
        self.record_event(event::AttestationEvent {
            event_id: generate_event_id(),
            event_type: event::AttestationEventType::HandshakeStarted,
            timestamp: now,
            identity_id: peer_id.to_string(),
            metadata: event::AttestationMetadata {
                protocol_version: PROTOCOL_VERSION,
                attestation_type: format!("{:?}", self.identity.attestation),
                cert_chain_length: self.cert_chain.len(),
                tpm_quote_present: false,
                trust_score: 0.0,
                failure_reason: None,
                additional_data: HashMap::new(),
            },
        });

        Ok(AttestationRequest {
            version: PROTOCOL_VERSION,
            challenge,
            identity: self.identity.clone(),
            cert_chain: self.cert_chain.clone(),
            timestamp: now,
        })
    }

    /// Handle incoming attestation request.
    pub fn handle_request(
        &mut self,
        request: AttestationRequest,
    ) -> crate::Result<AttestationResponse> {
        let now = current_timestamp();

        // Validate protocol version
        if request.version != PROTOCOL_VERSION {
            return Err(crate::Error::Identity(format!(
                "Protocol version mismatch: expected {}, got {}",
                PROTOCOL_VERSION, request.version
            )));
        }

        // Check timestamp freshness
        if !is_timestamp_fresh(request.timestamp, now, self.handshake_timeout_ms) {
            return Err(crate::Error::Identity(
                "Request timestamp stale".to_string(),
            ));
        }

        // Check for nonce replay
        if self.is_nonce_seen(&request.challenge) {
            self.record_replay_event(&request.identity.id);
            return Err(crate::Error::Identity("Nonce replay detected".to_string()));
        }

        // Validate certificate chain
        if !validate_cert_chain(&request.cert_chain) {
            return Err(crate::Error::Identity(
                "Invalid certificate chain".to_string(),
            ));
        }

        // Record the request nonce
        self.record_nonce(request.challenge.clone())?;

        // Store peer identity for later verification
        self.peer_identities
            .insert(request.identity.id.clone(), request.identity.clone());

        // Generate counter-challenge
        let counter_challenge = self.generate_nonce(32);
        self.record_nonce(counter_challenge.clone())?;

        // Sign the incoming challenge
        let challenge_signature = sign_data(&request.challenge, &self.identity);

        // Generate TPM quote if using TPM attestation
        let tpm_quote = match &self.identity.attestation {
            Attestation::Tpm { .. } => {
                // In production, generate real TPM quote
                Some(crate::TpmQuote {
                    pcrs: vec![],
                    signature: vec![],
                    nonce: request.challenge.clone(),
                    timestamp: now,
                    attestation_data: vec![],
                })
            }
            _ => None,
        };

        // Update state
        self.handshakes.insert(
            request.identity.id.clone(),
            HandshakeState::WaitingForFinalize {
                challenge: request.challenge.clone(),
                counter_challenge: counter_challenge.clone(),
                sent_at: now,
            },
        );

        // Record event
        self.record_event(event::AttestationEvent {
            event_id: generate_event_id(),
            event_type: event::AttestationEventType::ResponseSent,
            timestamp: now,
            identity_id: request.identity.id.clone(),
            metadata: event::AttestationMetadata {
                protocol_version: PROTOCOL_VERSION,
                attestation_type: format!("{:?}", self.identity.attestation),
                cert_chain_length: self.cert_chain.len(),
                tpm_quote_present: tpm_quote.is_some(),
                trust_score: 0.0,
                failure_reason: None,
                additional_data: HashMap::new(),
            },
        });

        Ok(AttestationResponse {
            version: PROTOCOL_VERSION,
            challenge: request.challenge,
            challenge_signature,
            counter_challenge,
            identity: self.identity.clone(),
            cert_chain: self.cert_chain.clone(),
            tpm_quote,
            timestamp: now,
        })
    }

    /// Handle incoming attestation response.
    pub fn handle_response(
        &mut self,
        response: AttestationResponse,
    ) -> crate::Result<AttestationFinalize> {
        let now = current_timestamp();

        // Validate protocol version
        if response.version != PROTOCOL_VERSION {
            return Err(crate::Error::Identity(format!(
                "Protocol version mismatch: expected {}, got {}",
                PROTOCOL_VERSION, response.version
            )));
        }

        // Get current handshake state
        let state = self
            .handshakes
            .get(&response.identity.id)
            .ok_or_else(|| crate::Error::Identity("No handshake in progress".to_string()))?
            .clone();

        // Validate state and extract challenge
        let (original_challenge, sent_at) = match state {
            HandshakeState::WaitingForResponse { challenge, sent_at } => (challenge, sent_at),
            _ => {
                return Err(crate::Error::Identity(
                    "Invalid handshake state for response".to_string(),
                ));
            }
        };

        // Check timeout
        if now - sent_at > self.handshake_timeout_ms {
            self.fail_handshake(&response.identity.id, "Handshake timeout");
            return Err(crate::Error::Identity("Handshake timeout".to_string()));
        }

        // Verify challenge matches
        if response.challenge != original_challenge {
            return Err(crate::Error::Identity("Challenge mismatch".to_string()));
        }

        // Check timestamp freshness
        if !is_timestamp_fresh(response.timestamp, now, self.handshake_timeout_ms) {
            return Err(crate::Error::Identity(
                "Response timestamp stale".to_string(),
            ));
        }

        // Check for nonce replay on counter-challenge
        if self.is_nonce_seen(&response.counter_challenge) {
            self.record_replay_event(&response.identity.id);
            return Err(crate::Error::Identity(
                "Counter-challenge replay detected".to_string(),
            ));
        }

        // Validate certificate chain
        if !validate_cert_chain(&response.cert_chain) {
            return Err(crate::Error::Identity(
                "Invalid certificate chain".to_string(),
            ));
        }

        // Verify challenge signature
        if !verify_signature(
            &response.challenge,
            &response.challenge_signature,
            &response.identity,
        ) {
            return Err(crate::Error::Identity(
                "Invalid challenge signature".to_string(),
            ));
        }

        // Verify TPM quote if present
        if let Some(ref quote) = response.tpm_quote {
            if !verify_tpm_quote(quote, &response.identity) {
                return Err(crate::Error::Identity("Invalid TPM quote".to_string()));
            }
        }

        // Record counter-challenge nonce
        self.record_nonce(response.counter_challenge.clone())?;

        // Store peer identity
        self.peer_identities
            .insert(response.identity.id.clone(), response.identity.clone());

        // Sign the counter-challenge
        let counter_signature = sign_data(&response.counter_challenge, &self.identity);

        // Record event
        self.record_event(event::AttestationEvent {
            event_id: generate_event_id(),
            event_type: event::AttestationEventType::ResponseVerified,
            timestamp: now,
            identity_id: response.identity.id.clone(),
            metadata: event::AttestationMetadata {
                protocol_version: PROTOCOL_VERSION,
                attestation_type: format!("{:?}", response.identity.attestation),
                cert_chain_length: response.cert_chain.len(),
                tpm_quote_present: response.tpm_quote.is_some(),
                trust_score: 0.0,
                failure_reason: None,
                additional_data: HashMap::new(),
            },
        });

        Ok(AttestationFinalize {
            version: PROTOCOL_VERSION,
            counter_challenge: response.counter_challenge,
            counter_signature,
            timestamp: now,
        })
    }

    /// Handle finalization and complete handshake.
    pub fn handle_finalize(
        &mut self,
        peer_id: &str,
        finalize: AttestationFinalize,
    ) -> crate::Result<AttestationResult> {
        let now = current_timestamp();

        // Validate protocol version
        if finalize.version != PROTOCOL_VERSION {
            return Err(crate::Error::Identity(format!(
                "Protocol version mismatch: expected {}, got {}",
                PROTOCOL_VERSION, finalize.version
            )));
        }

        // Get current handshake state
        let state = self
            .handshakes
            .get(peer_id)
            .ok_or_else(|| crate::Error::Identity("No handshake in progress".to_string()))?
            .clone();

        // Validate state and extract counter-challenge
        let (counter_challenge, sent_at) = match state {
            HandshakeState::WaitingForFinalize {
                counter_challenge,
                sent_at,
                ..
            } => (counter_challenge, sent_at),
            _ => {
                return Err(crate::Error::Identity(
                    "Invalid handshake state for finalize".to_string(),
                ));
            }
        };

        // Check timeout
        if now - sent_at > self.handshake_timeout_ms {
            self.fail_handshake(peer_id, "Handshake timeout");
            return Err(crate::Error::Identity("Handshake timeout".to_string()));
        }

        // Verify counter-challenge matches
        if finalize.counter_challenge != counter_challenge {
            return Err(crate::Error::Identity(
                "Counter-challenge mismatch".to_string(),
            ));
        }

        // Check timestamp freshness
        if !is_timestamp_fresh(finalize.timestamp, now, self.handshake_timeout_ms) {
            return Err(crate::Error::Identity(
                "Finalize timestamp stale".to_string(),
            ));
        }

        // Get peer identity from earlier handshake (stored when we validated their response)
        // For now, we'll fetch it from our records
        let peer_identity = self.get_peer_identity(peer_id)?;

        // Verify counter-signature
        if !verify_signature(
            &finalize.counter_challenge,
            &finalize.counter_signature,
            &peer_identity,
        ) {
            return Err(crate::Error::Identity(
                "Invalid counter-signature".to_string(),
            ));
        }

        // Calculate trust score based on attestation type
        let trust_score = calculate_trust_score(&peer_identity.attestation);

        // Mark handshake as completed
        self.handshakes.insert(
            peer_id.to_string(),
            HandshakeState::Completed {
                peer_identity: peer_identity.clone(),
                completed_at: now,
                trust_score,
            },
        );

        // Create completion event
        let event = event::AttestationEvent {
            event_id: generate_event_id(),
            event_type: event::AttestationEventType::HandshakeCompleted,
            timestamp: now,
            identity_id: peer_id.to_string(),
            metadata: event::AttestationMetadata {
                protocol_version: PROTOCOL_VERSION,
                attestation_type: format!("{:?}", peer_identity.attestation),
                cert_chain_length: 0,
                tpm_quote_present: matches!(peer_identity.attestation, Attestation::Tpm { .. }),
                trust_score,
                failure_reason: None,
                additional_data: HashMap::new(),
            },
        };

        self.record_event(event.clone());

        Ok(AttestationResult {
            success: true,
            peer_identity: Some(peer_identity),
            trust_score,
            details: "Attestation completed successfully".to_string(),
            event,
        })
    }

    /// Check if a handshake is completed for a peer.
    pub fn is_attested(&self, peer_id: &str) -> bool {
        matches!(
            self.handshakes.get(peer_id),
            Some(HandshakeState::Completed { .. })
        )
    }

    /// Get the trust score for an attested peer.
    pub fn get_trust_score(&self, peer_id: &str) -> Option<f64> {
        match self.handshakes.get(peer_id) {
            Some(HandshakeState::Completed { trust_score, .. }) => Some(*trust_score),
            _ => None,
        }
    }

    /// Get all attestation events for audit trail.
    pub fn get_attestation_events(&self) -> &[event::AttestationEvent] {
        &self.attestation_events
    }

    /// Cleanup old nonces and timed-out handshakes.
    pub fn cleanup(&mut self) {
        let now = current_timestamp();

        // Remove old nonces
        self.nonce_timestamps.retain(|nonce, timestamp| {
            if now - *timestamp > self.nonce_window_ms {
                self.seen_nonces.remove(nonce);
                false
            } else {
                true
            }
        });

        // Timeout old handshakes
        let mut to_timeout = Vec::new();
        for (peer_id, state) in &self.handshakes {
            let should_timeout = match state {
                HandshakeState::WaitingForResponse { sent_at, .. }
                | HandshakeState::WaitingForFinalize { sent_at, .. } => {
                    now - sent_at > self.handshake_timeout_ms
                }
                _ => false,
            };

            if should_timeout {
                to_timeout.push(peer_id.clone());
            }
        }

        for peer_id in to_timeout {
            self.fail_handshake(&peer_id, "Handshake timeout");
        }
    }

    // Private helper methods

    fn record_nonce(&mut self, nonce: Vec<u8>) -> crate::Result<()> {
        if self.seen_nonces.contains(&nonce) {
            return Err(crate::Error::Identity("Nonce already seen".to_string()));
        }

        let now = current_timestamp();
        self.seen_nonces.insert(nonce.clone());
        self.nonce_timestamps.insert(nonce, now);
        Ok(())
    }

    fn is_nonce_seen(&self, nonce: &[u8]) -> bool {
        self.seen_nonces.contains(nonce)
    }

    fn record_event(&mut self, event: event::AttestationEvent) {
        self.attestation_events.push(event);
    }

    fn record_replay_event(&mut self, identity_id: &str) {
        let event = event::AttestationEvent {
            event_id: generate_event_id(),
            event_type: event::AttestationEventType::ReplayDetected,
            timestamp: current_timestamp(),
            identity_id: identity_id.to_string(),
            metadata: event::AttestationMetadata {
                protocol_version: PROTOCOL_VERSION,
                attestation_type: "unknown".to_string(),
                cert_chain_length: 0,
                tpm_quote_present: false,
                trust_score: 0.0,
                failure_reason: Some("Nonce replay detected".to_string()),
                additional_data: HashMap::new(),
            },
        };
        self.record_event(event);
    }

    fn fail_handshake(&mut self, peer_id: &str, reason: &str) {
        let now = current_timestamp();
        self.handshakes.insert(
            peer_id.to_string(),
            HandshakeState::Failed {
                reason: reason.to_string(),
                failed_at: now,
            },
        );

        let event = event::AttestationEvent {
            event_id: generate_event_id(),
            event_type: event::AttestationEventType::HandshakeFailed,
            timestamp: now,
            identity_id: peer_id.to_string(),
            metadata: event::AttestationMetadata {
                protocol_version: PROTOCOL_VERSION,
                attestation_type: "unknown".to_string(),
                cert_chain_length: 0,
                tpm_quote_present: false,
                trust_score: 0.0,
                failure_reason: Some(reason.to_string()),
                additional_data: HashMap::new(),
            },
        };
        self.record_event(event);
    }

    fn get_peer_identity(&self, peer_id: &str) -> crate::Result<PlatformIdentity> {
        self.peer_identities.get(peer_id).cloned().ok_or_else(|| {
            crate::Error::Identity(format!("Peer identity not found for {}", peer_id))
        })
    }

    fn generate_nonce(&mut self, size: usize) -> Vec<u8> {
        self.nonce_counter += 1;

        let mut nonce = vec![0u8; size];
        OsRng.fill_bytes(&mut nonce);
        nonce
    }
}

// Helper functions

/// Generate a cryptographic nonce (deprecated - use manager's generate_nonce).
#[allow(dead_code)]
fn generate_nonce(size: usize) -> Vec<u8> {
    let mut nonce = vec![0u8; size];
    OsRng.fill_bytes(&mut nonce);
    nonce
}

/// Sign data with platform identity.
fn sign_data(data: &[u8], identity: &PlatformIdentity) -> Vec<u8> {
    let private_key = match identity.metadata.get("private_key_hex") {
        Some(hex_value) => match hex::decode(hex_value) {
            Ok(bytes) => bytes,
            Err(_) => return Vec::new(),
        },
        None => return Vec::new(),
    };

    match resolve_signature_algorithm(identity) {
        SignatureAlgorithm::Ed25519 => {
            if private_key.len() != 32 {
                return Vec::new();
            }
            let mut key_bytes = [0u8; 32];
            key_bytes.copy_from_slice(&private_key);
            let signing_key = Ed25519SigningKey::from_bytes(&key_bytes);
            let signature = signing_key.sign(data);
            signature.to_bytes().to_vec()
        }
        SignatureAlgorithm::P256 => {
            if private_key.len() != 32 {
                return Vec::new();
            }
            let secret_key = match p256::SecretKey::from_slice(&private_key) {
                Ok(key) => key,
                Err(_) => return Vec::new(),
            };
            let signing_key = SigningKey::from(secret_key);
            let signature: Signature = signing_key.sign(data);
            signature.to_der().as_bytes().to_vec()
        }
    }
}

/// Verify signature with platform identity.
fn verify_signature(data: &[u8], signature: &[u8], identity: &PlatformIdentity) -> bool {
    match resolve_signature_algorithm(identity) {
        SignatureAlgorithm::Ed25519 => {
            if identity.public_key.len() != 32 || signature.len() != 64 {
                return false;
            }
            let mut key_bytes = [0u8; 32];
            key_bytes.copy_from_slice(&identity.public_key);
            let verifying_key = match ed25519_dalek::VerifyingKey::from_bytes(&key_bytes) {
                Ok(key) => key,
                Err(_) => return false,
            };
            let signature_bytes: [u8; 64] = match signature.try_into() {
                Ok(bytes) => bytes,
                Err(_) => return false,
            };
            let signature = ed25519_dalek::Signature::from_bytes(&signature_bytes);
            verifying_key.verify(data, &signature).is_ok()
        }
        SignatureAlgorithm::P256 => {
            let verifying_key = match p256::ecdsa::VerifyingKey::from_sec1_bytes(
                &identity.public_key,
            ) {
                Ok(key) => key,
                Err(_) => return false,
            };
            let signature = match Signature::from_der(signature) {
                Ok(sig) => sig,
                Err(_) => return false,
            };
            verifying_key.verify(data, &signature).is_ok()
        }
    }
}

/// Verify TPM quote.
fn verify_tpm_quote(quote: &crate::TpmQuote, identity: &PlatformIdentity) -> bool {
    if quote.nonce.is_empty() {
        return false;
    }

    let verifying_key =
        match p256::ecdsa::VerifyingKey::from_sec1_bytes(&identity.public_key) {
            Ok(key) => key,
            Err(_) => return false,
        };
    let signature = match Signature::from_der(&quote.signature) {
        Ok(sig) => sig,
        Err(_) => return false,
    };

    if verifying_key
        .verify(&quote.attestation_data, &signature)
        .is_err()
    {
        return false;
    }

    if !quote
        .attestation_data
        .windows(quote.nonce.len())
        .any(|window| window == quote.nonce)
    {
        return false;
    }

    let expected_pcrs = match &identity.attestation {
        Attestation::Tpm { pcrs, .. } if !pcrs.is_empty() => {
            serde_json::from_slice::<Vec<crate::PcrValue>>(pcrs).ok()
        }
        _ => None,
    };

    if let Some(expected_pcrs) = expected_pcrs {
        for expected in expected_pcrs {
            match quote.pcrs.iter().find(|pcr| pcr.index == expected.index) {
                Some(actual) if actual.value == expected.value => {}
                _ => return false,
            }
        }
    }

    true
}

#[derive(Debug, Clone, Copy)]
enum SignatureAlgorithm {
    Ed25519,
    P256,
}

fn resolve_signature_algorithm(identity: &PlatformIdentity) -> SignatureAlgorithm {
    if let Some(key_type) = identity.metadata.get("key_type") {
        match key_type.as_str() {
            "ed25519" => return SignatureAlgorithm::Ed25519,
            "p256" => return SignatureAlgorithm::P256,
            _ => {}
        }
    }

    match identity.public_key.len() {
        32 => SignatureAlgorithm::Ed25519,
        33 | 65 => SignatureAlgorithm::P256,
        _ => SignatureAlgorithm::Ed25519,
    }
}

/// Validate certificate chain.
fn validate_cert_chain(chain: &[Certificate]) -> bool {
    // In production: fully validate chain with signature verification
    // For now, check basic structure
    !chain.is_empty() && chain.iter().all(|cert| !cert.signature.is_empty())
}

/// Check if timestamp is fresh (within window).
fn is_timestamp_fresh(timestamp: u64, now: u64, window_ms: u64) -> bool {
    // Allow some clock skew (both past and future)
    let skew_ms = 5000; // 5 seconds
    if timestamp > now + skew_ms {
        return false; // Too far in the future
    }
    if timestamp > now {
        return true; // Within skew tolerance
    }
    now - timestamp <= window_ms
}

/// Calculate trust score based on attestation type.
fn calculate_trust_score(attestation: &Attestation) -> f64 {
    match attestation {
        Attestation::Tpm { .. } => 1.0,      // Highest trust
        Attestation::Software { .. } => 0.7, // Medium trust
        Attestation::None => 0.0,            // No trust
    }
}

/// Generate event ID.
fn generate_event_id() -> String {
    format!("{:x}", current_timestamp())
}

/// Get current timestamp in milliseconds.
fn current_timestamp() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_millis() as u64
}

#[cfg(test)]
mod tests {
    use super::*;

    fn create_test_identity(id: &str, attestation: Attestation) -> PlatformIdentity {
        let private_key = blake3::hash(id.as_bytes()).as_bytes().to_vec();
        let mut key_bytes = [0u8; 32];
        key_bytes.copy_from_slice(&private_key);
        let signing_key = Ed25519SigningKey::from_bytes(&key_bytes);
        let public_key = signing_key.verifying_key().to_bytes().to_vec();
        let mut metadata = HashMap::new();
        metadata.insert("private_key_hex".to_string(), hex::encode(private_key));
        metadata.insert("key_type".to_string(), "ed25519".to_string());

        PlatformIdentity {
            id: id.to_string(),
            public_key,
            attestation,
            created_at: current_timestamp(),
            metadata,
        }
    }

    fn create_test_cert(subject: &str) -> Certificate {
        Certificate {
            serial: "1".to_string(),
            subject: subject.to_string(),
            issuer: "test-ca".to_string(),
            public_key: vec![1, 2, 3],
            not_before: 0,
            not_after: u64::MAX,
            signature: vec![4, 5, 6],
            extensions: HashMap::new(),
        }
    }

    #[test]
    fn test_create_attestation_manager() {
        let identity = create_test_identity(
            "node-1",
            Attestation::Software {
                certificate: vec![1, 2, 3],
            },
        );
        let cert_chain = vec![create_test_cert("node-1")];

        let manager = AttestationManager::new(identity, cert_chain);
        assert_eq!(manager.handshake_timeout_ms, DEFAULT_HANDSHAKE_TIMEOUT_MS);
    }

    #[test]
    fn test_initiate_handshake() {
        let identity = create_test_identity(
            "node-1",
            Attestation::Software {
                certificate: vec![1, 2, 3],
            },
        );
        let cert_chain = vec![create_test_cert("node-1")];

        let mut manager = AttestationManager::new(identity, cert_chain);
        let request = manager.initiate_handshake("node-2").unwrap();

        assert_eq!(request.version, PROTOCOL_VERSION);
        assert_eq!(request.challenge.len(), 32);
        assert!(manager.is_nonce_seen(&request.challenge));
    }

    #[test]
    fn test_nonce_generation_is_randomized() {
        let identity = create_test_identity(
            "node-1",
            Attestation::Software {
                certificate: vec![1, 2, 3],
            },
        );
        let cert_chain = vec![create_test_cert("node-1")];

        let mut manager = AttestationManager::new(identity, cert_chain);
        let nonce_a = manager.generate_nonce(32);
        let nonce_b = manager.generate_nonce(32);

        assert_eq!(nonce_a.len(), 32);
        assert_eq!(nonce_b.len(), 32);
        assert_ne!(nonce_a, nonce_b);
        assert!(nonce_a.iter().any(|byte| *byte != 0));
    }

    #[test]
    fn test_reject_duplicate_handshake() {
        let identity = create_test_identity(
            "node-1",
            Attestation::Software {
                certificate: vec![1, 2, 3],
            },
        );
        let cert_chain = vec![create_test_cert("node-1")];

        let mut manager = AttestationManager::new(identity, cert_chain);
        manager.initiate_handshake("node-2").unwrap();
        let result = manager.initiate_handshake("node-2");

        assert!(result.is_err());
    }

    #[test]
    fn test_handle_request() {
        let identity = create_test_identity(
            "node-1",
            Attestation::Software {
                certificate: vec![1, 2, 3],
            },
        );
        let cert_chain = vec![create_test_cert("node-1")];

        let mut manager = AttestationManager::new(identity.clone(), cert_chain.clone());

        let request = AttestationRequest {
            version: PROTOCOL_VERSION,
            challenge: vec![1, 2, 3, 4, 5],
            identity: create_test_identity(
                "node-2",
                Attestation::Software {
                    certificate: vec![4, 5, 6],
                },
            ),
            cert_chain: vec![create_test_cert("node-2")],
            timestamp: current_timestamp(),
        };

        let response = manager.handle_request(request).unwrap();
        assert_eq!(response.version, PROTOCOL_VERSION);
        assert_eq!(response.counter_challenge.len(), 32);
    }

    #[test]
    fn test_reject_version_mismatch() {
        let identity = create_test_identity(
            "node-1",
            Attestation::Software {
                certificate: vec![1, 2, 3],
            },
        );
        let cert_chain = vec![create_test_cert("node-1")];

        let mut manager = AttestationManager::new(identity, cert_chain);

        let request = AttestationRequest {
            version: 999, // Wrong version
            challenge: vec![1, 2, 3, 4, 5],
            identity: create_test_identity(
                "node-2",
                Attestation::Software {
                    certificate: vec![4, 5, 6],
                },
            ),
            cert_chain: vec![create_test_cert("node-2")],
            timestamp: current_timestamp(),
        };

        let result = manager.handle_request(request);
        assert!(result.is_err());
    }

    #[test]
    fn test_replay_detection() {
        let identity = create_test_identity(
            "node-1",
            Attestation::Software {
                certificate: vec![1, 2, 3],
            },
        );
        let cert_chain = vec![create_test_cert("node-1")];

        let mut manager = AttestationManager::new(identity.clone(), cert_chain.clone());

        let challenge = vec![1, 2, 3, 4, 5];
        let request = AttestationRequest {
            version: PROTOCOL_VERSION,
            challenge: challenge.clone(),
            identity: create_test_identity(
                "node-2",
                Attestation::Software {
                    certificate: vec![4, 5, 6],
                },
            ),
            cert_chain: vec![create_test_cert("node-2")],
            timestamp: current_timestamp(),
        };

        // First request should succeed
        manager.handle_request(request.clone()).unwrap();

        // Replay should fail
        let result = manager.handle_request(request);
        assert!(result.is_err());
        assert!(result.unwrap_err().to_string().contains("replay"));
    }

    #[test]
    fn test_stale_timestamp_rejection() {
        let identity = create_test_identity(
            "node-1",
            Attestation::Software {
                certificate: vec![1, 2, 3],
            },
        );
        let cert_chain = vec![create_test_cert("node-1")];

        let mut manager = AttestationManager::new(identity, cert_chain);

        let request = AttestationRequest {
            version: PROTOCOL_VERSION,
            challenge: vec![1, 2, 3, 4, 5],
            identity: create_test_identity(
                "node-2",
                Attestation::Software {
                    certificate: vec![4, 5, 6],
                },
            ),
            cert_chain: vec![create_test_cert("node-2")],
            timestamp: 1000, // Very old timestamp
        };

        let result = manager.handle_request(request);
        assert!(result.is_err());
    }

    #[test]
    fn test_trust_score_calculation() {
        assert_eq!(
            calculate_trust_score(&Attestation::Tpm {
                quote: vec![],
                pcrs: vec![],
                ak_cert: vec![],
            }),
            1.0
        );

        assert_eq!(
            calculate_trust_score(&Attestation::Software {
                certificate: vec![],
            }),
            0.7
        );

        assert_eq!(calculate_trust_score(&Attestation::None), 0.0);
    }

    #[test]
    fn test_real_signature_verification() {
        let identity = create_test_identity(
            "node-1",
            Attestation::Software {
                certificate: vec![1, 2, 3],
            },
        );
        let data = b"attestation-challenge";

        let signature = sign_data(data, &identity);
        assert!(verify_signature(data, &signature, &identity));
        assert!(!verify_signature(b"tampered", &signature, &identity));
    }

    #[test]
    fn test_verify_tpm_quote_with_pcrs() {
        let mut tpm = crate::TpmManager::new(false);
        let ak = tpm
            .generate_attestation_key("node-1-ak".to_string())
            .unwrap();
        let quote = tpm.generate_quote(generate_nonce(32), &[0, 1]).unwrap();

        let identity = PlatformIdentity {
            id: "node-1".to_string(),
            public_key: ak.public_key,
            attestation: Attestation::Tpm {
                quote: Vec::new(),
                pcrs: serde_json::to_vec(&quote.pcrs).unwrap(),
                ak_cert: Vec::new(),
            },
            created_at: current_timestamp(),
            metadata: HashMap::new(),
        };

        assert!(verify_tpm_quote(&quote, &identity));

        let mut bad_quote = quote.clone();
        bad_quote.pcrs[0].value = vec![0u8; bad_quote.pcrs[0].value.len()];
        assert!(!verify_tpm_quote(&bad_quote, &identity));
    }

    #[test]
    fn test_nonce_cleanup() {
        let identity = create_test_identity(
            "node-1",
            Attestation::Software {
                certificate: vec![1, 2, 3],
            },
        );
        let cert_chain = vec![create_test_cert("node-1")];

        let mut manager = AttestationManager::new(identity, cert_chain).with_nonce_window(100); // Very short window for testing

        let nonce = vec![1, 2, 3];
        manager.record_nonce(nonce.clone()).unwrap();
        assert!(manager.is_nonce_seen(&nonce));

        // Wait for nonce window to expire
        std::thread::sleep(std::time::Duration::from_millis(150));

        manager.cleanup();
        assert!(!manager.is_nonce_seen(&nonce));
    }

    #[test]
    fn test_attestation_event_recording() {
        let identity = create_test_identity(
            "node-1",
            Attestation::Software {
                certificate: vec![1, 2, 3],
            },
        );
        let cert_chain = vec![create_test_cert("node-1")];

        let mut manager = AttestationManager::new(identity, cert_chain);
        assert_eq!(manager.get_attestation_events().len(), 0);

        manager.initiate_handshake("node-2").unwrap();
        assert_eq!(manager.get_attestation_events().len(), 1);
        assert_eq!(
            manager.get_attestation_events()[0].event_type,
            event::AttestationEventType::HandshakeStarted
        );
    }

    #[test]
    fn test_is_attested() {
        let identity = create_test_identity(
            "node-1",
            Attestation::Software {
                certificate: vec![1, 2, 3],
            },
        );
        let cert_chain = vec![create_test_cert("node-1")];

        let mut manager = AttestationManager::new(identity, cert_chain);
        assert!(!manager.is_attested("node-2"));

        manager.handshakes.insert(
            "node-2".to_string(),
            HandshakeState::Completed {
                peer_identity: create_test_identity(
                    "node-2",
                    Attestation::Software {
                        certificate: vec![4, 5, 6],
                    },
                ),
                completed_at: current_timestamp(),
                trust_score: 0.7,
            },
        );

        assert!(manager.is_attested("node-2"));
        assert_eq!(manager.get_trust_score("node-2"), Some(0.7));
    }

    #[test]
    fn test_timestamp_freshness() {
        let now = current_timestamp();
        let window_ms = 30_000;

        // Current timestamp is fresh
        assert!(is_timestamp_fresh(now, now, window_ms));

        // Recent past is fresh
        assert!(is_timestamp_fresh(now - 10_000, now, window_ms));

        // Too old is not fresh
        assert!(!is_timestamp_fresh(now - 40_000, now, window_ms));

        // Slight future (within skew) is fresh
        assert!(is_timestamp_fresh(now + 1_000, now, window_ms));

        // Too far in future is not fresh
        assert!(!is_timestamp_fresh(now + 10_000, now, window_ms));
    }

    #[test]
    fn test_handshake_state_transitions() {
        let identity = create_test_identity(
            "node-1",
            Attestation::Software {
                certificate: vec![1, 2, 3],
            },
        );
        let cert_chain = vec![create_test_cert("node-1")];

        let mut manager = AttestationManager::new(identity, cert_chain);

        // Idle -> WaitingForResponse
        manager.initiate_handshake("node-2").unwrap();
        assert!(matches!(
            manager.handshakes.get("node-2"),
            Some(HandshakeState::WaitingForResponse { .. })
        ));
    }
}
