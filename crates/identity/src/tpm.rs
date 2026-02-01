//! Trusted Platform Module (TPM) integration.
//! Enforces "Hardware-Rooted Truth" via ECDSA signature verification.

use serde::{Deserialize, Serialize};
use tracing::{error, info, warn};
use p256::ecdsa::{signature::Verifier, Signature, VerifyingKey};

/// TPM configuration and state.
#[derive(Debug)]
pub struct TpmManager {
    hardware_available: bool,
    stub_keys: std::collections::HashMap<String, Vec<u8>>,
}

/// TPM Quote for platform attestation.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct TpmQuote {
    pub pcrs: Vec<PcrValue>,
    pub signature: Vec<u8>,
    pub nonce: Vec<u8>,
    pub timestamp: u64,
    /// Raw Attestation Data (TPMS_ATTEST) serialized.
    pub attestation_data: Vec<u8>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct PcrValue {
    pub index: u8,
    pub value: Vec<u8>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AttestationKey {
    pub key_id: String,
    pub public_key: Vec<u8>,
    pub certificate: Option<Vec<u8>>,
}

impl TpmManager {
    pub fn new(use_hardware: bool) -> Self {
        let hardware_available = use_hardware && Self::detect_hardware();
        if hardware_available {
            info!("STATUS: TpmManager :: Hardware Root of Trust :: ACTIVE");
        } else {
            warn!("STATUS: TpmManager :: Hardware Root of Trust :: STUBBED");
        }
        Self {
            hardware_available,
            stub_keys: std::collections::HashMap::new(),
        }
    }

    #[cfg(feature = "hardware-tpm")]
    fn detect_hardware() -> bool {
        std::path::Path::new("/dev/tpm0").exists() || std::path::Path::new("/dev/tpmrm0").exists()
    }

    #[cfg(not(feature = "hardware-tpm"))]
    fn detect_hardware() -> bool { false }

    pub fn generate_attestation_key(&mut self, key_id: String) -> crate::Result<AttestationKey> {
        if self.hardware_available { self.generate_ak_hardware(key_id) } else { self.generate_ak_stub(key_id) }
    }

    pub fn generate_quote(&self, nonce: Vec<u8>, pcr_selection: &[u8]) -> crate::Result<TpmQuote> {
        if self.hardware_available { self.generate_quote_hardware(nonce, pcr_selection) } else { self.generate_quote_stub(nonce, pcr_selection) }
    }

    pub fn verify_quote(&self, quote: &TpmQuote, ak: &AttestationKey) -> bool {
        // Verification logic is identical for stub (if simulated correctly) and hardware
        match self.perform_verification(quote, ak) {
            Ok(valid) => {
                if valid {
                    info!("TrustGate :: Quote Verified :: {:x?}", quote.nonce);
                    true
                } else {
                    error!("TrustGate :: Quote REJECTED :: Invalid Signature or Data");
                    false
                }
            }
            Err(e) => {
                error!("TrustGate :: Verification ERROR :: {}", e);
                false
            }
        }
    }

    /// Core Cryptographic Verification Logic
    fn perform_verification(&self, quote: &TpmQuote, ak: &AttestationKey) -> crate::Result<bool> {
        // 1. Reconstruct Public Key
        let verifying_key = VerifyingKey::from_sec1_bytes(&ak.public_key)
            .map_err(|_| crate::Error::Identity("Invalid Public Key Format".into()))?;

        // 2. Parse Signature
        let signature = Signature::from_der(&quote.signature)
            .map_err(|_| crate::Error::Identity("Invalid DER Signature".into()))?;

        // 3. Verify Signature against Raw Data
        if let Err(_) = verifying_key.verify(&quote.attestation_data, &signature) {
             error!("TrustGate :: FAIL :: Signature Mismatch");
             return Ok(false);
        }

        // 4. Verify Nonce (Anti-Replay)
        // Simplification: Check if nonce exists in the signed blob
        if !quote.attestation_data.windows(quote.nonce.len()).any(|w| w == quote.nonce) {
             error!("TrustGate :: FAIL :: Nonce not found in signed data");
             return Ok(false);
        }
        
        Ok(true)
    }

    // --- Hardware Placeholders (Requires tss-esapi setup in environment) ---
    #[cfg(feature = "hardware-tpm")]
    fn generate_ak_hardware(&mut self, _key_id: String) -> crate::Result<AttestationKey> {
        Err(crate::Error::Identity("Hardware KeyGen Pending Environment Setup".to_string()))
    }
    #[cfg(not(feature = "hardware-tpm"))]
    fn generate_ak_hardware(&mut self, _key_id: String) -> crate::Result<AttestationKey> {
        Err(crate::Error::Identity("Hardware TPM disabled".to_string()))
    }
    #[cfg(feature = "hardware-tpm")]
    fn generate_quote_hardware(&self, _nonce: Vec<u8>, _pcr_selection: &[u8]) -> crate::Result<TpmQuote> {
         Err(crate::Error::Identity("Hardware Quote Pending Environment Setup".to_string()))
    }
    #[cfg(not(feature = "hardware-tpm"))]
    fn generate_quote_hardware(&self, _nonce: Vec<u8>, _pcr_selection: &[u8]) -> crate::Result<TpmQuote> {
        Err(crate::Error::Identity("Hardware TPM disabled".to_string()))
    }

    // --- Stub Implementation ---
    fn generate_ak_stub(&mut self, key_id: String) -> crate::Result<AttestationKey> {
        let secret_key = p256::SecretKey::random(&mut rand::thread_rng());
        let public_key = secret_key.public_key().to_sec1_bytes().to_vec();
        self.stub_keys.insert(key_id.clone(), secret_key.to_bytes().to_vec());
        Ok(AttestationKey { key_id, public_key, certificate: None })
    }

    fn generate_quote_stub(&self, nonce: Vec<u8>, pcr_selection: &[u8]) -> crate::Result<TpmQuote> {
        let mut attestation_data = b"TPM_DATA_STUB_".to_vec();
        attestation_data.extend_from_slice(&nonce);
        
        let key_bytes = self.stub_keys.values().next().ok_or(crate::Error::Identity("No stub keys".into()))?;
        let secret_key = p256::SecretKey::from_slice(key_bytes).map_err(|_| crate::Error::Identity("Invalid stub key".into()))?;
        let signing_key = p256::ecdsa::SigningKey::from(secret_key);
        let signature: Signature = signature::Signer::sign(&signing_key, &attestation_data);

        let mut pcrs = Vec::new();
        for &index in pcr_selection {
            if index < 24 {
                pcrs.push(PcrValue { index, value: vec![0xFF; 32] });
            }
        }

        let timestamp = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs();

        Ok(TpmQuote {
            pcrs,
            signature: signature.to_der().as_bytes().to_vec(),
            nonce,
            timestamp,
            attestation_data,
        })
    }
}
