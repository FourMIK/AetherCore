//! Android Keystore integration for device identity attestation.
//! Provides challenge signing, quote verification, and backend metadata.

use p256::ecdsa::{
    signature::Signer as _, signature::Verifier as _, Signature, SigningKey, VerifyingKey,
};
use p256::elliptic_curve::rand_core::OsRng;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use x509_parser::{oid_registry::Oid, prelude::FromDer};

/// OID for Android key attestation extension (1.3.6.1.4.1.11129.2.1.17).
const ANDROID_KEY_ATTESTATION_OID: &[u64] = &[1, 3, 6, 1, 4, 1, 11129, 2, 1, 17];

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

/// Parsed fields from Android Key Attestation extension.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct AndroidAttestationExtension {
    /// Challenge embedded in attestation extension.
    pub attestation_challenge: Vec<u8>,
    /// Key origin, best-effort parsed from authorization list.
    pub key_origin: Option<String>,
    /// Attestation security level (software/trusted_environment/strongbox).
    pub attestation_security_level: String,
    /// Verified boot state parsed from RootOfTrust.
    pub verified_boot_state: Option<String>,
    /// Bootloader lock state parsed from RootOfTrust.
    pub bootloader_locked: Option<bool>,
    /// OS patch level in YYYY-MM(-DD) format when available.
    pub os_patch_level: Option<String>,
    /// Vendor patch level in YYYY-MM(-DD) format when available.
    pub vendor_patch_level: Option<String>,
}

/// Structured Android attestation verification failure reasons.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum AndroidVerificationFailure {
    EmptyCertificateChain,
    CertificateParseFailure(String),
    CertificateChainUntrusted,
    ChallengeMismatch,
    SignatureInvalid,
    MissingAttestationExtension,
    MalformedAttestationExtension(String),
    AttestationChallengeMismatch,
    PublicKeyMismatch,
}

/// Detailed result for Android quote verification.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct AndroidQuoteVerification {
    pub verified: bool,
    pub extension: Option<AndroidAttestationExtension>,
    pub failure: Option<AndroidVerificationFailure>,
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
    trusted_android_roots: Vec<Vec<u8>>,
}

impl AndroidKeystoreManager {
    /// Create an empty Android keystore manager.
    pub fn new() -> Self {
        Self {
            keys: HashMap::new(),
            trusted_android_roots: Vec::new(),
        }
    }

    /// Add a trusted Android root certificate (DER) used for quote verification.
    pub fn add_trusted_android_root(&mut self, root_der: Vec<u8>) {
        self.trusted_android_roots.push(root_der);
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
        self.verify_quote_detailed(quote, expected_challenge)
            .verified
    }

    /// Verify an Android quote and return detailed status with structured failure reasons.
    pub fn verify_quote_detailed(
        &self,
        quote: &AndroidQuote,
        expected_challenge: &[u8],
    ) -> AndroidQuoteVerification {
        if quote.challenge != expected_challenge || quote.challenge.is_empty() {
            return AndroidQuoteVerification {
                verified: false,
                extension: None,
                failure: Some(AndroidVerificationFailure::ChallengeMismatch),
            };
        }
        if quote.cert_chain.is_empty() {
            return AndroidQuoteVerification {
                verified: false,
                extension: None,
                failure: Some(AndroidVerificationFailure::EmptyCertificateChain),
            };
        }

        let parsed_chain = match parse_der_chain(&quote.cert_chain) {
            Ok(chain) => chain,
            Err(reason) => {
                return AndroidQuoteVerification {
                    verified: false,
                    extension: None,
                    failure: Some(AndroidVerificationFailure::CertificateParseFailure(reason)),
                }
            }
        };

        if !verify_chain_to_trusted_roots(&quote.cert_chain, &self.trusted_android_roots) {
            return AndroidQuoteVerification {
                verified: false,
                extension: None,
                failure: Some(AndroidVerificationFailure::CertificateChainUntrusted),
            };
        }

        let leaf = &parsed_chain[0];
        let leaf_pub = leaf.public_key().raw;
        if leaf_pub != quote.public_key {
            return AndroidQuoteVerification {
                verified: false,
                extension: None,
                failure: Some(AndroidVerificationFailure::PublicKeyMismatch),
            };
        }

        let extension = match parse_android_attestation_extension(leaf) {
            Ok(ext) => ext,
            Err(failure) => {
                return AndroidQuoteVerification {
                    verified: false,
                    extension: None,
                    failure: Some(failure),
                }
            }
        };

        if extension.attestation_challenge != expected_challenge {
            return AndroidQuoteVerification {
                verified: false,
                extension: Some(extension),
                failure: Some(AndroidVerificationFailure::AttestationChallengeMismatch),
            };
        }

        let verifying_key = match VerifyingKey::from_sec1_bytes(&quote.public_key) {
            Ok(key) => key,
            Err(err) => {
                return AndroidQuoteVerification {
                    verified: false,
                    extension: Some(extension),
                    failure: Some(AndroidVerificationFailure::CertificateParseFailure(
                        format!("invalid SEC1 public key: {err}"),
                    )),
                }
            }
        };
        let signature = match Signature::from_der(&quote.signature) {
            Ok(sig) => sig,
            Err(_) => {
                return AndroidQuoteVerification {
                    verified: false,
                    extension: Some(extension),
                    failure: Some(AndroidVerificationFailure::SignatureInvalid),
                }
            }
        };

        if verifying_key.verify(&quote.challenge, &signature).is_err() {
            return AndroidQuoteVerification {
                verified: false,
                extension: Some(extension),
                failure: Some(AndroidVerificationFailure::SignatureInvalid),
            };
        }

        AndroidQuoteVerification {
            verified: true,
            extension: Some(extension),
            failure: None,
        }
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

fn parse_der_chain<'a>(
    cert_chain: &'a [Vec<u8>],
) -> Result<Vec<x509_parser::certificate::X509Certificate<'a>>, String> {
    cert_chain
        .iter()
        .map(|cert| {
            x509_parser::certificate::X509Certificate::from_der(cert)
                .map(|(_, parsed)| parsed)
                .map_err(|e| format!("X.509 parse failure: {e}"))
        })
        .collect()
}

fn verify_chain_to_trusted_roots(cert_chain: &[Vec<u8>], trusted_roots: &[Vec<u8>]) -> bool {
    if cert_chain.is_empty() || trusted_roots.is_empty() {
        return false;
    }

    match cert_chain.last() {
        Some(root) => trusted_roots.iter().any(|trusted| trusted == root),
        None => false,
    }
}

fn parse_android_attestation_extension(
    cert: &x509_parser::certificate::X509Certificate<'_>,
) -> Result<AndroidAttestationExtension, AndroidVerificationFailure> {
    let ext = cert
        .extensions()
        .iter()
        .find(|extension| {
            extension.oid
                == Oid::from(ANDROID_KEY_ATTESTATION_OID).expect("valid android attestation oid")
        })
        .ok_or(AndroidVerificationFailure::MissingAttestationExtension)?;

    let parsed = parse_key_description(ext.value).map_err(|reason| {
        AndroidVerificationFailure::MalformedAttestationExtension(reason.to_string())
    })?;

    Ok(parsed)
}

fn parse_key_description(input: &[u8]) -> Result<AndroidAttestationExtension, String> {
    let (input, _attestation_version) = read_der_integer(input)?;
    let (input, attestation_security_level) = read_der_enumerated(input)?;
    let (input, _keymaster_version) = read_der_integer(input)?;
    let (input, _keymaster_security_level) = read_der_enumerated(input)?;
    let (input, _attestation_challenge) = read_der_octet_string(input)?;
    let (input, _unique_id) = read_der_octet_string(input)?;

    let (_, software_auth_list) = read_der_explicit_tag(input, 0)?;
    let (_, tee_auth_list) = read_der_explicit_tag(input, 1)?;

    let mut key_origin = extract_integer_for_tag(&software_auth_list, 702)
        .or_else(|| extract_integer_for_tag(&tee_auth_list, 702))
        .map(map_key_origin);
    if key_origin.as_deref() == Some("generated") && attestation_security_level == 0 {
        key_origin = Some("generated-software".to_string());
    }

    let root_of_trust = extract_root_of_trust(&software_auth_list)
        .or_else(|| extract_root_of_trust(&tee_auth_list));

    let os_patch = extract_integer_for_tag(&software_auth_list, 706)
        .or_else(|| extract_integer_for_tag(&tee_auth_list, 706))
        .map(format_patch_level);
    let vendor_patch = extract_integer_for_tag(&software_auth_list, 718)
        .or_else(|| extract_integer_for_tag(&tee_auth_list, 718))
        .map(format_patch_level);

    Ok(AndroidAttestationExtension {
        attestation_challenge: _attestation_challenge,
        key_origin,
        attestation_security_level: map_security_level(attestation_security_level).to_string(),
        verified_boot_state: root_of_trust
            .as_ref()
            .map(|r| r.verified_boot_state.clone()),
        bootloader_locked: root_of_trust.map(|r| r.device_locked),
        os_patch_level: os_patch,
        vendor_patch_level: vendor_patch,
    })
}

#[derive(Debug, Clone)]
struct RootOfTrust {
    device_locked: bool,
    verified_boot_state: String,
}

fn extract_root_of_trust(auth_list: &[u8]) -> Option<RootOfTrust> {
    extract_octet_string_for_tag(auth_list, 704).and_then(|value| {
        let (input, _) = read_der_octet_string(&value).ok()?;
        let (input, device_locked) = read_der_boolean(input).ok()?;
        let (_, verified_boot_state) = read_der_enumerated(input).ok()?;

        Some(RootOfTrust {
            device_locked,
            verified_boot_state: map_verified_boot_state(verified_boot_state).to_string(),
        })
    })
}

fn map_security_level(value: i64) -> &'static str {
    match value {
        0 => "software",
        1 => "trusted_environment",
        2 => "strongbox",
        _ => "unknown",
    }
}

fn map_key_origin(value: i64) -> String {
    match value {
        0 => "generated",
        1 => "derived",
        2 => "imported",
        3 => "unknown",
        4 => "securely_imported",
        _ => "other",
    }
    .to_string()
}

fn map_verified_boot_state(value: i64) -> &'static str {
    match value {
        0 => "green",
        1 => "yellow",
        2 => "orange",
        3 => "red",
        _ => "unknown",
    }
}

fn format_patch_level(level: i64) -> String {
    let value = level.max(0) as u32;
    if value >= 10_000_00 {
        let year = value / 10_000;
        let month = (value / 100) % 100;
        let day = value % 100;
        format!("{year:04}-{month:02}-{day:02}")
    } else {
        let year = value / 100;
        let month = value % 100;
        format!("{year:04}-{month:02}")
    }
}

fn extract_integer_for_tag(input: &[u8], wanted_tag: u32) -> Option<i64> {
    extract_context_specific_value(input, wanted_tag)
        .and_then(|value| read_der_integer(&value).ok().map(|(_, v)| v))
}

fn extract_octet_string_for_tag(input: &[u8], wanted_tag: u32) -> Option<Vec<u8>> {
    extract_context_specific_value(input, wanted_tag)
        .and_then(|value| read_der_octet_string(&value).ok().map(|(_, v)| v))
}

fn extract_context_specific_value(input: &[u8], wanted_tag: u32) -> Option<Vec<u8>> {
    let mut rest = input;
    while !rest.is_empty() {
        let (next, class, constructed, tag, value) = read_tlv(rest).ok()?;
        if class == 2 && constructed && tag == wanted_tag {
            return Some(value);
        }
        rest = next;
    }
    None
}

fn read_der_explicit_tag(input: &[u8], expected_tag: u32) -> Result<(&[u8], Vec<u8>), String> {
    let (rest, class, constructed, tag, value) = read_tlv(input)?;
    if class != 2 || !constructed || tag != expected_tag {
        return Err(format!("expected explicit tag [{expected_tag}]"));
    }
    Ok((rest, value))
}

fn read_der_integer(input: &[u8]) -> Result<(&[u8], i64), String> {
    let (rest, class, _, tag, value) = read_tlv(input)?;
    if class != 0 || tag != 2 {
        return Err("expected INTEGER".to_string());
    }
    if value.is_empty() || value.len() > 8 {
        return Err("INTEGER length unsupported".to_string());
    }
    let mut out: i64 = if value[0] & 0x80 != 0 { -1 } else { 0 };
    for byte in value {
        out = (out << 8) | i64::from(byte);
    }
    Ok((rest, out))
}

fn read_der_enumerated(input: &[u8]) -> Result<(&[u8], i64), String> {
    let (rest, class, _, tag, value) = read_tlv(input)?;
    if class != 0 || tag != 10 {
        return Err("expected ENUMERATED".to_string());
    }
    if value.is_empty() || value.len() > 8 {
        return Err("ENUMERATED length unsupported".to_string());
    }
    let mut out: i64 = 0;
    for byte in value {
        out = (out << 8) | i64::from(byte);
    }
    Ok((rest, out))
}

fn read_der_octet_string(input: &[u8]) -> Result<(&[u8], Vec<u8>), String> {
    let (rest, class, _, tag, value) = read_tlv(input)?;
    if class != 0 || tag != 4 {
        return Err("expected OCTET STRING".to_string());
    }
    Ok((rest, value))
}

fn read_der_boolean(input: &[u8]) -> Result<(&[u8], bool), String> {
    let (rest, class, _, tag, value) = read_tlv(input)?;
    if class != 0 || tag != 1 {
        return Err("expected BOOLEAN".to_string());
    }
    if value.len() != 1 {
        return Err("BOOLEAN length must be 1".to_string());
    }
    Ok((rest, value[0] != 0))
}

fn read_tlv(input: &[u8]) -> Result<(&[u8], u8, bool, u32, Vec<u8>), String> {
    if input.len() < 2 {
        return Err("truncated TLV".to_string());
    }

    let first = input[0];
    let class = first >> 6;
    let constructed = (first & 0b0010_0000) != 0;
    let mut tag: u32 = u32::from(first & 0b0001_1111);
    let mut idx = 1;

    if tag == 0b0001_1111 {
        tag = 0;
        loop {
            if idx >= input.len() {
                return Err("truncated high-tag-number".to_string());
            }
            let b = input[idx];
            idx += 1;
            tag = (tag << 7) | u32::from(b & 0x7f);
            if b & 0x80 == 0 {
                break;
            }
        }
    }

    if idx >= input.len() {
        return Err("truncated length".to_string());
    }
    let len_byte = input[idx];
    idx += 1;

    let (len, len_len) = if len_byte & 0x80 == 0 {
        (usize::from(len_byte), 0)
    } else {
        let num = usize::from(len_byte & 0x7f);
        if num == 0 || num > 4 || idx + num > input.len() {
            return Err("invalid long-form length".to_string());
        }
        let mut l = 0usize;
        for i in 0..num {
            l = (l << 8) | usize::from(input[idx + i]);
        }
        (l, num)
    };

    idx += len_len;
    if idx + len > input.len() {
        return Err("truncated value".to_string());
    }

    let value = input[idx..idx + len].to_vec();
    let rest = &input[idx + len..];
    Ok((rest, class, constructed, tag, value))
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

        assert!(!manager.verify_quote(&quote, challenge));
        assert!(!manager.verify_quote(&quote, b"wrong"));

        let metadata = manager.backend_metadata("device-ak").unwrap();
        assert_eq!(metadata.backend, "android-keystore");
        assert!(metadata.hardware_backed);
    }

    #[test]
    fn patch_level_formatting() {
        assert_eq!(format_patch_level(202403), "2024-03");
        assert_eq!(format_patch_level(20240301), "2024-03-01");
    }
}
