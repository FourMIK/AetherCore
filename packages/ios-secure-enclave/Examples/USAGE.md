# iOS Secure Enclave Examples

## Basic Usage Example

```swift
import Foundation
import SecureEnclaveKeyManager

// Initialize the key manager with a deterministic tag
let keyTag = "com.4mik.aethercore.sep"
let keyManager = SecureEnclaveKeyManager(keyTag: keyTag)

// Check availability before use
guard SecureEnclaveKeyManager.isSupported() else {
    fatalError("Secure Enclave not available on this device")
}

// Sign a nonce
let nonce = Data("aethercore-challenge-\(UUID().uuidString)".utf8)

do {
    let quote = try keyManager.signNonce(nonce)
    
    print("✅ Secure Enclave attestation successful")
    print("Key Tag: \(quote.keyTag)")
    print("Nonce: \(quote.nonce.base64EncodedString())")
    print("Signature: \(quote.signatureDER.base64EncodedString())")
    print("Public Key: \(quote.publicKeySEC1.base64EncodedString())")
    print("Timestamp: \(quote.timestampMs)")
    
} catch SecureEnclaveError.simulatorNotSupported {
    print("❌ Cannot run on simulator - deploy to device")
} catch SecureEnclaveError.missingEntitlements(let detail) {
    print("❌ Entitlements error: \(detail)")
} catch {
    print("❌ Unexpected error: \(error)")
}
```

## Integration with Backend

```swift
import Foundation
import SecureEnclaveKeyManager

class AetherCoreIdentityProvider {
    private let keyManager: SecureEnclaveKeyManager
    private let backendURL: URL
    
    init(keyTag: String, backendURL: URL) {
        self.keyManager = SecureEnclaveKeyManager(keyTag: keyTag)
        self.backendURL = backendURL
    }
    
    /// Attest device identity to backend using Secure Enclave
    func attestIdentity(completion: @escaping (Result<String, Error>) -> Void) {
        // Request challenge from backend
        fetchChallenge { [weak self] result in
            guard let self = self else { return }
            
            switch result {
            case .success(let nonce):
                // Sign nonce with Secure Enclave
                do {
                    let quote = try self.keyManager.signNonce(nonce)
                    
                    // Send attestation to backend
                    self.submitAttestation(quote: quote, completion: completion)
                    
                } catch {
                    completion(.failure(error))
                }
                
            case .failure(let error):
                completion(.failure(error))
            }
        }
    }
    
    private func fetchChallenge(completion: @escaping (Result<Data, Error>) -> Void) {
        let url = backendURL.appendingPathComponent("identity/challenge")
        
        URLSession.shared.dataTask(with: url) { data, response, error in
            if let error = error {
                completion(.failure(error))
                return
            }
            
            guard let data = data else {
                completion(.failure(NSError(domain: "AetherCore", code: -1)))
                return
            }
            
            // Parse nonce from response
            if let json = try? JSONSerialization.jsonObject(with: data) as? [String: String],
               let nonceBase64 = json["nonce"],
               let nonce = Data(base64Encoded: nonceBase64) {
                completion(.success(nonce))
            } else {
                completion(.failure(NSError(domain: "AetherCore", code: -2)))
            }
        }.resume()
    }
    
    private func submitAttestation(quote: SecureEnclaveQuote, completion: @escaping (Result<String, Error>) -> Void) {
        let url = backendURL.appendingPathComponent("identity/attest")
        
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        
        let payload: [String: Any] = [
            "nonce": quote.nonce.base64EncodedString(),
            "signature": quote.signatureDER.base64EncodedString(),
            "public_key": quote.publicKeySEC1.base64EncodedString(),
            "key_tag": quote.keyTag,
            "timestamp_ms": quote.timestampMs
        ]
        
        request.httpBody = try? JSONSerialization.data(withJSONObject: payload)
        
        URLSession.shared.dataTask(with: request) { data, response, error in
            if let error = error {
                completion(.failure(error))
                return
            }
            
            guard let data = data,
                  let json = try? JSONSerialization.jsonObject(with: data) as? [String: String],
                  let token = json["identity_token"] else {
                completion(.failure(NSError(domain: "AetherCore", code: -3)))
                return
            }
            
            completion(.success(token))
        }.resume()
    }
}

// Usage
let provider = AetherCoreIdentityProvider(
    keyTag: "com.4mik.aethercore.sep",
    backendURL: URL(string: "https://c2.example.com")!
)

provider.attestIdentity { result in
    switch result {
    case .success(let token):
        print("✅ Identity attested, token: \(token)")
    case .failure(let error):
        print("❌ Attestation failed: \(error)")
    }
}
```

## See Also

- [Secure Enclave Documentation](../../docs/ios/SECURE_ENCLAVE.md)
- [Build Guide](../../docs/ios/BUILD.md)
- [Rust Implementation](../../../crates/identity/src/secure_enclave.rs)
