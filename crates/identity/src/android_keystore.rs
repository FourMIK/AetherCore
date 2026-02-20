//! Android Keystore integration for device identity attestation.
//! Provides challenge signing, quote verification, and backend metadata.

use p256::ecdsa::{
    signature::Signer as _, signature::Verifier as _, Signature, SigningKey, VerifyingKey,
};
use p256::elliptic_curve::rand_core::OsRng;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// Parsed Android security signals extracted from key attestation.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Default)]
pub struct AndroidSecuritySignals {
    /// Android API level (e.g. 34)
    pub api_level: u32,
    /// Verified boot state (e.g. green/yellow/orange/red)
    pub verified_boot_state: String,
    /// Device lock state
    pub device_locked: bool,
    /// Security patch level (YYYY-MM)
    pub os_patch_level: String,
    /// Security level reported by Android Keystore
    pub security_level: String,
    /// Additional backend-defined attributes
    pub extra: HashMap<String, String>,
}

/// Android attestation quote containing proof over a challenge nonce.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct AndroidQuote {
    /// Original challenge/nonce that was signed.
    pub challenge: Vec<u8>,
    /// Signature over the challenge.
    pub signature: Vec<u8>,
    /// Public key used to verify the signature (SEC1 compressed/uncompressed).
    pub public_key: Vec<u8>,
    /// Android Key Attestation certificate chain (leaf to root).
    pub cert_chain: Vec<Vec<u8>>,
    /// Parsed security posture signals.
    pub security_signals: AndroidSecuritySignals,
    /// Quote creation timestamp.
    pub timestamp: u64,
}

/// Android backend metadata for observability and policy checks.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct AndroidBackendMetadata {
    /// Backend identifier.
    pub backend: String,
    /// Whether key operations are hardware-backed.
    pub hardware_backed: bool,
    /// Security level reported by Keystore.
    pub security_level: String,
    /// Reported API level.
    pub api_level: u32,
    /// Reported OS patch level.
    pub os_patch_level: String,
}

#[derive(Debug, Clone)]
struct AndroidKeyRecord {
    signing_key: SigningKey,
    cert_chain: Vec<Vec<u8>>,
    security_signals: AndroidSecuritySignals,
}

/// Android keystore manager used to mint and verify attestation quotes.
#[derive(Debug, Default)]
pub struct AndroidKeystoreManager {
    keys: HashMap<String, AndroidKeyRecord>,
}

impl AndroidKeystoreManager {
    /// Create an empty Android keystore manager.
    pub fn new() -> Self {
        Self {
            keys: HashMap::new(),
        }
    }

    /// Provision an ephemeral key in the stubbed backend.
    pub fn provision_stub_key(
        &mut self,
        key_id: impl Into<String>,
        cert_chain: Vec<Vec<u8>>,
        security_signals: AndroidSecuritySignals,
    ) {
        let signing_key = SigningKey::random(&mut OsRng);
        self.keys.insert(
            key_id.into(),
            AndroidKeyRecord {
                signing_key,
                cert_chain,
                security_signals,
            },
        );
    }

    /// Sign a challenge nonce with a backend-resident key and return an Android quote.
    pub fn sign_nonce(&self, key_id: &str, challenge: &[u8]) -> crate::Result<AndroidQuote> {
        let key = self.keys.get(key_id).ok_or_else(|| {
            crate::Error::Identity(format!("Android key '{}' not found in backend", key_id))
        })?;

        let signature: Signature = key.signing_key.sign(challenge);
        let verifying_key = key.signing_key.verifying_key();

        Ok(AndroidQuote {
            challenge: challenge.to_vec(),
            signature: signature.to_der().as_bytes().to_vec(),
            public_key: verifying_key.to_encoded_point(true).as_bytes().to_vec(),
            cert_chain: key.cert_chain.clone(),
            security_signals: key.security_signals.clone(),
            timestamp: current_timestamp(),
        })
    }

    /// Verify an Android quote against an expected challenge.
    pub fn verify_quote(&self, quote: &AndroidQuote, expected_challenge: &[u8]) -> bool {
        if quote.challenge != expected_challenge || quote.challenge.is_empty() {
            return false;
        }
        if quote.cert_chain.is_empty() {
            return false;
        }

        let verifying_key = match VerifyingKey::from_sec1_bytes(&quote.public_key) {
            Ok(key) => key,
            Err(_) => return false,
        };
        let signature = match Signature::from_der(&quote.signature) {
            Ok(sig) => sig,
            Err(_) => return false,
        };

        verifying_key.verify(&quote.challenge, &signature).is_ok()
    }

    /// Get backend metadata for policy and diagnostics.
    pub fn backend_metadata(&self, key_id: &str) -> crate::Result<AndroidBackendMetadata> {
        let key = self.keys.get(key_id).ok_or_else(|| {
            crate::Error::Identity(format!("Android key '{}' not found in backend", key_id))
        })?;

        Ok(AndroidBackendMetadata {
            backend: "android-keystore".to_string(),
            hardware_backed: key.security_signals.security_level.to_lowercase() != "software",
            security_level: key.security_signals.security_level.clone(),
            api_level: key.security_signals.api_level,
            os_patch_level: key.security_signals.os_patch_level.clone(),
        })
    }
}

fn current_timestamp() -> u64 {
    use std::time::{SystemTime, UNIX_EPOCH};
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn android_quote_round_trip() {
        let mut manager = AndroidKeystoreManager::new();
        manager.provision_stub_key(
            "device-ak",
            vec![vec![1, 2, 3]],
            AndroidSecuritySignals {
                api_level: 34,
                verified_boot_state: "green".to_string(),
                device_locked: true,
                os_patch_level: "2026-01".to_string(),
                security_level: "StrongBox".to_string(),
                extra: HashMap::new(),
            },
        );

        let challenge = b"nonce-1234";
        let quote = manager.sign_nonce("device-ak", challenge).unwrap();

        assert!(manager.verify_quote(&quote, challenge));
        assert!(!manager.verify_quote(&quote, b"wrong"));

        let metadata = manager.backend_metadata("device-ak").unwrap();
        assert_eq!(metadata.backend, "android-keystore");
        assert!(metadata.hardware_backed);
    }
}
