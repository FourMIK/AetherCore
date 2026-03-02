# iOS Secure Enclave Integration

## Overview

AetherCore's iOS identity backend uses the **Secure Enclave Processor (SEP)** for hardware-rooted attestation. This document details the entitlements requirements, key policy, fallback behavior, and cryptographic divergence from the standard AetherCore architecture.

## Architecture

### Alignment with Rust Implementation

The iOS Secure Enclave backend (`packages/ios-secure-enclave`) mirrors the macOS implementation in `crates/identity/src/secure_enclave.rs`:

- **Deterministic Key Tags**: Stable keychain identifiers enable key lifecycle management
- **Persistent Keys First**: Prefer keychain-backed SEP keys over ephemeral keys
- **Fail-Visible Errors**: Explicit diagnostics on entitlement, simulator, or key generation failures
- **Algorithm Support Check**: Validate P-256 ECDSA support before signing operations
- **Non-Exportable Private Keys**: Keys never leave the Secure Enclave
- **Public Key Export Only**: Only public keys are exported in SEC1 DER format

### Nonce-Signing Attestation

The iOS backend produces **SecureEnclaveQuote** structures containing:

```swift
struct SecureEnclaveQuote {
    let nonce: Data                  // Caller-supplied challenge
    let signatureDER: Data           // ECDSA P-256 signature (DER-encoded)
    let publicKeySEC1: Data          // Public key (SEC1 uncompressed format)
    let keyTag: String               // Keychain identifier
    let timestampMs: UInt64          // Quote creation time
}
```

## Entitlements Requirements

### Required Entitlements

The following entitlements **must** be present in your app's provisioning profile:

#### 1. Application Identifier
```xml
<key>com.apple.application-identifier</key>
<string>$(AppIdentifierPrefix)$(CFBundleIdentifier)</string>
```
**or**
```xml
<key>application-identifier</key>
<string>$(AppIdentifierPrefix)$(CFBundleIdentifier)</string>
```

#### 2. Keychain Access Groups
```xml
<key>keychain-access-groups</key>
<array>
    <string>$(AppIdentifierPrefix)com.aethercore.*</string>
</array>
```

#### 3. Team Identifier
```xml
<key>com.apple.developer.team-identifier</key>
<string>$(AppIdentifierPrefix)</string>
```

### Entitlements Preflight

The implementation performs an entitlements preflight check at startup:

```swift
func preflightSecureEnclaveEntitlements() -> String? {
    let applicationIdentifier = readEntitlement("com.apple.application-identifier") 
                             ?? readEntitlement("application-identifier")
    let keychainGroups = readEntitlement("keychain-access-groups")
    let teamIdentifier = readEntitlement("com.apple.developer.team-identifier")
    
    if applicationIdentifier == nil && keychainGroups == nil {
        return "missing keychain signing entitlements"
    }
    
    if teamIdentifier == nil {
        return "missing team-identifier entitlement"
    }
    
    return nil
}
```

**Fail-Fast Behavior**: If entitlements are missing, the error is surfaced in:
- Application launch logs
- SecureEnclaveError diagnostic messages
- Key generation failure context

### Provisioning Profile Setup

1. **Development Profile**:
   - Enable "Keychain Sharing" capability (adds keychain-access-groups entitlement)
   - Ensure team identifier is present
   - Sign with development certificate

2. **Distribution Profile**:
   - Same entitlements as development
   - Sign with distribution certificate

3. **Validate Entitlements**:
   ```bash
   codesign -d --entitlements :- YourApp.app
   ```

### Entitlements Enforcement

Entitlement validation occurs at the Security framework level during key operations. Missing entitlements result in:
- Key generation failures (errSecMissingEntitlement)
- Keychain access denied errors
- Fail-Visible error messages in SecureEnclaveError diagnostic context

## Key Policy

### Key Generation Parameters

#### Persistent Keys (Preferred)
```swift
let attributes: [String: Any] = [
    kSecAttrKeyType: kSecAttrKeyTypeECSECPrimeRandom,  // P-256
    kSecAttrKeySizeInBits: 256,
    kSecAttrTokenID: kSecAttrTokenIDSecureEnclave,     // Bind to SEP
    kSecPrivateKeyAttrs: [
        kSecAttrIsPermanent: true,                     // Store in keychain
        kSecAttrApplicationTag: tagData,               // Deterministic tag
        kSecAttrAccessControl: accessControl           // Device unlock required
    ]
]
```

#### Access Control Policy
```swift
let accessControl = SecAccessControlCreateWithFlags(
    nil,
    kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly,  // Preferred
    .privateKeyUsage,                                   // Require auth for signing
    nil
)
```

**Accessibility Levels Tried** (in order):
1. `kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly` (preferred)
2. `kSecAttrAccessibleWhenUnlockedThisDeviceOnly` (fallback)

### Key Lookup

Before creating a new key, the implementation searches keychain for existing keys:

```swift
let query: [String: Any] = [
    kSecClass: kSecClassKey,
    kSecAttrApplicationTag: tagData,
    kSecAttrKeyType: kSecAttrKeyTypeECSECPrimeRandom,
    kSecAttrKeyClass: kSecAttrKeyClassPrivate,
    kSecMatchLimit: kSecMatchLimitOne,
    kSecReturnRef: true
]
```

This enables:
- **Key Reuse**: Same key across app restarts
- **Rotation**: Delete old tag, create new key
- **Diagnostics**: Detect orphaned or stale keys

### Non-Exportable Private Keys

Private keys bound to the Secure Enclave **cannot be exported**. Any attempt to export private key material will fail with `errSecItemNotFound`.

Only **public keys** can be exported:
```swift
let publicKey = SecKeyCopyPublicKey(privateKey)
let publicKeyData = SecKeyCopyExternalRepresentation(publicKey, nil)
// Output: 65-byte SEC1 uncompressed format (0x04 || X || Y)
```

## Fallback Policy

### No Fallback - Fail-Visible Enforcement

Per AetherCore Fail-Visible doctrine, the implementation **does not support fallback modes**:

- ❌ **No ephemeral keys**: All keys must be persistent in Secure Enclave
- ❌ **No software fallback**: Hardware-rooted trust is non-negotiable
- ❌ **No degraded modes**: Security failures are explicit, never hidden

**Rationale**:
- **Fail-Visible Doctrine**: Persistent key creation failure is a security event requiring explicit acknowledgment
- **Cryptographic Certainty**: Fallback degrades from hardware-rooted identity to trust-by-policy
- **Byzantine Detection**: Trust mesh requires consistent cryptographic proofs from all nodes

### Key Generation Policy

When persistent key creation fails, the implementation:

1. **Fails Fast**: Returns SecureEnclaveError.secureEnclaveUnavailable
2. **Provides Diagnostics**: Error includes detailed failure context
3. **Requires Remediation**: Operator must fix entitlements, device configuration, or hardware

**Common Failure Causes**:
- Missing entitlements (keychain-access-groups, team-identifier)
- Device passcode not set (Secure Enclave requires passcode)
- Simulator execution (device-only builds required)
- Hardware fault or device compromise

### Diagnostic Errors

Key generation failures include detailed diagnostic context:

```swift
SecureEnclaveError.keyGenerationFailed(
    "OSStatus: -25300 (errSecItemNotFound) | " +
    "Context: Missing keychain-access-groups entitlement | " +
    "Device: iPhone 15 Pro, iOS 17.2 | " +
    "Accessibility: AfterFirstUnlock"
)
```

All errors follow Fail-Visible pattern with explicit failure reasons.

## Cryptographic Curve Policy

### P-256 Mandated by Secure Enclave

**AetherCore Standard Architecture**:
- **Primary**: Ed25519 signatures (Twisted Edwards curve)
- **Rationale**: Modern, fast, simple, side-channel resistant
- **Hashing**: BLAKE3 for all integrity checks

**iOS Secure Enclave Hardware Constraint**:
- **Required**: ECDSA P-256 (secp256r1 / NIST P-256)
- **Reason**: iOS SEP hardware exclusively supports P-256
- **Hashing**: SHA-256 for P-256 fingerprinting (ecosystem convention)

### Architectural Divergence

The iOS client represents a **hardware-constrained exception** to AetherCore's Ed25519 standard:

| Aspect | AetherCore Standard | iOS Secure Enclave |
|--------|-------------------|-------------------|
| Signing | Ed25519 | P-256 ECDSA |
| Hashing | BLAKE3 | SHA-256 |
| Security Level | 128-bit | 128-bit |
| Hardware Root | TPM 2.0 | Secure Enclave |

### Rationale for P-256

1. **Hardware Mandate**: iOS Secure Enclave only supports P-256; no Ed25519 capability
2. **Apple Silicon Integration**: Hardware-accelerated ECDSA operations
3. **Alignment with macOS**: Same curve as macOS Secure Enclave (`crates/identity/src/secure_enclave.rs`)
4. **Industry Standard**: NIST P-256 widely deployed in enterprise PKI and mobile ecosystems

### Security Considerations

**P-256 Security Properties**:
- 128-bit security level (equivalent to AES-128)
- Mature curve with extensive cryptanalysis
- No known practical attacks against properly implemented ECDSA P-256

**Divergence Risks**:
- ⚠️ **Mixed Signature Verification**: Trust mesh must support both Ed25519 and P-256
- ⚠️ **Key Agreement Incompatibility**: Ed25519 and P-256 keys cannot be mixed in DH
- ⚠️ **Signature Length**: P-256 signatures (64-72 bytes DER) vs Ed25519 (64 bytes)

### Trust Mesh Integration

**Protocol-Level Handling**:
1. **Signature Type Tagging**: GenesisBundle includes curve identifier (P-256)
2. **Verification Routing**: Trust mesh routes to appropriate verifier based on signature type
3. **Transparent to Applications**: Upper layers abstract curve differences
4. **Byzantine Detection**: All signatures verified against declared curve type

**Implementation Notes**:
- Gateway must support both Ed25519 (standard) and P-256 (iOS/macOS) verification
- Cross-curve signature verification prevented (Fail-Visible on type mismatch)
- Mixed-curve mesh operation validated in integration tests

## Simulator Rejection

### Explicit Rejection

The Secure Enclave is **not available** on iOS Simulator. The implementation explicitly rejects simulator builds:

```swift
public static func isSupported() -> Bool {
    #if targetEnvironment(simulator)
    return false
    #else
    return SecureEnclave.isAvailable
    #endif
}

public func signNonce(_ nonce: Data) throws -> SecureEnclaveQuote {
    #if targetEnvironment(simulator)
    throw SecureEnclaveError.simulatorNotSupported
    #endif
    // ...
}
```

**Error Message**:
```
Secure Enclave is not available on iOS Simulator. 
This is a fatal error - device-only builds required.
```

### Build Configuration

To enforce device-only builds, set in Xcode:

**Build Settings → Supported Platforms**:
```
SUPPORTED_PLATFORMS = iphoneos
```

Or in `project.pbxproj`:
```
SUPPORTED_PLATFORMS = "iphoneos";
```

### CI Considerations

CI builds using `CODE_SIGNING_ALLOWED=NO` will:
- ✅ Compile successfully
- ✅ Pass unit tests (simulator rejection is expected)
- ❌ Cannot exercise Secure Enclave operations

**Local Device Testing Required** for:
- Key generation validation
- Signing operation verification
- Entitlements compliance testing

## Validation

### Compilation Checks

```bash
# Build for iOS device
xcodebuild -scheme SecureEnclaveKeyManager \
    -destination 'generic/platform=iOS' \
    -configuration Release \
    CODE_SIGNING_ALLOWED=NO \
    build
```

Expected: Build succeeds without code signing

### Entitlements Validation

```bash
# Extract entitlements from built app
codesign -d --entitlements :- AetherCore.app

# Verify keychain-access-groups is present
# Verify team-identifier is present
# Verify application-identifier is present
```

### Device Testing

```swift
// In app delegate or entry point
func validateSecureEnclave() {
    guard SecureEnclaveKeyManager.isSupported() else {
        fatalError("Secure Enclave not available")
    }
    
    let manager = SecureEnclaveKeyManager(keyTag: "com.4mik.aethercore.sep")
    let nonce = Data("test-nonce".utf8)
    
    do {
        let quote = try manager.signNonce(nonce)
        print("✅ Secure Enclave operational")
        print("   Key Tag: \(quote.keyTag)")
        print("   Public Key Length: \(quote.publicKeySEC1.count) bytes")
    } catch {
        fatalError("Secure Enclave validation failed: \(error)")
    }
}
```

## Troubleshooting

### "Simulator Not Supported" Error
✅ **Expected on Simulator**: Deploy to physical device

### "Missing Entitlements" Error
1. Check provisioning profile includes required entitlements
2. Verify code signing identity is correct
3. Rebuild with `xcodebuild -showBuildSettings` to inspect entitlements

### "Key Generation Failed" Error
1. Ensure device is unlocked (Secure Enclave requires device unlock)
2. Verify device passcode is set (Secure Enclave mandate)
3. Check provisioning profile includes required entitlements
4. Inspect error diagnostic context for specific OSStatus code
5. Validate device supports Secure Enclave (iPhone 5s+, iPad Air 2+)

### "Algorithm Not Supported" Error
❌ **Fatal**: Device Secure Enclave does not support P-256 (extremely rare)
- Likely indicates compromised device or jailbreak
- Fail-fast is correct behavior per Fail-Visible doctrine

## References

- Apple Technical Note TN2250: [Secure Enclave](https://developer.apple.com/documentation/security/certificate_key_and_trust_services/keys/protecting_keys_with_the_secure_enclave)
- NIST SP 800-186: [Recommendations for Discrete Logarithm-based Cryptography: Elliptic Curve Domain Parameters](https://csrc.nist.gov/publications/detail/sp/800-186/final)
- Rust implementation: `crates/identity/src/secure_enclave.rs`
- iOS build guide: `docs/ios/BUILD.md`
