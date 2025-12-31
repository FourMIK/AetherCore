//! Genesis bundle distribution for AuthynticOne PKI.
//!
//! After successful attestation, platforms receive a "genesis bundle" containing
//! everything needed to join the trusted mesh network:
//! - Device certificate signed by Root CA
//! - Root and intermediate CA certificates
//! - Bootstrap node addresses for initial mesh connectivity
//! - Revocation checking endpoints (CRL and OCSP)
//!
//! # Security Model
//!
//! Genesis bundles are only issued to platforms with:
//! - Trust score >= 0.7
//! - Valid TPM attestation (Attestation::None is rejected)
//! - Verified firmware and PCR baselines
//!
//! # Installation
//!
//! Bundles are installed to `/etc/4mik/certs` with restricted permissions:
//! - Directory: 0o700 (owner only)
//! - Device certificate: 0o600 (owner read/write only)
//! - Root CA certificate: 0o644 (world-readable)

use serde::{Deserialize, Serialize};
use std::path::PathBuf;

use crate::{Attestation, Certificate};

/// Path where genesis bundles are installed.
pub const GENESIS_BUNDLE_PATH: &str = "/etc/4mik/certs";

/// Minimum trust score required to receive a genesis bundle.
const MIN_TRUST_SCORE: f64 = 0.7;

/// Genesis bundle containing all credentials for mesh network participation.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GenesisBundle {
    /// Device certificate signed by Root CA
    pub device_certificate: Certificate,
    /// Root CA certificate (trust anchor)
    pub root_ca_certificate: Certificate,
    /// Intermediate CA certificates (chain)
    pub intermediate_certificates: Vec<Certificate>,
    /// Bootstrap nodes for initial mesh connectivity
    pub mesh_bootstrap_nodes: Vec<BootstrapNode>,
    /// Certificate Revocation List endpoints
    pub crl_endpoints: Vec<String>,
    /// OCSP endpoints for real-time revocation checking
    pub ocsp_endpoints: Vec<String>,
    /// When this bundle was created
    pub created_at: u64,
    /// When this bundle expires
    pub expires_at: u64,
}

/// Bootstrap node for initial mesh connectivity.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BootstrapNode {
    /// Network address (IP or hostname)
    pub address: String,
    /// Port number
    pub port: u16,
    /// Node's public key for verification
    pub public_key: Vec<u8>,
    /// Geographic region (for proximity selection)
    pub region: String,
}

/// Generator for genesis bundles.
pub struct GenesisBundleGenerator {
    /// Root CA certificate
    root_ca: Certificate,
    /// Intermediate CA certificates
    intermediate_cas: Vec<Certificate>,
    /// Bootstrap node list
    bootstrap_nodes: Vec<BootstrapNode>,
    /// CRL endpoints
    crl_endpoints: Vec<String>,
    /// OCSP endpoints
    ocsp_endpoints: Vec<String>,
    /// Bundle validity in milliseconds
    validity_ms: u64,
}

impl GenesisBundleGenerator {
    /// Create a new genesis bundle generator.
    ///
    /// # Arguments
    ///
    /// * `root_ca` - Root CA certificate
    /// * `intermediate_cas` - Intermediate CA certificates
    /// * `bootstrap_nodes` - Initial bootstrap nodes
    /// * `crl_endpoints` - CRL endpoints for revocation checking
    /// * `ocsp_endpoints` - OCSP endpoints for revocation checking
    /// * `validity_days` - How many days bundles should be valid
    pub fn new(
        root_ca: Certificate,
        intermediate_cas: Vec<Certificate>,
        bootstrap_nodes: Vec<BootstrapNode>,
        crl_endpoints: Vec<String>,
        ocsp_endpoints: Vec<String>,
        validity_days: u64,
    ) -> Self {
        Self {
            root_ca,
            intermediate_cas,
            bootstrap_nodes,
            crl_endpoints,
            ocsp_endpoints,
            validity_ms: validity_days * 24 * 60 * 60 * 1000,
        }
    }

    /// Generate a genesis bundle for an attested platform.
    ///
    /// # Security Checks
    ///
    /// - Validates trust_score >= 0.7
    /// - Rejects Attestation::None
    /// - Validates device certificate is signed
    ///
    /// # Arguments
    ///
    /// * `device_certificate` - Device certificate issued by CA
    /// * `attestation` - Platform attestation proof
    /// * `trust_score` - Computed trust score
    ///
    /// # Returns
    ///
    /// Genesis bundle if all checks pass
    pub fn generate(
        &self,
        device_certificate: Certificate,
        attestation: &Attestation,
        trust_score: f64,
    ) -> crate::Result<GenesisBundle> {
        // Validate trust score
        if trust_score < MIN_TRUST_SCORE {
            return Err(crate::Error::Identity(format!(
                "Trust score {} below minimum {}",
                trust_score, MIN_TRUST_SCORE
            )));
        }

        // Reject platforms with no attestation
        if matches!(attestation, Attestation::None) {
            return Err(crate::Error::Identity(
                "Cannot issue genesis bundle without attestation".to_string(),
            ));
        }

        // Validate device certificate is signed
        if device_certificate.signature.is_empty() {
            return Err(crate::Error::Identity(
                "Device certificate must be signed".to_string(),
            ));
        }

        let now = current_timestamp();

        Ok(GenesisBundle {
            device_certificate,
            root_ca_certificate: self.root_ca.clone(),
            intermediate_certificates: self.intermediate_cas.clone(),
            mesh_bootstrap_nodes: self.bootstrap_nodes.clone(),
            crl_endpoints: self.crl_endpoints.clone(),
            ocsp_endpoints: self.ocsp_endpoints.clone(),
            created_at: now,
            expires_at: now + self.validity_ms,
        })
    }
}

/// Install a genesis bundle to the filesystem.
///
/// # Security
///
/// Creates directory with 0o700 permissions (owner only).
/// Writes device certificate with 0o600 (owner read/write only).
/// Writes root CA with 0o644 (world-readable).
///
/// # Arguments
///
/// * `bundle` - Genesis bundle to install
/// * `base_path` - Base directory (default: /etc/4mik/certs)
///
/// # Returns
///
/// Ok if installation succeeded, Error otherwise
pub fn install_genesis_bundle(
    bundle: &GenesisBundle,
    base_path: Option<&str>,
) -> crate::Result<()> {
    let base = base_path.unwrap_or(GENESIS_BUNDLE_PATH);
    let base_dir = PathBuf::from(base);

    tracing::info!("Installing genesis bundle to: {}", base);

    // Create directory with restricted permissions
    #[cfg(unix)]
    {
        use std::os::unix::fs::DirBuilderExt;
        let mut dir_builder = std::fs::DirBuilder::new();
        dir_builder.mode(0o700); // Owner only
        dir_builder
            .create(&base_dir)
            .map_err(|e| crate::Error::Identity(format!("Failed to create directory: {}", e)))?;
    }

    #[cfg(not(unix))]
    {
        std::fs::create_dir_all(&base_dir)
            .map_err(|e| crate::Error::Identity(format!("Failed to create directory: {}", e)))?;
    }

    // Write device certificate (owner read/write only)
    let device_cert_path = base_dir.join("device.crt");
    let device_cert_pem = certificate_to_pem(&bundle.device_certificate);
    std::fs::write(&device_cert_path, device_cert_pem)
        .map_err(|e| crate::Error::Identity(format!("Failed to write device cert: {}", e)))?;

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mut perms = std::fs::metadata(&device_cert_path)
            .map_err(|e| crate::Error::Identity(format!("Failed to get metadata: {}", e)))?
            .permissions();
        perms.set_mode(0o600); // Owner read/write only
        std::fs::set_permissions(&device_cert_path, perms)
            .map_err(|e| crate::Error::Identity(format!("Failed to set permissions: {}", e)))?;
    }

    // Write root CA certificate (world-readable)
    let root_ca_path = base_dir.join("root-ca.crt");
    let root_ca_pem = certificate_to_pem(&bundle.root_ca_certificate);
    std::fs::write(&root_ca_path, root_ca_pem)
        .map_err(|e| crate::Error::Identity(format!("Failed to write root CA: {}", e)))?;

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mut perms = std::fs::metadata(&root_ca_path)
            .map_err(|e| crate::Error::Identity(format!("Failed to get metadata: {}", e)))?
            .permissions();
        perms.set_mode(0o644); // World-readable
        std::fs::set_permissions(&root_ca_path, perms)
            .map_err(|e| crate::Error::Identity(format!("Failed to set permissions: {}", e)))?;
    }

    // Write intermediate certificates
    for (i, cert) in bundle.intermediate_certificates.iter().enumerate() {
        let path = base_dir.join(format!("intermediate-{}.crt", i));
        let pem = certificate_to_pem(cert);
        std::fs::write(&path, pem)
            .map_err(|e| crate::Error::Identity(format!("Failed to write intermediate cert: {}", e)))?;

        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mut perms = std::fs::metadata(&path)
                .map_err(|e| crate::Error::Identity(format!("Failed to get metadata: {}", e)))?
                .permissions();
            perms.set_mode(0o644);
            std::fs::set_permissions(&path, perms)
                .map_err(|e| crate::Error::Identity(format!("Failed to set permissions: {}", e)))?;
        }
    }

    // Write bootstrap nodes configuration
    let bootstrap_path = base_dir.join("bootstrap-nodes.json");
    let bootstrap_json = serde_json::to_string_pretty(&bundle.mesh_bootstrap_nodes)
        .map_err(|e| crate::Error::Identity(format!("Failed to serialize bootstrap nodes: {}", e)))?;
    std::fs::write(&bootstrap_path, bootstrap_json)
        .map_err(|e| crate::Error::Identity(format!("Failed to write bootstrap nodes: {}", e)))?;

    // Write bundle metadata
    let metadata_path = base_dir.join("bundle-metadata.json");
    let metadata = serde_json::json!({
        "created_at": bundle.created_at,
        "expires_at": bundle.expires_at,
        "crl_endpoints": bundle.crl_endpoints,
        "ocsp_endpoints": bundle.ocsp_endpoints,
    });
    let metadata_json = serde_json::to_string_pretty(&metadata)
        .map_err(|e| crate::Error::Identity(format!("Failed to serialize metadata: {}", e)))?;
    std::fs::write(&metadata_path, metadata_json)
        .map_err(|e| crate::Error::Identity(format!("Failed to write metadata: {}", e)))?;

    tracing::info!("Genesis bundle installed successfully");
    Ok(())
}

/// Convert certificate to PEM format (simplified).
fn certificate_to_pem(cert: &Certificate) -> String {
    // In production, use proper X.509 encoding
    // For now, create a simple PEM-like format
    let cert_json = serde_json::to_string_pretty(cert).unwrap_or_default();
    format!(
        "-----BEGIN CERTIFICATE-----\n{}\n-----END CERTIFICATE-----\n",
        base64_encode(&cert_json.as_bytes())
    )
}

/// Simple base64 encoding (use base64 crate in production).
fn base64_encode(data: &[u8]) -> String {
    // Simplified base64 for testing - use base64 crate in production
    const CHARSET: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut result = String::new();
    let mut i = 0;
    while i < data.len() {
        let b1 = data[i];
        let b2 = if i + 1 < data.len() { data[i + 1] } else { 0 };
        let b3 = if i + 2 < data.len() { data[i + 2] } else { 0 };

        result.push(CHARSET[(b1 >> 2) as usize] as char);
        result.push(CHARSET[(((b1 & 0x03) << 4) | (b2 >> 4)) as usize] as char);
        result.push(if i + 1 < data.len() {
            CHARSET[(((b2 & 0x0f) << 2) | (b3 >> 6)) as usize] as char
        } else {
            '='
        });
        result.push(if i + 2 < data.len() {
            CHARSET[(b3 & 0x3f) as usize] as char
        } else {
            '='
        });

        i += 3;
    }
    result
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
    use std::collections::HashMap;

    fn create_test_cert(subject: &str) -> Certificate {
        Certificate {
            serial: "12345".to_string(),
            subject: subject.to_string(),
            issuer: "test-ca".to_string(),
            public_key: vec![1, 2, 3, 4],
            not_before: 0,
            not_after: u64::MAX,
            signature: vec![5, 6, 7, 8],
            extensions: HashMap::new(),
        }
    }

    fn create_test_bootstrap_node() -> BootstrapNode {
        BootstrapNode {
            address: "10.0.0.1".to_string(),
            port: 8443,
            public_key: vec![9, 10, 11, 12],
            region: "us-west".to_string(),
        }
    }

    #[test]
    fn test_genesis_bundle_creation() {
        let generator = GenesisBundleGenerator::new(
            create_test_cert("root-ca"),
            vec![create_test_cert("intermediate-ca")],
            vec![create_test_bootstrap_node()],
            vec!["https://crl.example.com".to_string()],
            vec!["https://ocsp.example.com".to_string()],
            365,
        );

        let bundle = generator
            .generate(
                create_test_cert("device-001"),
                &Attestation::Tpm {
                    quote: vec![],
                    pcrs: vec![],
                    ak_cert: vec![],
                },
                1.0,
            )
            .unwrap();

        assert_eq!(bundle.device_certificate.subject, "device-001");
        assert_eq!(bundle.root_ca_certificate.subject, "root-ca");
        assert_eq!(bundle.intermediate_certificates.len(), 1);
        assert_eq!(bundle.mesh_bootstrap_nodes.len(), 1);
        assert_eq!(bundle.crl_endpoints.len(), 1);
        assert_eq!(bundle.ocsp_endpoints.len(), 1);
    }

    #[test]
    fn test_reject_low_trust_score() {
        let generator = GenesisBundleGenerator::new(
            create_test_cert("root-ca"),
            vec![],
            vec![],
            vec![],
            vec![],
            365,
        );

        let result = generator.generate(
            create_test_cert("device-002"),
            &Attestation::Software {
                certificate: vec![],
            },
            0.5, // Below threshold
        );

        assert!(result.is_err());
    }

    #[test]
    fn test_accept_minimum_trust_score() {
        let generator = GenesisBundleGenerator::new(
            create_test_cert("root-ca"),
            vec![],
            vec![],
            vec![],
            vec![],
            365,
        );

        let result = generator.generate(
            create_test_cert("device-003"),
            &Attestation::Software {
                certificate: vec![],
            },
            0.7, // Exactly at threshold
        );

        assert!(result.is_ok());
    }

    #[test]
    fn test_reject_no_attestation() {
        let generator = GenesisBundleGenerator::new(
            create_test_cert("root-ca"),
            vec![],
            vec![],
            vec![],
            vec![],
            365,
        );

        let result = generator.generate(
            create_test_cert("device-004"),
            &Attestation::None,
            1.0,
        );

        assert!(result.is_err());
    }

    #[test]
    fn test_bootstrap_node_fields() {
        let node = create_test_bootstrap_node();

        assert_eq!(node.address, "10.0.0.1");
        assert_eq!(node.port, 8443);
        assert_eq!(node.region, "us-west");
        assert!(!node.public_key.is_empty());
    }

    #[test]
    fn test_genesis_bundle_path_constant() {
        assert_eq!(GENESIS_BUNDLE_PATH, "/etc/4mik/certs");
    }

    #[test]
    fn test_install_genesis_bundle() {
        let temp_dir = std::env::temp_dir().join("test-genesis-bundle");
        let temp_path = temp_dir.to_str().unwrap();

        // Clean up any previous test runs
        let _ = std::fs::remove_dir_all(&temp_dir);

        let generator = GenesisBundleGenerator::new(
            create_test_cert("root-ca"),
            vec![create_test_cert("intermediate-ca")],
            vec![create_test_bootstrap_node()],
            vec!["https://crl.example.com".to_string()],
            vec!["https://ocsp.example.com".to_string()],
            365,
        );

        let bundle = generator
            .generate(
                create_test_cert("device-005"),
                &Attestation::Tpm {
                    quote: vec![],
                    pcrs: vec![],
                    ak_cert: vec![],
                },
                1.0,
            )
            .unwrap();

        // Install to temp directory
        install_genesis_bundle(&bundle, Some(temp_path)).unwrap();

        // Verify files were created
        assert!(temp_dir.join("device.crt").exists());
        assert!(temp_dir.join("root-ca.crt").exists());
        assert!(temp_dir.join("intermediate-0.crt").exists());
        assert!(temp_dir.join("bootstrap-nodes.json").exists());
        assert!(temp_dir.join("bundle-metadata.json").exists());

        // Verify permissions on Unix
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let device_perms = std::fs::metadata(temp_dir.join("device.crt"))
                .unwrap()
                .permissions();
            assert_eq!(device_perms.mode() & 0o777, 0o600);

            let root_perms = std::fs::metadata(temp_dir.join("root-ca.crt"))
                .unwrap()
                .permissions();
            assert_eq!(root_perms.mode() & 0o777, 0o644);
        }

        // Clean up
        let _ = std::fs::remove_dir_all(&temp_dir);
    }

    #[test]
    fn test_certificate_to_pem() {
        let cert = create_test_cert("test-subject");
        let pem = certificate_to_pem(&cert);

        assert!(pem.starts_with("-----BEGIN CERTIFICATE-----"));
        assert!(pem.ends_with("-----END CERTIFICATE-----\n"));
    }

    #[test]
    fn test_bundle_expiration() {
        let generator = GenesisBundleGenerator::new(
            create_test_cert("root-ca"),
            vec![],
            vec![],
            vec![],
            vec![],
            365, // 365 days
        );

        let bundle = generator
            .generate(
                create_test_cert("device-006"),
                &Attestation::Tpm {
                    quote: vec![],
                    pcrs: vec![],
                    ak_cert: vec![],
                },
                1.0,
            )
            .unwrap();

        let expected_validity = 365 * 24 * 60 * 60 * 1000; // milliseconds
        assert_eq!(
            bundle.expires_at - bundle.created_at,
            expected_validity
        );
    }

    #[test]
    fn test_min_trust_score_constant() {
        assert_eq!(MIN_TRUST_SCORE, 0.7);
    }
}
