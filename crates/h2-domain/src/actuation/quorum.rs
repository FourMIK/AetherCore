//! Quorum signature verification for Byzantine fault tolerance

use serde::{Deserialize, Serialize};
use ed25519_dalek::{Signature, VerifyingKey, Verifier};
use thiserror::Error;

/// Quorum verification errors
#[derive(Debug, Error)]
pub enum QuorumError {
    /// Insufficient signatures provided
    #[error("Insufficient signatures: got {got}, need {required}")]
    InsufficientSignatures {
        /// Number of signatures provided
        got: usize,
        /// Number of signatures required
        required: usize
    },
    
    /// Invalid signature
    #[error("Invalid signature from node {node_id}: {reason}")]
    InvalidSignature {
        /// Node identifier
        node_id: u16,
        /// Reason for invalidity
        reason: String
    },
    
    /// Duplicate node signature
    #[error("Duplicate signature from node {node_id}")]
    DuplicateNode {
        /// Node identifier
        node_id: u16
    },
}

/// Quorum proof containing threshold signatures
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct QuorumProof {
    /// Message being signed (typically command hash)
    pub message: Vec<u8>,
    /// Required signature threshold (e.g., 3 for 3-of-5)
    pub threshold: usize,
    /// Signatures from trusted nodes
    pub signatures: Vec<NodeSignature>,
}

/// Signature from a trusted node
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NodeSignature {
    /// Node identifier
    pub node_id: u16,
    /// Ed25519 signature
    pub signature: Vec<u8>,
    /// Ed25519 public key
    pub public_key: Vec<u8>,
}

impl QuorumProof {
    /// Create a new quorum proof
    pub fn new(message: Vec<u8>, threshold: usize) -> Self {
        Self {
            message,
            threshold,
            signatures: Vec::new(),
        }
    }
    
    /// Add a signature to the proof
    pub fn add_signature(&mut self, node_id: u16, signature: Vec<u8>, public_key: Vec<u8>) {
        self.signatures.push(NodeSignature {
            node_id,
            signature,
            public_key,
        });
    }
    
    /// Verify the quorum proof
    /// 
    /// Checks that:
    /// 1. Sufficient signatures are provided (>= threshold)
    /// 2. All signatures are valid Ed25519 signatures
    /// 3. No duplicate node IDs
    pub fn verify(&self) -> Result<(), QuorumError> {
        // Check threshold
        if self.signatures.len() < self.threshold {
            return Err(QuorumError::InsufficientSignatures {
                got: self.signatures.len(),
                required: self.threshold,
            });
        }
        
        // Check for duplicate nodes
        let mut seen_nodes = std::collections::HashSet::new();
        for sig in &self.signatures {
            if !seen_nodes.insert(sig.node_id) {
                return Err(QuorumError::DuplicateNode {
                    node_id: sig.node_id,
                });
            }
        }
        
        // Verify each signature
        for sig in &self.signatures {
            // Parse public key
            let public_key_bytes: [u8; 32] = sig.public_key
                .as_slice()
                .try_into()
                .map_err(|_| QuorumError::InvalidSignature {
                    node_id: sig.node_id,
                    reason: "Invalid public key length".to_string(),
                })?;
            
            let verifying_key = VerifyingKey::from_bytes(&public_key_bytes)
                .map_err(|e| QuorumError::InvalidSignature {
                    node_id: sig.node_id,
                    reason: format!("Invalid public key: {}", e),
                })?;
            
            // Parse signature
            let signature_bytes: [u8; 64] = sig.signature
                .as_slice()
                .try_into()
                .map_err(|_| QuorumError::InvalidSignature {
                    node_id: sig.node_id,
                    reason: "Invalid signature length".to_string(),
                })?;
            
            let signature = Signature::from_bytes(&signature_bytes);
            
            // Verify signature
            verifying_key
                .verify(&self.message, &signature)
                .map_err(|e| QuorumError::InvalidSignature {
                    node_id: sig.node_id,
                    reason: format!("Signature verification failed: {}", e),
                })?;
        }
        
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    
    #[test]
    fn test_quorum_proof_insufficient_signatures() {
        let proof = QuorumProof::new(b"test message".to_vec(), 3);
        
        match proof.verify() {
            Err(QuorumError::InsufficientSignatures { got: 0, required: 3 }) => {},
            _ => panic!("Expected InsufficientSignatures error"),
        }
    }
}
