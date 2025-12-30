//! Public Key Infrastructure (PKI) for 4MIK identity management.
//!
//! Provides certificate management, key distribution, and trust hierarchy.

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

        let cert = Certificate {
            serial: serial.clone(),
            subject: request.subject,
            issuer: self.ca_id.clone(),
            public_key: request.public_key,
            not_before: now,
            not_after: now + (validity_days * 24 * 60 * 60 * 1000),
            signature: self.sign_certificate(&serial),
            extensions: HashMap::new(),
        };

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

        // Verify signature (simplified - in production, verify with CA public key)
        true
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

    fn verify_csr(&self, _request: &CertificateRequest) -> bool {
        // In production: verify signature with public key from request
        true
    }

    fn verify_attestation(&self, attestation: &crate::device::Attestation) -> bool {
        // In production: verify attestation data
        !matches!(attestation, crate::device::Attestation::None)
    }

    fn sign_certificate(&self, data: &str) -> Vec<u8> {
        // In production: sign with CA private key using Ed25519 or RSA
        let mut sig = data.as_bytes().to_vec();
        sig.extend_from_slice(&self.ca_private_key[..std::cmp::min(32, self.ca_private_key.len())]);
        sig
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
        if !self.trusted_roots.contains_key(&root.issuer) {
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

            // In production: verify signature with issuer's public key
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::device::Attestation;

    fn create_test_csr(subject: &str) -> CertificateRequest {
        CertificateRequest {
            subject: subject.to_string(),
            public_key: vec![1, 2, 3, 4],
            signature: vec![5, 6, 7, 8],
            attestation: Attestation::Software {
                certificate: vec![9, 10, 11, 12],
            },
        }
    }

    #[test]
    fn test_create_ca() {
        let ca = CertificateAuthority::new("test-ca", vec![1, 2, 3], vec![4, 5, 6]);

        assert_eq!(ca.ca_id, "test-ca");
    }

    #[test]
    fn test_issue_certificate() {
        let mut ca = CertificateAuthority::new("test-ca", vec![1, 2, 3], vec![4, 5, 6]);

        let csr = create_test_csr("platform-1");
        let cert = ca.issue_certificate(csr, 365).unwrap();

        assert_eq!(cert.subject, "platform-1");
        assert_eq!(cert.issuer, "test-ca");
    }

    #[test]
    fn test_verify_certificate() {
        let mut ca = CertificateAuthority::new("test-ca", vec![1, 2, 3], vec![4, 5, 6]);

        let csr = create_test_csr("platform-1");
        let cert = ca.issue_certificate(csr, 365).unwrap();

        assert!(ca.verify_certificate(&cert));
    }

    #[test]
    fn test_revoke_certificate() {
        let mut ca = CertificateAuthority::new("test-ca", vec![1, 2, 3], vec![4, 5, 6]);

        let csr = create_test_csr("platform-1");
        let cert = ca.issue_certificate(csr, 365).unwrap();

        ca.revoke_certificate(&cert.serial).unwrap();

        assert!(ca.is_revoked(&cert.serial));
        assert!(!ca.verify_certificate(&cert));
    }

    #[test]
    fn test_reject_invalid_attestation() {
        let mut ca = CertificateAuthority::new("test-ca", vec![1, 2, 3], vec![4, 5, 6]);

        let csr = CertificateRequest {
            subject: "platform-1".to_string(),
            public_key: vec![1, 2, 3, 4],
            signature: vec![5, 6, 7, 8],
            attestation: Attestation::None,
        };

        let result = ca.issue_certificate(csr, 365);
        assert!(result.is_err());
    }

    #[test]
    fn test_trust_chain_validator() {
        let mut validator = TrustChainValidator::new();
        validator.add_trusted_root("root-ca".to_string(), vec![1, 2, 3]);

        let root_cert = Certificate {
            serial: "1".to_string(),
            subject: "intermediate-ca".to_string(),
            issuer: "root-ca".to_string(),
            public_key: vec![4, 5, 6],
            not_before: 0,
            not_after: u64::MAX,
            signature: vec![7, 8, 9],
            extensions: HashMap::new(),
        };

        assert!(validator.verify_chain(&[root_cert]));
    }

    #[test]
    fn test_list_certificates() {
        let mut ca = CertificateAuthority::new("test-ca", vec![1, 2, 3], vec![4, 5, 6]);

        ca.issue_certificate(create_test_csr("platform-1"), 365)
            .unwrap();
        ca.issue_certificate(create_test_csr("platform-2"), 365)
            .unwrap();

        let certs = ca.list_certificates();
        assert_eq!(certs.len(), 2);
    }
}
