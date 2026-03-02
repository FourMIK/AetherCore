//
// GatewayClient.swift
// AetherCoreMessenger
//
// AetherCore iOS Client - Gateway Enrollment
// Classification: CRITICAL
// Purpose: Device enrollment with hardware attestation and challenge-response authentication
//
// Enrollment Flow:
// 1. Build GenesisBundle with App Attest attestation
// 2. POST to gateway /enroll endpoint
// 3. Receive challenge nonce from gateway
// 4. Sign challenge with Secure Enclave key via DeviceIdentity.sign()
// 5. POST signed challenge response
// 6. Store access token in Keychain (secure, non-synced)
//
// Security Policy:
// - Fail-Visible on missing challenge or Keychain failures
// - Access token stored with accessibleAfterFirstUnlockThisDeviceOnly
// - No iCloud Keychain sync (this device only)
// - Challenge must be present or fatalError

import Foundation
import Security

enum GatewayError: Error, CustomStringConvertible {
    case networkError(Error)
    case invalidResponse
    case missingChallenge
    case challengeSigningFailed(Error)
    case keychainStoreFailed(OSStatus)
    case serializationFailed(Error)
    case httpError(statusCode: Int, message: String?)
    
    var description: String {
        switch self {
        case .networkError(let error):
            return "Network error: \(error.localizedDescription)"
        case .invalidResponse:
            return "Invalid response from gateway"
        case .missingChallenge:
            return "❌ FAIL-VISIBLE: Gateway challenge missing - enrollment cannot proceed"
        case .challengeSigningFailed(let error):
            return "❌ FAIL-VISIBLE: Challenge signing failed: \(error.localizedDescription)"
        case .keychainStoreFailed(let status):
            return "❌ FAIL-VISIBLE: Keychain storage failed: OSStatus \(status)"
        case .serializationFailed(let error):
            return "Serialization error: \(error.localizedDescription)"
        case .httpError(let statusCode, let message):
            if let message = message {
                return "HTTP error \(statusCode): \(message)"
            } else {
                return "HTTP error \(statusCode)"
            }
        }
    }
}

/// Result of enrollment operation
struct EnrollmentResult {
    /// Access token for authenticated API requests
    let accessToken: String
    
    /// Node ID assigned by gateway
    let nodeID: String
    
    /// Enrollment timestamp
    let enrolledAt: String
    
    /// Gateway-assigned trust score
    let trustScore: Double
}

/// Gateway client for device enrollment
class GatewayClient {
    
    // MARK: - Properties
    
    /// Gateway base URL (configurable for testing)
    private let gatewayURL: URL
    
    /// Keychain service identifier for access token
    private static let keychainService = "mil.fourmik.aethercore.gateway"
    private static let keychainAccount = "access_token"
    
    // MARK: - Initialization
    
    /// Initialize gateway client
    /// - Parameter gatewayURL: Gateway base URL (default: production endpoint)
    init(gatewayURL: URL = URL(string: "https://gateway.aethercore.mil")!) {
        self.gatewayURL = gatewayURL
        print("✅ GatewayClient initialized - endpoint: \(gatewayURL)")
    }
    
    // MARK: - Enrollment
    
    /// Enroll device with gateway using hardware attestation
    /// - Parameter identity: Device identity with Secure Enclave key
    /// - Returns: Enrollment result with access token
    /// - Throws: GatewayError if enrollment fails
    func enrollNode(identity: DeviceIdentity) async throws -> EnrollmentResult {
        print("ℹ️ Starting gateway enrollment for device: \(identity.deviceFingerprint)")
        
        // Step 1: Generate App Attest attestation
        let attestationManager = AttestationManager()
        let attestationResult: AttestationResult
        do {
            attestationResult = try await attestationManager.generateAttestation(
                deviceFingerprint: identity.deviceFingerprint
            )
            print("✅ Attestation generated successfully")
        } catch {
            throw GatewayError.networkError(error)
        }
        
        // Step 2: Build GenesisBundle with attestation
        let genesisBundle: GenesisBundle
        do {
            genesisBundle = try GenesisBundle(
                identity: identity,
                attestationResult: attestationResult
            )
            print("✅ GenesisBundle created with attestation")
        } catch {
            throw GatewayError.serializationFailed(error)
        }
        
        // Step 3: POST to /enroll endpoint
        let enrollURL = gatewayURL.appendingPathComponent("enroll")
        var request = URLRequest(url: enrollURL)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        
        do {
            request.httpBody = try genesisBundle.toJSON()
        } catch {
            throw GatewayError.serializationFailed(error)
        }
        
        print("ℹ️ Sending enrollment request to: \(enrollURL)")
        
        // Send enrollment request
        let (data, response): (Data, URLResponse)
        do {
            (data, response) = try await URLSession.shared.data(for: request)
        } catch {
            throw GatewayError.networkError(error)
        }
        
        // Validate HTTP response
        guard let httpResponse = response as? HTTPURLResponse else {
            throw GatewayError.invalidResponse
        }
        
        guard httpResponse.statusCode == 200 else {
            let errorMessage = String(data: data, encoding: .utf8)
            throw GatewayError.httpError(statusCode: httpResponse.statusCode, message: errorMessage)
        }
        
        // Step 4: Parse challenge response
        let challengeResponse: ChallengeResponse
        do {
            challengeResponse = try JSONDecoder().decode(ChallengeResponse.self, from: data)
            print("✅ Challenge received from gateway")
        } catch {
            throw GatewayError.serializationFailed(error)
        }
        
        // Fail-Visible: Challenge must be present
        guard let challengeNonce = challengeResponse.challenge else {
            fatalError("""
                ❌ FAIL-VISIBLE: Gateway challenge missing
                
                Enrollment requires challenge-response authentication.
                Gateway response does not contain challenge nonce.
                
                This indicates a protocol violation or gateway misconfiguration.
                Enrollment cannot proceed without cryptographic challenge.
                """)
        }
        
        // Step 5: Sign challenge with Secure Enclave key
        guard let challengeData = Data(base64Encoded: challengeNonce) else {
            throw GatewayError.invalidResponse
        }
        
        print("ℹ️ Signing challenge with Secure Enclave key")
        
        let signature: Data
        do {
            signature = try identity.sign(data: challengeData)
            print("✅ Challenge signed successfully")
        } catch {
            fatalError("""
                ❌ FAIL-VISIBLE: Challenge signing failed
                
                Failed to sign gateway challenge with Secure Enclave key.
                Error: \(error.localizedDescription)
                
                This indicates a critical security failure.
                Enrollment cannot proceed without valid signature.
                """)
        }
        
        // Step 6: POST signed challenge
        let challengeResponseData = ChallengeSignedResponse(
            deviceFingerprint: identity.deviceFingerprint,
            signature: signature.base64EncodedString()
        )
        
        let signedChallengeURL = gatewayURL.appendingPathComponent("enroll/challenge")
        var signedRequest = URLRequest(url: signedChallengeURL)
        signedRequest.httpMethod = "POST"
        signedRequest.setValue("application/json", forHTTPHeaderField: "Content-Type")
        
        do {
            let encoder = JSONEncoder()
            signedRequest.httpBody = try encoder.encode(challengeResponseData)
        } catch {
            throw GatewayError.serializationFailed(error)
        }
        
        print("ℹ️ Sending signed challenge response")
        
        // Send signed challenge
        let (signedData, signedResponse): (Data, URLResponse)
        do {
            (signedData, signedResponse) = try await URLSession.shared.data(for: signedRequest)
        } catch {
            throw GatewayError.networkError(error)
        }
        
        // Validate signed challenge response
        guard let signedHttpResponse = signedResponse as? HTTPURLResponse else {
            throw GatewayError.invalidResponse
        }
        
        guard signedHttpResponse.statusCode == 200 else {
            let errorMessage = String(data: signedData, encoding: .utf8)
            throw GatewayError.httpError(statusCode: signedHttpResponse.statusCode, message: errorMessage)
        }
        
        // Step 7: Parse enrollment result
        let enrollmentResponse: EnrollmentResponse
        do {
            enrollmentResponse = try JSONDecoder().decode(EnrollmentResponse.self, from: signedData)
            print("✅ Enrollment successful - nodeID: \(enrollmentResponse.nodeID)")
        } catch {
            throw GatewayError.serializationFailed(error)
        }
        
        // Step 8: Store access token in Keychain
        try storeAccessToken(enrollmentResponse.accessToken)
        print("✅ Access token stored in Keychain")
        
        // Return enrollment result
        return EnrollmentResult(
            accessToken: enrollmentResponse.accessToken,
            nodeID: enrollmentResponse.nodeID,
            enrolledAt: enrollmentResponse.enrolledAt,
            trustScore: enrollmentResponse.trustScore
        )
    }
    
    // MARK: - Keychain Operations
    
    /// Store access token in Keychain with secure attributes
    /// - Parameter token: Access token to store
    /// - Throws: GatewayError.keychainStoreFailed if storage fails
    private func storeAccessToken(_ token: String) throws {
        guard let tokenData = token.data(using: .utf8) else {
            fatalError("""
                ❌ FAIL-VISIBLE: UTF-8 encoding failed
                
                Failed to encode access token to UTF-8.
                This indicates corrupted token data from gateway.
                Enrollment cannot complete without valid token.
                """)
        }
        
        // Keychain attributes for access token
        // - Generic password item
        // - accessibleAfterFirstUnlockThisDeviceOnly (secure, non-synced)
        // - No iCloud Keychain sync
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: Self.keychainService,
            kSecAttrAccount as String: Self.keychainAccount,
            kSecValueData as String: tokenData,
            kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly,
            kSecAttrSynchronizable as String: false  // Explicitly disable iCloud sync
        ]
        
        // Delete existing token if present
        SecItemDelete(query as CFDictionary)
        
        // Add new token
        let status = SecItemAdd(query as CFDictionary, nil)
        
        // Fail-Visible: Keychain storage failures are critical
        guard status == errSecSuccess else {
            fatalError("""
                ❌ FAIL-VISIBLE: Keychain storage failed
                
                Failed to store access token in Keychain.
                OSStatus: \(status)
                
                This indicates a critical security failure.
                Device may not have passcode set or Keychain is corrupted.
                Enrollment cannot complete without secure token storage.
                """)
        }
    }
    
    /// Retrieve access token from Keychain
    /// - Returns: Access token or nil if not found
    func getAccessToken() -> String? {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: Self.keychainService,
            kSecAttrAccount as String: Self.keychainAccount,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne
        ]
        
        var item: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &item)
        
        guard status == errSecSuccess else {
            return nil
        }
        
        guard let tokenData = item as? Data else {
            return nil
        }
        
        return String(data: tokenData, encoding: .utf8)
    }
    
    /// Delete access token from Keychain (logout/reset)
    func deleteAccessToken() throws {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: Self.keychainService,
            kSecAttrAccount as String: Self.keychainAccount
        ]
        
        let status = SecItemDelete(query as CFDictionary)
        
        guard status == errSecSuccess || status == errSecItemNotFound else {
            throw GatewayError.keychainStoreFailed(status)
        }
        
        print("✅ Access token deleted from Keychain")
    }
}

// MARK: - Response Models

/// Gateway challenge response
private struct ChallengeResponse: Codable {
    let challenge: String?
    let message: String?
}

/// Signed challenge response
private struct ChallengeSignedResponse: Codable {
    let deviceFingerprint: String
    let signature: String
}

/// Enrollment response with access token
private struct EnrollmentResponse: Codable {
    let accessToken: String
    let nodeID: String
    let enrolledAt: String
    let trustScore: Double
}
