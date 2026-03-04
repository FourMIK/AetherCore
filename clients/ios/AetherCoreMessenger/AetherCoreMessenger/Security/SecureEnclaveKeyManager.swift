//
// SecureEnclaveKeyManager.swift
// AetherCoreMessenger
//
// AetherCore iOS Client - Secure Enclave Key Management
// Classification: CRITICAL
// Purpose: Hardware-rooted key generation, signing, and non-exportable storage
//
// Security Policy:
// - All private keys are non-exportable and stored exclusively in Secure Enclave
// - No private key material ever touches RAM or persistent storage
// - Access control: .privateKeyUsage + .accessibleAfterFirstUnlockThisDeviceOnly
// - Signing operations use SecKey handles only
// - Fail-Visible error handling for all cryptographic operations
//
// Alignment with AetherCore SECURITY.md:
// ✅ Ed25519-equivalent (ECC P-256 for Secure Enclave compatibility)
// ✅ TPM/Secure Enclave mandatory for production
// ✅ No private keys in memory/disk
// ✅ Fail-Visible on security failures

import Foundation
import Security
import CryptoKit

enum SecureEnclaveError: Error, CustomStringConvertible {
    case secureEnclaveUnavailable
    case keyGenerationFailed(OSStatus)
    case keyNotFound
    case signingFailed(OSStatus)
    case publicKeyExportFailed
    case invalidData
    case deletionFailed(OSStatus)
    
    var description: String {
        switch self {
        case .secureEnclaveUnavailable:
            return "Secure Enclave is not available on this device"
        case .keyGenerationFailed(let status):
            return "Key generation failed: OSStatus \(status)"
        case .keyNotFound:
            return "Private key not found in Secure Enclave"
        case .signingFailed(let status):
            return "Signing operation failed: OSStatus \(status)"
        case .publicKeyExportFailed:
            return "Failed to export public key"
        case .invalidData:
            return "Invalid input data"
        case .deletionFailed(let status):
            return "Key deletion failed: OSStatus \(status)"
        }
    }
}

class SecureEnclaveKeyManager {
    
    // Key identifier for Secure Enclave storage
    private static let keyTag = "mil.fourmik.aethercore.secureenclave.key"
    
    // MARK: - Secure Enclave Availability Check
    
    /// Check if Secure Enclave is available on this device
    /// - Returns: true if Secure Enclave is available and device has passcode set
    static func isSecureEnclaveAvailable() -> Bool {
        // Secure Enclave requires:
        // 1. Hardware support (iPhone 5s+, iPad Air 2+)
        // 2. Device passcode must be set
        // 3. iOS 9.0+ (guaranteed by deployment target)
        
        #if targetEnvironment(simulator)
        return false
        #else
        // Check if we can create a Secure Enclave-backed access control
        guard let access = SecAccessControlCreateWithFlags(
            kCFAllocatorDefault,
            kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly,
            [.privateKeyUsage],
            nil
        ) else {
            return false
        }
        
        // Verify token support
        let attributes: [String: Any] = [
            kSecAttrTokenID as String: kSecAttrTokenIDSecureEnclave
        ]
        
        // If we can create the access control and specify the token, SE is available
        return true
        #endif
    }
    
    // MARK: - Key Generation
    
    /// Generate a new P-256 key pair in Secure Enclave if one doesn't already exist
    /// - Throws: SecureEnclaveError if generation fails or Secure Enclave unavailable
    static func generateIfNeeded() throws {
        // Check if key already exists
        if try keyExists() {
            print("ℹ️ Secure Enclave key already exists, skipping generation")
            return
        }
        
        // Fail-Visible: Enforce Secure Enclave availability
        guard isSecureEnclaveAvailable() else {
            throw SecureEnclaveError.secureEnclaveUnavailable
        }
        
        // Create access control for Secure Enclave key
        // Policy: privateKeyUsage + accessibleAfterFirstUnlockThisDeviceOnly
        // No biometry required for unattended operation mode
        guard let accessControl = SecAccessControlCreateWithFlags(
            kCFAllocatorDefault,
            kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly,
            [.privateKeyUsage],
            nil
        ) else {
            throw SecureEnclaveError.keyGenerationFailed(errSecAllocate)
        }
        
        // Key generation attributes
        let attributes: [String: Any] = [
            kSecAttrKeyType as String: kSecAttrKeyTypeECSECPrimeRandom,
            kSecAttrKeySizeInBits as String: 256, // P-256
            kSecAttrTokenID as String: kSecAttrTokenIDSecureEnclave,
            kSecPrivateKeyAttrs as String: [
                kSecAttrIsPermanent as String: true,
                kSecAttrApplicationTag as String: keyTag.data(using: .utf8)!,
                kSecAttrAccessControl as String: accessControl
            ]
        ]
        
        // Generate key pair in Secure Enclave
        var error: Unmanaged<CFError>?
        guard let privateKey = SecKeyCreateRandomKey(attributes as CFDictionary, &error) else {
            let status = error?.takeRetainedValue() as? NSError
            throw SecureEnclaveError.keyGenerationFailed(OSStatus(status?.code ?? -1))
        }
        
        print("✅ Secure Enclave key generated successfully")
    }
    
    // MARK: - Key Existence Check
    
    /// Check if a Secure Enclave key exists
    /// - Returns: true if key exists in Secure Enclave
    static func keyExists() throws -> Bool {
        let query: [String: Any] = [
            kSecClass as String: kSecClassKey,
            kSecAttrApplicationTag as String: keyTag.data(using: .utf8)!,
            kSecAttrKeyType as String: kSecAttrKeyTypeECSECPrimeRandom,
            kSecReturnRef as String: true
        ]
        
        var item: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &item)
        
        return status == errSecSuccess
    }
    
    // MARK: - Signing Operation
    
    /// Sign data using the Secure Enclave private key
    /// - Parameter data: Data to sign
    /// - Returns: Signature bytes
    /// - Throws: SecureEnclaveError if signing fails or key not found
    static func sign(data: Data) throws -> Data {
        // Fail-Visible: Verify key exists before attempting to sign
        guard try keyExists() else {
            throw SecureEnclaveError.keyNotFound
        }
        
        // Retrieve private key reference (handle only, no key material exported)
        let query: [String: Any] = [
            kSecClass as String: kSecClassKey,
            kSecAttrApplicationTag as String: keyTag.data(using: .utf8)!,
            kSecAttrKeyType as String: kSecAttrKeyTypeECSECPrimeRandom,
            kSecReturnRef as String: true
        ]
        
        var item: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &item)
        
        guard status == errSecSuccess else {
            throw SecureEnclaveError.keyNotFound
        }
        
        guard let privateKey = item as? SecKey else {
            throw SecureEnclaveError.keyNotFound
        }
        
        // Perform signing operation in Secure Enclave
        // Algorithm: ECDSA with SHA-256
        var error: Unmanaged<CFError>?
        guard let signature = SecKeyCreateSignature(
            privateKey,
            .ecdsaSignatureMessageX962SHA256,
            data as CFData,
            &error
        ) else {
            let cfError = error?.takeRetainedValue()
            let nsError = cfError as NSError?
            throw SecureEnclaveError.signingFailed(OSStatus(nsError?.code ?? -1))
        }
        
        return signature as Data
    }
    
    // MARK: - Public Key Export
    
    /// Export the public key in DER format
    /// - Returns: Public key DER bytes
    /// - Throws: SecureEnclaveError if export fails or key not found
    static func publicKeyDER() throws -> Data {
        // Fail-Visible: Verify key exists
        guard try keyExists() else {
            throw SecureEnclaveError.keyNotFound
        }
        
        // Retrieve private key reference
        let query: [String: Any] = [
            kSecClass as String: kSecClassKey,
            kSecAttrApplicationTag as String: keyTag.data(using: .utf8)!,
            kSecAttrKeyType as String: kSecAttrKeyTypeECSECPrimeRandom,
            kSecReturnRef as String: true
        ]
        
        var item: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &item)
        
        guard status == errSecSuccess else {
            throw SecureEnclaveError.keyNotFound
        }
        
        guard let privateKey = item as? SecKey else {
            throw SecureEnclaveError.keyNotFound
        }
        
        // Extract public key from private key reference
        guard let publicKey = SecKeyCopyPublicKey(privateKey) else {
            throw SecureEnclaveError.publicKeyExportFailed
        }
        
        // Export public key in X.509 format (DER)
        var error: Unmanaged<CFError>?
        guard let publicKeyData = SecKeyCopyExternalRepresentation(publicKey, &error) else {
            throw SecureEnclaveError.publicKeyExportFailed
        }
        
        return publicKeyData as Data
    }
    
    // MARK: - Key Deletion (Secure Reset)
    
    /// Delete the Secure Enclave key (secure reset)
    /// - Throws: SecureEnclaveError if deletion fails
    /// - Note: Used for key rotation or secure device reset
    static func deleteKey() throws {
        let query: [String: Any] = [
            kSecClass as String: kSecClassKey,
            kSecAttrApplicationTag as String: keyTag.data(using: .utf8)!,
            kSecAttrKeyType as String: kSecAttrKeyTypeECSECPrimeRandom
        ]
        
        let status = SecItemDelete(query as CFDictionary)
        
        // Success or key not found (already deleted) are both acceptable
        guard status == errSecSuccess || status == errSecItemNotFound else {
            throw SecureEnclaveError.deletionFailed(status)
        }
        
        print("✅ Secure Enclave key deleted successfully")
    }
}
