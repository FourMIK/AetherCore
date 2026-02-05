//! Trusted Platform Module (TPM) integration.
//! Enforces "Hardware-Rooted Truth" via ECDSA signature verification.

use serde::{Deserialize, Serialize};
use tracing::{error, info, warn};
use p256::ecdsa::{signature::Verifier, Signature, VerifyingKey};
#[cfg(feature = "hardware-tpm")]
use sha2::{Digest as ShaDigestTrait, Sha256, Sha384, Sha512};

#[cfg(feature = "hardware-tpm")]
use tss_esapi::{
    constants::tss::TPM2_PERSISTENT_FIRST,
    handles::{ObjectHandle, PersistentTpmHandle, TpmHandle},
    interface_types::{
        algorithm::{EccSchemeAlgorithm, HashingAlgorithm},
        ecc::EccCurve,
        resource_handles::Hierarchy,
        session_handles::AuthSession,
        structure_tags::AttestationType,
    },
    structures::{
        Attest, AttestInfo, Data, EccScheme, MaxBuffer, ObjectAttributesBuilder,
        PcrSelectionListBuilder, PcrSlot, Public, PublicBuilder, PublicEccParametersBuilder,
        Signature as TpmSignature, SignatureScheme, SymmetricDefinitionObject,
    },
    traits::Marshall,
    Context, Error as TssError,
};

/// TPM configuration and state.
#[derive(Debug)]
pub struct TpmManager {
    hardware_available: bool,
    allow_stub: bool,
    stub_keys: std::collections::HashMap<String, Vec<u8>>,
    #[cfg(feature = "hardware-tpm")]
    hardware_keys: std::collections::HashMap<String, u32>,
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
        } else if !use_hardware {
            warn!("STATUS: TpmManager :: Hardware Root of Trust :: STUBBED");
        } else {
            error!("STATUS: TpmManager :: Hardware Root of Trust :: UNAVAILABLE");
        }
        Self {
            hardware_available,
            allow_stub: !use_hardware,
            stub_keys: std::collections::HashMap::new(),
            #[cfg(feature = "hardware-tpm")]
            hardware_keys: std::collections::HashMap::new(),
        }
    }

    #[cfg(feature = "hardware-tpm")]
    fn detect_hardware() -> bool {
        std::path::Path::new("/dev/tpm0").exists() || std::path::Path::new("/dev/tpmrm0").exists()
    }

    #[cfg(not(feature = "hardware-tpm"))]
    fn detect_hardware() -> bool { false }

    pub fn generate_attestation_key(&mut self, key_id: String) -> crate::Result<AttestationKey> {
        if self.hardware_available {
            self.generate_ak_hardware(key_id)
        } else if self.allow_stub {
            self.generate_ak_stub(key_id)
        } else {
            Err(crate::Error::Identity(
                "Hardware TPM unavailable; stub fallback is disabled".to_string(),
            ))
        }
    }

    pub fn generate_quote(&self, nonce: Vec<u8>, pcr_selection: &[u8]) -> crate::Result<TpmQuote> {
        if self.hardware_available {
            self.generate_quote_hardware(nonce, pcr_selection)
        } else if self.allow_stub {
            self.generate_quote_stub(nonce, pcr_selection)
        } else {
            Err(crate::Error::Identity(
                "Hardware TPM unavailable; stub fallback is disabled".to_string(),
            ))
        }
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

    /// Sign data with the TPM-resident attestation key.
    pub fn sign_with_attestation_key(&self, key_id: &str, data: &[u8]) -> crate::Result<Vec<u8>> {
        if self.hardware_available {
            self.sign_with_ak_hardware(key_id, data)
        } else if self.allow_stub {
            self.sign_with_ak_stub(key_id, data)
        } else {
            Err(crate::Error::Identity(
                "Hardware TPM unavailable; stub fallback is disabled".to_string(),
            ))
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

        self.verify_attestation_contents(quote)
    }

    // --- Hardware Placeholders (Requires tss-esapi setup in environment) ---
    #[cfg(feature = "hardware-tpm")]
    fn generate_ak_hardware(&mut self, key_id: String) -> crate::Result<AttestationKey> {
        let persistent_handle_value = persistent_handle_for_key(&key_id);
        let persistent = PersistentTpmHandle::new(persistent_handle_value).map_err(to_identity_error)?;
        let mut context = create_tpm_context()?;

        if let Ok(existing_handle) =
            context.tr_from_tpm_public(TpmHandle::Persistent(persistent))
        {
            let _ = context.execute_with_session(Some(AuthSession::Password), |ctx| {
                ctx.evict_control(
                    tss_esapi::interface_types::resource_handles::Provision::Owner,
                    existing_handle,
                    persistent,
                )
            });
        }

        let primary_public = build_storage_primary_public()?;
        let primary = context
            .execute_with_nullauth_session(|ctx| {
                ctx.create_primary(Hierarchy::Owner, primary_public, None, None, None, None)
            })
            .map_err(to_identity_error)?;

        let ak_public = build_attestation_public()?;
        let ak = context
            .execute_with_nullauth_session(|ctx| {
                ctx.create(primary.key_handle, ak_public, None, None, None, None)
            })
            .map_err(to_identity_error)?;
        let ak_handle = context
            .execute_with_nullauth_session(|ctx| ctx.load(primary.key_handle, ak.out_private, ak.out_public.clone()))
            .map_err(to_identity_error)?;

        context
            .execute_with_session(Some(AuthSession::Password), |ctx| {
                ctx.evict_control(
                    tss_esapi::interface_types::resource_handles::Provision::Owner,
                    ObjectHandle::from(ak_handle),
                    persistent,
                )
            })
            .map_err(to_identity_error)?;

        let public_key = ecc_public_to_sec1(&ak.out_public)?;
        self.hardware_keys
            .insert(key_id.clone(), persistent_handle_value);
        Ok(AttestationKey {
            key_id,
            public_key,
            certificate: None,
        })
    }
    #[cfg(not(feature = "hardware-tpm"))]
    fn generate_ak_hardware(&mut self, _key_id: String) -> crate::Result<AttestationKey> {
        Err(crate::Error::Identity("Hardware TPM disabled".to_string()))
    }
    #[cfg(feature = "hardware-tpm")]
    fn generate_quote_hardware(&self, nonce: Vec<u8>, pcr_selection: &[u8]) -> crate::Result<TpmQuote> {
        let key_handle_value = self
            .hardware_keys
            .values()
            .next()
            .ok_or_else(|| crate::Error::Identity("No hardware attestation keys available".into()))?;
        let persistent = PersistentTpmHandle::new(*key_handle_value).map_err(to_identity_error)?;
        let mut context = create_tpm_context()?;
        let key_handle = context
            .tr_from_tpm_public(TpmHandle::Persistent(persistent))
            .map_err(to_identity_error)?;

        let selection_list = build_pcr_selection_list(pcr_selection)?;
        let (attest, signature) = context
            .quote(
                key_handle.into(),
                Data::try_from(nonce.clone()).map_err(to_identity_error)?,
                SignatureScheme::EcDsa {
                    hash_scheme: tss_esapi::structures::HashScheme::new(HashingAlgorithm::Sha256),
                },
                selection_list.clone(),
            )
            .map_err(to_identity_error)?;

        let attestation_data = attest.marshall().map_err(to_identity_error)?;
        let signature = tpm_signature_to_der(&signature)?;
        let pcrs = read_pcr_values(&mut context, selection_list)?;
        let timestamp = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs();

        Ok(TpmQuote {
            pcrs,
            signature,
            nonce,
            timestamp,
            attestation_data,
        })
    }
    #[cfg(not(feature = "hardware-tpm"))]
    fn generate_quote_hardware(&self, _nonce: Vec<u8>, _pcr_selection: &[u8]) -> crate::Result<TpmQuote> {
        Err(crate::Error::Identity("Hardware TPM disabled".to_string()))
    }

    #[cfg(feature = "hardware-tpm")]
    fn sign_with_ak_hardware(&self, key_id: &str, data: &[u8]) -> crate::Result<Vec<u8>> {
        let key_handle_value = self
            .hardware_keys
            .get(key_id)
            .ok_or_else(|| crate::Error::Identity("Unknown hardware attestation key".into()))?;
        let persistent = PersistentTpmHandle::new(*key_handle_value).map_err(to_identity_error)?;
        let mut context = create_tpm_context()?;
        let key_handle = context
            .tr_from_tpm_public(TpmHandle::Persistent(persistent))
            .map_err(to_identity_error)?;

        let (digest, ticket) = context
            .hash(
                MaxBuffer::try_from(data).map_err(to_identity_error)?,
                HashingAlgorithm::Sha256,
                Hierarchy::Owner,
            )
            .map_err(to_identity_error)?;
        let signature = context
            .execute_with_session(Some(AuthSession::Password), |ctx| {
                ctx.sign(
                    key_handle.into(),
                    digest,
                    SignatureScheme::EcDsa {
                        hash_scheme: tss_esapi::structures::HashScheme::new(HashingAlgorithm::Sha256),
                    },
                    ticket,
                )
            })
            .map_err(to_identity_error)?;
        tpm_signature_to_der(&signature)
    }

    #[cfg(not(feature = "hardware-tpm"))]
    fn sign_with_ak_hardware(&self, _key_id: &str, _data: &[u8]) -> crate::Result<Vec<u8>> {
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

    fn sign_with_ak_stub(&self, key_id: &str, data: &[u8]) -> crate::Result<Vec<u8>> {
        let key_bytes = self
            .stub_keys
            .get(key_id)
            .ok_or(crate::Error::Identity("Unknown attestation key".into()))?;
        let secret_key =
            p256::SecretKey::from_slice(key_bytes).map_err(|_| crate::Error::Identity("Invalid stub key".into()))?;
        let signing_key = p256::ecdsa::SigningKey::from(secret_key);
        let signature: Signature = signature::Signer::sign(&signing_key, data);
        Ok(signature.to_der().as_bytes().to_vec())
    }
}

impl TpmManager {
    fn verify_attestation_contents(&self, quote: &TpmQuote) -> crate::Result<bool> {
        #[cfg(feature = "hardware-tpm")]
        {
            let attest = Attest::unmarshall(&quote.attestation_data)
                .map_err(to_identity_error)?;
            if attest.attestation_type() != AttestationType::Quote {
                error!("TrustGate :: FAIL :: Attestation type is not quote");
                return Ok(false);
            }

            if attest.extra_data().value() != quote.nonce.as_slice() {
                error!("TrustGate :: FAIL :: Nonce mismatch in attestation data");
                return Ok(false);
            }

            let quote_info = match attest.attested() {
                AttestInfo::Quote { info } => info,
                _ => {
                    error!("TrustGate :: FAIL :: Attestation data missing quote info");
                    return Ok(false);
                }
            };

            if !verify_pcr_selection_matches(quote_info.pcr_selection(), &quote.pcrs) {
                error!("TrustGate :: FAIL :: PCR selection mismatch");
                return Ok(false);
            }

            let expected_digest =
                compute_pcr_digest(quote_info.pcr_selection(), &quote.pcrs)?;
            if quote_info.pcr_digest().value() != expected_digest.as_slice() {
                error!("TrustGate :: FAIL :: PCR digest mismatch");
                return Ok(false);
            }

            return Ok(true);
        }

        #[cfg(not(feature = "hardware-tpm"))]
        {
            if !quote.attestation_data.windows(quote.nonce.len()).any(|w| w == quote.nonce) {
                error!("TrustGate :: FAIL :: Nonce not found in signed data");
                return Ok(false);
            }
            Ok(true)
        }
    }
}

#[cfg(feature = "hardware-tpm")]
fn create_tpm_context() -> crate::Result<Context> {
    let tcti = tss_esapi::tcti_ldr::TctiNameConf::from_environment_variable()
        .unwrap_or_else(|_| tss_esapi::tcti_ldr::TctiNameConf::Device(Default::default()));
    Context::new(tcti).map_err(to_identity_error)
}

#[cfg(feature = "hardware-tpm")]
fn build_storage_primary_public() -> crate::Result<Public> {
    let object_attributes = ObjectAttributesBuilder::new()
        .with_fixed_tpm(true)
        .with_fixed_parent(true)
        .with_sensitive_data_origin(true)
        .with_user_with_auth(true)
        .with_decrypt(true)
        .with_restricted(true)
        .build()
        .map_err(to_identity_error)?;

    PublicBuilder::new()
        .with_public_algorithm(tss_esapi::interface_types::algorithm::PublicAlgorithm::Ecc)
        .with_name_hashing_algorithm(HashingAlgorithm::Sha256)
        .with_object_attributes(object_attributes)
        .with_ecc_parameters(
            PublicEccParametersBuilder::new_restricted_decryption_key(
                SymmetricDefinitionObject::AES_128_CFB,
                EccCurve::NistP256,
            )
            .build()
            .map_err(to_identity_error)?,
        )
        .with_ecc_unique_identifier(Default::default())
        .build()
        .map_err(to_identity_error)
}

#[cfg(feature = "hardware-tpm")]
fn build_attestation_public() -> crate::Result<Public> {
    let object_attributes = ObjectAttributesBuilder::new()
        .with_fixed_tpm(true)
        .with_fixed_parent(true)
        .with_sensitive_data_origin(true)
        .with_user_with_auth(true)
        .with_sign_encrypt(true)
        .with_restricted(true)
        .build()
        .map_err(to_identity_error)?;

    PublicBuilder::new()
        .with_public_algorithm(tss_esapi::interface_types::algorithm::PublicAlgorithm::Ecc)
        .with_name_hashing_algorithm(HashingAlgorithm::Sha256)
        .with_object_attributes(object_attributes)
        .with_ecc_parameters(
            PublicEccParametersBuilder::new()
                .with_symmetric(SymmetricDefinitionObject::Null)
                .with_ecc_scheme(
                    EccScheme::create(EccSchemeAlgorithm::EcDsa, Some(HashingAlgorithm::Sha256))
                        .map_err(to_identity_error)?,
                )
                .with_curve(EccCurve::NistP256)
                .with_key_derivation_function_scheme(
                    tss_esapi::structures::KeyDerivationFunctionScheme::Null,
                )
                .with_is_signing_key(true)
                .with_is_decryption_key(false)
                .with_restricted(true)
                .build()
                .map_err(to_identity_error)?,
        )
        .with_ecc_unique_identifier(Default::default())
        .build()
        .map_err(to_identity_error)
}

#[cfg(feature = "hardware-tpm")]
fn build_pcr_selection_list(pcr_selection: &[u8]) -> crate::Result<tss_esapi::structures::PcrSelectionList> {
    let slots: Vec<PcrSlot> = pcr_selection
        .iter()
        .filter(|&&index| index < 24)
        .map(|&index| PcrSlot::try_from(1u32 << index).map_err(to_identity_error))
        .collect::<crate::Result<Vec<_>>>()?;

    PcrSelectionListBuilder::new()
        .with_selection(HashingAlgorithm::Sha256, &slots)
        .build()
        .map_err(to_identity_error)
}

#[cfg(feature = "hardware-tpm")]
fn read_pcr_values(
    context: &mut Context,
    selection_list: tss_esapi::structures::PcrSelectionList,
) -> crate::Result<Vec<PcrValue>> {
    let (_update_counter, read_selection, digest_list) =
        context.pcr_read(selection_list.clone()).map_err(to_identity_error)?;
    let selections = read_selection.get_selections();
    if selections.len() != 1 {
        return Err(crate::Error::Identity(
            "Unsupported PCR selection banks".to_string(),
        ));
    }
    let selected_slots = selections[0].selected();
    let digests = digest_list.value();
    if selected_slots.len() != digests.len() {
        return Err(crate::Error::Identity(
            "PCR digest list length mismatch".to_string(),
        ));
    }
    Ok(selected_slots
        .iter()
        .zip(digests.iter())
        .map(|(slot, digest)| PcrValue {
            index: u32::from(*slot).trailing_zeros() as u8,
            value: digest.value().to_vec(),
        })
        .collect())
}

#[cfg(feature = "hardware-tpm")]
fn tpm_signature_to_der(signature: &TpmSignature) -> crate::Result<Vec<u8>> {
    match signature {
        TpmSignature::EcDsa(ecc_sig) => {
            let r = pad_left(ecc_sig.signature_r().value(), 32);
            let s = pad_left(ecc_sig.signature_s().value(), 32);
            let sig = Signature::from_scalars(r, s)
                .map_err(|_| crate::Error::Identity("Invalid TPM ECDSA signature".into()))?;
            Ok(sig.to_der().as_bytes().to_vec())
        }
        _ => Err(crate::Error::Identity(
            "Unsupported TPM signature algorithm".to_string(),
        )),
    }
}

#[cfg(feature = "hardware-tpm")]
fn ecc_public_to_sec1(public: &Public) -> crate::Result<Vec<u8>> {
    match public {
        Public::Ecc { unique, .. } => {
            let x = pad_left(unique.x().value(), 32);
            let y = pad_left(unique.y().value(), 32);
            let encoded =
                p256::EncodedPoint::from_affine_coordinates(&x.into(), &y.into(), false);
            Ok(encoded.as_bytes().to_vec())
        }
        _ => Err(crate::Error::Identity(
            "Unsupported TPM public key type".to_string(),
        )),
    }
}

#[cfg(feature = "hardware-tpm")]
fn verify_pcr_selection_matches(
    selection_list: &tss_esapi::structures::PcrSelectionList,
    pcrs: &[PcrValue],
) -> bool {
    let selections = selection_list.get_selections();
    if selections.len() != 1 {
        return false;
    }
    let selected_slots = selections[0].selected();
    let selected_indices: std::collections::HashSet<u8> = selected_slots
        .iter()
        .map(|slot| u32::from(*slot).trailing_zeros() as u8)
        .collect();
    let provided_indices: std::collections::HashSet<u8> =
        pcrs.iter().map(|pcr| pcr.index).collect();
    selected_indices == provided_indices
}

#[cfg(feature = "hardware-tpm")]
fn compute_pcr_digest(
    selection_list: &tss_esapi::structures::PcrSelectionList,
    pcrs: &[PcrValue],
) -> crate::Result<Vec<u8>> {
    let selections = selection_list.get_selections();
    if selections.len() != 1 {
        return Err(crate::Error::Identity(
            "Unsupported PCR selection banks".to_string(),
        ));
    }
    let selection = selections[0];
    let hashing_algorithm = selection.hashing_algorithm();
    let pcr_map: std::collections::HashMap<u8, &PcrValue> =
        pcrs.iter().map(|pcr| (pcr.index, pcr)).collect();
    let mut ordered_values = Vec::new();
    for slot in selection.selected() {
        let index = u32::from(slot).trailing_zeros() as u8;
        let pcr_value = pcr_map.get(&index).ok_or_else(|| {
            crate::Error::Identity(format!("Missing PCR value for index {}", index))
        })?;
        ordered_values.extend_from_slice(&pcr_value.value);
    }

    let digest = match hashing_algorithm {
        HashingAlgorithm::Sha256 => Sha256::digest(&ordered_values).to_vec(),
        HashingAlgorithm::Sha384 => Sha384::digest(&ordered_values).to_vec(),
        HashingAlgorithm::Sha512 => Sha512::digest(&ordered_values).to_vec(),
        _ => {
            return Err(crate::Error::Identity(
                "Unsupported PCR hashing algorithm".to_string(),
            ))
        }
    };
    Ok(digest)
}

#[cfg(feature = "hardware-tpm")]
fn persistent_handle_for_key(key_id: &str) -> u32 {
    let hash = blake3::hash(key_id.as_bytes());
    let mut bytes = [0u8; 4];
    bytes.copy_from_slice(&hash.as_bytes()[..4]);
    TPM2_PERSISTENT_FIRST | (u32::from_be_bytes(bytes) & 0x0000_FFFF)
}

#[cfg(feature = "hardware-tpm")]
fn to_identity_error(error: TssError) -> crate::Error {
    crate::Error::Identity(format!("TPM error: {}", error))
}

#[cfg(feature = "hardware-tpm")]
fn pad_left(value: &[u8], size: usize) -> Vec<u8> {
    if value.len() >= size {
        return value.to_vec();
    }
    let mut padded = vec![0u8; size - value.len()];
    padded.extend_from_slice(value);
    padded
}
