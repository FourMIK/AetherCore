//! Enrollment state machine for Zero-Touch Onboarding.
//!
//! Tracks the lifecycle of a platform from uninitialized hardware to trusted
//! node in the CodeRalphie mesh. Each state transition is recorded for audit
//! via Merkle Vine integration.
//!
//! # State Transitions
//!
//! ```text
//! Uninitialized
//!     ↓ (generate_identity)
//! IdentityGenerated
//!     ↓ (receive_challenge)
//! ChallengeReceived
//!     ↓ (send_response)
//! ResponseSent
//!     ↓ (verify_attestation)
//! Attested
//!     ↓ (install_bundle)
//! Provisioned
//!     ↓ (validate_certificate)
//! Trusted
//! ```
//!
//! # Revocation (Great Gospel)
//!
//! Any state can transition to `Revoked` via the Great Gospel execution,
//! which permanently invalidates the platform's credentials.

use serde::{Deserialize, Serialize};
use std::collections::VecDeque;

/// Maximum number of state transitions to track in history.
const MAX_HISTORY_SIZE: usize = 100;

/// Enrollment state for a platform.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub enum EnrollmentState {
    /// Initial state - no identity generated
    Uninitialized,

    /// Identity has been generated with TPM-resident keys
    IdentityGenerated {
        /// Identity ID
        identity_id: String,
        /// When identity was created
        created_at: u64,
    },

    /// Challenge has been received from enrollment server
    ChallengeReceived {
        /// Identity ID
        identity_id: String,
        /// Hash of the challenge for audit
        challenge_hash: Vec<u8>,
        /// When challenge was received
        received_at: u64,
    },

    /// Response has been sent to enrollment server
    ResponseSent {
        /// Identity ID
        identity_id: String,
        /// Hash of the response for audit
        response_hash: Vec<u8>,
        /// When response was sent
        sent_at: u64,
    },

    /// Platform has been successfully attested
    Attested {
        /// Identity ID
        identity_id: String,
        /// Trust score assigned (0.0 to 1.0)
        trust_score: f64,
        /// When attestation completed
        attested_at: u64,
    },

    /// Genesis bundle has been installed
    Provisioned {
        /// Identity ID
        identity_id: String,
        /// Hash of the device token for audit
        token_hash: Vec<u8>,
        /// When provisioning completed
        provisioned_at: u64,
    },

    /// Platform is fully trusted and operational
    Trusted {
        /// Identity ID
        identity_id: String,
        /// Certificate serial number
        certificate_serial: String,
        /// Final trust score
        trust_score: f64,
        /// When trust was established
        trusted_at: u64,
    },

    /// Platform has been revoked (Great Gospel executed)
    Revoked {
        /// Identity ID
        identity_id: String,
        /// Reason for revocation
        reason: String,
        /// When revocation occurred
        revoked_at: u64,
    },

    /// Enrollment failed
    Failed {
        /// Identity ID (if available)
        identity_id: Option<String>,
        /// Error message
        error: String,
        /// When failure occurred
        failed_at: u64,
    },
}

/// Errors that can occur during enrollment.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, thiserror::Error)]
pub enum EnrollmentError {
    /// Protocol version does not match expected version
    #[error("Protocol version mismatch: {0}")]
    VersionMismatch(String),

    /// Signature verification failed
    #[error("Invalid signature: {0}")]
    SignatureInvalid(String),

    /// TPM quote verification failed
    #[error("Invalid TPM quote: {0}")]
    TpmQuoteInvalid(String),

    /// PCR values don't match baseline
    #[error("PCR baseline mismatch: {0}")]
    PcrBaselineMismatch(String),

    /// Trust score below minimum threshold
    #[error("Trust threshold not met: {0}")]
    TrustThresholdNotMet(String),

    /// Handshake timed out
    #[error("Handshake timeout: {0}")]
    HandshakeTimeout(String),

    /// Replay attack detected
    #[error("Replay detected: {0}")]
    ReplayDetected(String),

    /// Certificate chain validation failed
    #[error("Invalid certificate chain: {0}")]
    CertChainInvalid(String),

    /// Invalid state transition
    #[error("Invalid state transition: {0}")]
    InvalidTransition(String),

    /// Generic enrollment error
    #[error("Enrollment error: {0}")]
    Other(String),
}

/// Record of a state transition for audit trail.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StateTransition {
    /// Previous state (serialized)
    pub from_state: String,
    /// New state (serialized)
    pub to_state: String,
    /// When transition occurred
    pub timestamp: u64,
    /// Optional reason/context for transition
    pub reason: Option<String>,
    /// Hash of transition for Merkle Vine
    pub transition_hash: Vec<u8>,
}

/// Enrollment state machine managing platform lifecycle.
pub struct EnrollmentStateMachine {
    /// Current state
    current_state: EnrollmentState,
    /// History of state transitions for audit
    history: VecDeque<StateTransition>,
}

impl EnrollmentStateMachine {
    /// Create a new state machine in Uninitialized state.
    pub fn new() -> Self {
        Self {
            current_state: EnrollmentState::Uninitialized,
            history: VecDeque::with_capacity(MAX_HISTORY_SIZE),
        }
    }

    /// Get the current state.
    pub fn current_state(&self) -> &EnrollmentState {
        &self.current_state
    }

    /// Get the state transition history.
    pub fn history(&self) -> &VecDeque<StateTransition> {
        &self.history
    }

    /// Check if the platform is in a trusted state.
    pub fn is_trusted(&self) -> bool {
        matches!(self.current_state, EnrollmentState::Trusted { .. })
    }

    /// Get the current trust score (if available).
    pub fn trust_score(&self) -> Option<f64> {
        match &self.current_state {
            EnrollmentState::Attested { trust_score, .. } => Some(*trust_score),
            EnrollmentState::Trusted { trust_score, .. } => Some(*trust_score),
            _ => None,
        }
    }

    /// Transition: Uninitialized → IdentityGenerated
    pub fn on_identity_generated(&mut self, identity_id: String) -> Result<(), EnrollmentError> {
        match &self.current_state {
            EnrollmentState::Uninitialized => {
                let now = current_timestamp();
                let new_state = EnrollmentState::IdentityGenerated {
                    identity_id,
                    created_at: now,
                };
                self.transition(new_state, Some("Identity generated with TPM".to_string()))?;
                Ok(())
            }
            _ => Err(EnrollmentError::InvalidTransition(
                "Can only generate identity from Uninitialized state".to_string(),
            )),
        }
    }

    /// Transition: IdentityGenerated → ChallengeReceived
    pub fn on_challenge_received(
        &mut self,
        challenge_hash: Vec<u8>,
    ) -> Result<(), EnrollmentError> {
        match &self.current_state {
            EnrollmentState::IdentityGenerated { identity_id, .. } => {
                let now = current_timestamp();
                let new_state = EnrollmentState::ChallengeReceived {
                    identity_id: identity_id.clone(),
                    challenge_hash,
                    received_at: now,
                };
                self.transition(new_state, Some("Challenge received from server".to_string()))?;
                Ok(())
            }
            _ => Err(EnrollmentError::InvalidTransition(
                "Can only receive challenge from IdentityGenerated state".to_string(),
            )),
        }
    }

    /// Transition: ChallengeReceived → ResponseSent
    pub fn on_response_sent(&mut self, response_hash: Vec<u8>) -> Result<(), EnrollmentError> {
        match &self.current_state {
            EnrollmentState::ChallengeReceived { identity_id, .. } => {
                let now = current_timestamp();
                let new_state = EnrollmentState::ResponseSent {
                    identity_id: identity_id.clone(),
                    response_hash,
                    sent_at: now,
                };
                self.transition(new_state, Some("Response sent to server".to_string()))?;
                Ok(())
            }
            _ => Err(EnrollmentError::InvalidTransition(
                "Can only send response from ChallengeReceived state".to_string(),
            )),
        }
    }

    /// Transition: ResponseSent → Attested
    pub fn on_attestation_verified(&mut self, trust_score: f64) -> Result<(), EnrollmentError> {
        match &self.current_state {
            EnrollmentState::ResponseSent { identity_id, .. } => {
                // Validate trust score threshold
                if trust_score < 0.7 {
                    return Err(EnrollmentError::TrustThresholdNotMet(format!(
                        "Trust score {} below minimum 0.7",
                        trust_score
                    )));
                }

                let now = current_timestamp();
                let new_state = EnrollmentState::Attested {
                    identity_id: identity_id.clone(),
                    trust_score,
                    attested_at: now,
                };
                self.transition(
                    new_state,
                    Some(format!("Attestation verified with trust score {}", trust_score)),
                )?;
                Ok(())
            }
            _ => Err(EnrollmentError::InvalidTransition(
                "Can only verify attestation from ResponseSent state".to_string(),
            )),
        }
    }

    /// Transition: Attested → Provisioned
    pub fn on_genesis_bundle_installed(
        &mut self,
        token_hash: Vec<u8>,
    ) -> Result<(), EnrollmentError> {
        match &self.current_state {
            EnrollmentState::Attested { identity_id, .. } => {
                let now = current_timestamp();
                let new_state = EnrollmentState::Provisioned {
                    identity_id: identity_id.clone(),
                    token_hash,
                    provisioned_at: now,
                };
                self.transition(new_state, Some("Genesis bundle installed".to_string()))?;
                Ok(())
            }
            _ => Err(EnrollmentError::InvalidTransition(
                "Can only install bundle from Attested state".to_string(),
            )),
        }
    }

    /// Transition: Provisioned → Trusted
    pub fn on_certificate_validated(
        &mut self,
        certificate_serial: String,
        trust_score: f64,
    ) -> Result<(), EnrollmentError> {
        match &self.current_state {
            EnrollmentState::Provisioned { identity_id, .. } => {
                let now = current_timestamp();
                let new_state = EnrollmentState::Trusted {
                    identity_id: identity_id.clone(),
                    certificate_serial,
                    trust_score,
                    trusted_at: now,
                };
                self.transition(new_state, Some("Certificate validated, platform trusted".to_string()))?;
                Ok(())
            }
            _ => Err(EnrollmentError::InvalidTransition(
                "Can only validate certificate from Provisioned state".to_string(),
            )),
        }
    }

    /// Transition: Any → Failed
    pub fn on_failure(&mut self, error: EnrollmentError) -> Result<(), EnrollmentError> {
        let identity_id = self.extract_identity_id();
        let now = current_timestamp();
        let new_state = EnrollmentState::Failed {
            identity_id,
            error: error.to_string(),
            failed_at: now,
        };
        self.transition(new_state, Some(format!("Enrollment failed: {}", error)))?;
        Ok(())
    }

    /// Execute Great Gospel - revoke the platform (any state → Revoked).
    pub fn revoke(&mut self, reason: String) -> Result<(), EnrollmentError> {
        let identity_id = self.extract_identity_id().ok_or_else(|| {
            EnrollmentError::InvalidTransition("Cannot revoke without identity ID".to_string())
        })?;

        let now = current_timestamp();
        let new_state = EnrollmentState::Revoked {
            identity_id,
            reason: reason.clone(),
            revoked_at: now,
        };
        self.transition(
            new_state,
            Some(format!("Great Gospel executed: {}", reason)),
        )?;
        Ok(())
    }

    /// Internal state transition handler.
    fn transition(
        &mut self,
        new_state: EnrollmentState,
        reason: Option<String>,
    ) -> Result<(), EnrollmentError> {
        let now = current_timestamp();

        // Serialize states for audit
        let from_state_str = format!("{:?}", self.current_state);
        let to_state_str = format!("{:?}", new_state);

        // Create transition hash for Merkle Vine
        let transition_data = format!("{}->{};{}", from_state_str, to_state_str, now);
        let transition_hash = blake3::hash(transition_data.as_bytes()).as_bytes().to_vec();

        let transition = StateTransition {
            from_state: from_state_str,
            to_state: to_state_str,
            timestamp: now,
            reason,
            transition_hash,
        };

        // Update state
        self.current_state = new_state;

        // Add to history
        if self.history.len() >= MAX_HISTORY_SIZE {
            self.history.pop_front();
        }
        self.history.push_back(transition);

        Ok(())
    }

    /// Extract identity ID from current state (if available).
    fn extract_identity_id(&self) -> Option<String> {
        match &self.current_state {
            EnrollmentState::Uninitialized => None,
            EnrollmentState::IdentityGenerated { identity_id, .. } => Some(identity_id.clone()),
            EnrollmentState::ChallengeReceived { identity_id, .. } => Some(identity_id.clone()),
            EnrollmentState::ResponseSent { identity_id, .. } => Some(identity_id.clone()),
            EnrollmentState::Attested { identity_id, .. } => Some(identity_id.clone()),
            EnrollmentState::Provisioned { identity_id, .. } => Some(identity_id.clone()),
            EnrollmentState::Trusted { identity_id, .. } => Some(identity_id.clone()),
            EnrollmentState::Revoked { identity_id, .. } => Some(identity_id.clone()),
            EnrollmentState::Failed { identity_id, .. } => identity_id.clone(),
        }
    }
}

impl Default for EnrollmentStateMachine {
    fn default() -> Self {
        Self::new()
    }
}

/// Get current timestamp in milliseconds.
fn current_timestamp() -> u64 {
    use std::time::{SystemTime, UNIX_EPOCH};
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_millis() as u64
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_state_machine_creation() {
        let sm = EnrollmentStateMachine::new();
        assert_eq!(*sm.current_state(), EnrollmentState::Uninitialized);
        assert!(!sm.is_trusted());
        assert_eq!(sm.trust_score(), None);
    }

    #[test]
    fn test_happy_path_transitions() {
        let mut sm = EnrollmentStateMachine::new();

        // Generate identity
        sm.on_identity_generated("platform-001".to_string())
            .unwrap();
        assert!(matches!(
            sm.current_state(),
            EnrollmentState::IdentityGenerated { .. }
        ));

        // Receive challenge
        sm.on_challenge_received(vec![1, 2, 3, 4]).unwrap();
        assert!(matches!(
            sm.current_state(),
            EnrollmentState::ChallengeReceived { .. }
        ));

        // Send response
        sm.on_response_sent(vec![5, 6, 7, 8]).unwrap();
        assert!(matches!(
            sm.current_state(),
            EnrollmentState::ResponseSent { .. }
        ));

        // Verify attestation
        sm.on_attestation_verified(1.0).unwrap();
        assert!(matches!(
            sm.current_state(),
            EnrollmentState::Attested { .. }
        ));
        assert_eq!(sm.trust_score(), Some(1.0));

        // Install genesis bundle
        sm.on_genesis_bundle_installed(vec![9, 10, 11, 12]).unwrap();
        assert!(matches!(
            sm.current_state(),
            EnrollmentState::Provisioned { .. }
        ));

        // Validate certificate
        sm.on_certificate_validated("cert-12345".to_string(), 1.0)
            .unwrap();
        assert!(matches!(
            sm.current_state(),
            EnrollmentState::Trusted { .. }
        ));
        assert!(sm.is_trusted());
        assert_eq!(sm.trust_score(), Some(1.0));

        // Check history
        assert_eq!(sm.history().len(), 6);
    }

    #[test]
    fn test_invalid_transition() {
        let mut sm = EnrollmentStateMachine::new();

        // Try to receive challenge before generating identity
        let result = sm.on_challenge_received(vec![1, 2, 3, 4]);
        assert!(result.is_err());
    }

    #[test]
    fn test_trust_threshold_enforcement() {
        let mut sm = EnrollmentStateMachine::new();

        sm.on_identity_generated("platform-002".to_string())
            .unwrap();
        sm.on_challenge_received(vec![1, 2, 3, 4]).unwrap();
        sm.on_response_sent(vec![5, 6, 7, 8]).unwrap();

        // Try attestation with low trust score
        let result = sm.on_attestation_verified(0.5);
        assert!(result.is_err());
        assert!(matches!(
            result.unwrap_err(),
            EnrollmentError::TrustThresholdNotMet(_)
        ));
    }

    #[test]
    fn test_minimum_trust_threshold() {
        let mut sm = EnrollmentStateMachine::new();

        sm.on_identity_generated("platform-003".to_string())
            .unwrap();
        sm.on_challenge_received(vec![1, 2, 3, 4]).unwrap();
        sm.on_response_sent(vec![5, 6, 7, 8]).unwrap();

        // Exactly 0.7 should pass
        sm.on_attestation_verified(0.7).unwrap();
        assert_eq!(sm.trust_score(), Some(0.7));
    }

    #[test]
    fn test_great_gospel_revocation() {
        let mut sm = EnrollmentStateMachine::new();

        sm.on_identity_generated("platform-004".to_string())
            .unwrap();

        // Execute Great Gospel
        sm.revoke("Security breach detected".to_string())
            .unwrap();

        assert!(matches!(
            sm.current_state(),
            EnrollmentState::Revoked { .. }
        ));

        if let EnrollmentState::Revoked { reason, .. } = sm.current_state() {
            assert_eq!(reason, "Security breach detected");
        }
    }

    #[test]
    fn test_revoke_from_trusted_state() {
        let mut sm = EnrollmentStateMachine::new();

        // Go through full enrollment
        sm.on_identity_generated("platform-005".to_string())
            .unwrap();
        sm.on_challenge_received(vec![1, 2, 3, 4]).unwrap();
        sm.on_response_sent(vec![5, 6, 7, 8]).unwrap();
        sm.on_attestation_verified(1.0).unwrap();
        sm.on_genesis_bundle_installed(vec![9, 10, 11, 12]).unwrap();
        sm.on_certificate_validated("cert-99999".to_string(), 1.0)
            .unwrap();

        assert!(sm.is_trusted());

        // Revoke even from Trusted state
        sm.revoke("Compromise detected".to_string()).unwrap();

        assert!(matches!(
            sm.current_state(),
            EnrollmentState::Revoked { .. }
        ));
        assert!(!sm.is_trusted());
    }

    #[test]
    fn test_failure_transition() {
        let mut sm = EnrollmentStateMachine::new();

        sm.on_identity_generated("platform-006".to_string())
            .unwrap();

        // Trigger failure
        sm.on_failure(EnrollmentError::SignatureInvalid("Bad signature".to_string()))
            .unwrap();

        assert!(matches!(
            sm.current_state(),
            EnrollmentState::Failed { .. }
        ));
    }

    #[test]
    fn test_state_transition_history() {
        let mut sm = EnrollmentStateMachine::new();

        sm.on_identity_generated("platform-007".to_string())
            .unwrap();
        sm.on_challenge_received(vec![1, 2, 3, 4]).unwrap();

        let history = sm.history();
        assert_eq!(history.len(), 2);

        // Check first transition
        assert!(history[0].from_state.contains("Uninitialized"));
        assert!(history[0].to_state.contains("IdentityGenerated"));
        assert!(!history[0].transition_hash.is_empty());

        // Check second transition
        assert!(history[1].from_state.contains("IdentityGenerated"));
        assert!(history[1].to_state.contains("ChallengeReceived"));
    }

    #[test]
    fn test_enrollment_error_types() {
        let errors = vec![
            EnrollmentError::VersionMismatch("v1 != v2".to_string()),
            EnrollmentError::SignatureInvalid("bad sig".to_string()),
            EnrollmentError::TpmQuoteInvalid("bad quote".to_string()),
            EnrollmentError::PcrBaselineMismatch("PCR mismatch".to_string()),
            EnrollmentError::TrustThresholdNotMet("0.5 < 0.7".to_string()),
            EnrollmentError::HandshakeTimeout("30s exceeded".to_string()),
            EnrollmentError::ReplayDetected("nonce reused".to_string()),
            EnrollmentError::CertChainInvalid("invalid chain".to_string()),
        ];

        assert_eq!(errors.len(), 8);
        for error in errors {
            assert!(!error.to_string().is_empty());
        }
    }
}
