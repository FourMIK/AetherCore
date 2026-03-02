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
   - Enable "App Groups" capability (for keychain-access-groups)
   - Ensure team identifier is present
   - Sign with development certificate

2. **Distribution Profile**:
   - Same entitlements as development
   - Sign with distribution certificate

3. **Validate Entitlements**:
   ```bash
   codesign -d --entitlements :- YourApp.app
   ```

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

### Fallback Hierarchy

When persistent key creation fails, the implementation attempts:

1. **Ephemeral SEP Key** (if `AETHERCORE_SEP_ALLOW_EPHEMERAL=true`)
   - Non-permanent key (no keychain storage)
   - Still bound to Secure Enclave
   - Lost on app termination
   - **Key tag modified**: Appends `-ephemeral` suffix to distinguish from persistent keys

2. **Alternative Accessibility Level**
   - Try `kSecAttrAccessibleWhenUnlockedThisDeviceOnly`
   - Requires device unlock before use

3. **Fatal Error**
   - If all attempts fail, return `SecureEnclaveError.secureEnclaveUnavailable`
   - Error includes diagnostic context from all failed attempts

### Environment Variable

```bash
# Disable ephemeral fallback (default - fail-visible)
# No environment variable needed - this is the default behavior

# Enable ephemeral fallback (explicit opt-in)
export AETHERCORE_SEP_ALLOW_EPHEMERAL=true
```

**Rationale for Default `false`**:
- **Fail-Visible Doctrine**: Persistent key creation failure is a security event requiring explicit acknowledgment
- **Cryptographic Certainty**: Ephemeral keys degrade from persistent hardware-rooted identity
- **Explicit Opt-In**: Operators must consciously enable fallback behavior

**When to Enable**:
- Development/testing environments where key persistence is not critical
- Temporary workaround for CryptoTokenKit instability on specific iOS builds
- Scenarios where transient signing capability is acceptable

**When to Keep Disabled** (default):
- Production deployments requiring persistent identity
- Environments where key lifecycle management is critical
- Any deployment where silent degradation is unacceptable

### Diagnostic Errors

All fallback attempts are logged in the error context:

```swift
SecureEnclaveError.secureEnclaveUnavailable(
    "generation_errors=entitlements_preflight: diagnostic check skipped | " +
    "persistent_key_lookup_status=-25300 | " +
    "ephemeral_sec_enclave_key_failed: key creation failed | " +
    "persistent_key_creation_failed[AfterFirstUnlock]: errSecItemNotFound"
)
```

**Note on Entitlements Preflight**: The preflight check is currently a placeholder. Actual entitlement validation occurs at the Security framework level during key operations. Future implementations may add programmatic entitlement checking via `SecTaskCopyValueForEntitlement`.

## Cryptographic Curve Rationale

### P-256 vs Ed25519 Divergence

**Standard AetherCore Architecture**:
- **Primary**: Ed25519 signatures (Twisted Edwards curve)
- **Rationale**: Modern, fast, simple, side-channel resistant

**iOS Secure Enclave Constraint**:
- **Required**: ECDSA P-256 (secp256r1 / NIST P-256)
- **Reason**: iOS SEP hardware only supports P-256

### Why P-256?

1. **Hardware Support**: iOS Secure Enclave exclusively supports P-256
2. **Apple Silicon Acceleration**: Hardware-accelerated ECDSA operations
3. **Alignment with macOS**: Same curve as `crates/identity/src/secure_enclave.rs`
4. **Industry Standard**: NIST P-256 widely deployed in enterprise PKI

### Security Considerations

**P-256 Security Properties**:
- 128-bit security level (equivalent to AES-128)
- Mature curve with extensive cryptanalysis
- No known practical attacks against properly implemented ECDSA P-256

**Divergence Risks**:
- ⚠️ **Mixed Signature Verification**: Trust mesh must support both Ed25519 and P-256
- ⚠️ **Key Agreement Incompatibility**: Ed25519 and P-256 keys cannot be mixed in DH
- ⚠️ **Signature Length**: P-256 signatures (64-72 bytes DER) vs Ed25519 (64 bytes)

### Mitigation Strategy

1. **Protocol-Level Tagging**: `Attestation::SecureEnclave` variant identifies P-256 signatures
2. **Verification Routing**: Trust mesh routes to appropriate verifier based on attestation type
3. **Transparent to Applications**: Upper layers abstract curve details
4. **Documentation**: This divergence is tracked in architecture docs

### Future Work

- **Evaluate StrongBox Keymaster** on Android (also P-256)
- **Unified P-256 Verification Path** for mobile platforms
- **Performance Benchmarks**: P-256 vs Ed25519 on mobile hardware

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
1. Ensure device is unlocked (for `AfterFirstUnlock` accessibility)
2. Check if another app is using the same key tag
3. Enable `AETHERCORE_SEP_ALLOW_EPHEMERAL=true` as temporary fallback
4. Inspect error context for specific failure reasons

### "Algorithm Not Supported" Error
❌ **Fatal**: Device Secure Enclave does not support P-256 (extremely rare)
- Likely indicates compromised device or jailbreak
- Fail-fast is correct behavior

## References

- Apple Technical Note TN2250: [Secure Enclave](https://developer.apple.com/documentation/security/certificate_key_and_trust_services/keys/protecting_keys_with_the_secure_enclave)
- NIST SP 800-186: [Recommendations for Discrete Logarithm-based Cryptography: Elliptic Curve Domain Parameters](https://csrc.nist.gov/publications/detail/sp/800-186/final)
- Rust implementation: `crates/identity/src/secure_enclave.rs`
- iOS build guide: `docs/ios/BUILD.md`
