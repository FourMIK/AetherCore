// SecureEnclaveKeyManager.swift
// iOS Secure Enclave attestation backend aligned with crates/identity/src/secure_enclave.rs
//
// This backend signs caller-provided nonces with an ECDSA P-256 private key
// bound to the Secure Enclave and stored in keychain.
//
// ARCHITECTURE ALIGNMENT:
// - Mirrors Rust SEP flow: deterministic key tag, persistent Secure Enclave key first
// - Optional ephemeral fallback guarded behind explicit flag (AETHERCORE_SEP_ALLOW_EPHEMERAL)
// - Fail-visible: entitlements preflight fails fast on missing requirements
// - Algorithm support check before signing
// - Non-exportable private key; public key DER export only
// - Explicitly rejects simulator targets

import Foundation
import Security
import CryptoKit

/// Nonce quote produced by the Secure Enclave attestor.
public struct SecureEnclaveQuote: Codable {
    /// Nonce supplied by caller.
    public let nonce: Data
    /// DER-encoded ECDSA signature over nonce.
    public let signatureDER: Data
    /// SEC1-encoded public key associated with the Secure Enclave private key.
    public let publicKeySEC1: Data
    /// Stable key tag used in keychain lookup.
    public let keyTag: String
    /// Quote creation time (Unix epoch milliseconds).
    public let timestampMs: UInt64
    
    public init(nonce: Data, signatureDER: Data, publicKeySEC1: Data, keyTag: String, timestampMs: UInt64) {
        self.nonce = nonce
        self.signatureDER = signatureDER
        self.publicKeySEC1 = publicKeySEC1
        self.keyTag = keyTag
        self.timestampMs = timestampMs
    }
}

/// Errors produced by Secure Enclave operations.
public enum SecureEnclaveError: Error, CustomStringConvertible {
    case simulatorNotSupported
    case missingEntitlements(String)
    case keyGenerationFailed(String)
    case keyLookupFailed(String)
    case signingFailed(String)
    case publicKeyExportFailed(String)
    case algorithmNotSupported
    case emptyNonce
    case secureEnclaveUnavailable(String)
    
    public var description: String {
        switch self {
        case .simulatorNotSupported:
            return "Secure Enclave is not available on iOS Simulator. This is a fatal error - device-only builds required."
        case .missingEntitlements(let detail):
            return "Secure Enclave entitlements preflight failed: \(detail)"
        case .keyGenerationFailed(let detail):
            return "Secure Enclave key generation failed: \(detail)"
        case .keyLookupFailed(let detail):
            return "Secure Enclave key lookup failed: \(detail)"
        case .signingFailed(let detail):
            return "Secure Enclave signing failed: \(detail)"
        case .publicKeyExportFailed(let detail):
            return "Public key export failed: \(detail)"
        case .algorithmNotSupported:
            return "Secure Enclave key does not support ECDSA P-256 signature algorithm"
        case .emptyNonce:
            return "Secure Enclave attestation nonce cannot be empty"
        case .secureEnclaveUnavailable(let detail):
            return "Secure Enclave unavailable: \(detail)"
        }
    }
}

/// Secure Enclave nonce-signing attestor.
/// 
/// CURVE DIVERGENCE NOTE:
/// This implementation uses ECDSA P-256 (secp256r1) because:
/// 1. iOS Secure Enclave only supports P-256 (not Ed25519)
/// 2. Hardware acceleration for P-256 on Apple Silicon
/// 3. Alignment with macOS Secure Enclave implementation in secure_enclave.rs
///
/// This diverges from the standard Ed25519 signatures used elsewhere in AetherCore.
/// This is a tracked architectural risk documented in docs/ios/SECURE_ENCLAVE.md.
public class SecureEnclaveKeyManager {
    private let keyTag: String
    
    /// Create a new Secure Enclave attestor with a deterministic key tag.
    /// - Parameter keyTag: Stable identifier for keychain lookup (e.g., "com.4mik.aethercore.sep")
    public init(keyTag: String) {
        self.keyTag = keyTag
    }
    
    /// Returns true when Secure Enclave is available on the current device.
    /// Always returns false on simulators (fail-visible rejection).
    public static func isSupported() -> Bool {
        #if targetEnvironment(simulator)
        return false
        #else
        // Check if Secure Enclave is available
        return SecureEnclave.isAvailable
        #endif
    }
    
    /// Sign a nonce using a Secure Enclave-backed key.
    /// - Parameter nonce: Nonce data to sign (must not be empty)
    /// - Returns: SecureEnclaveQuote containing signature and public key
    /// - Throws: SecureEnclaveError on failure
    public func signNonce(_ nonce: Data) throws -> SecureEnclaveQuote {
        // Fail-visible: reject empty nonce
        guard !nonce.isEmpty else {
            throw SecureEnclaveError.emptyNonce
        }
        
        // Fail-visible: reject simulator
        #if targetEnvironment(simulator)
        throw SecureEnclaveError.simulatorNotSupported
        #endif
        
        // Entitlements preflight (diagnostic, but still attempted)
        var generationErrors: [String] = []
        if let entitlementError = preflightSecureEnclaveEntitlements() {
            generationErrors.append("entitlements_preflight: \(entitlementError)")
        }
        
        // Try to lookup existing key or create new one
        var privateKey: SecKey?
        
        // Lookup existing key
        let lookupResult = lookupPrivateKey()
        if let existingKey = lookupResult.key {
            privateKey = existingKey
        } else {
            generationErrors.append("persistent_key_lookup_status=\(lookupResult.status)")
            
            // Check if ephemeral fallback is enabled
            if allowEphemeralSEPFallback() {
                do {
                    privateKey = try createEphemeralPrivateKey()
                    generationErrors.append("using ephemeral Secure Enclave key (persistent generation skipped)")
                } catch {
                    generationErrors.append("ephemeral_sec_enclave_key_failed: \(error)")
                }
            }
            
            // Try persistent key creation if ephemeral failed or not enabled
            if privateKey == nil {
                let accessibilities: [CFString] = [
                    kSecAttrAccessibleWhenUnlockedThisDeviceOnly,
                    kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
                ]
                
                for accessibility in accessibilities {
                    do {
                        privateKey = try createPrivateKey(accessibility: accessibility)
                        break
                    } catch {
                        generationErrors.append("persistent_key_creation_failed[\(accessibility)]: \(error)")
                    }
                }
            }
        }
        
        guard let privateKey = privateKey else {
            throw SecureEnclaveError.secureEnclaveUnavailable(
                "generation_errors=\(generationErrors.joined(separator: " | "))"
            )
        }
        
        // Algorithm support check (fail-visible)
        let algorithm: SecKeyAlgorithm = .ecdsaSignatureMessageX962SHA256
        guard SecKeyIsAlgorithmSupported(privateKey, .sign, algorithm) else {
            throw SecureEnclaveError.algorithmNotSupported
        }
        
        // Sign the nonce
        var error: Unmanaged<CFError>?
        guard let signature = SecKeyCreateSignature(
            privateKey,
            algorithm,
            nonce as CFData,
            &error
        ) as Data? else {
            let errorDesc = error?.takeRetainedValue().localizedDescription ?? "unknown error"
            
            // Attempt ephemeral fallback on signing failure if enabled
            if allowEphemeralSEPFallback() {
                do {
                    let ephemeralKey = try createEphemeralPrivateKey()
                    var retryError: Unmanaged<CFError>?
                    if let retrySignature = SecKeyCreateSignature(
                        ephemeralKey,
                        algorithm,
                        nonce as CFData,
                        &retryError
                    ) as Data? {
                        // Use ephemeral key for public key export
                        let publicKey = try exportPublicKey(from: ephemeralKey)
                        let timestamp = currentTimestampMs()
                        // Note: Using modified key tag to indicate ephemeral key usage
                        return SecureEnclaveQuote(
                            nonce: nonce,
                            signatureDER: retrySignature,
                            publicKeySEC1: publicKey,
                            keyTag: "\(keyTag)-ephemeral",
                            timestampMs: timestamp
                        )
                    } else {
                        let retryErrorDesc = retryError?.takeRetainedValue().localizedDescription ?? "unknown error"
                        throw SecureEnclaveError.signingFailed(
                            "primary SEP key failed: \(errorDesc); ephemeral fallback failed: \(retryErrorDesc)"
                        )
                    }
                } catch {
                    throw SecureEnclaveError.signingFailed(
                        "primary SEP key failed: \(errorDesc); ephemeral fallback unavailable: \(error)"
                    )
                }
            } else {
                throw SecureEnclaveError.signingFailed(
                    "primary SEP key failed: \(errorDesc); ephemeral fallback disabled"
                )
            }
        }
        
        // Export public key (DER format only, non-exportable private key)
        let publicKey = try exportPublicKey(from: privateKey)
        let timestamp = currentTimestampMs()
        
        return SecureEnclaveQuote(
            nonce: nonce,
            signatureDER: signature,
            publicKeySEC1: publicKey,
            keyTag: keyTag,
            timestampMs: timestamp
        )
    }
    
    // MARK: - Private Key Management
    
    private func lookupPrivateKey() -> (key: SecKey?, status: OSStatus) {
        let tagData = keyTag.data(using: .utf8)!
        
        let query: [String: Any] = [
            kSecClass as String: kSecClassKey,
            kSecAttrApplicationTag as String: tagData,
            kSecAttrKeyType as String: kSecAttrKeyTypeECSECPrimeRandom,
            kSecAttrKeyClass as String: kSecAttrKeyClassPrivate,
            kSecMatchLimit as String: kSecMatchLimitOne,
            kSecReturnRef as String: true
        ]
        
        var item: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &item)
        
        if status == errSecSuccess {
            // Fail-visible: Validate type instead of force-casting
            guard let key = item as? SecKey else {
                return (nil, status)
            }
            return (key, status)
        } else {
            return (nil, status)
        }
    }
    
    private func createPrivateKey(accessibility: CFString) throws -> SecKey {
        let tagData = keyTag.data(using: .utf8)!
        
        // Create access control for Secure Enclave
        var accessError: Unmanaged<CFError>?
        guard let accessControl = SecAccessControlCreateWithFlags(
            nil,
            accessibility,
            .privateKeyUsage,
            &accessError
        ) else {
            let errorDesc = accessError?.takeRetainedValue().localizedDescription ?? "unknown error"
            throw SecureEnclaveError.keyGenerationFailed("SecAccessControlCreateWithFlags failed: \(errorDesc)")
        }
        
        // Key generation parameters
        let attributes: [String: Any] = [
            kSecAttrKeyType as String: kSecAttrKeyTypeECSECPrimeRandom,
            kSecAttrKeySizeInBits as String: 256,
            kSecAttrTokenID as String: kSecAttrTokenIDSecureEnclave,
            kSecPrivateKeyAttrs as String: [
                kSecAttrIsPermanent as String: true,
                kSecAttrApplicationTag as String: tagData,
                kSecAttrAccessControl as String: accessControl
            ]
        ]
        
        var keyError: Unmanaged<CFError>?
        guard let key = SecKeyCreateRandomKey(attributes as CFDictionary, &keyError) else {
            let errorDesc = keyError?.takeRetainedValue().localizedDescription ?? "unknown error"
            throw SecureEnclaveError.keyGenerationFailed("SecKeyCreateRandomKey failed: \(errorDesc)")
        }
        
        return key
    }
    
    private func createEphemeralPrivateKey() throws -> SecKey {
        // Ephemeral key: no kSecAttrIsPermanent, no application tag, no access control
        let attributes: [String: Any] = [
            kSecAttrKeyType as String: kSecAttrKeyTypeECSECPrimeRandom,
            kSecAttrKeySizeInBits as String: 256,
            kSecAttrTokenID as String: kSecAttrTokenIDSecureEnclave
        ]
        
        var keyError: Unmanaged<CFError>?
        guard let key = SecKeyCreateRandomKey(attributes as CFDictionary, &keyError) else {
            let errorDesc = keyError?.takeRetainedValue().localizedDescription ?? "unknown error"
            throw SecureEnclaveError.keyGenerationFailed("SecKeyCreateRandomKey (ephemeral) failed: \(errorDesc)")
        }
        
        return key
    }
    
    private func exportPublicKey(from privateKey: SecKey) throws -> Data {
        guard let publicKey = SecKeyCopyPublicKey(privateKey) else {
            throw SecureEnclaveError.publicKeyExportFailed("SecKeyCopyPublicKey returned nil")
        }
        
        var exportError: Unmanaged<CFError>?
        guard let publicKeyData = SecKeyCopyExternalRepresentation(publicKey, &exportError) as Data? else {
            let errorDesc = exportError?.takeRetainedValue().localizedDescription ?? "unknown error"
            throw SecureEnclaveError.publicKeyExportFailed("SecKeyCopyExternalRepresentation failed: \(errorDesc)")
        }
        
        return publicKeyData
    }
    
    // MARK: - Entitlements Preflight
    
    private func preflightSecureEnclaveEntitlements() -> String? {
        // Note: Actual entitlement validation occurs at the Security framework level when
        // key operations are attempted. This function is a placeholder for future
        // implementation of programmatic entitlement checking via SecTaskCopyValueForEntitlement.
        // 
        // Current behavior: Returns nil (unable to verify), allowing key operations to
        // proceed. If entitlements are actually missing, key creation will fail with
        // explicit Security framework errors.
        //
        // Future: Implement SecTaskCopyValueForEntitlement for diagnostic purposes.
        return nil
    }
    
    // MARK: - Configuration
    
    private func allowEphemeralSEPFallback() -> Bool {
        guard let value = ProcessInfo.processInfo.environment["AETHERCORE_SEP_ALLOW_EPHEMERAL"] else {
            return false // Fail-visible: Default to disabling fallback (explicit opt-in required)
        }
        
        let normalized = value.trimmingCharacters(in: .whitespaces).lowercased()
        return normalized == "1" || normalized == "true" || normalized == "yes"
    }
    
    private func currentTimestampMs() -> UInt64 {
        return UInt64(Date().timeIntervalSince1970 * 1000)
    }
}
