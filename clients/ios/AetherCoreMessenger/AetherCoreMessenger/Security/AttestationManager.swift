//
// AttestationManager.swift
// AetherCoreMessenger
//
// AetherCore iOS Client - AppAttest Hardware Attestation
// Classification: CRITICAL
// Purpose: iOS App Attest integration for hardware-backed device attestation
//
// Security Policy:
// - DCAppAttestService mandatory (fail-visible if unsupported)
// - AppAttest key generated using deviceFingerprint SHA-256 as clientDataHash
// - CBOR attestation object returned as base64
// - No degraded modes or silent fallbacks
//
// Alignment with AetherCore SECURITY.md:
// ✅ Hardware attestation mandatory for production
// ✅ Fail-Visible on missing attestation capability
// ✅ SHA-256 challenge for P-256 Secure Enclave alignment

import Foundation
import DeviceCheck
import CryptoKit

enum AttestationError: Error, CustomStringConvertible {
    case attestationNotSupported
    case keyGenerationFailed(Error)
    case attestationFailed(Error)
    case invalidChallenge
    
    var description: String {
        switch self {
        case .attestationNotSupported:
            return "❌ FAIL-VISIBLE: App Attest not supported on this device"
        case .keyGenerationFailed(let error):
            return "❌ FAIL-VISIBLE: AppAttest key generation failed: \(error.localizedDescription)"
        case .attestationFailed(let error):
            return "❌ FAIL-VISIBLE: AppAttest attestation failed: \(error.localizedDescription)"
        case .invalidChallenge:
            return "❌ FAIL-VISIBLE: Invalid challenge data for attestation"
        }
    }
}

/// Result of AppAttest attestation operation
struct AttestationResult {
    /// AppAttest key identifier (persistent reference)
    let keyID: String
    
    /// Base64-encoded CBOR attestation object
    let attestationObject: String
    
    /// Challenge used for attestation (SHA-256 of device fingerprint)
    let challenge: Data
    
    /// Device fingerprint used as attestation challenge
    let deviceFingerprint: String
}

/// Manager for iOS App Attest hardware attestation
class AttestationManager {
    
    // MARK: - Properties
    
    /// DCAppAttestService singleton
    private let service = DCAppAttestService.shared
    
    // MARK: - Initialization
    
    init() {
        // Fail-Visible: Enforce App Attest support at initialization
        guard service.isSupported else {
            fatalError("""
                ❌ FAIL-VISIBLE: App Attest not supported
                
                This device does not support DCAppAttestService.
                AetherCore requires hardware attestation for trust establishment.
                
                Requirements:
                - iOS 14.0+ on physical device
                - App Attest capability enabled
                - No simulator or jailbroken devices
                """)
        }
        
        print("✅ AttestationManager initialized - App Attest supported")
    }
    
    // MARK: - Attestation Operations
    
    /// Generate AppAttest key and produce attestation object
    /// - Parameter deviceFingerprint: Device fingerprint (SHA-256 of public key) used as challenge
    /// - Returns: Attestation result with key ID and CBOR attestation object
    /// - Throws: AttestationError if attestation fails
    func generateAttestation(deviceFingerprint: String) async throws -> AttestationResult {
        // Validate challenge (device fingerprint)
        guard !deviceFingerprint.isEmpty else {
            throw AttestationError.invalidChallenge
        }
        
        print("ℹ️ Generating AppAttest key for device fingerprint: \(deviceFingerprint)")
        
        // Step 1: Generate AppAttest key
        let keyID: String
        do {
            keyID = try await service.generateKey()
            print("✅ AppAttest key generated: \(keyID)")
        } catch {
            throw AttestationError.keyGenerationFailed(error)
        }
        
        // Step 2: Prepare challenge (SHA-256 of device fingerprint)
        // Use device fingerprint directly as challenge data
        // This binds the attestation to the Secure Enclave key identity
        let challengeData = Data(deviceFingerprint.utf8)
        let challenge = SHA256.hash(data: challengeData)
        let challengeBytes = Data(challenge)
        
        print("ℹ️ Challenge prepared: SHA-256 of device fingerprint")
        
        // Step 3: Request attestation with challenge
        let attestationObject: Data
        do {
            attestationObject = try await service.attestKey(keyID, clientDataHash: challengeBytes)
            print("✅ AppAttest attestation successful - CBOR object size: \(attestationObject.count) bytes")
        } catch {
            throw AttestationError.attestationFailed(error)
        }
        
        // Step 4: Return attestation result
        let result = AttestationResult(
            keyID: keyID,
            attestationObject: attestationObject.base64EncodedString(),
            challenge: challengeBytes,
            deviceFingerprint: deviceFingerprint
        )
        
        print("✅ Attestation completed successfully")
        return result
    }
    
    // MARK: - Assertion Generation
    
    /// Generate assertion for client request (future use for API authentication)
    /// - Parameters:
    ///   - keyID: AppAttest key identifier
    ///   - clientData: Client data to assert
    /// - Returns: Base64-encoded assertion object
    /// - Throws: AttestationError if assertion fails
    func generateAssertion(keyID: String, clientData: Data) async throws -> String {
        // Hash client data (SHA-256 required by App Attest)
        let clientDataHash = SHA256.hash(data: clientData)
        let clientDataHashBytes = Data(clientDataHash)
        
        do {
            let assertion = try await service.generateAssertion(keyID, clientDataHash: clientDataHashBytes)
            print("✅ AppAttest assertion generated - size: \(assertion.count) bytes")
            return assertion.base64EncodedString()
        } catch {
            throw AttestationError.attestationFailed(error)
        }
    }
}
