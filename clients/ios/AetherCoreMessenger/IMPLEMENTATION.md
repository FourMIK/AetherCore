# AetherCore iOS Client - Implementation Notes

## Overview

iOS client implementation for AetherCore hardware-rooted trust fabric with App Attest integration, Gateway enrollment, and C2 telemetry reporting.

## Implementation Status

### ✅ Phase 1: AppAttest Integration
- **File**: `Security/AttestationManager.swift`
- **Features**:
  - DCAppAttestService integration with hardware validation
  - Fail-visible check: fatalError if App Attest not supported
  - AppAttest key generation using deviceFingerprint (SHA-256) as challenge
  - CBOR attestation object export (base64-encoded)
  - Assertion generation for future API authentication

### ✅ Phase 2: Gateway Enrollment Client
- **File**: `Network/GatewayClient.swift`
- **Features**:
  - Async enrollment flow: `enrollNode(identity:) async throws -> EnrollmentResult`
  - GenesisBundle construction with App Attest attestation
  - Challenge-response authentication with Secure Enclave signing
  - Access token storage in Keychain with secure attributes:
    - `kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly`
    - No iCloud sync (`kSecAttrSynchronizable: false`)
  - Fail-visible checks:
    - fatalError on missing gateway challenge
    - fatalError on challenge signing failure
    - fatalError on Keychain storage failure

### ✅ Phase 3: C2 Telemetry Daemon
- **File**: `Network/NodeTelemetryDaemon.swift`
- **Features**:
  - Background telemetry loop every 30 seconds
  - Payload: ISO8601 timestamp + deviceFingerprint + signature
  - Signature over `(timestamp || fingerprint)` using Secure Enclave
  - POST to C2 router `/telemetry/heartbeat` endpoint
  - Access token authentication via Bearer token
  - Fail-visible check: fatalError on signature generation failure
  - Graceful degradation: HTTP errors logged but allow retry

## Security Architecture

### Fail-Visible Doctrine

All security-critical failures trigger `fatalError` with descriptive messages:

1. **App Attest unavailable** → App cannot launch
2. **Gateway challenge missing** → Enrollment cannot proceed
3. **Challenge signing failure** → Enrollment cannot proceed
4. **Keychain storage failure** → Enrollment cannot proceed
5. **Telemetry signature failure** → Telemetry cannot be trusted

### Cryptographic Standards

- **Key Generation**: P-256 (Secure Enclave requirement)
- **Signing**: ECDSA with SHA-256 (`.ecdsaSignatureMessageX962SHA256`)
- **Hashing**: SHA-256 for fingerprints and attestation (iOS ecosystem requirement)
  - **⚠️ EXCEPTION TO AETHERCORE STANDARD**: AetherCore mandates BLAKE3 for all hashing per SECURITY.md
  - **Justification**: iOS platform constraints
    - DCAppAttestService API requires SHA-256 for `clientDataHash` parameter
    - Secure Enclave P-256 ecosystem conventions use SHA-256
    - This is a documented iOS-specific exception to the BLAKE3 standard
    - See: https://developer.apple.com/documentation/devicecheck/establishing-your-app-s-integrity
- **Attestation**: DCAppAttestService CBOR attestation objects

### Data Flow

```
1. Device Identity (SecureEnclaveKeyManager)
   ↓
2. App Attest Key Generation (AttestationManager)
   ↓
3. GenesisBundle Creation (with attestation)
   ↓
4. Gateway Enrollment (challenge-response)
   ↓
5. Access Token Storage (Keychain)
   ↓
6. Telemetry Daemon Start (30s heartbeat)
```

## API Endpoints

### Gateway Enrollment

```
POST /enroll
Body: GenesisBundle (JSON)
Response: { challenge: string?, message: string? }

POST /enroll/challenge
Body: { deviceFingerprint: string, signature: string }
Response: { accessToken: string, nodeID: string, enrolledAt: string, trustScore: number }
```

### C2 Telemetry

```
POST /telemetry/heartbeat
Headers: Authorization: Bearer <access_token>
Body: TelemetryPayload (JSON)
  {
    timestamp: string (ISO8601),
    deviceFingerprint: string,
    signature: string (base64),
    nodeID: string?,
    version: string
  }
Response: 200 OK
```

## GenesisBundle Structure

```json
{
  "publicKeyDER": "base64-encoded DER",
  "keyTag": "mil.fourmik.aethercore.secureenclave.key",
  "deviceFingerprint": "sha256-hex",
  "attestationPayload": "base64-encoded CBOR",
  "appAttestKeyID": "uuid-string",
  "timestamp": "2024-01-01T00:00:00Z",
  "version": "0.1.0"
}
```

## Usage Example

```swift
// 1. Initialize device identity
let identity = try DeviceIdentity()

// 2. Enroll with gateway
let gatewayClient = GatewayClient()
let enrollment = try await gatewayClient.enrollNode(identity: identity)
print("Enrolled - Node ID: \(enrollment.nodeID)")

// 3. Start telemetry daemon
let telemetryDaemon = NodeTelemetryDaemon(
    identity: identity,
    gatewayClient: gatewayClient
)
telemetryDaemon.start(nodeID: enrollment.nodeID)

// Telemetry now broadcasting every 30s
```

## Testing Considerations

### Device Requirements
- Physical iOS device (iPhone 5s+ or iPad Air 2+)
- iOS 14.0+ (for App Attest support)
- Device passcode must be set
- No simulator support (Secure Enclave required)

### Network Configuration
- Gateway endpoint: `https://gateway.aethercore.mil` (configurable)
- C2 router endpoint: `https://c2.aethercore.mil` (configurable)
- For testing, initialize clients with custom URLs:
  ```swift
  let gatewayClient = GatewayClient(
      gatewayURL: URL(string: "http://localhost:3000")!
  )
  ```

### Fail-Visible Testing

To test fail-visible conditions:

1. **App Attest unavailable**: Run on iOS 13 or simulator (will fatalError)
2. **Missing challenge**: Mock gateway without challenge response
3. **Signature failure**: Manually trigger signing error (not possible in normal operation)
4. **Keychain failure**: Remove device passcode (will fatalError)

## Known Limitations

1. **No simulator support**: Secure Enclave required for hardware attestation
2. **iOS 14.0+ only**: App Attest API introduced in iOS 14
3. **Single device only**: Access tokens not synced via iCloud Keychain
4. **No offline mode**: Enrollment and telemetry require network connectivity
5. **Enrollment state persistence**: UI does not restore enrollment status on app restart
   - Access token is stored securely in Keychain
   - However, enrollment details (nodeID, trust score) are not persisted locally
   - On app restart, device appears "Not Enrolled" until re-enrollment or server fetch
   - Future enhancement: Cache enrollment details in UserDefaults or fetch from gateway

## Future Enhancements

- [ ] Assertion-based API authentication (App Attest)
- [ ] Certificate pinning for gateway/C2 endpoints
- [ ] Telemetry payload compression
- [ ] Background URLSession for telemetry (continues during app suspension)
- [ ] Re-enrollment flow on token expiration
- [ ] Key rotation support

## File Structure

```
clients/ios/AetherCoreMessenger/AetherCoreMessenger/
├── App.swift                           # App entry point with SE validation
├── ContentView.swift                   # UI with enrollment/telemetry controls
├── Security/
│   ├── SecureEnclaveKeyManager.swift   # Low-level SE key operations
│   ├── DeviceIdentity.swift            # Identity wrapper with fingerprinting
│   └── AttestationManager.swift        # ✅ NEW: App Attest integration
├── Genesis/
│   └── GenesisBundle.swift             # ✅ UPDATED: Attestation payload + keyID
└── Network/
    ├── GatewayClient.swift             # ✅ NEW: Enrollment client
    └── NodeTelemetryDaemon.swift       # ✅ NEW: C2 telemetry daemon
```

## Compliance

- ✅ Swift 5.9+ with async/await
- ✅ CryptoKit + Security frameworks
- ✅ No completion handlers (async/await only)
- ✅ Custom Error enums with CustomStringConvertible
- ✅ Fail-visible fatalError on trust failures
- ✅ Success logs prefixed with ✅
- ✅ Error logs prefixed with ❌
- ✅ P-256/SHA-256 for Secure Enclave alignment
- ✅ No private key export
- ✅ No ephemeral or degraded modes

---

**Implementation Date**: 2026-03-02  
**Version**: 0.1.0  
**Status**: ✅ Complete - All phases implemented
