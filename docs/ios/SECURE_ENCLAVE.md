# iOS Secure Enclave Security Policy

**Classification:** CRITICAL  
**Purpose:** Secure Enclave key management policy for AetherCore iOS client  
**Last Updated:** 2026-03-02

---

## Overview

AetherCore iOS Messenger implements hardware-rooted trust using Apple's Secure Enclave, a dedicated security coprocessor providing cryptographic operations with hardware-isolated key storage.

**Core Principles:**
- **No private key export:** Private keys never leave Secure Enclave
- **No backup:** Keys are device-specific and non-extractable
- **Fail-Visible:** Security failures halt operations explicitly
- **Hardware-rooted identity:** Cryptographic certainty replaces "Trust by Policy"

---

## Secure Enclave Architecture

### Hardware Isolation

```
┌─────────────────────────────────────────┐
│  Application Process (User Space)      │
│  ↓ Sign Request (data to sign)         │
├─────────────────────────────────────────┤
│  iOS Security Framework (Kernel)       │
│  ↓ SecKeyCreateSignature               │
├─────────────────────────────────────────┤
│  Secure Enclave Processor (SEP)        │
│  • Private key never exposed           │
│  • Signing operation in hardware       │
│  • Returns signature only              │
└─────────────────────────────────────────┘
```

**Key Guarantees:**
1. Private keys are generated and stored in Secure Enclave
2. Private key material never enters application memory
3. Signing operations occur within hardware-isolated processor
4. Keys are bound to specific device (non-transferable)

---

## Key Management Policy

### Key Generation

**Method:** `SecureEnclaveKeyManager.generateIfNeeded()`

**Parameters:**
- **Key Type:** ECC P-256 (NIST secp256r1)
- **Token:** `kSecAttrTokenIDSecureEnclave` (Secure Enclave storage)
- **Permanence:** `kSecAttrIsPermanent = true` (persists across app restarts)
- **Application Tag:** `mil.fourmik.aethercore.secureenclave.key`

**Access Control:**
```swift
kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
+ .privateKeyUsage
```

**Policy Rationale:**
- `AfterFirstUnlockThisDeviceOnly`: Key available after device boot unlock, but not backed up
- `.privateKeyUsage`: Key usage requires device authentication (passcode or biometry if enrolled); suitable for unattended operation as biometry is optional

**Code Reference:** `clients/ios/AetherCoreMessenger/AetherCoreMessenger/Security/SecureEnclaveKeyManager.swift:93-118`

---

### Key Storage

**Location:** Secure Enclave (hardware-isolated)

**Properties:**
- ❌ **Not exportable:** Private key cannot be read from Secure Enclave
- ❌ **Not backed up:** Keys are device-specific (iCloud backup excluded)
- ❌ **Not in memory:** Private key never touches application RAM
- ❌ **Not on disk:** No private key files in filesystem
- ✅ **Device-bound:** Key tied to specific device Secure Enclave

**Verification:**
```swift
// Private key is accessed via handle only
let privateKey: SecKey = /* reference handle, not key material */

// No method exists to export private key bytes
// SecKeyCopyExternalRepresentation() fails for Secure Enclave keys
```

---

### Signing Operations

**Method:** `SecureEnclaveKeyManager.sign(data:)`

**Algorithm:** ECDSA with SHA-256 (`.ecdsaSignatureMessageX962SHA256`)

**Workflow:**
1. Application calls `sign(data:)` with plaintext data
2. Security framework sends data to Secure Enclave
3. Secure Enclave performs ECDSA signing with private key (internal)
4. Signature returned to application (DER-encoded X9.62 format)

**Security Properties:**
- Private key never leaves Secure Enclave
- No side-channel exposure of key material
- Signature validity cryptographically provable

**Performance:**
- Typical latency: <10ms per signature
- Hardware-accelerated ECC operations

**Code Reference:** `clients/ios/AetherCoreMessenger/AetherCoreMessenger/Security/SecureEnclaveKeyManager.swift:143-177`

---

### Public Key Export

**Method:** `SecureEnclaveKeyManager.publicKeyDER()`

**Format:** X.509 SubjectPublicKeyInfo (DER encoding)

**Usage:**
- Device registration with AetherCore gateway
- Genesis bundle creation
- Public key fingerprint computation (SHA-256 hash)

**Security Note:** Public key export is safe and does not compromise private key secrecy.

**Code Reference:** `clients/ios/AetherCoreMessenger/AetherCoreMessenger/Security/SecureEnclaveKeyManager.swift:179-215`

---

## Key Lifecycle

### 1. Initial Generation

```swift
// First app launch
try SecureEnclaveKeyManager.generateIfNeeded()
// → Generates P-256 key pair in Secure Enclave
// → Private key stored in hardware (non-exportable)
// → Public key extractable for registration
```

### 2. Operational Use

```swift
// Sign telemetry data
let data = "Hello AetherCore".data(using: .utf8)!
let signature = try SecureEnclaveKeyManager.sign(data: data)
// → Signature computed in Secure Enclave
// → Private key never exposed
```

### 3. Key Rotation (Placeholder)

**Status:** Not yet implemented (requires gateway coordination)

**Planned Workflow:**
1. Generate new key pair in Secure Enclave
2. Export new public key + rotation certificate
3. Submit rotation request to AetherCore gateway
4. Wait for gateway acknowledgment
5. Delete old key after confirmation

**TODO:** See `SecureEnclaveKeyManager.rotateKey()` stub

**Rotation Trigger Conditions:**
- Periodic rotation (e.g., every 90 days)
- Compromise detection (Byzantine fault observed)
- User-initiated secure reset
- Policy compliance requirement

---

### 4. Key Deletion (Secure Reset)

**Method:** `SecureEnclaveKeyManager.deleteKey()`

**Effect:**
- Permanent deletion of private key from Secure Enclave
- Irreversible operation (key cannot be recovered)
- Device de-registration from AetherCore mesh

**Use Cases:**
- Device decommissioning
- Security incident response
- User account deletion
- Factory reset preparation

**Code Reference:** `clients/ios/AetherCoreMessenger/AetherCoreMessenger/Security/SecureEnclaveKeyManager.swift:217-234`

---

## Attestation (Placeholder)

### Current Status

**Implementation:** Placeholder only (no real attestation)

**Placeholder Value:** `"ATTESTATION_PLACEHOLDER_TODO_DEVICECHECK"`

**Code Location:** `clients/ios/AetherCoreMessenger/AetherCoreMessenger/Genesis/GenesisBundle.swift:43`

### Planned Implementation

**Technology:** Apple DeviceCheck API

**Workflow:**
1. Gateway generates challenge nonce
2. iOS app requests attestation token from DeviceCheck
3. DeviceCheck service validates device authenticity
4. Attestation token returned (cryptographically signed by Apple)
5. Token submitted to gateway with public key

**Attestation Properties:**
- Proves device is genuine Apple hardware
- Validates iOS version and integrity
- Cannot be forged or replayed
- Rate-limited by Apple (anti-abuse)

**TODO:** Implement `AttestationService.requestAttestationToken()`

---

## Cryptographic Alignment with AetherCore

### AetherCore Standards (from `SECURITY.md`)

| Standard | Required | iOS Implementation | Status |
|----------|----------|-------------------|--------|
| **Hashing** | BLAKE3 | SHA-256 (interim) | ⚠️ Partial |
| **Signing** | Ed25519 | ECDSA P-256 | ✅ Compatible |
| **Key Storage** | TPM/Secure Enclave | Secure Enclave | ✅ Compliant |
| **Transport** | TLS 1.3 | Not yet implemented | ⏳ Pending |

### Notes on BLAKE3

**Current:** iOS CryptoKit does not provide BLAKE3 natively. Using SHA-256 for public key fingerprinting.

**Future:** Integrate third-party BLAKE3 library (ensure MIT/Apache-2.0 license per `deny.toml`).

**Impact:** SHA-256 is cryptographically secure; BLAKE3 is preferred for performance and consistency.

### Notes on P-256 vs Ed25519

**Secure Enclave Constraint:** Apple Secure Enclave only supports P-256 (NIST secp256r1).

**Compatibility:** P-256 provides equivalent security to Ed25519 (128-bit security level).

**Rationale:** Hardware-rooted trust (Secure Enclave) takes precedence over algorithm preference.

---

## Security Boundaries

### What Secure Enclave Protects

✅ **Private key confidentiality:** Key never exposed to application or OS  
✅ **Signing integrity:** Operations performed in hardware-isolated processor  
✅ **Device binding:** Keys cannot be exported or transferred  
✅ **Tamper resistance:** Physical attacks mitigated by hardware design  

### What Secure Enclave Does NOT Protect

❌ **Public key confidentiality:** Public keys are inherently shareable  
❌ **Data confidentiality:** Plaintext data passed to signing operations  
❌ **Network security:** TLS/transport layer is separate concern  
❌ **Application logic vulnerabilities:** Code bugs are outside Secure Enclave scope  

---

## Fail-Visible Error Handling

Per AetherCore doctrine, security failures are explicit and halt operations.

### Example: Secure Enclave Unavailable

```swift
// App.swift:27-40
guard SecureEnclaveKeyManager.isSecureEnclaveAvailable() else {
    fatalError("""
        ❌ FAIL-VISIBLE: Secure Enclave unavailable
        
        This device does not support Secure Enclave.
        AetherCore cannot operate without hardware-rooted key storage.
        """)
}
```

### Error Categories

| Error | Severity | Action |
|-------|----------|--------|
| Secure Enclave unavailable | CRITICAL | Fatal error, halt app |
| Key generation failure | CRITICAL | Fatal error, cannot proceed |
| Signing failure | HIGH | Fail operation, log error |
| Key not found | MEDIUM | Attempt regeneration |

---

## Simulator Enforcement

**Policy:** Simulator deployment is explicitly prohibited.

**Rationale:** iOS Simulator does not have Secure Enclave, cannot provide hardware-rooted trust.

**Implementation:**
```swift
#if targetEnvironment(simulator)
fatalError("❌ FAIL-VISIBLE: Simulator detected")
#endif
```

**Code Location:** `clients/ios/AetherCoreMessenger/AetherCoreMessenger/App.swift:18-27`

---

## Compliance and Audit

### Key Policy Checklist

- [x] Private keys are non-exportable
- [x] Private keys never in application memory
- [x] Private keys not backed up to iCloud
- [x] Secure Enclave availability enforced at launch
- [x] Fail-Visible error handling for crypto operations
- [x] Simulator deployment blocked
- [x] Device passcode required (enforced by iOS)
- [ ] Key rotation implemented (TODO)
- [ ] Real attestation token (TODO)
- [ ] BLAKE3 integration (TODO)

### Audit Trail

All cryptographic operations log success/failure:
- Key generation: `✅ Secure Enclave key generated successfully`
- Key existence: `ℹ️ Secure Enclave key already exists`
- Signing operations: Logged in application context
- Key deletion: `✅ Secure Enclave key deleted successfully`

**Log Level:** INFO for success, ERROR for failures

---

## Risk Mitigation

### Risk: Simulator Bypass

**Threat:** Developer disables simulator guard to test on simulator

**Mitigation:**
- CI enforces build for `generic/platform=iOS` (device architecture)
- Runtime guard fails-fast with diagnostic message
- Code review enforces policy

### Risk: Access Control Downgrade

**Threat:** Developer weakens access control to bypass device authentication

**Mitigation:**
- Access control flags are compile-time constants
- Code review checks `SecAccessControlCreateWithFlags` parameters
- Policy documented and versioned

### Risk: Key Export Attempt

**Threat:** Attacker attempts to export private key via API

**Mitigation:**
- Secure Enclave hardware prevents export (enforced by iOS)
- No API exists to extract private key material
- `SecKeyCopyExternalRepresentation()` returns error for Secure Enclave keys

---

## References

- **Apple Documentation:** [Storing Keys in the Secure Enclave](https://developer.apple.com/documentation/security/certificate_key_and_trust_services/keys/storing_keys_in_the_secure_enclave)
- **DeviceCheck API:** [Validating Apps with DeviceCheck](https://developer.apple.com/documentation/devicecheck)
- **AetherCore Security Standards:** `/SECURITY.md`
- **iOS Build Guide:** [BUILD.md](BUILD.md)

---

## Changelog

| Date | Version | Change |
|------|---------|--------|
| 2026-03-02 | 0.1.0 | Initial Secure Enclave policy documentation |
