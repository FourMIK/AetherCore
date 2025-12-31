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
    /// Command hash being signed (32 bytes)
    pub command_hash: [u8; 32],
    /// Signatures from trusted nodes
    pub signatures: Vec<NodeSignature>,
    /// Required signature threshold (e.g., 3 for 3-of-5)
    pub threshold: u8,
    /// Timestamp when proof was created (nanoseconds since epoch)
    pub timestamp: u64,
}

/// Signature from a trusted node
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NodeSignature {
    /// Node identifier
    pub node_id: String,
    /// Ed25519 signature (64 bytes, stored as Vec for serde compatibility)
    pub signature: Vec<u8>,
    /// Ed25519 public key (32 bytes)
    pub public_key: [u8; 32],
}

impl QuorumProof {
    /// Create a new quorum proof
    pub fn new(command_hash: [u8; 32], threshold: u8, timestamp: u64) -> Self {
        Self {
            command_hash,
            threshold,
            timestamp,
            signatures: Vec::new(),
        }
    }
    
    /// Add a signature to the proof
    pub fn add_signature(&mut self, node_id: String, signature: Vec<u8>, public_key: [u8; 32]) {
        self.signatures.push(NodeSignature {
            node_id,
            signature,
            public_key,
        });
    }
    
    /// Check if threshold is met
    pub fn meets_threshold(&self) -> bool {
        self.signatures.len() >= self.threshold as usize
    }
    
    /// Verify the quorum proof
    /// 
    /// Checks that:
    /// 1. Sufficient signatures are provided (>= threshold)
    /// 2. All signatures are valid Ed25519 signatures
    /// 3. No duplicate node IDs
    pub fn verify(&self) -> Result<(), QuorumError> {
        // Check threshold
        if !self.meets_threshold() {
            return Err(QuorumError::InsufficientSignatures {
                got: self.signatures.len(),
                required: self.threshold as usize,
            });
        }
        
        // Check for duplicate nodes
        let mut seen_nodes = std::collections::HashSet::new();
        for sig in &self.signatures {
            if !seen_nodes.insert(&sig.node_id) {
                // Convert string to u16 for error reporting (use hash of first bytes)
                let node_id_hash = sig.node_id.as_bytes().get(0).copied().unwrap_or(0) as u16;
                return Err(QuorumError::DuplicateNode {
                    node_id: node_id_hash,
                });
            }
        }
        
        // Verify each signature
        for sig in &self.signatures {
            let verifying_key = VerifyingKey::from_bytes(&sig.public_key)
                .map_err(|e| {
                    let node_id_hash = sig.node_id.as_bytes().get(0).copied().unwrap_or(0) as u16;
                    QuorumError::InvalidSignature {
                        node_id: node_id_hash,
                        reason: format!("Invalid public key: {}", e),
                    }
                })?;
            
            // Parse signature (must be exactly 64 bytes)
            if sig.signature.len() != 64 {
                let node_id_hash = sig.node_id.as_bytes().get(0).copied().unwrap_or(0) as u16;
                return Err(QuorumError::InvalidSignature {
                    node_id: node_id_hash,
                    reason: format!("Invalid signature length: {} (expected 64)", sig.signature.len()),
                });
            }
            
            let signature_bytes: [u8; 64] = sig.signature[..64].try_into().unwrap();
            let signature = Signature::from_bytes(&signature_bytes);
            
            // Verify signature over command hash
            verifying_key
                .verify(&self.command_hash, &signature)
                .map_err(|e| {
                    let node_id_hash = sig.node_id.as_bytes().get(0).copied().unwrap_or(0) as u16;
                    QuorumError::InvalidSignature {
                        node_id: node_id_hash,
                        reason: format!("Signature verification failed: {}", e),
                    }
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
        let proof = QuorumProof::new([0u8; 32], 3, 1000);
        
        match proof.verify() {
            Err(QuorumError::InsufficientSignatures { got: 0, required: 3 }) => {},
            _ => panic!("Expected InsufficientSignatures error"),
        }
    }
    
    #[test]
    fn test_quorum_proof_meets_threshold() {
        let mut proof = QuorumProof::new([0u8; 32], 2, 1000);
        assert!(!proof.meets_threshold());
        
        proof.add_signature("node1".to_string(), vec![0u8; 64], [0u8; 32]);
        assert!(!proof.meets_threshold());
        
        proof.add_signature("node2".to_string(), vec![0u8; 64], [0u8; 32]);
        assert!(proof.meets_threshold());
    }
}
