//
// GenesisBundle.swift
// AetherCoreMessenger
//
// AetherCore iOS Client - Genesis Bundle for Device Registration
// Purpose: Device identity attestation bundle for gateway enrollment
//
// Genesis Bundle Structure:
// - Public key (DER format) - Secure Enclave P-256 public key
// - Key tag - Deterministic keychain identifier for key persistence
// - Device fingerprint (SHA-256 of public key)
// - Attestation payload - Base64-encoded CBOR attestation object from App Attest
// - App Attest key ID - Persistent identifier for attestation key
// - Timestamp (ISO 8601)
//
// Attestation Policy:
// Mandatory App Attest integration (DCAppAttestService) for hardware-backed attestation.
// Attestation payload is non-nil and contains CBOR attestation object.
// See: https://developer.apple.com/documentation/devicecheck

import Foundation

struct GenesisBundle: Codable {
    
    // MARK: - Properties
    
    /// Device public key in DER format (base64 encoded for JSON transport)
    let publicKeyDER: String
    
    /// Keychain key tag for persistent Secure Enclave key
    let keyTag: String
    
    /// Device fingerprint (SHA-256 hex of public key)
    let deviceFingerprint: String
    
    /// Attestation payload - Base64-encoded CBOR attestation object (non-nil)
    /// Generated via DCAppAttestService with deviceFingerprint as challenge
    let attestationPayload: String
    
    /// App Attest key identifier for attestation key persistence
    let appAttestKeyID: String
    
    /// Bundle creation timestamp (ISO 8601)
    let timestamp: String
    
    /// Bundle format version
    let version: String
    
    // MARK: - Initialization
    
    /// Create a genesis bundle from device identity with attestation
    /// - Parameters:
    ///   - identity: Device identity with Secure Enclave key
    ///   - attestationResult: App Attest attestation result
    /// - Throws: Error if public key export fails
    init(identity: DeviceIdentity, attestationResult: AttestationResult) throws {
        // Export public key
        let publicKeyData = try identity.getPublicKeyDER()
        self.publicKeyDER = publicKeyData.base64EncodedString()
        
        // Keychain key tag for key persistence
        self.keyTag = "mil.fourmik.aethercore.secureenclave.key"
        
        // Copy device fingerprint
        self.deviceFingerprint = identity.deviceFingerprint
        
        // Attestation payload: Base64-encoded CBOR attestation object (non-nil)
        self.attestationPayload = attestationResult.attestationObject
        
        // App Attest key ID for key persistence
        self.appAttestKeyID = attestationResult.keyID
        
        // ISO 8601 timestamp
        let formatter = ISO8601DateFormatter()
        self.timestamp = formatter.string(from: Date())
        
        // Version
        self.version = "0.1.0"
        
        print("✅ GenesisBundle created with attestation - keyID: \(appAttestKeyID)")
    }
    
    // MARK: - Serialization
    
    /// Serialize genesis bundle to JSON
    /// - Returns: JSON data
    /// - Throws: EncodingError if serialization fails
    func toJSON() throws -> Data {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
        return try encoder.encode(self)
    }
    
    /// Serialize genesis bundle to JSON string
    /// - Returns: JSON string
    /// - Throws: EncodingError if serialization fails
    func toJSONString() throws -> String {
        let data = try toJSON()
        guard let jsonString = String(data: data, encoding: .utf8) else {
            throw GenesisError.serializationFailed
        }
        return jsonString
    }
    
    /// Create genesis bundle from JSON data
    /// - Parameter data: JSON data
    /// - Returns: Parsed genesis bundle
    /// - Throws: DecodingError if parsing fails
    static func fromJSON(_ data: Data) throws -> GenesisBundle {
        let decoder = JSONDecoder()
        return try decoder.decode(GenesisBundle.self, from: data)
    }
}

// MARK: - Genesis Bundle Errors

enum GenesisError: Error, CustomStringConvertible {
    case serializationFailed
    
    var description: String {
        switch self {
        case .serializationFailed:
            return "Failed to serialize genesis bundle"
        }
    }
}
