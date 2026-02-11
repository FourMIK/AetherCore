//! Public Key Infrastructure (PKI) for 4MIK identity management.
//!
//! Provides certificate management, key distribution, and trust hierarchy.

use ed25519_dalek::{Signature as Ed25519Signature, Signer, SigningKey, Verifier, VerifyingKey};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// X.509-like certificate for platform identities.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct Certificate {
    /// Certificate serial number
    pub serial: String,
    /// Subject (identity being certified)
    pub subject: String,
    /// Issuer (certificate authority)
    pub issuer: String,
    /// Subject's public key (DER-encoded)
    pub public_key: Vec<u8>,
    /// Not valid before (Unix timestamp)
    pub not_before: u64,
    /// Not valid after (Unix timestamp)
    pub not_after: u64,
    /// Certificate signature
    pub signature: Vec<u8>,
    /// Extensions
    pub extensions: HashMap<String, Vec<u8>>,
}

/// Certificate Signing Request (CSR).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CertificateRequest {
    /// Subject requesting the certificate
    pub subject: String,
    /// Public key to be certified
    pub public_key: Vec<u8>,
    /// Request signature (signed with private key)
    pub signature: Vec<u8>,
    /// Attestation data
    pub attestation: crate::device::Attestation,
}

/// Certificate Authority managing certificate lifecycle.
#[derive(Debug)]
pub struct CertificateAuthority {
    /// CA identity
    ca_id: String,
    /// CA private key (in production, use HSM)
    ca_private_key: Vec<u8>,
    /// CA public key
    #[allow(dead_code)]
    ca_public_key: Vec<u8>,
    /// Issued certificates indexed by serial
    certificates: HashMap<String, Certificate>,
    /// Revoked certificate serials
    revoked: std::collections::HashSet<String>,
    /// Next serial number
    next_serial: u64,
}

impl CertificateAuthority {
    /// Create a new certificate authority.
    pub fn new(ca_id: impl Into<String>, ca_public_key: Vec<u8>, ca_private_key: Vec<u8>) -> Self {
        Self {
            ca_id: ca_id.into(),
            ca_private_key,
            ca_public_key,
            certificates: HashMap::new(),
            revoked: std::collections::HashSet::new(),
            next_serial: 1,
        }
    }

    /// Issue a certificate from a CSR.
    pub fn issue_certificate(
        &mut self,
        request: CertificateRequest,
        validity_days: u64,
    ) -> crate::Result<Certificate> {
        // Verify the CSR signature
        if !self.verify_csr(&request) {
            return Err(crate::Error::Identity("Invalid CSR signature".to_string()));
        }

        // Check attestation
        if !self.verify_attestation(&request.attestation) {
            return Err(crate::Error::Identity("Invalid attestation".to_string()));
        }

        let now = current_timestamp();
        let serial = self.next_serial.to_string();
        self.next_serial += 1;

        let mut cert = Certificate {
            serial: serial.clone(),
            subject: request.subject,
            issuer: self.ca_id.clone(),
            public_key: request.public_key,
            not_before: now,
            not_after: now + (validity_days * 24 * 60 * 60 * 1000),
            signature: Vec::new(),
            extensions: HashMap::new(),
        };
        cert.signature = self.sign_certificate(&cert);

        self.certificates.insert(serial, cert.clone());
        Ok(cert)
    }

    /// Verify a certificate.
    pub fn verify_certificate(&self, cert: &Certificate) -> bool {
        // Check if issued by this CA
        if cert.issuer != self.ca_id {
            return false;
        }

        // Check if revoked
        if self.revoked.contains(&cert.serial) {
            return false;
        }

        // Check validity period
        let now = current_timestamp();
        if now < cert.not_before || now > cert.not_after {
            return false;
        }

        verify_certificate_signature(cert, &self.ca_public_key)
    }

    /// Revoke a certificate.
    pub fn revoke_certificate(&mut self, serial: &str) -> crate::Result<()> {
        if !self.certificates.contains_key(serial) {
            return Err(crate::Error::Identity("Certificate not found".to_string()));
        }

        self.revoked.insert(serial.to_string());
        Ok(())
    }

    /// Check if a certificate is revoked.
    pub fn is_revoked(&self, serial: &str) -> bool {
        self.revoked.contains(serial)
    }

    /// Get a certificate by serial.
    pub fn get_certificate(&self, serial: &str) -> Option<&Certificate> {
        self.certificates.get(serial)
    }

    /// List all issued certificates.
    pub fn list_certificates(&self) -> Vec<&Certificate> {
        self.certificates.values().collect()
    }

    // Internal helper methods

    fn verify_csr(&self, request: &CertificateRequest) -> bool {
        if request.public_key.len() != 32 || request.signature.len() != 64 {
            return false;
        }

        let tbs = csr_tbs_bytes(request);
        let mut key_bytes = [0u8; 32];
        key_bytes.copy_from_slice(&request.public_key);
        let verifying_key = match VerifyingKey::from_bytes(&key_bytes) {
            Ok(key) => key,
            Err(_) => return false,
        };
        let signature_bytes: [u8; 64] = match request.signature.as_slice().try_into() {
            Ok(bytes) => bytes,
            Err(_) => return false,
        };
        let signature = Ed25519Signature::from_bytes(&signature_bytes);
        verifying_key.verify(&tbs, &signature).is_ok()
    }

    fn verify_attestation(&self, attestation: &crate::device::Attestation) -> bool {
        // In production: verify attestation data
        !matches!(attestation, crate::device::Attestation::None)
    }

    fn sign_certificate(&self, cert: &Certificate) -> Vec<u8> {
        if self.ca_private_key.len() != 32 {
            return Vec::new();
        }
        let mut key_bytes = [0u8; 32];
        key_bytes.copy_from_slice(&self.ca_private_key);
        let signing_key = SigningKey::from_bytes(&key_bytes);
        let tbs = certificate_tbs_bytes(cert);
        signing_key.sign(&tbs).to_bytes().to_vec()
    }
}

/// Trust chain validator for certificate chains.
#[derive(Debug)]
pub struct TrustChainValidator {
    /// Trusted root CAs
    trusted_roots: HashMap<String, Vec<u8>>,
}

impl TrustChainValidator {
    /// Create a new trust chain validator.
    pub fn new() -> Self {
        Self {
            trusted_roots: HashMap::new(),
        }
    }

    /// Add a trusted root CA.
    pub fn add_trusted_root(&mut self, ca_id: String, public_key: Vec<u8>) {
        self.trusted_roots.insert(ca_id, public_key);
    }

    /// Verify a certificate chain.
    pub fn verify_chain(&self, certificates: &[Certificate]) -> bool {
        if certificates.is_empty() {
            return false;
        }

        // Check if root is trusted
        let root = &certificates[certificates.len() - 1];
        let root_public_key = match self.trusted_roots.get(&root.issuer) {
            Some(key) => key,
            None => return false,
        };

        if !is_certificate_time_valid(root) {
            return false;
        }
        if !verify_certificate_signature(root, root_public_key) {
            return false;
        }

        // Verify each certificate in chain
        for i in 0..certificates.len() - 1 {
            let cert = &certificates[i];
            let issuer = &certificates[i + 1];

            // Verify cert was issued by issuer
            if cert.issuer != issuer.subject {
                return false;
            }

            if !is_certificate_time_valid(cert) {
                return false;
            }

            if !verify_certificate_signature(cert, &issuer.public_key) {
                return false;
            }
        }

        true
    }
}

impl Default for TrustChainValidator {
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

fn csr_tbs_bytes(request: &CertificateRequest) -> Vec<u8> {
    let mut data = Vec::new();
    write_bytes(&mut data, request.subject.as_bytes());
    write_bytes(&mut data, &request.public_key);
    let attestation_bytes = serde_json::to_vec(&request.attestation).unwrap_or_else(|_| Vec::new());
    write_bytes(&mut data, &attestation_bytes);
    data
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

fn write_bytes(buffer: &mut Vec<u8>, bytes: &[u8]) {
    let len = bytes.len() as u32;
    buffer.extend_from_slice(&len.to_be_bytes());
    buffer.extend_from_slice(bytes);
}

fn is_certificate_time_valid(cert: &Certificate) -> bool {
    let now = current_timestamp();
    now >= cert.not_before && now <= cert.not_after
}

fn verify_certificate_signature(cert: &Certificate, issuer_public_key: &[u8]) -> bool {
    if issuer_public_key.len() != 32 || cert.signature.len() != 64 {
        return false;
    }
    let mut key_bytes = [0u8; 32];
    key_bytes.copy_from_slice(issuer_public_key);
    let verifying_key = match VerifyingKey::from_bytes(&key_bytes) {
        Ok(key) => key,
        Err(_) => return false,
    };
    let signature_bytes: [u8; 64] = match cert.signature.as_slice().try_into() {
        Ok(bytes) => bytes,
        Err(_) => return false,
    };
    let signature = Ed25519Signature::from_bytes(&signature_bytes);
    let tbs = certificate_tbs_bytes(cert);
    verifying_key.verify(&tbs, &signature).is_ok()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::device::Attestation;

    fn signing_key_from_seed(seed: u8) -> SigningKey {
        let bytes = [seed; 32];
        SigningKey::from_bytes(&bytes)
    }

    fn create_test_csr(subject: &str, signing_key: &SigningKey) -> CertificateRequest {
        let public_key = signing_key.verifying_key().to_bytes().to_vec();
        let mut request = CertificateRequest {
            subject: subject.to_string(),
            public_key,
            signature: Vec::new(),
            attestation: Attestation::Software {
                certificate: vec![9, 10, 11, 12],
            },
        };
        let tbs = csr_tbs_bytes(&request);
        request.signature = signing_key.sign(&tbs).to_bytes().to_vec();
        request
    }

    fn build_ca(seed: u8, ca_id: &str) -> CertificateAuthority {
        let signing_key = signing_key_from_seed(seed);
        CertificateAuthority::new(
            ca_id,
            signing_key.verifying_key().to_bytes().to_vec(),
            signing_key.to_bytes().to_vec(),
        )
    }

    fn sign_certificate(cert: &Certificate, signing_key: &SigningKey) -> Vec<u8> {
        let tbs = certificate_tbs_bytes(cert);
        signing_key.sign(&tbs).to_bytes().to_vec()
    }

    fn build_root_cert(ca_id: &str, signing_key: &SigningKey) -> Certificate {
        let mut cert = Certificate {
            serial: "root-serial".to_string(),
            subject: ca_id.to_string(),
            issuer: ca_id.to_string(),
            public_key: signing_key.verifying_key().to_bytes().to_vec(),
            not_before: 0,
            not_after: u64::MAX,
            signature: Vec::new(),
            extensions: HashMap::new(),
        };
        cert.signature = sign_certificate(&cert, signing_key);
        cert
    }

    #[test]
    fn test_create_ca() {
        let ca = build_ca(42, "test-ca");

        assert_eq!(ca.ca_id, "test-ca");
    }

    #[test]
    fn test_issue_certificate() {
        let mut ca = build_ca(42, "test-ca");

        let csr_key = signing_key_from_seed(10);
        let csr = create_test_csr("platform-1", &csr_key);
        let cert = ca.issue_certificate(csr, 365).unwrap();

        assert_eq!(cert.subject, "platform-1");
        assert_eq!(cert.issuer, "test-ca");
    }

    #[test]
    fn test_verify_certificate() {
        let mut ca = build_ca(42, "test-ca");

        let csr_key = signing_key_from_seed(10);
        let csr = create_test_csr("platform-1", &csr_key);
        let cert = ca.issue_certificate(csr, 365).unwrap();

        assert!(ca.verify_certificate(&cert));
    }

    #[test]
    fn test_revoke_certificate() {
        let mut ca = build_ca(42, "test-ca");

        let csr_key = signing_key_from_seed(10);
        let csr = create_test_csr("platform-1", &csr_key);
        let cert = ca.issue_certificate(csr, 365).unwrap();

        ca.revoke_certificate(&cert.serial).unwrap();

        assert!(ca.is_revoked(&cert.serial));
        assert!(!ca.verify_certificate(&cert));
    }

    #[test]
    fn test_reject_invalid_attestation() {
        let mut ca = build_ca(42, "test-ca");

        let csr_key = signing_key_from_seed(10);
        let mut csr = create_test_csr("platform-1", &csr_key);
        csr.attestation = Attestation::None;
        let tbs = csr_tbs_bytes(&csr);
        csr.signature = csr_key.sign(&tbs).to_bytes().to_vec();

        let result = ca.issue_certificate(csr, 365);
        assert!(result.is_err());
    }

    #[test]
    fn test_trust_chain_validator() {
        let mut validator = TrustChainValidator::new();
        let root_key = signing_key_from_seed(55);
        validator.add_trusted_root(
            "root-ca".to_string(),
            root_key.verifying_key().to_bytes().to_vec(),
        );

        let root_cert = build_root_cert("root-ca", &root_key);

        assert!(validator.verify_chain(&[root_cert]));
    }

    #[test]
    fn test_list_certificates() {
        let mut ca = build_ca(42, "test-ca");

        let csr_key = signing_key_from_seed(10);
        ca.issue_certificate(create_test_csr("platform-1", &csr_key), 365)
            .unwrap();
        ca.issue_certificate(create_test_csr("platform-2", &csr_key), 365)
            .unwrap();

        let certs = ca.list_certificates();
        assert_eq!(certs.len(), 2);
    }
}
