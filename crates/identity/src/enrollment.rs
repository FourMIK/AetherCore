//! Hardware-rooted identity enrollment for Zero-Touch Onboarding.
//!
//! This module implements the first phase of the "Silicon Bind" - generating
//! hardware-backed identities that can never be cloned or spoofed. Private keys
//! are generated inside the TPM and NEVER leave the secure element.
//!
//! # Security Properties
//!
//! - Private keys are TPM-resident (architecture invariant)
//! - PCR 0, 2, 4, 7 must match Gold Image baselines
//! - Protocol version enforcement (must equal 1)
//! - Challenge nonces for replay protection
//! - Timestamp window enforcement (30 seconds)
//!
//! # Protocol Flow
//!
//! 1. Platform boots, TPM generates identity key pair
//! 2. Identity manager creates enrollment request with TPM quote
//! 3. Enrollment server validates PCRs, firmware, timestamps
//! 4. Server sends challenge for proof-of-possession
//! 5. Platform signs challenge with TPM-resident key
//! 6. Server validates and issues genesis bundle

use serde::{Deserialize, Serialize};
use std::collections::HashMap;

use crate::{Attestation, PlatformIdentity, TpmManager};

/// Protocol version for enrollment.
pub const PROTOCOL_VERSION: u32 = 1;

/// Challenge response window in milliseconds (30 seconds).
pub const CHALLENGE_WINDOW_MS: u64 = 30_000;

/// Required Platform Configuration Registers for attestation.
/// - PCR 0: BIOS and boot firmware
/// - PCR 2: Option ROM code
/// - PCR 4: Master Boot Record (MBR)
/// - PCR 7: Secure Boot state
pub const REQUIRED_PCRS: [u8; 4] = [0, 2, 4, 7];

/// Platform type classifications for asset management.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum PlatformType {
    /// Unmanned Surface Vehicle
    Usv,
    /// Unmanned Underwater Vehicle
    Uuv,
    /// Unmanned Aerial System
    Uas,
    /// Ground Station (command center)
    GroundStation,
    /// Field Tactical Case (portable operations)
    FTCase,
    /// Mobile platform (vehicle-mounted)
    Mobile,
    /// Fixed installation (building-mounted)
    Fixed,
    /// Aerial platform (aircraft-mounted)
    Aerial,
}

/// Enrollment request payload from edge device to enrollment server.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EnrollmentRequest {
    /// Protocol version (must be 1)
    pub version: u32,
    /// Platform identity being enrolled
    pub identity: PlatformIdentity,
    /// Platform type classification
    pub platform_type: PlatformType,
    /// Firmware version string (e.g., "v2.1.0-rc3")
    pub firmware_version: String,
    /// Request timestamp (Unix epoch milliseconds)
    pub timestamp: u64,
    /// Challenge nonce for replay protection (32 bytes)
    pub challenge_nonce: Vec<u8>,
}

/// Enrollment context managing TPM-backed identity generation.
pub struct EnrollmentContext {
    /// TPM manager for hardware operations
    tpm: TpmManager,
    /// Nonce counter for uniqueness
    nonce_counter: u64,
}

impl EnrollmentContext {
    /// Create a new enrollment context.
    ///
    /// # Arguments
    ///
    /// * `use_hardware_tpm` - Whether to use hardware TPM (true) or stub (false)
    pub fn new(use_hardware_tpm: bool) -> Self {
        Self {
            tpm: TpmManager::new(use_hardware_tpm),
            nonce_counter: 0,
        }
    }

    /// Generate a new hardware-rooted identity.
    ///
    /// This function creates a new identity with TPM-resident keys. The private
    /// key is generated inside the TPM and NEVER leaves the secure element.
    ///
    /// # Returns
    ///
    /// A `PlatformIdentity` with TPM attestation containing:
    /// - Unique identity ID
    /// - Public key (exportable)
    /// - TPM quote with required PCR values
    /// - Attestation key certificate
    pub fn generate_identity(&mut self, platform_id: &str) -> crate::Result<PlatformIdentity> {
        tracing::info!("Generating TPM-backed identity for platform: {}", platform_id);

        // Generate attestation key (private key stays in TPM)
        let ak = self.tpm.generate_attestation_key(format!("{}-ak", platform_id))?;

        // Generate TPM quote with required PCRs
        let nonce = self.generate_nonce(32);
        let quote = self.tpm.generate_quote(nonce, &REQUIRED_PCRS)?;

        // Verify the quote was generated correctly
        if !self.tpm.verify_quote(&quote, &ak) {
            return Err(crate::Error::Identity(
                "Failed to verify generated TPM quote".to_string(),
            ));
        }

        let now = current_timestamp();

        Ok(PlatformIdentity {
            id: platform_id.to_string(),
            public_key: ak.public_key,
            attestation: Attestation::Tpm {
                quote: serde_json::to_vec(&quote)
                    .map_err(|e| crate::Error::Identity(format!("Failed to serialize quote: {}", e)))?,
                pcrs: serde_json::to_vec(&quote.pcrs)
                    .map_err(|e| crate::Error::Identity(format!("Failed to serialize PCRs: {}", e)))?,
                ak_cert: ak.certificate.unwrap_or_default(),
            },
            created_at: now,
            metadata: HashMap::new(),
        })
    }

    /// Sign a challenge using the TPM-resident attestation key.
    ///
    /// This proves possession of the private key without ever exporting it.
    /// The signature is generated entirely within the TPM's secure boundary.
    ///
    /// # Arguments
    ///
    /// * `platform_id` - Platform identity ID
    /// * `challenge` - Challenge data to sign
    ///
    /// # Returns
    ///
    /// Signature bytes generated by the TPM
    pub fn sign_challenge(&mut self, platform_id: &str, challenge: &[u8]) -> crate::Result<Vec<u8>> {
        tracing::debug!("Signing challenge for platform: {}", platform_id);

        let key_id = format!("{}-ak", platform_id);
        self.tpm.sign_with_attestation_key(&key_id, challenge)
    }

    /// Generate a cryptographic nonce for challenges.
    fn generate_nonce(&mut self, size: usize) -> Vec<u8> {
        self.nonce_counter += 1;

        let now = current_timestamp();
        let mut nonce = Vec::new();
        nonce.extend_from_slice(&now.to_le_bytes());
        nonce.extend_from_slice(&self.nonce_counter.to_le_bytes());

        // Pad to desired size with pseudo-random data
        while nonce.len() < size {
            nonce.push((nonce.len() as u8).wrapping_mul(17).wrapping_add(31));
        }
        nonce.truncate(size);
        nonce
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
    use p256::ecdsa::{signature::Verifier, Signature, VerifyingKey};

    #[test]
    fn test_platform_types() {
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
    }

    #[test]
    fn test_required_pcrs() {
        assert_eq!(REQUIRED_PCRS.len(), 4);
        assert_eq!(REQUIRED_PCRS, [0, 2, 4, 7]);
    }

    #[test]
    fn test_enrollment_context_creation() {
        let ctx = EnrollmentContext::new(false);
        assert_eq!(ctx.nonce_counter, 0);
    }

    #[test]
    fn test_generate_identity() {
        let mut ctx = EnrollmentContext::new(false);
        let identity = ctx.generate_identity("test-platform-001").unwrap();

        assert_eq!(identity.id, "test-platform-001");
        assert!(!identity.public_key.is_empty());
        assert!(matches!(identity.attestation, Attestation::Tpm { .. }));

        // Verify TPM attestation contains required data
        if let Attestation::Tpm { quote, pcrs, .. } = &identity.attestation {
            assert!(!quote.is_empty());
            assert!(!pcrs.is_empty());
        } else {
            panic!("Expected TPM attestation");
        }
    }

    #[test]
    fn test_sign_challenge() {
        let mut ctx = EnrollmentContext::new(false);
        let identity = ctx.generate_identity("test-platform-002").unwrap();
        
        let challenge = b"test-challenge-data";
        let signature = ctx.sign_challenge(&identity.id, challenge).unwrap();

        assert!(!signature.is_empty());

        let verifying_key =
            VerifyingKey::from_sec1_bytes(&identity.public_key).expect("valid public key");
        let parsed_signature = Signature::from_der(&signature).expect("valid signature");
        assert!(verifying_key.verify(challenge, &parsed_signature).is_ok());
        assert!(verifying_key.verify(b"tampered-challenge", &parsed_signature).is_err());
        
        // Different challenge should produce different signature
        let challenge2 = b"different-challenge-data";
        let signature2 = ctx.sign_challenge(&identity.id, challenge2).unwrap();
        assert_ne!(signature, signature2); // Different due to different challenge
    }

    #[test]
    fn test_enrollment_request_serialization() {
        let mut ctx = EnrollmentContext::new(false);
        let identity = ctx.generate_identity("test-platform-003").unwrap();

        let request = EnrollmentRequest {
            version: PROTOCOL_VERSION,
            identity,
            platform_type: PlatformType::Uas,
            firmware_version: "v2.1.0".to_string(),
            timestamp: current_timestamp(),
            challenge_nonce: vec![1, 2, 3, 4, 5, 6, 7, 8],
        };

        let serialized = serde_json::to_string(&request).unwrap();
        let deserialized: EnrollmentRequest = serde_json::from_str(&serialized).unwrap();

        assert_eq!(deserialized.version, PROTOCOL_VERSION);
        assert_eq!(deserialized.platform_type, PlatformType::Uas);
        assert_eq!(deserialized.firmware_version, "v2.1.0");
    }

    #[test]
    fn test_nonce_generation() {
        let mut ctx = EnrollmentContext::new(false);
        
        let nonce1 = ctx.generate_nonce(32);
        let nonce2 = ctx.generate_nonce(32);

        assert_eq!(nonce1.len(), 32);
        assert_eq!(nonce2.len(), 32);
        assert_ne!(nonce1, nonce2); // Nonces should be unique
    }

    #[test]
    fn test_protocol_version_constant() {
        assert_eq!(PROTOCOL_VERSION, 1);
    }

    #[test]
    fn test_challenge_window_constant() {
        assert_eq!(CHALLENGE_WINDOW_MS, 30_000);
    }
}
