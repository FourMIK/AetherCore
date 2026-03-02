# iOS Secure Enclave Key Manager

Hardware-rooted identity backend for iOS devices using the Secure Enclave Processor (SEP).

## Overview

This Swift package provides nonce-signing attestation using ECDSA P-256 keys bound to the iOS Secure Enclave. It mirrors the architecture of the macOS Secure Enclave implementation in `crates/identity/src/secure_enclave.rs`.

## Key Features

- **Hardware-Rooted Keys**: Private keys never leave the Secure Enclave
- **Persistent Storage**: Keys stored in keychain with device-only accessibility
- **Fail-Visible**: Explicit errors on entitlement, simulator, or key generation failures
- **Deterministic Key Tags**: Stable keychain identifiers for key lifecycle management
- **Optional Ephemeral Fallback**: Configurable via `AETHERCORE_SEP_ALLOW_EPHEMERAL` environment variable

## Architecture Alignment

This implementation follows the Rust SEP flow:

1. **Deterministic Key Tag**: Stable identifier for keychain lookup
2. **Persistent SEP Key First**: Attempts keychain-backed key before fallback
3. **Entitlements Preflight**: Diagnostic check for required entitlements
4. **Algorithm Support Check**: Validates P-256 ECDSA support before signing
5. **Non-Exportable Private Key**: Keys never leave Secure Enclave
6. **Public Key DER Export**: Only public key is exportable in SEC1 format

## Requirements

### Platform
- iOS 13.0 or later
- **Physical device only** (Simulator is explicitly rejected)

### Entitlements
The following entitlements are required for Secure Enclave operations:

```xml
<key>com.apple.application-identifier</key>
<string>$(AppIdentifierPrefix)$(CFBundleIdentifier)</string>

<key>keychain-access-groups</key>
<array>
    <string>$(AppIdentifierPrefix)com.aethercore.*</string>
</array>

<key>com.apple.developer.team-identifier</key>
<string>$(AppIdentifierPrefix)</string>
```

See `docs/ios/SECURE_ENCLAVE.md` for detailed entitlements documentation.

## Usage

```swift
import SecureEnclaveKeyManager

// Initialize with deterministic key tag
let keyManager = SecureEnclaveKeyManager(keyTag: "com.4mik.aethercore.sep")

// Check if Secure Enclave is available (returns false on simulator)
guard SecureEnclaveKeyManager.isSupported() else {
    fatalError("Secure Enclave not available - device-only build required")
}

// Sign a nonce
let nonce = Data("aethercore-challenge".utf8)
do {
    let quote = try keyManager.signNonce(nonce)
    print("Signature: \(quote.signatureDER.base64EncodedString())")
    print("Public Key: \(quote.publicKeySEC1.base64EncodedString())")
} catch {
    print("Signing failed: \(error)")
}
```

## Cryptographic Details

### Algorithm: ECDSA P-256 (secp256r1)

This implementation uses **P-256** instead of AetherCore's standard **Ed25519** signatures due to iOS Secure Enclave constraints:

- iOS SEP only supports NIST P-256 (not Ed25519)
- Hardware acceleration for P-256 on Apple Silicon
- Alignment with macOS Secure Enclave implementation

**This is a tracked architectural divergence.** See `docs/ios/SECURE_ENCLAVE.md` for risk analysis.

### Key Attributes
- **Key Type**: `kSecAttrKeyTypeECSECPrimeRandom` (P-256)
- **Key Size**: 256 bits
- **Token ID**: `kSecAttrTokenIDSecureEnclave`
- **Accessibility**: `kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly` (preferred)
- **Access Control**: `kSecAccessControlPrivateKeyUsage`
- **Permanence**: `kSecAttrIsPermanent=true` (persistent keys only)

### Signature Format
- **Algorithm**: `ecdsaSignatureMessageX962SHA256`
- **Output**: DER-encoded ECDSA signature
- **Hash**: SHA-256

### Public Key Format
- **Encoding**: SEC1 uncompressed format (0x04 prefix)
- **Size**: 65 bytes (1 byte prefix + 32 bytes X + 32 bytes Y)

## Fallback Behavior

### Persistent Key Failure
If persistent key creation fails, the implementation attempts:

1. **Ephemeral SEP Key**: Non-permanent key (if `AETHERCORE_SEP_ALLOW_EPHEMERAL=true`)
2. **Alternative Accessibility**: Try `kSecAttrAccessibleWhenUnlockedThisDeviceOnly`

### Environment Variable
```bash
# Disable ephemeral fallback (default - fail-visible)
# No environment variable needed

# Enable ephemeral fallback (explicit opt-in)
AETHERCORE_SEP_ALLOW_EPHEMERAL=true
```

**Default Behavior (`false`)**:
- Persistent key creation failure results in `SecureEnclaveError.secureEnclaveUnavailable`
- Fail-visible: No silent degradation to ephemeral keys
- Cryptographic certainty: Key lifecycle is explicit and traceable

**When to Enable (`true`)**:
- Development/testing environments
- Temporary workaround for CryptoTokenKit instability
- Scenarios where transient signing is acceptable

## Build Configuration

### Device-Only Builds
Add to `project.pbxproj` or use Xcode build settings:

```
SUPPORTED_PLATFORMS = iphoneos
```

### CI Builds
CI builds use `CODE_SIGNING_ALLOWED=NO` and will **not** exercise Secure Enclave operations. Local device testing requires:

1. Provisioning profile with required entitlements
2. Physical iOS device
3. Code signing identity

See `docs/ios/BUILD.md` for complete build instructions.

## Error Handling

All errors are fail-visible with structured context:

```swift
do {
    let quote = try keyManager.signNonce(nonce)
} catch SecureEnclaveError.simulatorNotSupported {
    fatalError("Cannot use Secure Enclave on simulator")
} catch SecureEnclaveError.missingEntitlements(let detail) {
    fatalError("Entitlements error: \(detail)")
} catch SecureEnclaveError.keyGenerationFailed(let detail) {
    fatalError("Key generation error: \(detail)")
} catch {
    fatalError("Unexpected error: \(error)")
}
```

## Testing

### Unit Tests
```bash
swift test
```

**Note**: Tests that require Secure Enclave operations will be skipped on simulators.

### Device Testing
1. Build with provisioning profile
2. Deploy to physical iOS device
3. Run tests in Xcode (Cmd+U)

## License

MIT/Apache-2.0 (same as AetherCore)

## References

- Rust implementation: `crates/identity/src/secure_enclave.rs`
- Documentation: `docs/ios/SECURE_ENCLAVE.md`
- Build guide: `docs/ios/BUILD.md`
