//
// OverlaySigningKeyManager.swift
// AetherCoreMessenger
//
// Purpose: Persisted Ed25519 signing key for limited-release iOS overlay presence.
// Security: Key material is stored in Keychain (ThisDeviceOnly), never synced.
//

import Foundation
import Security
import CryptoKit

enum OverlaySigningKeyError: Error, CustomStringConvertible {
    case invalidKeyMaterial
    case keychainStoreFailed(OSStatus)
    case keychainLoadFailed(OSStatus)
    case keychainDeleteFailed(OSStatus)
    case utf8EncodingFailed

    var description: String {
        switch self {
        case .invalidKeyMaterial:
            return "Invalid Ed25519 key material"
        case .keychainStoreFailed(let status):
            return "Keychain store failed: OSStatus \(status)"
        case .keychainLoadFailed(let status):
            return "Keychain load failed: OSStatus \(status)"
        case .keychainDeleteFailed(let status):
            return "Keychain delete failed: OSStatus \(status)"
        case .utf8EncodingFailed:
            return "UTF-8 encoding failed"
        }
    }
}

final class OverlaySigningKeyManager {
    private static let keychainService = "mil.fourmik.aethercore.overlay"
    private static let keychainAccount = "presence_signing_ed25519_private_key"

    func signHex(data: Data) throws -> String {
        let key = try loadOrCreateSigningKey()
        let signature = try key.signature(for: data)
        return signature.hexEncodedString()
    }

    func publicKeyPEM() throws -> String {
        let key = try loadOrCreateSigningKey()
        let rawPublicKey = key.publicKey.rawRepresentation

        // SubjectPublicKeyInfo prefix for Ed25519 public keys.
        let spkiPrefix = Data([0x30, 0x2a, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x03, 0x21, 0x00])
        let der = spkiPrefix + rawPublicKey
        let base64 = der.base64EncodedString()
        let body = stride(from: 0, to: base64.count, by: 64).map { index -> String in
            let start = base64.index(base64.startIndex, offsetBy: index)
            let end = base64.index(start, offsetBy: min(64, base64.count - index), limitedBy: base64.endIndex) ?? base64.endIndex
            return String(base64[start..<end])
        }.joined(separator: "\n")

        return "-----BEGIN PUBLIC KEY-----\n\(body)\n-----END PUBLIC KEY-----"
    }

    func certificateSerial() throws -> String {
        let key = try loadOrCreateSigningKey()
        let digest = SHA256.hash(data: key.publicKey.rawRepresentation)
        let hex = digest.hexEncodedString()
        // Keep serial compact but deterministic.
        return String(hex.prefix(32))
    }

    private func loadOrCreateSigningKey() throws -> Curve25519.Signing.PrivateKey {
        if let keyData = try loadPrivateKeyData() {
            guard keyData.count == 32 else {
                try deletePrivateKeyData()
                throw OverlaySigningKeyError.invalidKeyMaterial
            }
            return try Curve25519.Signing.PrivateKey(rawRepresentation: keyData)
        }

        let key = Curve25519.Signing.PrivateKey()
        try storePrivateKeyData(key.rawRepresentation)
        return key
    }

    private func storePrivateKeyData(_ data: Data) throws {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: Self.keychainService,
            kSecAttrAccount as String: Self.keychainAccount,
            kSecValueData as String: data,
            kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly,
            kSecAttrSynchronizable as String: false
        ]

        SecItemDelete(query as CFDictionary)
        let status = SecItemAdd(query as CFDictionary, nil)
        guard status == errSecSuccess else {
            throw OverlaySigningKeyError.keychainStoreFailed(status)
        }
    }

    private func loadPrivateKeyData() throws -> Data? {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: Self.keychainService,
            kSecAttrAccount as String: Self.keychainAccount,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne
        ]

        var item: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &item)
        if status == errSecItemNotFound {
            return nil
        }
        guard status == errSecSuccess else {
            throw OverlaySigningKeyError.keychainLoadFailed(status)
        }
        return item as? Data
    }

    private func deletePrivateKeyData() throws {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: Self.keychainService,
            kSecAttrAccount as String: Self.keychainAccount
        ]
        let status = SecItemDelete(query as CFDictionary)
        guard status == errSecSuccess || status == errSecItemNotFound else {
            throw OverlaySigningKeyError.keychainDeleteFailed(status)
        }
    }
}

private extension Data {
    func hexEncodedString() -> String {
        map { String(format: "%02x", $0) }.joined()
    }
}

private extension SHA256Digest {
    func hexEncodedString() -> String {
        map { String(format: "%02x", $0) }.joined()
    }
}

