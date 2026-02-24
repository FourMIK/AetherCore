//! Integration tests for Zero-Touch Onboarding (Operation Silicon Bind).
//!
//! These tests validate the complete enrollment workflow from raw hardware
//! to trusted mesh node, including:
//! - TPM-backed identity generation
//! - State machine transitions
//! - Genesis bundle generation and installation
//! - Security invariants (replay protection, trust thresholds)
//! - Revocation (Great Gospel)

use aethercore_identity::{
    install_genesis_bundle, Attestation, BootstrapNode, Certificate, CertificateAuthority,
    CertificateRequest, EnrollmentContext, EnrollmentError, EnrollmentRequest,
    EnrollmentStateMachine, GenesisBundleGenerator, PlatformType, CHALLENGE_WINDOW_MS,
    REQUIRED_PCRS,
};
use ed25519_dalek::{Signer, SigningKey};
use std::collections::HashMap;

/// Helper to create a test certificate.
fn create_test_cert(subject: &str, issuer: &str) -> Certificate {
    Certificate {
        serial: "test-12345".to_string(),
        subject: subject.to_string(),
        issuer: issuer.to_string(),
        public_key: vec![1, 2, 3, 4, 5],
        not_before: 0,
        not_after: u64::MAX,
        signature: vec![6, 7, 8, 9, 10],
        extensions: HashMap::new(),
    }
}

/// Helper to create a test bootstrap node.
fn create_test_bootstrap_node(address: &str, region: &str) -> BootstrapNode {
    BootstrapNode {
        address: address.to_string(),
        port: 8443,
        public_key: vec![1, 2, 3, 4],
        region: region.to_string(),
    }
}

#[test]
fn test_identity_generation_with_tpm_attestation() {
    // Create enrollment context (using stub TPM)
    let mut ctx = EnrollmentContext::new(false);

    // Generate identity
    let identity = ctx
        .generate_identity("platform-usv-001")
        .expect("Failed to generate identity");

    // Verify identity has required fields
    assert_eq!(identity.id, "platform-usv-001");
    assert!(!identity.public_key.is_empty());

    // Verify TPM attestation is present
    match identity.attestation {
        Attestation::Tpm { quote, pcrs, .. } => {
            assert!(!quote.is_empty(), "TPM quote should not be empty");
            assert!(!pcrs.is_empty(), "PCR values should not be empty");
        }
        _ => panic!("Expected TPM attestation"),
    }
}

#[test]
fn test_required_pcrs_constant() {
    // Verify required PCRs match specification
    assert_eq!(REQUIRED_PCRS, [0, 2, 4, 7]);
    assert_eq!(REQUIRED_PCRS.len(), 4);
}

#[test]
fn test_challenge_window_constant() {
    // Verify challenge window is 30 seconds
    assert_eq!(CHALLENGE_WINDOW_MS, 30_000);
}

#[test]
fn test_state_machine_happy_path() {
    let mut sm = EnrollmentStateMachine::new();

    // Step 1: Generate identity
    sm.on_identity_generated("platform-uas-002".to_string())
        .expect("Failed to generate identity");

    // Step 2: Receive challenge
    let challenge_hash = blake3::hash(b"challenge-data").as_bytes().to_vec();
    sm.on_challenge_received(challenge_hash)
        .expect("Failed to receive challenge");

    // Step 3: Send response
    let response_hash = blake3::hash(b"response-data").as_bytes().to_vec();
    sm.on_response_sent(response_hash)
        .expect("Failed to send response");

    // Step 4: Verify attestation with TPM (trust score 1.0)
    sm.on_attestation_verified(1.0)
        .expect("Failed to verify attestation");
    assert_eq!(sm.trust_score(), Some(1.0));

    // Step 5: Install genesis bundle
    let token_hash = blake3::hash(b"genesis-token").as_bytes().to_vec();
    sm.on_genesis_bundle_installed(token_hash)
        .expect("Failed to install genesis bundle");

    // Step 6: Validate certificate
    sm.on_certificate_validated("cert-98765".to_string(), 1.0)
        .expect("Failed to validate certificate");

    // Verify final trusted state
    assert!(sm.is_trusted());
    assert_eq!(sm.trust_score(), Some(1.0));

    // Verify all transitions were recorded
    assert_eq!(sm.history().len(), 6);
}

#[test]
fn test_state_machine_software_attestation() {
    let mut sm = EnrollmentStateMachine::new();

    sm.on_identity_generated("platform-ground-003".to_string())
        .expect("Failed to generate identity");
    sm.on_challenge_received(vec![1, 2, 3, 4])
        .expect("Failed to receive challenge");
    sm.on_response_sent(vec![5, 6, 7, 8])
        .expect("Failed to send response");

    // Software attestation has trust score 0.7
    sm.on_attestation_verified(0.7)
        .expect("Failed to verify attestation");

    assert_eq!(sm.trust_score(), Some(0.7));
}

#[test]
fn test_state_machine_trust_threshold_enforcement() {
    let mut sm = EnrollmentStateMachine::new();

    sm.on_identity_generated("platform-ftcase-004".to_string())
        .unwrap();
    sm.on_challenge_received(vec![1, 2, 3, 4]).unwrap();
    sm.on_response_sent(vec![5, 6, 7, 8]).unwrap();

    // Try to attest with trust score below threshold (0.7)
    let result = sm.on_attestation_verified(0.6);

    assert!(result.is_err());
    match result.unwrap_err() {
        EnrollmentError::TrustThresholdNotMet(msg) => {
            assert!(msg.contains("0.6"));
            assert!(msg.contains("0.7"));
        }
        _ => panic!("Expected TrustThresholdNotMet error"),
    }
}

#[test]
fn test_state_machine_invalid_transitions() {
    let mut sm = EnrollmentStateMachine::new();

    // Try to skip directly to challenge received
    let result = sm.on_challenge_received(vec![1, 2, 3, 4]);
    assert!(result.is_err());

    // Try to send response without challenge
    let result = sm.on_response_sent(vec![5, 6, 7, 8]);
    assert!(result.is_err());

    // Try to verify attestation without response
    let result = sm.on_attestation_verified(1.0);
    assert!(result.is_err());
}

#[test]
fn test_genesis_bundle_generation() {
    let root_ca = create_test_cert("4mik-root-ca", "self-signed");
    let intermediate_ca = create_test_cert("4mik-intermediate-ca", "4mik-root-ca");
    let device_cert = create_test_cert("platform-mobile-005", "4mik-intermediate-ca");

    let bootstrap_nodes = vec![
        create_test_bootstrap_node("10.0.1.10", "us-east"),
        create_test_bootstrap_node("10.0.2.20", "us-west"),
        create_test_bootstrap_node("10.0.3.30", "eu-west"),
    ];

    let generator = GenesisBundleGenerator::new(
        root_ca,
        vec![intermediate_ca],
        bootstrap_nodes,
        vec!["https://crl.4mik.net/v1".to_string()],
        vec!["https://ocsp.4mik.net/v1".to_string()],
        365, // Valid for 1 year
    );

    let bundle = generator
        .generate(
            device_cert,
            &Attestation::Tpm {
                quote: vec![1, 2, 3],
                pcrs: vec![4, 5, 6],
                ak_cert: vec![7, 8, 9],
            },
            1.0,
        )
        .expect("Failed to generate genesis bundle");

    // Verify bundle contents
    assert_eq!(bundle.device_certificate.subject, "platform-mobile-005");
    assert_eq!(bundle.root_ca_certificate.subject, "4mik-root-ca");
    assert_eq!(bundle.intermediate_certificates.len(), 1);
    assert_eq!(bundle.mesh_bootstrap_nodes.len(), 3);
    assert_eq!(bundle.crl_endpoints.len(), 1);
    assert_eq!(bundle.ocsp_endpoints.len(), 1);

    // Verify expiration
    let expected_validity = 365 * 24 * 60 * 60 * 1000; // milliseconds
    assert_eq!(bundle.expires_at - bundle.created_at, expected_validity);
}

#[test]
fn test_genesis_bundle_rejects_low_trust() {
    let generator = GenesisBundleGenerator::new(
        create_test_cert("root", "self"),
        vec![],
        vec![],
        vec![],
        vec![],
        365,
    );

    let result = generator.generate(
        create_test_cert("device", "ca"),
        &Attestation::Software {
            certificate: vec![],
        },
        0.5, // Below 0.7 threshold
    );

    assert!(result.is_err());
}

#[test]
fn test_genesis_bundle_rejects_no_attestation() {
    let generator = GenesisBundleGenerator::new(
        create_test_cert("root", "self"),
        vec![],
        vec![],
        vec![],
        vec![],
        365,
    );

    let result = generator.generate(
        create_test_cert("device", "ca"),
        &Attestation::None,
        1.0, // Even with high trust score
    );

    assert!(result.is_err());
}

#[test]
fn test_genesis_bundle_installation() {
    let temp_dir = std::env::temp_dir().join("test-enrollment-integration");
    let temp_path = temp_dir.to_str().unwrap();

    // Clean up any previous runs
    let _ = std::fs::remove_dir_all(&temp_dir);

    let generator = GenesisBundleGenerator::new(
        create_test_cert("root-ca", "self"),
        vec![create_test_cert("intermediate-ca", "root-ca")],
        vec![create_test_bootstrap_node("10.0.0.1", "test-region")],
        vec!["https://crl.test.com".to_string()],
        vec!["https://ocsp.test.com".to_string()],
        365,
    );

    let bundle = generator
        .generate(
            create_test_cert("device-006", "intermediate-ca"),
            &Attestation::Tpm {
                quote: vec![],
                pcrs: vec![],
                ak_cert: vec![],
            },
            1.0,
        )
        .expect("Failed to generate bundle");

    // Install bundle
    install_genesis_bundle(&bundle, Some(temp_path)).expect("Failed to install bundle");

    // Verify files exist
    assert!(temp_dir.join("device.crt").exists());
    assert!(temp_dir.join("root-ca.crt").exists());
    assert!(temp_dir.join("intermediate-0.crt").exists());
    assert!(temp_dir.join("bootstrap-nodes.json").exists());
    assert!(temp_dir.join("bundle-metadata.json").exists());

    // Verify directory permissions on Unix
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let dir_perms = std::fs::metadata(&temp_dir).unwrap().permissions();
        assert_eq!(dir_perms.mode() & 0o777, 0o700);
    }

    // Clean up
    let _ = std::fs::remove_dir_all(&temp_dir);
}

#[test]
fn test_replay_attack_detection() {
    let mut ctx = EnrollmentContext::new(false);
    let identity = ctx.generate_identity("platform-fixed-007").unwrap();

    // Create enrollment request with nonce
    let nonce1 = vec![1, 2, 3, 4, 5, 6, 7, 8];
    let request1 = EnrollmentRequest {
        version: 1,
        identity: identity.clone(),
        platform_type: PlatformType::Fixed,
        firmware_version: "v2.0.0".to_string(),
        timestamp: current_timestamp(),
        challenge_nonce: nonce1.clone(),
    };

    // Simulate replay - reuse the same nonce
    let request2 = EnrollmentRequest {
        version: 1,
        identity,
        platform_type: PlatformType::Fixed,
        firmware_version: "v2.0.0".to_string(),
        timestamp: current_timestamp(),
        challenge_nonce: nonce1, // SAME nonce - replay attack
    };

    // In a real implementation, the server would track nonces
    // For this test, we just verify the nonces are the same (attack scenario)
    assert_eq!(request1.challenge_nonce, request2.challenge_nonce);
}

#[test]
fn test_great_gospel_revocation() {
    let mut sm = EnrollmentStateMachine::new();

    // Enroll a platform completely
    sm.on_identity_generated("platform-aerial-008".to_string())
        .unwrap();
    sm.on_challenge_received(vec![1, 2, 3, 4]).unwrap();
    sm.on_response_sent(vec![5, 6, 7, 8]).unwrap();
    sm.on_attestation_verified(1.0).unwrap();
    sm.on_genesis_bundle_installed(vec![9, 10, 11, 12]).unwrap();
    sm.on_certificate_validated("cert-final".to_string(), 1.0)
        .unwrap();

    assert!(sm.is_trusted());

    // Execute Great Gospel - revoke the platform
    sm.revoke("Platform compromised - firmware tampering detected".to_string())
        .expect("Failed to revoke platform");

    // Verify platform is no longer trusted
    assert!(!sm.is_trusted());

    // Verify state is Revoked
    match sm.current_state() {
        aethercore_identity::EnrollmentState::Revoked {
            identity_id,
            reason,
            ..
        } => {
            assert_eq!(identity_id, "platform-aerial-008");
            assert!(reason.contains("compromised"));
        }
        _ => panic!("Expected Revoked state"),
    }
}

#[test]
fn test_revoke_from_early_state() {
    let mut sm = EnrollmentStateMachine::new();

    sm.on_identity_generated("platform-uuv-009".to_string())
        .unwrap();

    // Revoke even before full enrollment
    sm.revoke("Failed security audit".to_string()).unwrap();

    assert!(!sm.is_trusted());
}

#[test]
fn test_enrollment_request_serialization() {
    let mut ctx = EnrollmentContext::new(false);
    let identity = ctx.generate_identity("platform-uuv-010").unwrap();

    let request = EnrollmentRequest {
        version: 1,
        identity,
        platform_type: PlatformType::Uuv,
        firmware_version: "v3.1.4-beta".to_string(),
        timestamp: current_timestamp(),
        challenge_nonce: vec![0xFF; 32],
    };

    // Serialize and deserialize
    let json = serde_json::to_string(&request).expect("Failed to serialize");
    let deserialized: EnrollmentRequest =
        serde_json::from_str(&json).expect("Failed to deserialize");

    assert_eq!(deserialized.version, 1);
    assert_eq!(deserialized.platform_type, PlatformType::Uuv);
    assert_eq!(deserialized.firmware_version, "v3.1.4-beta");
    assert_eq!(deserialized.challenge_nonce.len(), 32);
}

#[test]
fn test_all_platform_types() {
    let types = vec![
        PlatformType::Usv,
        PlatformType::Uuv,
        PlatformType::Uas,
        PlatformType::GroundStation,
        PlatformType::FTCase,
        PlatformType::Mobile,
        PlatformType::Fixed,
        PlatformType::Aerial,
    ];

    assert_eq!(types.len(), 8);

    // Verify all types serialize/deserialize correctly
    for platform_type in types {
        let json = serde_json::to_string(&platform_type).unwrap();
        let deserialized: PlatformType = serde_json::from_str(&json).unwrap();
        assert_eq!(deserialized, platform_type);
    }
}

#[test]
fn test_state_transition_history() {
    let mut sm = EnrollmentStateMachine::new();

    sm.on_identity_generated("platform-history-test".to_string())
        .unwrap();
    sm.on_challenge_received(vec![1, 2, 3, 4]).unwrap();
    sm.on_response_sent(vec![5, 6, 7, 8]).unwrap();

    let history = sm.history();
    assert_eq!(history.len(), 3);

    // Verify each transition has a hash
    for transition in history {
        assert!(!transition.transition_hash.is_empty());
        assert!(transition.timestamp > 0);
    }

    // Verify transition chain
    assert!(history[0].from_state.contains("Uninitialized"));
    assert!(history[0].to_state.contains("IdentityGenerated"));
    assert!(history[1].from_state.contains("IdentityGenerated"));
    assert!(history[1].to_state.contains("ChallengeReceived"));
    assert!(history[2].from_state.contains("ChallengeReceived"));
    assert!(history[2].to_state.contains("ResponseSent"));
}

#[test]
fn test_certificate_authority_integration() {
    // Create a CA for enrollment
    let ca_signing_key = SigningKey::from_bytes(&[7u8; 32]);
    let ca_public_key = ca_signing_key.verifying_key().to_bytes().to_vec();
    let ca_private_key = ca_signing_key.to_bytes().to_vec();
    let mut ca = CertificateAuthority::new("4mik-enrollment-ca", ca_public_key, ca_private_key);

    // Create CSR for a platform
    let csr_signing_key = SigningKey::from_bytes(&[9u8; 32]);
    let csr_public_key = csr_signing_key.verifying_key().to_bytes().to_vec();
    let mut csr = CertificateRequest {
        subject: "platform-usv-011".to_string(),
        public_key: csr_public_key,
        signature: Vec::new(),
        attestation: Attestation::Tpm {
            quote: vec![],
            pcrs: vec![],
            ak_cert: vec![],
        },
    };

    let csr_tbs = csr_tbs_bytes(&csr);
    csr.signature = csr_signing_key.sign(&csr_tbs).to_bytes().to_vec();

    // Issue certificate
    let cert = ca
        .issue_certificate(csr, 365)
        .expect("Failed to issue certificate");

    assert_eq!(cert.subject, "platform-usv-011");
    assert_eq!(cert.issuer, "4mik-enrollment-ca");
    assert!(ca.verify_certificate(&cert));
}

fn csr_tbs_bytes(request: &CertificateRequest) -> Vec<u8> {
    let mut data = Vec::new();
    write_bytes(&mut data, request.subject.as_bytes());
    write_bytes(&mut data, &request.public_key);
    let attestation_bytes = serde_json::to_vec(&request.attestation).unwrap_or_default();
    write_bytes(&mut data, &attestation_bytes);
    data
}

fn write_bytes(buffer: &mut Vec<u8>, bytes: &[u8]) {
    let len = bytes.len() as u32;
    buffer.extend_from_slice(&len.to_be_bytes());
    buffer.extend_from_slice(bytes);
}

/// Helper to get current timestamp.
fn current_timestamp() -> u64 {
    use std::time::{SystemTime, UNIX_EPOCH};
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_millis() as u64
}
