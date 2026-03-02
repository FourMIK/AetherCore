//
// DeviceIdentity.swift
// AetherCoreMessenger
//
// AetherCore iOS Client - Device Identity Management
// Purpose: Wrapper for Secure Enclave key manager with stable device fingerprint
//
// Identity Model:
// - Device fingerprint: SHA-256 hex of public key DER (stable identifier)
// - Public key presence check
// - Automatic key generation on first access

import Foundation
import CryptoKit

enum DeviceIdentityError: Error, CustomStringConvertible {
    case keyManagerError(SecureEnclaveError)
    case fingerprintGenerationFailed
    
    var description: String {
        switch self {
        case .keyManagerError(let error):
            return "Key manager error: \(error.description)"
        case .fingerprintGenerationFailed:
            return "Failed to generate device fingerprint"
        }
    }
}

class DeviceIdentity {
    
    // MARK: - Properties
    
    /// Stable device fingerprint (SHA-256 hex of public key DER)
    private(set) var deviceFingerprint: String
    
    /// Public key presence status
    var hasKey: Bool {
        do {
            return try SecureEnclaveKeyManager.keyExists()
        } catch {
            return false
        }
    }
    
    // MARK: - Initialization
    
    /// Initialize device identity with Secure Enclave key
    /// Automatically generates key if not present
    /// - Throws: DeviceIdentityError if initialization fails
    init() throws {
        // Generate Secure Enclave key if needed
        do {
            try SecureEnclaveKeyManager.generateIfNeeded()
        } catch let error as SecureEnclaveError {
            throw DeviceIdentityError.keyManagerError(error)
        }
        
        // Compute stable device fingerprint from public key
        do {
            let publicKeyDER = try SecureEnclaveKeyManager.publicKeyDER()
            self.deviceFingerprint = Self.computeFingerprint(publicKeyDER: publicKeyDER)
        } catch let error as SecureEnclaveError {
            throw DeviceIdentityError.keyManagerError(error)
        } catch {
            throw DeviceIdentityError.fingerprintGenerationFailed
        }
        
        print("✅ Device identity initialized: \(deviceFingerprint)")
    }
    
    // MARK: - Public Key Access
    
    /// Get the public key in DER format
    /// - Returns: Public key DER bytes
    /// - Throws: DeviceIdentityError if export fails
    func getPublicKeyDER() throws -> Data {
        do {
            return try SecureEnclaveKeyManager.publicKeyDER()
        } catch let error as SecureEnclaveError {
            throw DeviceIdentityError.keyManagerError(error)
        }
    }
    
    /// Get the public key as base64 string
    /// - Returns: Base64-encoded public key
    /// - Throws: DeviceIdentityError if export fails
    func getPublicKeyBase64() throws -> String {
        let publicKeyDER = try getPublicKeyDER()
        return publicKeyDER.base64EncodedString()
    }
    
    // MARK: - Signing Operations
    
    /// Sign data using the Secure Enclave private key
    /// - Parameter data: Data to sign
    /// - Returns: Signature bytes
    /// - Throws: DeviceIdentityError if signing fails
    func sign(data: Data) throws -> Data {
        do {
            return try SecureEnclaveKeyManager.sign(data: data)
        } catch let error as SecureEnclaveError {
            throw DeviceIdentityError.keyManagerError(error)
        }
    }
    
    // MARK: - Fingerprint Computation
    
    /// Compute SHA-256 fingerprint of public key DER
    /// - Parameter publicKeyDER: Public key in DER format
    /// - Returns: Hex string of SHA-256 hash
    private static func computeFingerprint(publicKeyDER: Data) -> String {
        // Note: SHA-256 used for P-256 public key fingerprinting
        // Rationale: iOS Secure Enclave mandates P-256 curve (not Ed25519)
        // Using SHA-256 maintains consistency with P-256 ecosystem conventions
        // AetherCore standard is BLAKE3, but P-256 SEP constraint requires SHA-256 alignment
        let hash = SHA256.hash(data: publicKeyDER)
        return hash.map { String(format: "%02x", $0) }.joined()
    }
    
    // MARK: - Key Reset
    
    /// Reset device identity by deleting Secure Enclave key
    /// - Throws: DeviceIdentityError if deletion fails
    /// - Warning: This operation is irreversible
    func reset() throws {
        do {
            try SecureEnclaveKeyManager.deleteKey()
            print("✅ Device identity reset - key deleted")
        } catch let error as SecureEnclaveError {
            throw DeviceIdentityError.keyManagerError(error)
        }
    }
}
