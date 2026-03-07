//! Secure Enclave attestation backend for Apple platforms (macOS and iOS).
//!
//! This backend signs caller-provided nonces with an ECDSA P-256 private key
//! bound to the Secure Enclave and stored in keychain.

use p256::ecdsa::{signature::Verifier, Signature, VerifyingKey};
use serde::{Deserialize, Serialize};

/// Nonce quote produced by the Secure Enclave attestor.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct SecureEnclaveQuote {
    /// Nonce supplied by caller.
    pub nonce: Vec<u8>,
    /// DER-encoded ECDSA signature over nonce.
    pub signature_der: Vec<u8>,
    /// SEC1-encoded public key associated with the Secure Enclave private key.
    pub public_key_sec1: Vec<u8>,
    /// Stable key tag used in keychain lookup.
    pub key_tag: String,
    /// Quote creation time (Unix epoch milliseconds).
    pub timestamp_ms: u64,
}

/// Secure Enclave nonce-signing attestor.
#[derive(Debug, Clone)]
pub struct SecureEnclaveAttestor {
    #[cfg_attr(not(any(target_os = "macos", target_os = "ios")), allow(dead_code))]
    key_tag: String,
}

impl SecureEnclaveAttestor {
    /// Create a new Secure Enclave attestor with a deterministic key tag.
    pub fn new(key_tag: impl Into<String>) -> Self {
        Self {
            key_tag: key_tag.into(),
        }
    }

    /// Returns true when the current target is macOS or iOS.
    pub fn is_supported() -> bool {
        cfg!(any(target_os = "macos", target_os = "ios"))
    }

    /// Sign a nonce using a Secure Enclave-backed key.
    pub fn sign_nonce(&self, nonce: &[u8]) -> crate::Result<SecureEnclaveQuote> {
        if nonce.is_empty() {
            return Err(crate::Error::Identity(
                "Secure Enclave attestation nonce cannot be empty".to_string(),
            ));
        }

        #[cfg(any(target_os = "macos", target_os = "ios"))]
        {
            return self.sign_nonce_apple(nonce);
        }

        #[cfg(not(any(target_os = "macos", target_os = "ios")))]
        {
            let _ = nonce;
            Err(crate::Error::Identity(
                "Secure Enclave attestation is only supported on macOS and iOS".to_string(),
            ))
        }
    }

    /// Build an attestation payload from a signed nonce quote.
    pub fn attest_nonce(&self, nonce: &[u8]) -> crate::Result<crate::Attestation> {
        let quote = self.sign_nonce(nonce)?;
        Ok(crate::Attestation::SecureEnclave {
            key_tag: quote.key_tag,
            public_key: quote.public_key_sec1,
            signature: quote.signature_der,
        })
    }

    /// Verify a Secure Enclave quote's signature.
    pub fn verify_quote(quote: &SecureEnclaveQuote) -> crate::Result<bool> {
        let verifying_key = VerifyingKey::from_sec1_bytes(&quote.public_key_sec1)
            .map_err(|e| crate::Error::Identity(format!("Invalid SEC1 public key: {e}")))?;
        let signature = Signature::from_der(&quote.signature_der)
            .map_err(|e| crate::Error::Identity(format!("Invalid DER signature: {e}")))?;
        Ok(verifying_key.verify(&quote.nonce, &signature).is_ok())
    }

    /// Verify a Secure Enclave attestation payload against the provided nonce.
    pub fn verify_attestation(
        attestation: &crate::Attestation,
        nonce: &[u8],
    ) -> crate::Result<bool> {
        match attestation {
            crate::Attestation::SecureEnclave {
                key_tag,
                public_key,
                signature,
            } => {
                let quote = SecureEnclaveQuote {
                    nonce: nonce.to_vec(),
                    signature_der: signature.clone(),
                    public_key_sec1: public_key.clone(),
                    key_tag: key_tag.clone(),
                    timestamp_ms: current_timestamp_ms(),
                };
                Self::verify_quote(&quote)
            }
            _ => Err(crate::Error::Identity(
                "Attestation payload is not SecureEnclave type".to_string(),
            )),
        }
    }

    #[cfg(any(target_os = "macos", target_os = "ios"))]
    fn sign_nonce_apple(&self, nonce: &[u8]) -> crate::Result<SecureEnclaveQuote> {
        apple_backend::sign_nonce(&self.key_tag, nonce)
    }
}

#[cfg(any(target_os = "macos", target_os = "ios"))]
mod apple_backend {
    use super::{current_timestamp_ms, SecureEnclaveQuote};
    use std::ffi::{c_void, CString};
    use std::os::raw::c_char;
    use std::ptr;
    use std::slice;

    type CFTypeRef = *const c_void;
    type CFStringRef = *const c_void;
    type CFDataRef = *const c_void;
    type CFErrorRef = *const c_void;
    type CFDictionaryRef = *const c_void;
    type CFNumberRef = *const c_void;
    type SecKeyRef = *const c_void;
    type SecTaskRef = *const c_void;
    type SecAccessControlRef = *const c_void;
    type CFAllocatorRef = *const c_void;
    type CFIndex = isize;
    type CFNumberType = i32;
    type CFOptionFlags = u64;
    type Boolean = u8;
    type OSStatus = i32;
    type SecKeyOperationType = i32;
    type CFStringEncoding = u32;

    const ERR_SEC_SUCCESS: OSStatus = 0;
    const K_CF_NUMBER_SINT32_TYPE: CFNumberType = 3;
    const K_SEC_KEY_OPERATION_TYPE_SIGN: SecKeyOperationType = 0;
    const K_CF_STRING_ENCODING_UTF8: CFStringEncoding = 0x0800_0100;
    const K_SEC_ACCESS_CONTROL_PRIVATE_KEY_USAGE: CFOptionFlags = 1 << 30;

    #[repr(C)]
    struct CFDictionaryKeyCallBacks {
        version: CFIndex,
        retain: *const c_void,
        release: *const c_void,
        copy_description: *const c_void,
        equal: *const c_void,
        hash: *const c_void,
    }

    #[repr(C)]
    struct CFDictionaryValueCallBacks {
        version: CFIndex,
        retain: *const c_void,
        release: *const c_void,
        copy_description: *const c_void,
        equal: *const c_void,
    }

    #[link(name = "CoreFoundation", kind = "framework")]
    unsafe extern "C" {
        static kCFBooleanTrue: CFTypeRef;
        static kCFTypeDictionaryKeyCallBacks: CFDictionaryKeyCallBacks;
        static kCFTypeDictionaryValueCallBacks: CFDictionaryValueCallBacks;

        fn CFRelease(cf: CFTypeRef);
        fn CFDataCreate(allocator: CFAllocatorRef, bytes: *const u8, length: CFIndex) -> CFDataRef;
        fn CFDataGetLength(data: CFDataRef) -> CFIndex;
        fn CFDataGetBytePtr(data: CFDataRef) -> *const u8;
        fn CFStringCreateWithCString(
            allocator: CFAllocatorRef,
            c_str: *const c_char,
            encoding: CFStringEncoding,
        ) -> CFStringRef;
        fn CFNumberCreate(
            allocator: CFAllocatorRef,
            number_type: CFNumberType,
            value_ptr: *const c_void,
        ) -> CFNumberRef;
        fn CFDictionaryCreate(
            allocator: CFAllocatorRef,
            keys: *const CFTypeRef,
            values: *const CFTypeRef,
            num_values: CFIndex,
            key_callbacks: *const c_void,
            value_callbacks: *const c_void,
        ) -> CFDictionaryRef;
        fn CFStringCreateExternalRepresentation(
            allocator: CFAllocatorRef,
            string: CFStringRef,
            encoding: CFStringEncoding,
            loss_byte: u8,
        ) -> CFDataRef;
        fn CFErrorCopyDescription(err: CFErrorRef) -> CFStringRef;
    }

    #[link(name = "Security", kind = "framework")]
    unsafe extern "C" {
        static kSecClass: CFTypeRef;
        static kSecClassKey: CFTypeRef;
        static kSecAttrApplicationTag: CFTypeRef;
        static kSecAttrKeyType: CFTypeRef;
        static kSecAttrKeyTypeECSECPrimeRandom: CFTypeRef;
        static kSecAttrKeyClass: CFTypeRef;
        static kSecAttrKeyClassPrivate: CFTypeRef;
        static kSecMatchLimit: CFTypeRef;
        static kSecMatchLimitOne: CFTypeRef;
        static kSecReturnRef: CFTypeRef;
        static kSecAttrKeySizeInBits: CFTypeRef;
        static kSecAttrTokenID: CFTypeRef;
        static kSecAttrTokenIDSecureEnclave: CFTypeRef;
        static kSecPrivateKeyAttrs: CFTypeRef;
        static kSecAttrIsPermanent: CFTypeRef;
        static kSecAttrAccessControl: CFTypeRef;
        static kSecAttrAccessibleWhenUnlockedThisDeviceOnly: CFTypeRef;
        static kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly: CFTypeRef;
        static kSecKeyAlgorithmECDSASignatureMessageX962SHA256: CFTypeRef;

        fn SecItemCopyMatching(query: CFDictionaryRef, result: *mut CFTypeRef) -> OSStatus;
        fn SecKeyCreateRandomKey(parameters: CFDictionaryRef, error: *mut CFErrorRef) -> SecKeyRef;
        fn SecKeyIsAlgorithmSupported(
            key: SecKeyRef,
            operation: SecKeyOperationType,
            algorithm: CFTypeRef,
        ) -> Boolean;
        fn SecKeyCreateSignature(
            key: SecKeyRef,
            algorithm: CFTypeRef,
            data_to_sign: CFDataRef,
            error: *mut CFErrorRef,
        ) -> CFDataRef;
        fn SecAccessControlCreateWithFlags(
            allocator: CFAllocatorRef,
            protection: CFTypeRef,
            flags: CFOptionFlags,
            error: *mut CFErrorRef,
        ) -> SecAccessControlRef;
        fn SecKeyCopyPublicKey(key: SecKeyRef) -> SecKeyRef;
        fn SecKeyCopyExternalRepresentation(key: SecKeyRef, error: *mut CFErrorRef) -> CFDataRef;
        fn SecCopyErrorMessageString(status: OSStatus, reserved: *mut c_void) -> CFStringRef;
        fn SecTaskCreateFromSelf(allocator: CFAllocatorRef) -> SecTaskRef;
        fn SecTaskCopyValueForEntitlement(
            task: SecTaskRef,
            entitlement: CFStringRef,
            error: *mut CFErrorRef,
        ) -> CFTypeRef;
    }

    #[derive(Debug)]
    struct CfScoped(CFTypeRef);

    impl CfScoped {
        fn new(raw: CFTypeRef, context: &str) -> crate::Result<Self> {
            if raw.is_null() {
                return Err(crate::Error::Identity(format!("{context} returned null")));
            }
            Ok(Self(raw))
        }

        fn as_ptr(&self) -> CFTypeRef {
            self.0
        }
    }

    impl Drop for CfScoped {
        fn drop(&mut self) {
            if !self.0.is_null() {
                // SAFETY: All retained CoreFoundation objects can be released with CFRelease.
                unsafe { CFRelease(self.0) };
            }
        }
    }

    struct LookupResult {
        key: Option<CfScoped>,
        status: OSStatus,
    }

    pub(super) fn sign_nonce(key_tag: &str, nonce: &[u8]) -> crate::Result<SecureEnclaveQuote> {
        // SAFETY: Calls into macOS Security/CoreFoundation APIs with owned CF objects.
        unsafe {
            let entitlement_preflight_error = preflight_secure_enclave_entitlements().err();

            let tag_data = cf_data_from_bytes(key_tag.as_bytes(), "key tag")?;
            let nonce_data = cf_data_from_bytes(nonce, "nonce")?;
            let mut generation_errors = Vec::new();
            let mut private_key: Option<CfScoped> = None;

            // Prefer persistent keychain-backed SEP keys first. This is the most stable
            // mode for launch-time probes and avoids transient CTK instability.
            //
            // Entitlement preflight is diagnostic only; we still attempt persistent-key
            // operations because certain launch/signing contexts can suppress task
            // entitlement visibility while key generation still succeeds.
            if let Some(error) = entitlement_preflight_error {
                generation_errors.push(format!("entitlements_preflight: {error}"));
            }

            let lookup = lookup_private_key(&tag_data)?;
            if let Some(existing) = lookup.key {
                private_key = Some(existing);
            } else {
                // On some macOS builds, persistent SEP key creation can crash in
                // CryptoTokenKit. Prefer ephemeral SEP keys first when fallback is
                // enabled so startup attestation remains available.
                if allow_ephemeral_sep_fallback() {
                    match create_ephemeral_private_key() {
                        Ok(key) => {
                            generation_errors.push(
                                "using ephemeral Secure Enclave key (persistent generation skipped)"
                                    .to_string(),
                            );
                            private_key = Some(key);
                        }
                        Err(error) => generation_errors
                            .push(format!("ephemeral_sec_enclave_key_failed: {error}")),
                    }
                }

                if private_key.is_none() {
                    let accessibility = [
                        kSecAttrAccessibleWhenUnlockedThisDeviceOnly,
                        kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly,
                    ];
                    for accessible in accessibility {
                        match create_private_key(&tag_data, accessible) {
                            Ok(key) => {
                                private_key = Some(key);
                                break;
                            }
                            Err(error) => generation_errors.push(error),
                        }
                    }
                    generation_errors.push(format!(
                        "persistent_key_lookup_status={} ({})",
                        lookup.status,
                        os_status_message(lookup.status)
                    ));
                }
            }

            let mut private_key = private_key.ok_or_else(|| {
                crate::Error::Identity(format!(
                    "secure enclave key unavailable. generation_errors={}",
                    generation_errors.join(" | ")
                ))
            })?;

            if SecKeyIsAlgorithmSupported(
                private_key.as_ptr() as SecKeyRef,
                K_SEC_KEY_OPERATION_TYPE_SIGN,
                kSecKeyAlgorithmECDSASignatureMessageX962SHA256,
            ) == 0
            {
                return Err(crate::Error::Identity(
                    "Secure Enclave key does not support ECDSA SHA-256 signature algorithm"
                        .to_string(),
                ));
            }

            let mut sig_error: CFErrorRef = ptr::null();
            let mut signature = SecKeyCreateSignature(
                private_key.as_ptr() as SecKeyRef,
                kSecKeyAlgorithmECDSASignatureMessageX962SHA256,
                nonce_data.as_ptr() as CFDataRef,
                &mut sig_error,
            );
            if signature.is_null() {
                let primary_error = cf_error_message(sig_error);
                if allow_ephemeral_sep_fallback() {
                    match create_ephemeral_private_key() {
                        Ok(ephemeral_key) => {
                            private_key = ephemeral_key;
                            let mut retry_error: CFErrorRef = ptr::null();
                            signature = SecKeyCreateSignature(
                                private_key.as_ptr() as SecKeyRef,
                                kSecKeyAlgorithmECDSASignatureMessageX962SHA256,
                                nonce_data.as_ptr() as CFDataRef,
                                &mut retry_error,
                            );
                            if signature.is_null() {
                                let secondary_error = cf_error_message(retry_error);
                                return Err(crate::Error::Identity(format!(
                                    "failed to sign nonce with primary SEP key: {primary_error}; ephemeral SEP fallback also failed: {secondary_error}"
                                )));
                            }
                        }
                        Err(ephemeral_error) => {
                            return Err(crate::Error::Identity(format!(
                                "failed to sign nonce with primary SEP key: {primary_error}; ephemeral SEP fallback unavailable: {ephemeral_error}"
                            )));
                        }
                    }
                } else {
                    return Err(crate::Error::Identity(format!(
                        "failed to sign nonce with primary SEP key: {primary_error}; ephemeral SEP fallback disabled"
                    )));
                }
            }
            let signature = CfScoped::new(signature as CFTypeRef, "SecKeyCreateSignature")?;

            let public_key = SecKeyCopyPublicKey(private_key.as_ptr() as SecKeyRef);
            if public_key.is_null() {
                return Err(crate::Error::Identity(
                    "failed to derive public key".to_string(),
                ));
            }
            let public_key = CfScoped::new(public_key as CFTypeRef, "SecKeyCopyPublicKey")?;

            let mut pub_error: CFErrorRef = ptr::null();
            let public_key_data =
                SecKeyCopyExternalRepresentation(public_key.as_ptr() as SecKeyRef, &mut pub_error);
            if public_key_data.is_null() {
                let detail = cf_error_message(pub_error);
                return Err(crate::Error::Identity(format!(
                    "failed to export public key: {detail}"
                )));
            }
            let public_key_data = CfScoped::new(
                public_key_data as CFTypeRef,
                "SecKeyCopyExternalRepresentation",
            )?;

            Ok(SecureEnclaveQuote {
                nonce: nonce.to_vec(),
                signature_der: cf_data_to_vec(signature.as_ptr() as CFDataRef),
                public_key_sec1: cf_data_to_vec(public_key_data.as_ptr() as CFDataRef),
                key_tag: key_tag.to_string(),
                timestamp_ms: current_timestamp_ms(),
            })
        }
    }

    unsafe fn lookup_private_key(tag_data: &CfScoped) -> crate::Result<LookupResult> {
        let query = cf_dictionary(
            &[
                (kSecClass, kSecClassKey),
                (kSecAttrApplicationTag, tag_data.as_ptr()),
                (kSecAttrKeyType, kSecAttrKeyTypeECSECPrimeRandom),
                (kSecAttrKeyClass, kSecAttrKeyClassPrivate),
                (kSecMatchLimit, kSecMatchLimitOne),
                (kSecReturnRef, kCFBooleanTrue),
            ],
            "lookup query",
        )?;

        let mut item: CFTypeRef = ptr::null();
        let status = SecItemCopyMatching(query.as_ptr() as CFDictionaryRef, &mut item);
        if status == ERR_SEC_SUCCESS {
            let key = CfScoped::new(item, "SecItemCopyMatching key result")?;
            Ok(LookupResult {
                key: Some(key),
                status,
            })
        } else {
            Ok(LookupResult { key: None, status })
        }
    }

    unsafe fn create_private_key(
        tag_data: &CfScoped,
        accessible: CFTypeRef,
    ) -> Result<CfScoped, String> {
        let key_bits: i32 = 256;
        let key_bits =
            cf_number_i32(key_bits, "kSecAttrKeySizeInBits").map_err(|e| format!("{e}"))?;
        let mut access_error: CFErrorRef = ptr::null();
        let access_control = SecAccessControlCreateWithFlags(
            ptr::null(),
            accessible,
            K_SEC_ACCESS_CONTROL_PRIVATE_KEY_USAGE,
            &mut access_error,
        );
        if access_control.is_null() {
            return Err(format!(
                "SecAccessControlCreateWithFlags failed: {}",
                cf_error_message(access_error)
            ));
        }
        let access_control = CfScoped::new(
            access_control as CFTypeRef,
            "SecAccessControlCreateWithFlags",
        )
        .map_err(|e| format!("{e}"))?;

        let private_key_attrs = cf_dictionary(
            &[
                (kSecAttrIsPermanent, kCFBooleanTrue),
                (kSecAttrApplicationTag, tag_data.as_ptr()),
                (kSecAttrAccessControl, access_control.as_ptr()),
            ],
            "private key attrs",
        )
        .map_err(|e| format!("{e}"))?;
        let parameters = cf_dictionary(
            &[
                (kSecAttrKeyType, kSecAttrKeyTypeECSECPrimeRandom),
                (kSecAttrKeySizeInBits, key_bits.as_ptr()),
                (kSecAttrTokenID, kSecAttrTokenIDSecureEnclave),
                (kSecPrivateKeyAttrs, private_key_attrs.as_ptr()),
            ],
            "key generation params",
        )
        .map_err(|e| format!("{e}"))?;

        let mut key_error: CFErrorRef = ptr::null();
        let key = SecKeyCreateRandomKey(parameters.as_ptr() as CFDictionaryRef, &mut key_error);
        if key.is_null() {
            return Err(format!(
                "SecKeyCreateRandomKey failed: {}",
                cf_error_message(key_error)
            ));
        }

        CfScoped::new(key as CFTypeRef, "SecKeyCreateRandomKey").map_err(|e| format!("{e}"))
    }

    unsafe fn create_ephemeral_private_key() -> Result<CfScoped, String> {
        let key_bits: i32 = 256;
        let key_bits =
            cf_number_i32(key_bits, "kSecAttrKeySizeInBits").map_err(|e| format!("{e}"))?;
        let parameters = cf_dictionary(
            &[
                (kSecAttrKeyType, kSecAttrKeyTypeECSECPrimeRandom),
                (kSecAttrKeySizeInBits, key_bits.as_ptr()),
                (kSecAttrTokenID, kSecAttrTokenIDSecureEnclave),
            ],
            "ephemeral key generation params",
        )
        .map_err(|e| format!("{e}"))?;

        let mut key_error: CFErrorRef = ptr::null();
        let key = SecKeyCreateRandomKey(parameters.as_ptr() as CFDictionaryRef, &mut key_error);
        if key.is_null() {
            return Err(format!(
                "SecKeyCreateRandomKey (ephemeral) failed: {}",
                cf_error_message(key_error)
            ));
        }

        CfScoped::new(key as CFTypeRef, "SecKeyCreateRandomKey (ephemeral)")
            .map_err(|e| format!("{e}"))
    }

    fn allow_ephemeral_sep_fallback() -> bool {
        std::env::var("AETHERCORE_SEP_ALLOW_EPHEMERAL")
            .ok()
            .map(|value| {
                let normalized = value.trim().to_ascii_lowercase();
                normalized == "1" || normalized == "true" || normalized == "yes"
            })
            .unwrap_or(false)
    }

    unsafe fn preflight_secure_enclave_entitlements() -> Result<(), String> {
        // iOS and macOS have different entitlement requirements
        #[cfg(target_os = "ios")]
        {
            preflight_ios_entitlements()
        }
        
        #[cfg(target_os = "macos")]
        {
            preflight_macos_entitlements()
        }
    }

    #[cfg(target_os = "ios")]
    unsafe fn preflight_ios_entitlements() -> Result<(), String> {
        let application_identifier = read_entitlement("application-identifier")?;
        let keychain_groups = read_entitlement("keychain-access-groups")?;
        let team_identifier = read_entitlement("com.apple.developer.team-identifier")?;

        if application_identifier.is_none() && keychain_groups.is_none() {
            return Err(
                "missing iOS keychain signing entitlements (application-identifier or keychain-access-groups)".to_string(),
            );
        }

        if team_identifier.is_none() {
            return Err("missing com.apple.developer.team-identifier entitlement".to_string());
        }

        Ok(())
    }

    #[cfg(target_os = "macos")]
    unsafe fn preflight_macos_entitlements() -> Result<(), String> {
        let application_identifier = read_entitlement("com.apple.application-identifier")?
            .or(read_entitlement("application-identifier")?);
        let keychain_groups = read_entitlement("keychain-access-groups")?;
        let team_identifier = read_entitlement("com.apple.developer.team-identifier")?;

        if application_identifier.is_none() && keychain_groups.is_none() {
            return Err(
                "missing macOS keychain signing entitlements (com.apple.application-identifier or keychain-access-groups)".to_string(),
            );
        }

        if team_identifier.is_none() {
            return Err("missing com.apple.developer.team-identifier entitlement".to_string());
        }

        Ok(())
    }

    unsafe fn read_entitlement(name: &str) -> Result<Option<CfScoped>, String> {
        let task = SecTaskCreateFromSelf(ptr::null());
        if task.is_null() {
            return Err("SecTaskCreateFromSelf returned null".to_string());
        }
        let task = CfScoped::new(task as CFTypeRef, "SecTaskCreateFromSelf")
            .map_err(|error| format!("{error}"))?;

        let entitlement =
            cf_string_from_str(name, "entitlement key").map_err(|error| format!("{error}"))?;
        let mut entitlement_error: CFErrorRef = ptr::null();
        let value = SecTaskCopyValueForEntitlement(
            task.as_ptr() as SecTaskRef,
            entitlement.as_ptr() as CFStringRef,
            &mut entitlement_error,
        );
        if !entitlement_error.is_null() {
            return Err(format!(
                "SecTaskCopyValueForEntitlement({name}) failed: {}",
                cf_error_message(entitlement_error)
            ));
        }

        if value.is_null() {
            Ok(None)
        } else {
            CfScoped::new(
                value as CFTypeRef,
                &format!("SecTaskCopyValueForEntitlement({name}) value"),
            )
            .map(Some)
            .map_err(|error| format!("{error}"))
        }
    }

    unsafe fn cf_data_from_bytes(bytes: &[u8], label: &str) -> crate::Result<CfScoped> {
        let data = CFDataCreate(ptr::null(), bytes.as_ptr(), bytes.len() as CFIndex);
        CfScoped::new(data as CFTypeRef, &format!("CFDataCreate for {label}"))
    }

    unsafe fn cf_string_from_str(value: &str, label: &str) -> crate::Result<CfScoped> {
        let c_string = CString::new(value).map_err(|_| {
            crate::Error::Identity(format!(
                "CFStringCreateWithCString for {label} received interior null byte"
            ))
        })?;
        let string =
            CFStringCreateWithCString(ptr::null(), c_string.as_ptr(), K_CF_STRING_ENCODING_UTF8);
        CfScoped::new(
            string as CFTypeRef,
            &format!("CFStringCreateWithCString for {label}"),
        )
    }

    unsafe fn cf_number_i32(value: i32, label: &str) -> crate::Result<CfScoped> {
        let number = CFNumberCreate(
            ptr::null(),
            K_CF_NUMBER_SINT32_TYPE,
            (&value as *const i32).cast(),
        );
        CfScoped::new(number as CFTypeRef, &format!("CFNumberCreate for {label}"))
    }

    unsafe fn cf_dictionary(
        pairs: &[(CFTypeRef, CFTypeRef)],
        label: &str,
    ) -> crate::Result<CfScoped> {
        let (keys, values): (Vec<CFTypeRef>, Vec<CFTypeRef>) = pairs.iter().copied().unzip();
        let dict = CFDictionaryCreate(
            ptr::null(),
            keys.as_ptr(),
            values.as_ptr(),
            pairs.len() as CFIndex,
            (&raw const kCFTypeDictionaryKeyCallBacks).cast(),
            (&raw const kCFTypeDictionaryValueCallBacks).cast(),
        );
        CfScoped::new(
            dict as CFTypeRef,
            &format!("CFDictionaryCreate for {label}"),
        )
    }

    unsafe fn cf_data_to_vec(data: CFDataRef) -> Vec<u8> {
        if data.is_null() {
            return Vec::new();
        }
        let len = CFDataGetLength(data) as usize;
        let ptr = CFDataGetBytePtr(data);
        if ptr.is_null() || len == 0 {
            return Vec::new();
        }
        slice::from_raw_parts(ptr, len).to_vec()
    }

    unsafe fn cf_string_to_string(string: CFStringRef) -> String {
        if string.is_null() {
            return "unknown".to_string();
        }
        let data =
            CFStringCreateExternalRepresentation(ptr::null(), string, K_CF_STRING_ENCODING_UTF8, 0);
        if data.is_null() {
            return "unknown".to_string();
        }
        let bytes = cf_data_to_vec(data as CFDataRef);
        CFRelease(data as CFTypeRef);
        String::from_utf8(bytes).unwrap_or_else(|_| "unknown".to_string())
    }

    unsafe fn cf_error_message(error: CFErrorRef) -> String {
        if error.is_null() {
            return "unknown".to_string();
        }
        let description = CFErrorCopyDescription(error);
        let message = cf_string_to_string(description);
        if !description.is_null() {
            CFRelease(description as CFTypeRef);
        }
        CFRelease(error as CFTypeRef);
        message
    }

    unsafe fn os_status_message(status: OSStatus) -> String {
        let message = SecCopyErrorMessageString(status, ptr::null_mut());
        if message.is_null() {
            return "unknown".to_string();
        }
        let text = cf_string_to_string(message);
        CFRelease(message as CFTypeRef);
        text
    }
}

fn current_timestamp_ms() -> u64 {
    use std::time::{SystemTime, UNIX_EPOCH};
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

#[cfg(test)]
mod tests {
    use super::*;
    use p256::ecdsa::{signature::Signer, SigningKey};

    #[test]
    fn verify_quote_accepts_valid_signature() {
        let nonce = b"aethercore-secure-enclave-nonce".to_vec();
        let signing_key = SigningKey::from_bytes((&[7u8; 32]).into()).expect("valid signing key");
        let signature: Signature = signing_key.sign(&nonce);
        let public_key = signing_key
            .verifying_key()
            .to_encoded_point(false)
            .as_bytes()
            .to_vec();

        let quote = SecureEnclaveQuote {
            nonce,
            signature_der: signature.to_der().as_bytes().to_vec(),
            public_key_sec1: public_key,
            key_tag: "com.4mik.test.sep".to_string(),
            timestamp_ms: 1,
        };

        assert!(SecureEnclaveAttestor::verify_quote(&quote).unwrap());
    }

    #[test]
    fn verify_quote_rejects_tampered_nonce() {
        let nonce = b"aethercore-secure-enclave-nonce".to_vec();
        let signing_key = SigningKey::from_bytes((&[9u8; 32]).into()).expect("valid signing key");
        let signature: Signature = signing_key.sign(&nonce);
        let public_key = signing_key
            .verifying_key()
            .to_encoded_point(false)
            .as_bytes()
            .to_vec();

        let mut tampered_nonce = nonce.clone();
        tampered_nonce[0] ^= 0xFF;

        let quote = SecureEnclaveQuote {
            nonce: tampered_nonce,
            signature_der: signature.to_der().as_bytes().to_vec(),
            public_key_sec1: public_key,
            key_tag: "com.4mik.test.sep".to_string(),
            timestamp_ms: 1,
        };

        assert!(!SecureEnclaveAttestor::verify_quote(&quote).unwrap());
    }

    #[test]
    fn non_apple_sign_nonce_is_rejected() {
        if cfg!(any(target_os = "macos", target_os = "ios")) {
            return;
        }

        let attestor = SecureEnclaveAttestor::new("com.4mik.test.sep");
        let result = attestor.sign_nonce(b"test-nonce");
        assert!(result.is_err());
    }
}
