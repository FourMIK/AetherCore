//! Security layer for tactical mesh
//!
//! Integrates with aethercore-crypto for TPM-based signing and verification

use aethercore_crypto::signing::EventSigningService;
use aethercore_identity::{
    Attestation, AttestationKey, Certificate, PlatformIdentity, TpmManager, TpmQuote,
    TrustChainValidator,
};
use ed25519_dalek::{Signature, Verifier, VerifyingKey};
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
    pub fn with_signing(
        mut self,
        signing_service: EventSigningService,
        identity: PlatformIdentity,
    ) -> Self {
        self.signing_service = Some(signing_service);
        self.identity = Some(identity);
        self
    }

    /// Sign a routing update
    ///
    /// # Security Note
    /// Hashes the update with BLAKE3 and signs it with the TPM-backed Ed25519 key.
    pub fn sign_routing_update(&mut self, update: &[u8]) -> Result<Vec<u8>, String> {
        let service = self
            .signing_service
            .as_mut()
            .ok_or_else(|| "No signing service configured".to_string())?;

        let hash = blake3::hash(update);
        service
            .sign_message(hash.as_bytes())
            .map_err(|e| format!("Signing error: {}", e))
    }

    /// Verify a routing update signature
    ///
    /// # Security Note
    /// Hashes the update with BLAKE3 and verifies the Ed25519 signature.
    pub fn verify_routing_update(
        &self,
        update: &[u8],
        signature: &[u8],
        public_key: &[u8],
    ) -> Result<bool, String> {
        if signature.len() != 64 {
            return Err("Invalid signature length".to_string());
        }
        if public_key.len() != 32 {
            return Err("Invalid public key length".to_string());
        }

        let hash = blake3::hash(update);

        let mut key_array = [0u8; 32];
        key_array.copy_from_slice(public_key);
        let verifying_key = VerifyingKey::from_bytes(&key_array)
            .map_err(|e| format!("Invalid public key: {}", e))?;

        let signature = Signature::from_bytes(&signature.try_into().unwrap());
        Ok(verifying_key.verify(hash.as_bytes(), &signature).is_ok())
    }

    /// Verify TPM attestation for a peer
    ///
    /// # Security Note
    /// Validates AK certificate chain, TPM quote signatures, and PCR policy.
    pub fn verify_attestation(&self, attestation: &Attestation) -> Result<f64, String> {
        match attestation {
            Attestation::Tpm {
                quote,
                pcrs,
                ak_cert,
            } => {
                let cert_chain: Vec<Certificate> = serde_json::from_slice(ak_cert)
                    .map_err(|e| format!("Invalid AK certificate chain: {}", e))?;
                if cert_chain.is_empty() {
                    return Err("AK certificate chain is empty".to_string());
                }

                let root = cert_chain
                    .last()
                    .ok_or_else(|| "Missing root certificate".to_string())?;
                let mut validator = TrustChainValidator::new();
                validator.add_trusted_root(root.issuer.clone(), root.public_key.clone());
                if !validator.verify_chain(&cert_chain) {
                    return Err("AK certificate chain validation failed".to_string());
                }

                let ak_public_key = cert_chain
                    .first()
                    .ok_or_else(|| "Missing AK certificate".to_string())?
                    .public_key
                    .clone();
                if ak_public_key.is_empty() {
                    return Err("AK public key missing".to_string());
                }

                let tpm_quote: TpmQuote = serde_json::from_slice(quote)
                    .map_err(|e| format!("Invalid TPM quote: {}", e))?;

                let ak = AttestationKey {
                    key_id: cert_chain
                        .first()
                        .map(|cert| cert.subject.clone())
                        .unwrap_or_else(|| "ak".to_string()),
                    public_key: ak_public_key,
                    certificate: Some(ak_cert.clone()),
                };

                let tpm_manager = TpmManager::new(false);
                if !tpm_manager.verify_quote(&tpm_quote, &ak) {
                    return Err("TPM quote signature verification failed".to_string());
                }

                let attestation_pcrs = parse_pcrs(pcrs)?;
                let quote_pcrs = extract_quote_pcrs(&tpm_quote)?;

                validate_pcr_policy(&attestation_pcrs)?;
                validate_pcr_policy(&quote_pcrs)?;

                if attestation_pcrs != quote_pcrs {
                    return Err("PCR values do not match TPM quote".to_string());
                }

                Ok(1.0)
            }
            Attestation::Software { certificate } => {
                let cert_chain = parse_certificate_chain(certificate)?;
                if cert_chain.is_empty() {
                    return Err("Software attestation certificate chain is empty".to_string());
                }

                let root = cert_chain
                    .last()
                    .ok_or_else(|| "Missing software attestation root certificate".to_string())?;
                let mut validator = TrustChainValidator::new();
                validator.add_trusted_root(root.issuer.clone(), root.public_key.clone());

                if !validator.verify_chain(&cert_chain) {
                    return Err("Software attestation certificate validation failed".to_string());
                }

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
    pub fn new(payload: Vec<u8>, security: &mut MeshSecurity) -> Result<Self, String> {
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

fn parse_pcrs(pcrs: &[u8]) -> Result<Vec<Vec<u8>>, String> {
    if pcrs.is_empty() {
        return Err("PCR values are required".to_string());
    }
    if pcrs.len() % 32 != 0 {
        return Err("PCR values must be 32-byte aligned".to_string());
    }

    Ok(pcrs.chunks(32).map(|chunk| chunk.to_vec()).collect())
}

fn extract_quote_pcrs(quote: &TpmQuote) -> Result<Vec<Vec<u8>>, String> {
    if quote.pcrs.is_empty() {
        return Err("TPM quote missing PCR values".to_string());
    }

    let mut sorted = quote.pcrs.clone();
    sorted.sort_by_key(|pcr| pcr.index);
    Ok(sorted.into_iter().map(|pcr| pcr.value).collect())
}

fn validate_pcr_policy(pcrs: &[Vec<u8>]) -> Result<(), String> {
    for (index, value) in pcrs.iter().enumerate() {
        if value.len() != 32 {
            return Err(format!("PCR {} has invalid length {}", index, value.len()));
        }
        if value.iter().all(|byte| *byte == 0) {
            return Err(format!("PCR {} value fails policy", index));
        }
    }
    Ok(())
}

fn parse_certificate_chain(certificate: &[u8]) -> Result<Vec<Certificate>, String> {
    if certificate.is_empty() {
        return Err("Certificate payload is empty".to_string());
    }

    if let Ok(chain) = serde_json::from_slice::<Vec<Certificate>>(certificate) {
        return Ok(chain);
    }

    if let Ok(cert) = serde_json::from_slice::<Certificate>(certificate) {
        return Ok(vec![cert]);
    }

    Err("Certificate payload is not valid JSON".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use aethercore_identity::PcrValue;
    use ed25519_dalek::{Signer, SigningKey};
    use std::collections::HashMap;

    fn signing_key_from_seed(seed: u8) -> SigningKey {
        SigningKey::from_bytes(&[seed; 32])
    }

    fn write_bytes(data: &mut Vec<u8>, bytes: &[u8]) {
        let len = bytes.len() as u32;
        data.extend_from_slice(&len.to_be_bytes());
        data.extend_from_slice(bytes);
    }

    fn certificate_tbs_bytes(cert: &Certificate) -> Vec<u8> {
        let mut data = Vec::new();
        write_bytes(&mut data, cert.serial.as_bytes());
        write_bytes(&mut data, cert.subject.as_bytes());
        write_bytes(&mut data, cert.issuer.as_bytes());
        write_bytes(&mut data, &cert.public_key);
        data.extend_from_slice(&cert.not_before.to_be_bytes());
        data.extend_from_slice(&cert.not_after.to_be_bytes());

        let mut extensions: Vec<(&String, &Vec<u8>)> = cert.extensions.iter().collect();
        extensions.sort_by(|a, b| a.0.cmp(b.0));
        for (key, value) in extensions {
            write_bytes(&mut data, key.as_bytes());
            write_bytes(&mut data, value);
        }

        data
    }

    fn sign_certificate(cert: &Certificate, signing_key: &SigningKey) -> Vec<u8> {
        let tbs = certificate_tbs_bytes(cert);
        signing_key.sign(&tbs).to_bytes().to_vec()
    }

    fn build_cert_chain(ak_public_key: Vec<u8>) -> Vec<u8> {
        let root_key = signing_key_from_seed(7);

        let mut root_cert = Certificate {
            serial: "root-serial".to_string(),
            subject: "root-ca".to_string(),
            issuer: "root-ca".to_string(),
            public_key: root_key.verifying_key().to_bytes().to_vec(),
            not_before: 0,
            not_after: u64::MAX,
            signature: Vec::new(),
            extensions: HashMap::new(),
        };
        root_cert.signature = sign_certificate(&root_cert, &root_key);

        let mut ak_cert = Certificate {
            serial: "ak-serial".to_string(),
            subject: "ak-cert".to_string(),
            issuer: "root-ca".to_string(),
            public_key: ak_public_key,
            not_before: 0,
            not_after: u64::MAX,
            signature: Vec::new(),
            extensions: HashMap::new(),
        };
        ak_cert.signature = sign_certificate(&ak_cert, &root_key);

        serde_json::to_vec(&vec![ak_cert, root_cert]).expect("serialize cert chain")
    }

    fn build_software_attestation() -> Attestation {
        let signing_key = signing_key_from_seed(11);
        let mut cert = Certificate {
            serial: "software-serial".to_string(),
            subject: "software-node".to_string(),
            issuer: "software-node".to_string(),
            public_key: signing_key.verifying_key().to_bytes().to_vec(),
            not_before: 0,
            not_after: u64::MAX,
            signature: Vec::new(),
            extensions: HashMap::new(),
        };
        cert.signature = sign_certificate(&cert, &signing_key);
        let certificate = serde_json::to_vec(&cert).expect("serialize software cert");

        Attestation::Software { certificate }
    }

    fn build_tpm_attestation() -> (Attestation, Vec<Vec<u8>>) {
        let mut tpm_manager = TpmManager::new(false);
        let ak = tpm_manager
            .generate_attestation_key("node-1".to_string())
            .expect("ak");
        let nonce = vec![1, 2, 3, 4];
        let quote = tpm_manager.generate_quote(nonce, &[0]).expect("quote");

        let quote_pcrs: Vec<Vec<u8>> = quote.pcrs.iter().map(|pcr| pcr.value.clone()).collect();
        let pcrs_bytes: Vec<u8> = quote_pcrs.iter().flatten().copied().collect();

        let attestation = Attestation::Tpm {
            quote: serde_json::to_vec(&quote).expect("serialize quote"),
            pcrs: pcrs_bytes,
            ak_cert: build_cert_chain(ak.public_key.clone()),
        };

        (attestation, quote_pcrs)
    }

    #[test]
    fn test_mesh_security_creation() {
        let security = MeshSecurity::new();
        assert!(security.identity().is_none());
    }

    #[test]
    fn test_verify_tpm_attestation() {
        let security = MeshSecurity::new();
        let (attestation, _) = build_tpm_attestation();

        let trust = security.verify_attestation(&attestation).unwrap();
        assert_eq!(trust, 1.0);
    }

    #[test]
    fn test_verify_software_attestation() {
        let security = MeshSecurity::new();
        let attestation = build_software_attestation();

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
        let (attestation, _) = build_tpm_attestation();

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
        let signing_service = EventSigningService::new();
        let identity = PlatformIdentity {
            id: "test".to_string(),
            public_key: signing_service.public_key(),
            attestation: build_software_attestation(),
            created_at: 1000,
            metadata: HashMap::new(),
        };

        let mut security = security.with_signing(signing_service, identity);

        let message = SignedMessage::new(vec![1, 2, 3], &mut security).unwrap();

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

    #[test]
    fn test_routing_update_signature_validates() {
        let security = MeshSecurity::new();
        let signing_service = EventSigningService::new();
        let identity = PlatformIdentity {
            id: "test".to_string(),
            public_key: signing_service.public_key(),
            attestation: build_software_attestation(),
            created_at: 1000,
            metadata: HashMap::new(),
        };
        let mut security = security.with_signing(signing_service, identity);

        let payload = vec![10, 20, 30];
        let signature = security.sign_routing_update(&payload).unwrap();
        let public_key = security.identity().unwrap().public_key.clone();

        let is_valid = security
            .verify_routing_update(&payload, &signature, &public_key)
            .unwrap();
        assert!(is_valid);
    }

    #[test]
    fn test_routing_update_signature_invalid_length() {
        let security = MeshSecurity::new();
        let result = security.verify_routing_update(&[1, 2, 3], &[0u8; 10], &[0u8; 32]);
        assert!(result.is_err());
    }

    #[test]
    fn test_routing_update_signature_wrong_key() {
        let security = MeshSecurity::new();
        let signing_service = EventSigningService::new();
        let identity = PlatformIdentity {
            id: "test".to_string(),
            public_key: signing_service.public_key(),
            attestation: build_software_attestation(),
            created_at: 1000,
            metadata: HashMap::new(),
        };
        let mut security = security.with_signing(signing_service, identity);

        let payload = vec![10, 20, 30];
        let signature = security.sign_routing_update(&payload).unwrap();

        let wrong_service = EventSigningService::new();
        let wrong_key = wrong_service.public_key();

        let is_valid = security
            .verify_routing_update(&payload, &signature, &wrong_key)
            .unwrap();
        assert!(!is_valid);
    }

    #[test]
    fn test_tpm_attestation_rejects_bad_pcrs() {
        let security = MeshSecurity::new();
        let (mut attestation, mut quote_pcrs) = build_tpm_attestation();
        quote_pcrs[0] = vec![0; 32];

        if let Attestation::Tpm { quote, pcrs, .. } = &mut attestation {
            let mut quote_struct: TpmQuote = serde_json::from_slice(quote).expect("parse quote");
            quote_struct.pcrs = vec![PcrValue {
                index: 0,
                value: vec![0; 32],
            }];
            *quote = serde_json::to_vec(&quote_struct).expect("serialize quote");
            *pcrs = vec![0; 32];
        }

        let result = security.verify_attestation(&attestation);
        assert!(result.is_err());
    }
}
