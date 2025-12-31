//! Quorum gate for authority threshold enforcement
//!
//! This module implements quorum verification for swarm commands based on
//! command scope and criticality. Different operations require different
//! levels of authority.

#![warn(missing_docs)]

use crate::authority::{AuthorityError, AuthoritySignature, AuthorityVerifier};
use crate::command_types::{SwarmCommand, UnitCommand};
use serde::{Deserialize, Serialize};
use thiserror::Error;

/// Quorum gate errors
#[derive(Debug, Error)]
pub enum QuorumError {
    /// Insufficient authorities for required threshold
    #[error("Insufficient authorities: got {got}, required {required} for {operation}")]
    InsufficientAuthority {
        /// Number of authorities provided
        got: usize,
        /// Number of authorities required
        required: usize,
        /// Operation being authorized
        operation: String,
    },
    
    /// Authority verification failed
    #[error("Authority verification failed: {0}")]
    AuthorityFailed(#[from] AuthorityError),
    
    /// Invalid quorum configuration
    #[error("Invalid quorum configuration: {0}")]
    InvalidConfig(String),
}

/// Command scope for authority requirements
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CommandScope {
    /// Single unit, non-critical operation
    SingleUnitNormal,
    /// Single unit, critical operation (reboot, config)
    SingleUnitCritical,
    /// Swarm command, less than 5 units
    SwarmSmall,
    /// Swarm command, 5 or more units
    SwarmLarge,
    /// Emergency stop (immediate)
    Emergency,
}

impl CommandScope {
    /// Get required number of signatures for this scope
    pub fn required_signatures(&self) -> usize {
        match self {
            CommandScope::SingleUnitNormal => 1,
            CommandScope::SingleUnitCritical => 2,
            CommandScope::SwarmSmall => 2,
            CommandScope::SwarmLarge => 2, // 2-of-3 quorum
            CommandScope::Emergency => 1,
        }
    }
    
    /// Get operation description for error messages
    pub fn operation_name(&self) -> &'static str {
        match self {
            CommandScope::SingleUnitNormal => "single unit (normal)",
            CommandScope::SingleUnitCritical => "single unit (critical)",
            CommandScope::SwarmSmall => "swarm (<5 units)",
            CommandScope::SwarmLarge => "swarm (≥5 units)",
            CommandScope::Emergency => "emergency stop",
        }
    }
}

/// Quorum gate for authority verification
#[derive(Debug)]
pub struct QuorumGate {
    /// Authority verifier
    verifier: AuthorityVerifier,
}

impl QuorumGate {
    /// Create a new quorum gate
    pub fn new(verifier: AuthorityVerifier) -> Self {
        Self { verifier }
    }
    
    /// Determine command scope for a unit command
    pub fn classify_unit_command(command: &UnitCommand) -> CommandScope {
        match command {
            UnitCommand::EmergencyStop { .. } => CommandScope::Emergency,
            UnitCommand::Reboot { .. } | UnitCommand::Configure { .. } => {
                CommandScope::SingleUnitCritical
            }
            _ => CommandScope::SingleUnitNormal,
        }
    }
    
    /// Determine command scope for a swarm command
    pub fn classify_swarm_command(command: &SwarmCommand, unit_count: usize) -> CommandScope {
        match command {
            SwarmCommand::AbortAll { .. } => CommandScope::Emergency,
            _ => {
                if unit_count >= 5 {
                    CommandScope::SwarmLarge
                } else {
                    CommandScope::SwarmSmall
                }
            }
        }
    }
    
    /// Verify authority for a unit command
    ///
    /// # Arguments
    /// * `command` - The unit command to authorize
    /// * `command_hash` - BLAKE3 hash of the command
    /// * `signatures` - Authority signatures
    ///
    /// # Returns
    /// Ok(()) if quorum is met, Err otherwise
    pub fn verify_unit_command(
        &self,
        command: &UnitCommand,
        command_hash: &[u8; 32],
        signatures: &[AuthoritySignature],
    ) -> Result<(), QuorumError> {
        let scope = Self::classify_unit_command(command);
        self.verify_quorum(scope, command_hash, signatures)
    }
    
    /// Verify authority for a swarm command
    ///
    /// # Arguments
    /// * `command` - The swarm command to authorize
    /// * `unit_count` - Number of units targeted by the command
    /// * `command_hash` - BLAKE3 hash of the command
    /// * `signatures` - Authority signatures
    ///
    /// # Returns
    /// Ok(()) if quorum is met, Err otherwise
    pub fn verify_swarm_command(
        &self,
        command: &SwarmCommand,
        unit_count: usize,
        command_hash: &[u8; 32],
        signatures: &[AuthoritySignature],
    ) -> Result<(), QuorumError> {
        let scope = Self::classify_swarm_command(command, unit_count);
        self.verify_quorum(scope, command_hash, signatures)
    }
    
    /// Verify quorum for a given scope
    fn verify_quorum(
        &self,
        scope: CommandScope,
        command_hash: &[u8; 32],
        signatures: &[AuthoritySignature],
    ) -> Result<(), QuorumError> {
        let required = scope.required_signatures();
        
        if signatures.len() < required {
            return Err(QuorumError::InsufficientAuthority {
                got: signatures.len(),
                required,
                operation: scope.operation_name().to_string(),
            });
        }
        
        // Verify all signatures
        self.verifier.verify_multiple(command_hash, signatures)?;
        
        Ok(())
    }
}

/// Quorum proof for command authorization
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct QuorumProof {
    /// Command hash being authorized
    pub command_hash: [u8; 32],
    /// Authority signatures
    pub signatures: Vec<AuthoritySignature>,
    /// Command scope
    pub scope: String,
    /// Timestamp when proof was created
    pub timestamp_ns: u64,
}

impl QuorumProof {
    /// Create a new quorum proof
    pub fn new(
        command_hash: [u8; 32],
        signatures: Vec<AuthoritySignature>,
        scope: CommandScope,
        timestamp_ns: u64,
    ) -> Self {
        Self {
            command_hash,
            signatures,
            scope: scope.operation_name().to_string(),
            timestamp_ns,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::command_types::Coordinate;
    use ed25519_dalek::{Signer, SigningKey};
    
#[cfg(test)]
mod tests {
    use super::*;
    use crate::command_types::Coordinate;
    use ed25519_dalek::{Signer, SigningKey};
    use rand::RngCore;
    
    fn create_test_signature(signing_key: &SigningKey, command_hash: &[u8; 32], authority_id: &str) -> AuthoritySignature {
        let signature = signing_key.sign(command_hash);
        AuthoritySignature::new(
            authority_id.to_string(),
            signature.to_bytes().to_vec(),
            signing_key.verifying_key().to_bytes(),
            1000,
        )
    }
    
    #[test]
    fn test_single_unit_normal_requires_one_signature() {
        let mut csprng = rand::rngs::OsRng;
        let mut secret_key_bytes = [0u8; 32];
        csprng.fill_bytes(&mut secret_key_bytes);
        let signing_key = SigningKey::from_bytes(&secret_key_bytes);
        
        let command = UnitCommand::Navigate {
            waypoint: Coordinate { lat: 45.0, lon: -122.0, alt: None },
            speed: None,
            altitude: None,
        };
        
        let command_hash = [0u8; 32];
        let signatures = vec![create_test_signature(&signing_key, &command_hash, "operator-1")];
        
        let mut verifier = AuthorityVerifier::new();
        verifier.register_authority("operator-1".to_string(), signing_key.verifying_key().to_bytes());
        
        let gate = QuorumGate::new(verifier);
        assert!(gate.verify_unit_command(&command, &command_hash, &signatures).is_ok());
    }
    
    #[test]
    fn test_single_unit_critical_requires_two_signatures() {
        let mut csprng = rand::rngs::OsRng;
        let mut secret_key_bytes1 = [0u8; 32];
        let mut secret_key_bytes2 = [0u8; 32];
        csprng.fill_bytes(&mut secret_key_bytes1);
        csprng.fill_bytes(&mut secret_key_bytes2);
        let key1 = SigningKey::from_bytes(&secret_key_bytes1);
        let key2 = SigningKey::from_bytes(&secret_key_bytes2);
        
        let command = UnitCommand::Reboot { delay_secs: 10 };
        let command_hash = [0u8; 32];
        
        // Only one signature - should fail
        let signatures_one = vec![create_test_signature(&key1, &command_hash, "operator-1")];
        
        let mut verifier = AuthorityVerifier::new();
        verifier.register_authority("operator-1".to_string(), key1.verifying_key().to_bytes());
        verifier.register_authority("coalition-1".to_string(), key2.verifying_key().to_bytes());
        
        let gate = QuorumGate::new(verifier);
        assert!(matches!(
            gate.verify_unit_command(&command, &command_hash, &signatures_one),
            Err(QuorumError::InsufficientAuthority { .. })
        ));
        
        // Two signatures - should succeed
        let signatures_two = vec![
            create_test_signature(&key1, &command_hash, "operator-1"),
            create_test_signature(&key2, &command_hash, "coalition-1"),
        ];
        
        let mut verifier2 = AuthorityVerifier::new();
        verifier2.register_authority("operator-1".to_string(), key1.verifying_key().to_bytes());
        verifier2.register_authority("coalition-1".to_string(), key2.verifying_key().to_bytes());
        
        let gate2 = QuorumGate::new(verifier2);
        assert!(gate2.verify_unit_command(&command, &command_hash, &signatures_two).is_ok());
    }
    
    #[test]
    fn test_emergency_stop_requires_one_signature() {
        let mut csprng = rand::rngs::OsRng;
        let mut secret_key_bytes = [0u8; 32];
        csprng.fill_bytes(&mut secret_key_bytes);
        let signing_key = SigningKey::from_bytes(&secret_key_bytes);
        
        let command = UnitCommand::EmergencyStop {
            reason: "Test emergency".to_string(),
        };
        
        let command_hash = [0u8; 32];
        let signatures = vec![create_test_signature(&signing_key, &command_hash, "operator-1")];
        
        let mut verifier = AuthorityVerifier::new();
        verifier.register_authority("operator-1".to_string(), signing_key.verifying_key().to_bytes());
        
        let gate = QuorumGate::new(verifier);
        assert!(gate.verify_unit_command(&command, &command_hash, &signatures).is_ok());
    }
}
}
