// SecureEnclaveKeyManagerTests.swift
// Unit tests for iOS Secure Enclave Key Manager

import XCTest
@testable import SecureEnclaveKeyManager

final class SecureEnclaveKeyManagerTests: XCTestCase {
    
    // MARK: - Availability Tests
    
    func testIsSupported_ReturnsExpectedValue() {
        #if targetEnvironment(simulator)
        // On simulator, Secure Enclave is never supported
        XCTAssertFalse(SecureEnclaveKeyManager.isSupported(), 
                      "Secure Enclave should not be supported on simulator")
        #else
        // On device, support depends on hardware
        // iPhone 5s and later support Secure Enclave
        let isSupported = SecureEnclaveKeyManager.isSupported()
        print("Secure Enclave support on device: \(isSupported)")
        #endif
    }
    
    // MARK: - Simulator Rejection Tests
    
    func testSignNonce_RejectsSimulator() {
        #if targetEnvironment(simulator)
        let keyManager = SecureEnclaveKeyManager(keyTag: "com.test.sep")
        let nonce = Data("test-nonce".utf8)
        
        XCTAssertThrowsError(try keyManager.signNonce(nonce)) { error in
            guard case SecureEnclaveError.simulatorNotSupported = error else {
                XCTFail("Expected simulatorNotSupported error, got: \(error)")
                return
            }
            XCTAssertTrue(error.localizedDescription.contains("Simulator"), 
                         "Error should mention simulator")
        }
        #else
        // Skip on device - this test is simulator-specific
        #endif
    }
    
    // MARK: - Input Validation Tests
    
    func testSignNonce_RejectsEmptyNonce() {
        #if !targetEnvironment(simulator)
        // Only run on device where SEP is available
        guard SecureEnclaveKeyManager.isSupported() else {
            XCTSkip("Secure Enclave not available on this device")
        }
        
        let keyManager = SecureEnclaveKeyManager(keyTag: "com.test.sep")
        let emptyNonce = Data()
        
        XCTAssertThrowsError(try keyManager.signNonce(emptyNonce)) { error in
            guard case SecureEnclaveError.emptyNonce = error else {
                XCTFail("Expected emptyNonce error, got: \(error)")
                return
            }
        }
        #else
        // Skip on simulator
        #endif
    }
    
    // MARK: - Quote Structure Tests
    
    func testSecureEnclaveQuote_Codable() throws {
        // Test that SecureEnclaveQuote can be encoded/decoded
        let nonce = Data("test-nonce".utf8)
        let signature = Data("test-signature".utf8)
        let publicKey = Data("test-public-key".utf8)
        let keyTag = "com.test.sep"
        let timestamp: UInt64 = 1234567890
        
        let quote = SecureEnclaveQuote(
            nonce: nonce,
            signatureDER: signature,
            publicKeySEC1: publicKey,
            keyTag: keyTag,
            timestampMs: timestamp
        )
        
        // Encode
        let encoder = JSONEncoder()
        let encoded = try encoder.encode(quote)
        
        // Decode
        let decoder = JSONDecoder()
        let decoded = try decoder.decode(SecureEnclaveQuote.self, from: encoded)
        
        XCTAssertEqual(decoded.nonce, nonce)
        XCTAssertEqual(decoded.signatureDER, signature)
        XCTAssertEqual(decoded.publicKeySEC1, publicKey)
        XCTAssertEqual(decoded.keyTag, keyTag)
        XCTAssertEqual(decoded.timestampMs, timestamp)
    }
    
    // MARK: - Error Description Tests
    
    func testSecureEnclaveError_Descriptions() {
        let errors: [SecureEnclaveError] = [
            .simulatorNotSupported,
            .missingEntitlements("test detail"),
            .keyGenerationFailed("test detail"),
            .keyLookupFailed("test detail"),
            .signingFailed("test detail"),
            .publicKeyExportFailed("test detail"),
            .algorithmNotSupported,
            .emptyNonce,
            .secureEnclaveUnavailable("test detail")
        ]
        
        for error in errors {
            let description = error.description
            XCTAssertFalse(description.isEmpty, "Error description should not be empty")
            print("\(error): \(description)")
        }
    }
    
    // MARK: - Key Tag Tests
    
    func testKeyManager_InitializesWithKeyTag() {
        let keyTag = "com.4mik.aethercore.sep"
        let keyManager = SecureEnclaveKeyManager(keyTag: keyTag)
        XCTAssertNotNil(keyManager, "KeyManager should initialize successfully")
    }
    
    // MARK: - Device Tests (Run Only on Physical Device)
    
    func testSignNonce_SucceedsOnDevice() throws {
        #if !targetEnvironment(simulator)
        guard SecureEnclaveKeyManager.isSupported() else {
            XCTSkip("Secure Enclave not available on this device")
        }
        
        // Use deterministic key tag with cleanup
        let keyTag = "com.test.sep.integration"
        
        // Cleanup: Delete any existing test key
        let tagData = keyTag.data(using: .utf8)!
        let deleteQuery: [String: Any] = [
            kSecClass as String: kSecClassKey,
            kSecAttrApplicationTag as String: tagData
        ]
        SecItemDelete(deleteQuery as CFDictionary)
        
        let keyManager = SecureEnclaveKeyManager(keyTag: keyTag)
        let nonce = Data("aethercore-test-nonce".utf8)
        
        let quote = try keyManager.signNonce(nonce)
        
        // Validate quote structure
        XCTAssertEqual(quote.nonce, nonce, "Nonce should match input")
        XCTAssertFalse(quote.signatureDER.isEmpty, "Signature should not be empty")
        XCTAssertFalse(quote.publicKeySEC1.isEmpty, "Public key should not be empty")
        XCTAssertEqual(quote.keyTag, keyTag, "Key tag should match")
        XCTAssertGreaterThan(quote.timestampMs, 0, "Timestamp should be valid")
        
        // Validate public key format (SEC1 uncompressed: 65 bytes)
        XCTAssertEqual(quote.publicKeySEC1.count, 65, 
                      "SEC1 uncompressed public key should be 65 bytes")
        XCTAssertEqual(quote.publicKeySEC1[0], 0x04, 
                      "SEC1 uncompressed key should start with 0x04")
        
        print("✅ Secure Enclave signing successful")
        print("   Key Tag: \(quote.keyTag)")
        print("   Signature Length: \(quote.signatureDER.count) bytes")
        print("   Public Key Length: \(quote.publicKeySEC1.count) bytes")
        print("   Timestamp: \(quote.timestampMs)")
        
        // Cleanup after test
        addTeardownBlock {
            SecItemDelete(deleteQuery as CFDictionary)
        }
        #else
        XCTSkip("This test requires a physical iOS device")
        #endif
    }
    
    func testSignNonce_ReusesPersistentKey() throws {
        #if !targetEnvironment(simulator)
        guard SecureEnclaveKeyManager.isSupported() else {
            XCTSkip("Secure Enclave not available on this device")
        }
        
        // Use deterministic key tag with cleanup
        let keyTag = "com.test.sep.persistent"
        
        // Cleanup: Delete any existing test key
        let tagData = keyTag.data(using: .utf8)!
        let deleteQuery: [String: Any] = [
            kSecClass as String: kSecClassKey,
            kSecAttrApplicationTag as String: tagData
        ]
        SecItemDelete(deleteQuery as CFDictionary)
        
        let keyManager = SecureEnclaveKeyManager(keyTag: keyTag)
        let nonce1 = Data("nonce-1".utf8)
        let nonce2 = Data("nonce-2".utf8)
        
        // First signing creates key
        let quote1 = try keyManager.signNonce(nonce1)
        
        // Second signing should reuse same key (same public key)
        let quote2 = try keyManager.signNonce(nonce2)
        
        XCTAssertEqual(quote1.publicKeySEC1, quote2.publicKeySEC1, 
                      "Public key should be identical across signings")
        XCTAssertNotEqual(quote1.signatureDER, quote2.signatureDER, 
                         "Signatures should differ for different nonces")
        
        print("✅ Persistent key reuse validated")
        print("   Same public key: \(quote1.publicKeySEC1 == quote2.publicKeySEC1)")
        
        // Cleanup after test
        addTeardownBlock {
            SecItemDelete(deleteQuery as CFDictionary)
        }
        #else
        XCTSkip("This test requires a physical iOS device")
        #endif
    }
}
