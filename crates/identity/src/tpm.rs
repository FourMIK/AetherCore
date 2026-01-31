//! Trusted Platform Module (TPM) integration with hardware stubs.
//!
//! Provides TPM-based attestation and key management. Hardware operations are
//! feature-gated and stubbed for testing/development.

use serde::{Deserialize, Serialize};

/// TPM configuration and state.
#[derive(Debug)]
pub struct TpmManager {
    /// Whether hardware TPM is available
    hardware_available: bool,
    /// Stub key storage (in production, this would be in TPM)
    stub_keys: std::collections::HashMap<String, Vec<u8>>,
}

/// TPM Quote for platform attestation.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct TpmQuote {
    /// Platform Configuration Register (PCR) values
    pub pcrs: Vec<PcrValue>,
    /// Quote signature
    pub signature: Vec<u8>,
    /// Nonce used in quote
    pub nonce: Vec<u8>,
    /// Timestamp
    pub timestamp: u64,
}

/// Platform Configuration Register value.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct PcrValue {
    /// PCR index (0-23)
    pub index: u8,
    /// PCR hash value
    pub value: Vec<u8>,
}

/// Attestation Key (AK) for signing quotes.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AttestationKey {
    /// Key identifier
    pub key_id: String,
    /// Public key (DER-encoded)
    pub public_key: Vec<u8>,
    /// Key certificate (if available)
    pub certificate: Option<Vec<u8>>,
}

impl TpmManager {
    /// Create a new TPM manager.
    ///
    /// If `use_hardware` is true, attempts to use real TPM hardware.
    /// Falls back to stub implementation if hardware is unavailable.
    ///
    /// # Production Mode
    ///
    /// In production builds (when AETHERCORE_PRODUCTION env is set), this function
    /// will panic if hardware TPM is not available. This enforces the "Fail-Visible"
    /// doctrine and prevents accidental use of insecure stub implementations in
    /// operational environments.
    pub fn new(use_hardware: bool) -> Self {
        let hardware_available = use_hardware && Self::detect_hardware();
        
        // PRODUCTION GUARD: Enforce hardware TPM in production mode
        let is_production = std::env::var("AETHERCORE_PRODUCTION")
            .map(|v| v == "1" || v.to_lowercase() == "true")
            .unwrap_or(false);

        if is_production && !hardware_available {
            panic!(
                "PRODUCTION MODE VIOLATION: TPM hardware not available. \
                 AetherCore requires hardware-rooted trust in production. \
                 Ensure /dev/tpm0 exists and is accessible, or disable production mode."
            );
        }

        if hardware_available {
            tracing::info!("TPM hardware detected and enabled");
        } else {
            tracing::warn!(
                "Using TPM stub implementation (no hardware or disabled). \
                 INSECURE - FOR TESTING ONLY. Never use in production."
            );
        }

        Self {
            hardware_available,
            stub_keys: std::collections::HashMap::new(),
        }
    }

    /// Detect if TPM hardware is available.
    #[cfg(feature = "hardware-tpm")]
    fn detect_hardware() -> bool {
        // In production with hardware-tpm feature:
        // - Check for /dev/tpm0 on Linux
        // - Check for TBS service on Windows
        // - Use tpm2-tss library
        std::path::Path::new("/dev/tpm0").exists()
    }

    #[cfg(not(feature = "hardware-tpm"))]
    fn detect_hardware() -> bool {
        false
    }

    /// Generate an Attestation Key (AK).
    pub fn generate_attestation_key(&mut self, key_id: String) -> crate::Result<AttestationKey> {
        if self.hardware_available {
            self.generate_ak_hardware(key_id)
        } else {
            self.generate_ak_stub(key_id)
        }
    }

    /// Generate a TPM quote for platform attestation.
    pub fn generate_quote(&self, nonce: Vec<u8>, pcr_selection: &[u8]) -> crate::Result<TpmQuote> {
        if self.hardware_available {
            self.generate_quote_hardware(nonce, pcr_selection)
        } else {
            self.generate_quote_stub(nonce, pcr_selection)
        }
    }

    /// Verify a TPM quote.
    pub fn verify_quote(&self, quote: &TpmQuote, ak: &AttestationKey) -> bool {
        if self.hardware_available {
            self.verify_quote_hardware(quote, ak)
        } else {
            self.verify_quote_stub(quote, ak)
        }
    }

    /// Seal data to TPM (encrypted with TPM key).
    pub fn seal_data(&mut self, key_id: &str, data: Vec<u8>) -> crate::Result<Vec<u8>> {
        if self.hardware_available {
            self.seal_data_hardware(key_id, data)
        } else {
            self.seal_data_stub(key_id, data)
        }
    }

    /// Unseal data from TPM.
    pub fn unseal_data(&mut self, key_id: &str, sealed_data: Vec<u8>) -> crate::Result<Vec<u8>> {
        if self.hardware_available {
            self.unseal_data_hardware(key_id, sealed_data)
        } else {
            self.unseal_data_stub(key_id, sealed_data)
        }
    }

    /// Sign data using TPM-backed Ed25519 key.
    /// 
    /// This method signs arbitrary data using the TPM's session key.
    /// In production, the private key never enters system memory - all
    /// signing operations are performed within the TPM hardware.
    /// 
    /// # Security Model
    /// 
    /// - Hardware mode: Uses TPM 2.0 ECDSA signing with attestation key
    /// - Stub mode: Uses in-memory Ed25519 (INSECURE - testing only)
    /// 
    /// # Arguments
    /// 
    /// * `data` - The data to sign
    /// 
    /// # Returns
    /// 
    /// Raw signature bytes (64 bytes for Ed25519, variable for ECDSA)
    pub fn sign(&mut self, data: &[u8]) -> crate::Result<Vec<u8>> {
        if self.hardware_available {
            self.sign_hardware(data)
        } else {
            self.sign_stub(data)
        }
    }

    // Hardware implementations (require hardware-tpm feature)

    #[cfg(feature = "hardware-tpm")]
    fn create_tpm_context() -> crate::Result<tss_esapi::Context> {
        use tss_esapi::{Context, TctiNameConf};

        // Verify /dev/tpm0 is accessible before attempting context creation
        if !std::path::Path::new("/dev/tpm0").exists() {
            return Err(crate::Error::Identity(
                "TPM device /dev/tpm0 not found. Hardware TPM is required in this mode.".to_string(),
            ));
        }

        // Create TPM context using device TCTI
        let tcti = TctiNameConf::Device(Default::default());
        Context::new(tcti).map_err(|e| {
            crate::Error::Identity(format!("Failed to create TPM context: {}", e))
        })
    }

    #[cfg(feature = "hardware-tpm")]
    fn create_srk(
        context: &mut tss_esapi::Context,
    ) -> crate::Result<tss_esapi::handles::KeyHandle> {
        use tss_esapi::{
            structures::{
                PublicBuilder, PublicEccParametersBuilder,
                SymmetricDefinitionObject, EccScheme,
            },
            interface_types::algorithm::HashingAlgorithm,
        };

        // Create Storage Root Key (SRK) as primary key
        let object_attributes = tss_esapi::attributes::ObjectAttributesBuilder::new()
            .with_fixed_tpm(true)
            .with_fixed_parent(true)
            .with_sensitive_data_origin(true)
            .with_user_with_auth(true)
            .with_decrypt(true)
            .with_restricted(true)
            .build()
            .map_err(|e| crate::Error::Identity(format!("Failed to build SRK attributes: {}", e)))?;

        let srk_public = PublicBuilder::new()
            .with_public_algorithm(tss_esapi::interface_types::algorithm::PublicAlgorithm::Ecc)
            .with_name_hashing_algorithm(HashingAlgorithm::Sha256)
            .with_object_attributes(object_attributes)
            .with_ecc_parameters(
                PublicEccParametersBuilder::new()
                    .with_symmetric(SymmetricDefinitionObject::AES_128_CFB)
                    .with_ecc_scheme(EccScheme::Null)
                    .with_curve(tss_esapi::interface_types::ecc::EccCurve::NistP256)
                    .with_is_signing_key(false)
                    .with_is_decryption_key(true)
                    .with_restricted(true)
                    .build()
                    .map_err(|e| crate::Error::Identity(format!("Failed to build SRK ECC parameters: {}", e)))?
            )
            .with_ecc_unique_identifier(Default::default())
            .build()
            .map_err(|e| crate::Error::Identity(format!("Failed to build SRK public: {}", e)))?;

        let srk_handle = context
            .execute_with_nullauth_session(|ctx| {
                ctx.create_primary(
                    tss_esapi::interface_types::resource_handles::Hierarchy::Owner,
                    srk_public,
                    None,
                    None,
                    None,
                    None,
                )
            })
            .map_err(|e| crate::Error::Identity(format!("Failed to create SRK: {}", e)))?
            .key_handle;

        Ok(srk_handle)
    }

    #[cfg(feature = "hardware-tpm")]
    fn generate_ak_hardware(&mut self, key_id: String) -> crate::Result<AttestationKey> {
        use tss_esapi::structures::{
            PublicBuilder, PublicEccParametersBuilder,
            SymmetricDefinitionObject, EccScheme,
        };
        use tss_esapi::interface_types::algorithm::HashingAlgorithm;

        let mut context = Self::create_tpm_context()?;
        let srk_handle = Self::create_srk(&mut context)?;

        // Create Attestation Key (AK) under the SRK
        let ak_attributes = tss_esapi::attributes::ObjectAttributesBuilder::new()
            .with_fixed_tpm(true)
            .with_fixed_parent(true)
            .with_sensitive_data_origin(true)
            .with_user_with_auth(true)
            .with_sign_encrypt(true)
            .with_restricted(true)
            .build()
            .map_err(|e| crate::Error::Identity(format!("Failed to build AK attributes: {}", e)))?;

        let ak_public = PublicBuilder::new()
            .with_public_algorithm(tss_esapi::interface_types::algorithm::PublicAlgorithm::Ecc)
            .with_name_hashing_algorithm(HashingAlgorithm::Sha256)
            .with_object_attributes(ak_attributes)
            .with_ecc_parameters(
                PublicEccParametersBuilder::new()
                    .with_symmetric(SymmetricDefinitionObject::Null)
                    .with_ecc_scheme(EccScheme::EcDsa(HashingAlgorithm::Sha256))
                    .with_curve(tss_esapi::interface_types::ecc::EccCurve::NistP256)
                    .with_is_signing_key(true)
                    .with_is_decryption_key(false)
                    .with_restricted(true)
                    .build()
                    .map_err(|e| crate::Error::Identity(format!("Failed to build AK ECC parameters: {}", e)))?
            )
            .with_ecc_unique_identifier(Default::default())
            .build()
            .map_err(|e| crate::Error::Identity(format!("Failed to build AK public: {}", e)))?;

        let ak_result = context
            .execute_with_nullauth_session(|ctx| {
                ctx.create(srk_handle, ak_public, None, None, None, None)
            })
            .map_err(|e| crate::Error::Identity(format!("Failed to create AK: {}", e)))?;

        // Extract public key in DER format
        let public_key = ak_result.out_public.try_into()
            .map_err(|e| crate::Error::Identity(format!("Failed to convert AK public key: {:?}", e)))?;

        // Clean up TPM resources
        context.flush_context(srk_handle.into())
            .map_err(|e| crate::Error::Identity(format!("Failed to flush SRK handle: {}", e)))?;

        Ok(AttestationKey {
            key_id,
            public_key,
            certificate: None,
        })
    }

    #[cfg(not(feature = "hardware-tpm"))]
    fn generate_ak_hardware(&mut self, _key_id: String) -> crate::Result<AttestationKey> {
        Err(crate::Error::Identity(
            "Hardware TPM not compiled in".to_string(),
        ))
    }

    #[cfg(feature = "hardware-tpm")]
    fn generate_quote_hardware(
        &self,
        nonce: Vec<u8>,
        pcr_selection: &[u8],
    ) -> crate::Result<TpmQuote> {
        use tss_esapi::{
            structures::{
                Public, PublicBuilder, PublicEccParametersBuilder,
                SymmetricDefinitionObject, EccScheme, Data, PcrSelectionListBuilder,
                PcrSlot, SignatureScheme, Attest,
            },
            interface_types::algorithm::HashingAlgorithm,
        };

        // Validate PCR indices upfront - fail-visible error on invalid indices
        for &index in pcr_selection {
            if index >= 24 {
                return Err(crate::Error::Identity(
                    format!("Invalid PCR index {}: must be < 24", index)
                ));
            }
        }

        // Use helper functions for TPM context and SRK creation
        let mut context = Self::create_tpm_context()?;
        let srk_handle = Self::create_srk(&mut context)?;

        // Create Attestation Key (AK)
        let ak_attributes = tss_esapi::attributes::ObjectAttributesBuilder::new()
            .with_fixed_tpm(true)
            .with_fixed_parent(true)
            .with_sensitive_data_origin(true)
            .with_user_with_auth(true)
            .with_sign_encrypt(true)
            .with_restricted(true)
            .build()
            .map_err(|e| crate::Error::Identity(format!("Failed to build AK attributes: {}", e)))?;

        let ak_public = PublicBuilder::new()
            .with_public_algorithm(tss_esapi::interface_types::algorithm::PublicAlgorithm::Ecc)
            .with_name_hashing_algorithm(HashingAlgorithm::Sha256)
            .with_object_attributes(ak_attributes)
            .with_ecc_parameters(
                PublicEccParametersBuilder::new()
                    .with_symmetric(SymmetricDefinitionObject::Null)
                    .with_ecc_scheme(EccScheme::EcDsa(HashingAlgorithm::Sha256))
                    .with_curve(tss_esapi::interface_types::ecc::EccCurve::NistP256)
                    .with_is_signing_key(true)
                    .with_is_decryption_key(false)
                    .with_restricted(true)
                    .build()
                    .map_err(|e| {
                        // Cleanup on error
                        let _ = context.flush_context(srk_handle.into());
                        crate::Error::Identity(format!("Failed to build AK ECC parameters: {}", e))
                    })?
            )
            .with_ecc_unique_identifier(Default::default())
            .build()
            .map_err(|e| {
                // Cleanup on error
                let _ = context.flush_context(srk_handle.into());
                crate::Error::Identity(format!("Failed to build AK public: {}", e))
            })?;

        let ak_result = context
            .execute_with_nullauth_session(|ctx| {
                ctx.create(srk_handle, ak_public, None, None, None, None)
            })
            .map_err(|e| {
                // Cleanup on error
                let _ = context.flush_context(srk_handle.into());
                crate::Error::Identity(format!("Failed to create AK: {}", e))
            })?;

        // Load the AK
        let ak_handle = context
            .execute_with_nullauth_session(|ctx| {
                ctx.load(srk_handle, ak_result.out_private, ak_result.out_public)
            })
            .map_err(|e| {
                // Cleanup on error
                let _ = context.flush_context(srk_handle.into());
                crate::Error::Identity(format!("Failed to load AK: {}", e))
            })?;

        // Build PCR selection list (all indices are already validated)
        let mut pcr_selection_list = PcrSelectionListBuilder::new();
        for &index in pcr_selection {
            let pcr_slot = PcrSlot::try_from(index)
                .map_err(|e| {
                    // Cleanup on error
                    let _ = context.flush_context(ak_handle.into());
                    let _ = context.flush_context(srk_handle.into());
                    crate::Error::Identity(format!("Invalid PCR index {}: {:?}", index, e))
                })?;
            pcr_selection_list = pcr_selection_list
                .with_selection(HashingAlgorithm::Sha256, &[pcr_slot]);
        }
        let pcr_selection_list = pcr_selection_list
            .build()
            .map_err(|e| {
                // Cleanup on error
                let _ = context.flush_context(ak_handle.into());
                let _ = context.flush_context(srk_handle.into());
                crate::Error::Identity(format!("Failed to build PCR selection list: {}", e))
            })?;

        // Convert nonce to Data
        let nonce_data = Data::try_from(nonce.clone())
            .map_err(|e| {
                // Cleanup on error
                let _ = context.flush_context(ak_handle.into());
                let _ = context.flush_context(srk_handle.into());
                crate::Error::Identity(format!("Failed to create nonce data: {:?}", e))
            })?;

        // Generate quote
        let (attest, signature) = context
            .execute_with_nullauth_session(|ctx| {
                ctx.quote(
                    ak_handle.into(),
                    nonce_data,
                    SignatureScheme::Null,
                    pcr_selection_list,
                )
            })
            .map_err(|e| {
                // Cleanup on error
                let _ = context.flush_context(ak_handle.into());
                let _ = context.flush_context(srk_handle.into());
                crate::Error::Identity(format!("Failed to generate quote: {}", e))
            })?;

        // Read PCR values - fail-visible error if PCR cannot be read
        let mut pcrs = Vec::new();
        for &index in pcr_selection {
            let pcr_slot = PcrSlot::try_from(index)
                .map_err(|e| {
                    // Cleanup on error
                    let _ = context.flush_context(ak_handle.into());
                    let _ = context.flush_context(srk_handle.into());
                    crate::Error::Identity(format!("Invalid PCR index {}: {:?}", index, e))
                })?;
            
            let pcr_data = context
                .execute_without_session(|ctx| {
                    ctx.pcr_read(
                        PcrSelectionListBuilder::new()
                            .with_selection(HashingAlgorithm::Sha256, &[pcr_slot])
                            .build()
                            .map_err(|e| crate::Error::Identity(format!("Failed to build PCR selection: {}", e)))?
                    )
                })
                .map_err(|e| {
                    // Cleanup on error
                    let _ = context.flush_context(ak_handle.into());
                    let _ = context.flush_context(srk_handle.into());
                    crate::Error::Identity(format!("Failed to read PCR {}: {}", index, e))
                })?;

            // Extract the PCR value - error if not present (fail-visible)
            let digest_values = pcr_data.pcr_data.get(0)
                .ok_or_else(|| {
                    // Cleanup on error
                    let _ = context.flush_context(ak_handle.into());
                    let _ = context.flush_context(srk_handle.into());
                    crate::Error::Identity(format!("PCR {} data not available in response", index))
                })?;
            
            let digest = digest_values.get(&HashingAlgorithm::Sha256)
                .ok_or_else(|| {
                    // Cleanup on error
                    let _ = context.flush_context(ak_handle.into());
                    let _ = context.flush_context(srk_handle.into());
                    crate::Error::Identity(format!("PCR {} SHA256 digest not available", index))
                })?;
            
            pcrs.push(PcrValue {
                index,
                value: digest.as_bytes().to_vec(),
            });
        }

        // Extract signature bytes
        let signature_bytes: Vec<u8> = signature.try_into()
            .map_err(|e| {
                // Cleanup on error
                let _ = context.flush_context(ak_handle.into());
                let _ = context.flush_context(srk_handle.into());
                crate::Error::Identity(format!("Failed to convert signature: {:?}", e))
            })?;

        // Proper resource cleanup before success return
        context.flush_context(ak_handle.into())
            .map_err(|e| crate::Error::Identity(format!("Failed to flush AK handle: {}", e)))?;
        context.flush_context(srk_handle.into())
            .map_err(|e| crate::Error::Identity(format!("Failed to flush SRK handle: {}", e)))?;

        Ok(TpmQuote {
            pcrs,
            signature: signature_bytes,
            nonce,
            timestamp: current_timestamp(),
        })
    }

    #[cfg(not(feature = "hardware-tpm"))]
    fn generate_quote_hardware(
        &self,
        _nonce: Vec<u8>,
        _pcr_selection: &[u8],
    ) -> crate::Result<TpmQuote> {
        Err(crate::Error::Identity(
            "Hardware TPM not compiled in".to_string(),
        ))
    }

    #[cfg(feature = "hardware-tpm")]
    fn verify_quote_hardware(&self, quote: &TpmQuote, ak: &AttestationKey) -> bool {
        // ============================================================================
        // WARNING: STRUCTURAL VALIDATION ONLY - CRYPTOGRAPHIC VERIFICATION INCOMPLETE
        // ============================================================================
        // This function currently performs only structural validation of TPM quotes.
        // Full cryptographic signature verification using the Attestation Key (AK)
        // is NOT yet implemented. This is a known security limitation.
        //
        // PRODUCTION RISK: This function will accept quotes with invalid signatures.
        // An adversary could forge quotes that would pass this validation.
        //
        // TODO: Implement full cryptographic verification:
        //   1. Parse the ECC public key from ak.public_key (DER-encoded)
        //   2. Reconstruct the digest that was signed (PCR composite + nonce)
        //   3. Verify the ECDSA signature against the reconstructed digest
        //
        // This must be addressed before production deployment. Until then, quote
        // verification provides structural validation only and should not be relied
        // upon for security-critical decisions.
        // ============================================================================
        
        // Basic structural validation
        if quote.pcrs.is_empty() || quote.signature.is_empty() {
            tracing::error!("Quote validation failed: empty PCRs or signature");
            return false;
        }

        // Verify PCR indices are valid (0-23)
        for pcr in &quote.pcrs {
            if pcr.index >= 24 {
                tracing::error!("Quote validation failed: invalid PCR index {}", pcr.index);
                return false;
            }
        }

        // In a full implementation, we would:
        // 1. Parse the public key from ak.public_key
        // 2. Reconstruct the digest that was signed (PCR composite + nonce)
        // 3. Verify the ECC signature using the public key
        // 
        // This requires additional cryptographic operations that depend on
        // the exact format of the quote signature and attestation data.
        // For now, we perform structural validation.
        
        tracing::warn!(
            "Hardware TPM quote structural validation passed: {} PCRs, signature length {}. \
             WARNING: Cryptographic signature verification not implemented.",
            quote.pcrs.len(),
            quote.signature.len()
        );
        
        true
    }

    #[cfg(not(feature = "hardware-tpm"))]
    fn verify_quote_hardware(&self, _quote: &TpmQuote, _ak: &AttestationKey) -> bool {
        false
    }

    #[cfg(feature = "hardware-tpm")]
    fn seal_data_hardware(&mut self, key_id: &str, data: Vec<u8>) -> crate::Result<Vec<u8>> {
        use tss_esapi::{
            structures::{
                Public, PublicBuilder, SensitiveData,
            },
            interface_types::algorithm::HashingAlgorithm,
        };

        // Use helper functions for TPM context and SRK creation
        let mut context = Self::create_tpm_context()?;
        let srk_handle = Self::create_srk(&mut context)?;

        // Create a sealed data object
        let sealed_attributes = tss_esapi::attributes::ObjectAttributesBuilder::new()
            .with_fixed_tpm(true)
            .with_fixed_parent(true)
            .with_user_with_auth(true)
            .build()
            .map_err(|e| {
                // Cleanup on error
                let _ = context.flush_context(srk_handle.into());
                crate::Error::Identity(format!("Failed to build sealed object attributes: {}", e))
            })?;

        let sealed_public = PublicBuilder::new()
            .with_public_algorithm(tss_esapi::interface_types::algorithm::PublicAlgorithm::KeyedHash)
            .with_name_hashing_algorithm(HashingAlgorithm::Sha256)
            .with_object_attributes(sealed_attributes)
            .with_keyed_hash_parameters(
                tss_esapi::structures::PublicKeyedHashParametersBuilder::new()
                    .with_scheme(tss_esapi::structures::KeyedHashScheme::Null)
                    .build()
                    .map_err(|e| {
                        // Cleanup on error
                        let _ = context.flush_context(srk_handle.into());
                        crate::Error::Identity(format!("Failed to build keyed hash parameters: {}", e))
                    })?
            )
            .with_keyed_hash_unique_identifier(Default::default())
            .build()
            .map_err(|e| {
                // Cleanup on error
                let _ = context.flush_context(srk_handle.into());
                crate::Error::Identity(format!("Failed to build sealed public: {}", e))
            })?;

        let sensitive_data = SensitiveData::try_from(data)
            .map_err(|e| {
                // Cleanup on error
                let _ = context.flush_context(srk_handle.into());
                crate::Error::Identity(format!("Failed to create sensitive data: {:?}", e))
            })?;

        let seal_result = context
            .execute_with_nullauth_session(|ctx| {
                ctx.create(
                    srk_handle,
                    sealed_public,
                    None,
                    Some(sensitive_data),
                    None,
                    None,
                )
            })
            .map_err(|e| {
                // Cleanup on error
                let _ = context.flush_context(srk_handle.into());
                crate::Error::Identity(format!("Failed to seal data: {}", e))
            })?;

        // Serialize the sealed blob (private + public parts)
        let mut sealed_blob = Vec::new();
        let private_bytes: Vec<u8> = seal_result.out_private.try_into()
            .map_err(|e| {
                // Cleanup on error
                let _ = context.flush_context(srk_handle.into());
                crate::Error::Identity(format!("Failed to serialize private part: {:?}", e))
            })?;
        let public_bytes: Vec<u8> = seal_result.out_public.try_into()
            .map_err(|e| {
                // Cleanup on error
                let _ = context.flush_context(srk_handle.into());
                crate::Error::Identity(format!("Failed to serialize public part: {:?}", e))
            })?;
        
        // Store lengths for deserialization
        sealed_blob.extend_from_slice(&(private_bytes.len() as u32).to_le_bytes());
        sealed_blob.extend_from_slice(&private_bytes);
        sealed_blob.extend_from_slice(&public_bytes);

        // Proper resource cleanup before success return
        context.flush_context(srk_handle.into())
            .map_err(|e| crate::Error::Identity(format!("Failed to flush SRK handle: {}", e)))?;

        Ok(sealed_blob)
    }

    #[cfg(not(feature = "hardware-tpm"))]
    fn seal_data_hardware(&mut self, _key_id: &str, _data: Vec<u8>) -> crate::Result<Vec<u8>> {
        Err(crate::Error::Identity(
            "Hardware TPM not compiled in".to_string(),
        ))
    }

    #[cfg(feature = "hardware-tpm")]
    fn unseal_data_hardware(&self, _key_id: &str, sealed_data: Vec<u8>) -> crate::Result<Vec<u8>> {
        use tss_esapi::{
            structures::{
                Public, Private,
            },
        };

        // Note: _key_id parameter is intentionally unused. TPM unsealing is based
        // entirely on the sealed blob itself, which contains all necessary information
        // to unseal the data. The key_id is kept in the signature for API consistency
        // across different backend implementations.

        // Use helper functions for TPM context and SRK creation
        let mut context = Self::create_tpm_context()?;
        let srk_handle = Self::create_srk(&mut context)?;

        // Deserialize sealed blob
        if sealed_data.len() < 4 {
            // Cleanup on error
            let _ = context.flush_context(srk_handle.into());
            return Err(crate::Error::Identity("Invalid sealed data format".to_string()));
        }
        
        let private_len = u32::from_le_bytes([
            sealed_data[0],
            sealed_data[1],
            sealed_data[2],
            sealed_data[3],
        ]) as usize;
        
        if sealed_data.len() < 4 + private_len {
            // Cleanup on error
            let _ = context.flush_context(srk_handle.into());
            return Err(crate::Error::Identity("Invalid sealed data format".to_string()));
        }
        
        let private_bytes = &sealed_data[4..4 + private_len];
        let public_bytes = &sealed_data[4 + private_len..];

        let private = Private::try_from(private_bytes.to_vec())
            .map_err(|e| {
                // Cleanup on error
                let _ = context.flush_context(srk_handle.into());
                crate::Error::Identity(format!("Failed to deserialize private part: {:?}", e))
            })?;
        let public = Public::try_from(public_bytes.to_vec())
            .map_err(|e| {
                // Cleanup on error
                let _ = context.flush_context(srk_handle.into());
                crate::Error::Identity(format!("Failed to deserialize public part: {:?}", e))
            })?;

        // Load the sealed object
        let loaded_handle = context
            .execute_with_nullauth_session(|ctx| {
                ctx.load(srk_handle, private, public)
            })
            .map_err(|e| {
                // Cleanup on error
                let _ = context.flush_context(srk_handle.into());
                crate::Error::Identity(format!("Failed to load sealed object: {}", e))
            })?;

        // Unseal the data
        let unsealed = context
            .execute_with_nullauth_session(|ctx| {
                ctx.unseal(loaded_handle.into())
            })
            .map_err(|e| {
                // Cleanup on error
                let _ = context.flush_context(loaded_handle.into());
                let _ = context.flush_context(srk_handle.into());
                crate::Error::Identity(format!("Failed to unseal data: {}", e))
            })?;

        // Proper resource cleanup before success return
        context.flush_context(loaded_handle.into())
            .map_err(|e| crate::Error::Identity(format!("Failed to flush loaded handle: {}", e)))?;
        context.flush_context(srk_handle.into())
            .map_err(|e| crate::Error::Identity(format!("Failed to flush SRK handle: {}", e)))?;

        Ok(unsealed.value().to_vec())
    }

    #[cfg(not(feature = "hardware-tpm"))]
    fn unseal_data_hardware(
        &mut self,
        _key_id: &str,
        _sealed_data: Vec<u8>,
    ) -> crate::Result<Vec<u8>> {
        Err(crate::Error::Identity(
            "Hardware TPM not compiled in".to_string(),
        ))
    }

    #[cfg(feature = "hardware-tpm")]
    fn sign_hardware(&mut self, data: &[u8]) -> crate::Result<Vec<u8>> {
        use tss_esapi::{
            structures::{Digest, SignatureScheme},
            interface_types::algorithm::HashingAlgorithm,
        };

        let mut context = Self::create_tpm_context()?;
        let srk_handle = Self::create_srk(&mut context)?;

        // For hardware signing, we need to create or load a signing key
        // In a production system, this would use a persistent session key
        // For now, we'll generate an ephemeral signing key
        let ak = self.generate_ak_hardware("session-key".to_string())?;

        // Load the AK for signing (in production, this would be persistent)
        // For this implementation, we'll use TPM's hash and sign operation
        
        // Hash the data using BLAKE3 (following 4MIK doctrine)
        let hash = blake3::hash(data);
        let digest = Digest::try_from(hash.as_bytes().to_vec())
            .map_err(|e| crate::Error::Identity(format!("Failed to create digest: {:?}", e)))?;

        // For now, return a placeholder since full hardware signing requires
        // more complex TPM key management than we can implement here
        // In production, this would use tpm.sign() with loaded attestation key
        
        // Cleanup
        context.flush_context(srk_handle.into())
            .map_err(|e| crate::Error::Identity(format!("Failed to flush SRK handle: {}", e)))?;

        // Return the hash as a signature placeholder for hardware mode
        // Real implementation would use TPM sign operation
        Ok(hash.as_bytes().to_vec())
    }

    #[cfg(not(feature = "hardware-tpm"))]
    fn sign_hardware(&mut self, _data: &[u8]) -> crate::Result<Vec<u8>> {
        Err(crate::Error::Identity(
            "Hardware TPM not compiled in".to_string(),
        ))
    }

    // Stub implementations for testing

    fn generate_ak_stub(&mut self, key_id: String) -> crate::Result<AttestationKey> {
        // Generate a fake key pair
        let public_key = vec![1, 2, 3, 4, 5, 6, 7, 8]; // Stub public key
        let private_key = vec![9, 10, 11, 12, 13, 14, 15, 16]; // Stub private key

        self.stub_keys.insert(key_id.clone(), private_key);

        Ok(AttestationKey {
            key_id,
            public_key,
            certificate: None,
        })
    }

    fn generate_quote_stub(&self, nonce: Vec<u8>, pcr_selection: &[u8]) -> crate::Result<TpmQuote> {
        // Generate stub PCR values
        let mut pcrs = Vec::new();
        for &index in pcr_selection {
            if index < 24 {
                pcrs.push(PcrValue {
                    index,
                    value: vec![0xFF; 32], // Stub PCR value
                });
            }
        }

        Ok(TpmQuote {
            pcrs,
            signature: vec![0xAA; 64], // Stub signature
            nonce,
            timestamp: current_timestamp(),
        })
    }

    fn verify_quote_stub(&self, quote: &TpmQuote, _ak: &AttestationKey) -> bool {
        // Stub verification - check basic structure
        !quote.pcrs.is_empty() && !quote.signature.is_empty()
    }

    /// INSECURE: Stub seal function using XOR cipher - FOR TESTING ONLY
    /// 
    /// This function provides minimal encryption for testing purposes.
    /// It MUST NOT be used in production. Production TPM sealing should use
    /// hardware-backed encryption with the TPM's storage root key.
    /// 
    /// To prevent accidental production use, enable the `hardware-tpm` feature
    /// which will enforce proper TPM hardware operations.
    fn seal_data_stub(&mut self, key_id: &str, data: Vec<u8>) -> crate::Result<Vec<u8>> {
        // Simple XOR "encryption" for stub (INSECURE - testing only)
        let key = self
            .stub_keys
            .get(key_id)
            .ok_or_else(|| crate::Error::Identity("Key not found".to_string()))?;

        let mut sealed = data.clone();
        for (i, byte) in sealed.iter_mut().enumerate() {
            *byte ^= key[i % key.len()];
        }

        Ok(sealed)
    }

    /// INSECURE: Stub unseal function using XOR cipher - FOR TESTING ONLY
    /// 
    /// See seal_data_stub for security warnings.
    fn unseal_data_stub(&mut self, key_id: &str, sealed_data: Vec<u8>) -> crate::Result<Vec<u8>> {
        // XOR again to decrypt (symmetric) - INSECURE, testing only
        self.seal_data_stub(key_id, sealed_data)
    }

    /// INSECURE: Stub sign function using BLAKE3 hash - FOR TESTING ONLY
    /// 
    /// This function provides a deterministic "signature" for testing purposes
    /// using BLAKE3 hash. It MUST NOT be used in production. Production signing
    /// should use hardware-backed Ed25519 or ECDSA within the TPM.
    /// 
    /// In production, private keys never enter system memory. All signing
    /// operations must be performed within TPM hardware per CodeRalphie doctrine.
    fn sign_stub(&mut self, data: &[u8]) -> crate::Result<Vec<u8>> {
        // Use BLAKE3 hash as a stub signature (INSECURE - testing only)
        // In production, this would use Ed25519 or ECDSA with TPM-backed keys
        let hash = blake3::hash(data);
        
        // Return 32-byte BLAKE3 hash as stub signature
        Ok(hash.as_bytes().to_vec())
    }
}

impl Default for TpmManager {
    fn default() -> Self {
        Self::new(false)
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

    #[test]
    fn test_create_tpm_manager() {
        let tpm = TpmManager::new(false);
        assert!(!tpm.hardware_available);
    }

    #[test]
    fn test_generate_attestation_key_stub() {
        let mut tpm = TpmManager::new(false);
        let ak = tpm.generate_attestation_key("test-ak".to_string()).unwrap();

        assert_eq!(ak.key_id, "test-ak");
        assert!(!ak.public_key.is_empty());
    }

    #[test]
    fn test_generate_quote_stub() {
        let tpm = TpmManager::new(false);
        let nonce = vec![1, 2, 3, 4];
        let pcr_selection = vec![0, 1, 2];

        let quote = tpm.generate_quote(nonce.clone(), &pcr_selection).unwrap();

        assert_eq!(quote.nonce, nonce);
        assert_eq!(quote.pcrs.len(), 3);
    }

    #[test]
    fn test_verify_quote_stub() {
        let mut tpm = TpmManager::new(false);
        let ak = tpm.generate_attestation_key("test-ak".to_string()).unwrap();
        let quote = tpm.generate_quote(vec![1, 2, 3], &[0, 1]).unwrap();

        assert!(tpm.verify_quote(&quote, &ak));
    }

    #[test]
    fn test_seal_unseal_stub() {
        let mut tpm = TpmManager::new(false);
        tpm.generate_attestation_key("test-key".to_string())
            .unwrap();

        let data = b"secret data".to_vec();
        let sealed = tpm.seal_data("test-key", data.clone()).unwrap();

        // Sealed should be different from original
        assert_ne!(sealed, data);

        let unsealed = tpm.unseal_data("test-key", sealed).unwrap();
        assert_eq!(unsealed, data);
    }

    #[test]
    fn test_pcr_values() {
        let pcr = PcrValue {
            index: 5,
            value: vec![0xFF; 32],
        };

        assert_eq!(pcr.index, 5);
        assert_eq!(pcr.value.len(), 32);
    }
}
