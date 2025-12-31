//! Security layer for tactical mesh
//!
//! Integrates with aethercore-crypto for TPM-based signing and verification

use aethercore_crypto::signing::EventSigningService;
use aethercore_identity::{Attestation, PlatformIdentity};
use serde::{Deserialize, Serialize};

/// Security context for mesh operations
pub struct MeshSecurity {
    /// Signing service for message authentication
    signing_service: Option<EventSigningService>,
    /// Local node identity
    identity: Option<PlatformIdentity>,
}

impl MeshSecurity {
    /// Create a new mesh security context
    pub fn new() -> Self {
        Self {
            signing_service: None,
            identity: None,
        }
    }

    /// Initialize with signing service and identity
    pub fn with_signing(mut self, signing_service: EventSigningService, identity: PlatformIdentity) -> Self {
        self.signing_service = Some(signing_service);
        self.identity = Some(identity);
        self
    }

    /// Sign a routing update
    ///
    /// # Security Note
    /// **STUB IMPLEMENTATION**: This currently returns a placeholder signature.
    /// In production, this MUST be replaced with actual TPM-based signing.
    pub fn sign_routing_update(&self, _update: &[u8]) -> Result<Vec<u8>, String> {
        if let Some(_service) = &self.signing_service {
            // TODO: Implement actual Ed25519 signing via TPM
            // Production implementation should:
            // 1. Hash the update with BLAKE3
            // 2. Sign the hash with TPM-backed Ed25519 key
            // 3. Return the signature
            #[cfg(debug_assertions)]
            eprintln!("WARNING: Using stub signature implementation. DO NOT USE IN PRODUCTION!");
            
            Ok(vec![0u8; 64]) // Ed25519 signature size
        } else {
            Err("No signing service configured".to_string())
        }
    }

    /// Verify a routing update signature
    ///
    /// # Security Note
    /// **STUB IMPLEMENTATION**: This currently accepts all signatures.
    /// In production, this MUST be replaced with actual Ed25519 verification.
    pub fn verify_routing_update(&self, _update: &[u8], signature: &[u8], _public_key: &[u8]) -> Result<bool, String> {
        if signature.len() != 64 {
            return Err("Invalid signature length".to_string());
        }
        
        // TODO: Implement actual Ed25519 verification
        // Production implementation should:
        // 1. Hash the update with BLAKE3
        // 2. Verify signature against public key
        // 3. Return verification result
        #[cfg(debug_assertions)]
        eprintln!("WARNING: Accepting all signatures. DO NOT USE IN PRODUCTION!");
        
        Ok(true)
    }

    /// Verify TPM attestation for a peer
    ///
    /// # Security Note
    /// **STUB IMPLEMENTATION**: Returns hardcoded trust scores without verification.
    /// In production, this MUST perform actual TPM attestation verification.
    pub fn verify_attestation(&self, attestation: &Attestation) -> Result<f64, String> {
        match attestation {
            Attestation::Tpm { quote: _, pcrs: _, ak_cert: _ } => {
                // TODO: Implement actual TPM attestation verification
                // Production implementation should:
                // 1. Verify AK certificate chain against trusted roots
                // 2. Verify TPM quote signature using AK
                // 3. Check PCR values against security policy
                // 4. Return trust score based on verification results
                #[cfg(debug_assertions)]
                eprintln!("WARNING: Skipping TPM attestation verification. DO NOT USE IN PRODUCTION!");
                
                Ok(1.0)
            }
            Attestation::Software { certificate: _ } => {
                // Software attestation has lower trust
                // TODO: Verify software certificate
                Ok(0.7)
            }
            Attestation::None => {
                // No attestation = no trust
                Ok(0.0)
            }
        }
    }

    /// Calculate trust score for a peer
    pub fn calculate_trust_score(
        &self,
        attestation: &Attestation,
        signature_failures: u32,
        successful_routes: u32,
        failed_routes: u32,
    ) -> f64 {
        // Base trust from attestation
        let attestation_trust = self.verify_attestation(attestation).unwrap_or(0.0);

        // Behavioral trust based on routing success
        let route_success_rate = if successful_routes + failed_routes > 0 {
            successful_routes as f64 / (successful_routes + failed_routes) as f64
        } else {
            0.5 // Neutral for new peers
        };

        // Penalty for signature failures
        let signature_penalty = (signature_failures as f64 * 0.1).min(0.5);

        // Combined trust score
        let trust = (attestation_trust * 0.6 + route_success_rate * 0.4) - signature_penalty;
        trust.max(0.0).min(1.0)
    }

    /// Get local identity
    pub fn identity(&self) -> Option<&PlatformIdentity> {
        self.identity.as_ref()
    }
}

impl Default for MeshSecurity {
    fn default() -> Self {
        Self::new()
    }
}

/// Signed message wrapper
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SignedMessage {
    /// Message payload
    pub payload: Vec<u8>,
    /// Signature
    pub signature: Vec<u8>,
    /// Signer's public key
    pub public_key: Vec<u8>,
    /// Timestamp
    pub timestamp: u64,
}

impl SignedMessage {
    /// Create a new signed message
    pub fn new(payload: Vec<u8>, security: &MeshSecurity) -> Result<Self, String> {
        let timestamp = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_millis() as u64;

        let signature = security.sign_routing_update(&payload)?;
        let public_key = security
            .identity()
            .map(|id| id.public_key.clone())
            .unwrap_or_default();

        Ok(Self {
            payload,
            signature,
            public_key,
            timestamp,
        })
    }

    /// Verify the signature on this message
    pub fn verify(&self, security: &MeshSecurity) -> Result<bool, String> {
        security.verify_routing_update(&self.payload, &self.signature, &self.public_key)
    }

    /// Check if message is too old (replay protection)
    pub fn is_stale(&self, max_age_ms: u64) -> bool {
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_millis() as u64;

        (now - self.timestamp) > max_age_ms
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;

    #[test]
    fn test_mesh_security_creation() {
        let security = MeshSecurity::new();
        assert!(security.identity().is_none());
    }

    #[test]
    fn test_verify_tpm_attestation() {
        let security = MeshSecurity::new();
        let attestation = Attestation::Tpm {
            quote: vec![1, 2, 3],
            pcrs: vec![4, 5, 6],
            ak_cert: vec![7, 8, 9],
        };

        let trust = security.verify_attestation(&attestation).unwrap();
        assert_eq!(trust, 1.0);
    }

    #[test]
    fn test_verify_software_attestation() {
        let security = MeshSecurity::new();
        let attestation = Attestation::Software {
            certificate: vec![1, 2, 3],
        };

        let trust = security.verify_attestation(&attestation).unwrap();
        assert_eq!(trust, 0.7);
    }

    #[test]
    fn test_verify_no_attestation() {
        let security = MeshSecurity::new();
        let attestation = Attestation::None;

        let trust = security.verify_attestation(&attestation).unwrap();
        assert_eq!(trust, 0.0);
    }

    #[test]
    fn test_calculate_trust_score() {
        let security = MeshSecurity::new();
        let attestation = Attestation::Tpm {
            quote: vec![],
            pcrs: vec![],
            ak_cert: vec![],
        };

        // Good behavior: high success rate, no failures
        let trust = security.calculate_trust_score(&attestation, 0, 100, 10);
        assert!(trust > 0.8);

        // Bad behavior: signature failures
        let trust = security.calculate_trust_score(&attestation, 5, 100, 10);
        assert!(trust < 0.8);

        // Mixed behavior
        let trust = security.calculate_trust_score(&attestation, 1, 50, 50);
        // With TPM attestation (0.6 * 1.0) + routing (0.4 * 0.5) - penalty (0.1) = 0.7
        assert!(trust > 0.4 && trust < 0.8);
    }

    #[test]
    fn test_trust_score_bounds() {
        let security = MeshSecurity::new();
        let attestation = Attestation::None;

        // Even with perfect routing, no attestation limits trust
        let trust = security.calculate_trust_score(&attestation, 0, 1000, 0);
        assert!(trust <= 1.0);

        // Many failures shouldn't make trust negative
        let trust = security.calculate_trust_score(&attestation, 100, 0, 1000);
        assert!(trust >= 0.0);
    }

    #[test]
    fn test_signed_message_stale_detection() {
        let security = MeshSecurity::new();
        let identity = PlatformIdentity {
            id: "test".to_string(),
            public_key: vec![1, 2, 3, 4],
            attestation: Attestation::Software {
                certificate: vec![],
            },
            created_at: 1000,
            metadata: HashMap::new(),
        };

        let security = security.with_signing(
            EventSigningService::new(),
            identity,
        );

        let message = SignedMessage::new(vec![1, 2, 3], &security).unwrap();

        // Fresh message
        assert!(!message.is_stale(60000));

        // Simulate old message
        let old_message = SignedMessage {
            payload: vec![1, 2, 3],
            signature: vec![0; 64],
            public_key: vec![1, 2, 3, 4],
            timestamp: 0, // Very old
        };

        assert!(old_message.is_stale(60000));
    }
}
