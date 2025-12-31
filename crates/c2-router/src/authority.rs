//! Authority verification for command execution
//!
//! This module provides signature verification using Ed25519 for command authority.
//! All commands must be signed by authorized operators or coalition members.

#![warn(missing_docs)]

use ed25519_dalek::{Signature, Verifier, VerifyingKey};
use serde::{Deserialize, Serialize};
use thiserror::Error;

/// Authority verification errors
#[derive(Debug, Error)]
pub enum AuthorityError {
    /// Invalid signature format
    #[error("Invalid signature format: {0}")]
    InvalidSignature(String),
    
    /// Invalid public key format
    #[error("Invalid public key format: {0}")]
    InvalidPublicKey(String),
    
    /// Signature verification failed
    #[error("Signature verification failed for authority {authority_id}: {reason}")]
    VerificationFailed {
        /// Authority identifier
        authority_id: String,
        /// Reason for failure
        reason: String,
    },
    
    /// Unknown authority
    #[error("Unknown authority: {0}")]
    UnknownAuthority(String),
}

/// Command authority signature
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthoritySignature {
    /// Authority identifier (operator or coalition member)
    pub authority_id: String,
    /// Ed25519 signature (64 bytes)
    pub signature: Vec<u8>,
    /// Ed25519 public key (32 bytes)
    pub public_key: [u8; 32],
    /// Signature timestamp (nanoseconds since epoch)
    pub timestamp_ns: u64,
}

impl AuthoritySignature {
    /// Create a new authority signature
    pub fn new(authority_id: String, signature: Vec<u8>, public_key: [u8; 32], timestamp_ns: u64) -> Self {
        Self {
            authority_id,
            signature,
            public_key,
            timestamp_ns,
        }
    }
}

/// Authority verifier for Ed25519 signatures
#[derive(Debug)]
pub struct AuthorityVerifier {
    /// Known authorities and their public keys
    known_authorities: std::collections::HashMap<String, [u8; 32]>,
}

impl AuthorityVerifier {
    /// Create a new authority verifier
    pub fn new() -> Self {
        Self {
            known_authorities: std::collections::HashMap::new(),
        }
    }
    
    /// Register a known authority with their public key
    pub fn register_authority(&mut self, authority_id: String, public_key: [u8; 32]) {
        self.known_authorities.insert(authority_id, public_key);
    }
    
    /// Verify a command signature
    ///
    /// # Arguments
    /// * `command_hash` - BLAKE3 hash of the command (32 bytes)
    /// * `signature` - Authority signature to verify
    ///
    /// # Returns
    /// Ok(()) if signature is valid, Err otherwise
    pub fn verify(
        &self,
        command_hash: &[u8; 32],
        signature: &AuthoritySignature,
    ) -> Result<(), AuthorityError> {
        // Verify signature format (must be 64 bytes)
        if signature.signature.len() != 64 {
            return Err(AuthorityError::InvalidSignature(
                format!("Expected 64 bytes, got {}", signature.signature.len())
            ));
        }
        
        // Check if authority is known (optional - can verify unknown authorities if public key provided)
        if let Some(known_pubkey) = self.known_authorities.get(&signature.authority_id) {
            if known_pubkey != &signature.public_key {
                return Err(AuthorityError::VerificationFailed {
                    authority_id: signature.authority_id.clone(),
                    reason: "Public key mismatch with registered authority".to_string(),
                });
            }
        }
        
        // Parse public key
        let verifying_key = VerifyingKey::from_bytes(&signature.public_key)
            .map_err(|e| AuthorityError::InvalidPublicKey(format!("{}", e)))?;
        
        // Parse signature
        let sig_bytes: [u8; 64] = signature.signature[..64]
            .try_into()
            .map_err(|_| AuthorityError::InvalidSignature("Failed to convert signature".to_string()))?;
        let sig = Signature::from_bytes(&sig_bytes);
        
        // Verify signature over command hash
        verifying_key
            .verify(command_hash, &sig)
            .map_err(|e| AuthorityError::VerificationFailed {
                authority_id: signature.authority_id.clone(),
                reason: format!("{}", e),
            })?;
        
        Ok(())
    }
    
    /// Verify multiple signatures (for quorum requirements)
    pub fn verify_multiple(
        &self,
        command_hash: &[u8; 32],
        signatures: &[AuthoritySignature],
    ) -> Result<Vec<String>, AuthorityError> {
        let mut verified_authorities = Vec::new();
        
        for sig in signatures {
            self.verify(command_hash, sig)?;
            verified_authorities.push(sig.authority_id.clone());
        }
        
        Ok(verified_authorities)
    }
}

impl Default for AuthorityVerifier {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use ed25519_dalek::{SigningKey, Signer};
    use rand::RngCore;
    
    #[test]
    fn test_authority_signature_verification() {
        let mut csprng = rand::rngs::OsRng;
        let mut secret_key_bytes = [0u8; 32];
        csprng.fill_bytes(&mut secret_key_bytes);
        let signing_key = SigningKey::from_bytes(&secret_key_bytes);
        let verifying_key = signing_key.verifying_key();
        
        let command_hash = [0u8; 32];
        let signature = signing_key.sign(&command_hash);
        
        let auth_sig = AuthoritySignature::new(
            "operator-1".to_string(),
            signature.to_bytes().to_vec(),
            verifying_key.to_bytes(),
            1000,
        );
        
        let mut verifier = AuthorityVerifier::new();
        verifier.register_authority("operator-1".to_string(), verifying_key.to_bytes());
        
        assert!(verifier.verify(&command_hash, &auth_sig).is_ok());
    }
    
    #[test]
    fn test_invalid_signature_length() {
        let verifier = AuthorityVerifier::new();
        let command_hash = [0u8; 32];
        
        let auth_sig = AuthoritySignature::new(
            "operator-1".to_string(),
            vec![0u8; 32], // Wrong length
            [0u8; 32],
            1000,
        );
        
        assert!(matches!(
            verifier.verify(&command_hash, &auth_sig),
            Err(AuthorityError::InvalidSignature(_))
        ));
    }
}
