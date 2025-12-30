# Fourmik Identity Crate

## Overview

The `fourmik-identity` crate provides hardware-rooted identity primitives, PKI infrastructure, and TPM integration for the 4MIK system. It ensures every platform, sensor, and logical actor has a unique, attestable identity that is cryptographically bound to all signals and commands.

## Key Components

### Device Identity (`device.rs`)

Platform identity management with hardware attestation support.

**Data Contracts:**

```rust
pub struct PlatformIdentity {
    pub id: String,
    pub public_key: Vec<u8>,           // DER-encoded public key
    pub attestation: Attestation,
    pub created_at: u64,
    pub metadata: HashMap<String, String>,
}

pub enum Attestation {
    Tpm {
        quote: Vec<u8>,                // TPM quote signature
        pcrs: Vec<u8>,                 // Platform Configuration Registers
        ak_cert: Vec<u8>,              // Attestation Key certificate
    },
    Software {
        certificate: Vec<u8>,          // Self-signed certificate
    },
    None,                               // Testing only - NEVER use in production
}

pub struct IdentityVerification {
    pub verified: bool,
    pub identity: PlatformIdentity,
    pub trust_score: f64,              // 0.0 to 1.0
    pub verified_at: u64,
    pub details: String,
}
```

**API Surface:**
- `IdentityManager::new()` - Create identity manager
- `register(identity)` - Register new identity
- `get(id)` - Retrieve identity by ID
- `verify(identity)` - Verify identity and attestation
- `revoke(id)` - Revoke compromised identity
- `is_revoked(id)` - Check revocation status
- `list()` - List all registered identities

**Security Hooks:**
- TPM attestation: trust score 1.0 (highest)
- Software attestation: trust score 0.7 (moderate)
- No attestation: trust score 0.0, verification fails
- Revoked identities: trust score 0.0, verification fails
- All operations auditable through event system

### Public Key Infrastructure (`pki.rs`)

Certificate management and trust hierarchy.

**Data Contracts:**
```rust
pub struct Certificate {
    pub serial: String,
    pub subject: String,
    pub issuer: String,
    pub public_key: Vec<u8>,
    pub not_before: u64,
    pub not_after: u64,
    pub signature: Vec<u8>,
    pub extensions: HashMap<String, Vec<u8>>,
}

pub struct CertificateRequest {
    pub subject: String,
    pub public_key: Vec<u8>,
    pub signature: Vec<u8>,            // Signed with private key
    pub attestation: Attestation,
}
```

**API Surface:**
- `CertificateAuthority::new(ca_id, public_key, private_key)` - Create CA
- `issue_certificate(csr, validity_days)` - Issue certificate from CSR
- `verify_certificate(cert)` - Verify certificate validity
- `revoke_certificate(serial)` - Revoke certificate
- `is_revoked(serial)` - Check revocation status
- `list_certificates()` - List all issued certificates
- `TrustChainValidator::new()` - Create validator
- `add_trusted_root(ca_id, public_key)` - Add trusted root CA
- `verify_chain(certificates)` - Verify certificate chain

**Security Hooks:**
- CSR signatures verified before issuance
- Attestation required for certificate issuance
- Certificate validity period enforced
- Revoked certificates rejected
- Chain of trust validated to known root CA

### TPM Integration (`tpm.rs`)

Trusted Platform Module support with hardware stubs for testing.

**Data Contracts:**
```rust
pub struct TpmQuote {
    pub pcrs: Vec<PcrValue>,           // Platform Configuration Registers
    pub signature: Vec<u8>,
    pub nonce: Vec<u8>,                // Replay protection
    pub timestamp: u64,
}

pub struct PcrValue {
    pub index: u8,                     // 0-23
    pub value: Vec<u8>,                // Hash value
}

pub struct AttestationKey {
    pub key_id: String,
    pub public_key: Vec<u8>,
    pub certificate: Option<Vec<u8>>,
}
```

**API Surface:**
- `TpmManager::new(use_hardware)` - Create TPM manager
- `generate_attestation_key(key_id)` - Generate AK for signing quotes
- `generate_quote(nonce, pcr_selection)` - Generate platform quote
- `verify_quote(quote, ak)` - Verify quote signature
- `seal_data(key_id, data)` - Seal data to TPM (encrypted)
- `unseal_data(key_id, sealed_data)` - Unseal TPM-encrypted data

**Hardware Interfaces:**
- **TPM 2.0**: `/dev/tpm0` on Linux, TBS service on Windows
- **Feature Flag**: `hardware-tpm` enables real TPM integration
- **Stub Mode**: Software simulation when hardware unavailable
- **Detection**: Automatic fallback to stub if hardware not present

## Hardware Dependencies

### TPM Hardware
- **Required for Production**: TPM 2.0 chip or firmware TPM
- **Detection**: `/dev/tpm0` on Linux, TBS on Windows
- **Feature Flag**: Compile with `--features hardware-tpm` to enable
- **Fallback**: Stub implementation always available for testing

### Secure Enclaves (Future)
- Intel SGX, ARM TrustZone support planned
- Will use same attestation interface

## Feature Flags

### `hardware-tpm`
Enables real TPM hardware integration. When disabled, uses software stubs.

```toml
[dependencies]
fourmik-identity = { version = "0.1", features = ["hardware-tpm"] }
```

**Production**: Always enable `hardware-tpm` for deployed systems
**Development/Testing**: Disabled by default, uses stubs

## Security Invariants

1. **Hardware-Rooted Trust**: Production identities must use TPM or secure enclave
2. **Attestation Required**: No identity creation without attestation proof
3. **Verification Before Trust**: Identity verification completes before granting access
4. **Fail Closed**: Verification failure results in rejection, not degradation
5. **No Silent Downgrade**: Identity trust cannot be reduced without explicit revocation
6. **Revocation Propagation**: Revoked identities immediately untrusted
7. **No Secret Logging**: Private keys and sensitive material never logged
8. **Audit Trail**: All identity operations generate audit events

## Integration Points

### With Core Crate
- Uses core error types and event schema
- Trust chains bind to verified identities
- Events for identity lifecycle operations

### With Crypto Crate
- Delegates signature generation and verification
- Uses crypto key management for identity keys
- Shares cryptographic primitives (Ed25519, BLAKE3)

### With Mesh Crate
- Provides identity verification for mesh messages
- Authenticates node-to-node communications
- Enables authenticated routing decisions

### With Edge Crate
- Binds vessel tracks to verified identities
- Increases trust scores for authenticated AIS data
- Enables deconfliction with high-confidence targets

## Testing

Run tests with:
```bash
cargo test -p fourmik-identity
```

Test with hardware-tpm feature (requires TPM):
```bash
cargo test -p fourmik-identity --features hardware-tpm
```

Current test coverage: 21 unit tests covering:
- Identity registration and retrieval
- Verification with different attestation types
- Revocation and trust score updates
- Certificate issuance and validation
- PKI trust chain verification
- TPM stub operations (seal/unseal, quote generation)

## Production Considerations

1. **TPM Integration**: Use `tpm2-tss` library for production TPM operations
2. **Key Storage**: Private keys must never leave TPM/HSM
3. **Certificate Lifecycle**: Implement auto-renewal before expiration
4. **Revocation Lists**: Distribute CRLs or use OCSP for real-time revocation checking
5. **Attestation Freshness**: Verify quote timestamps and nonces to prevent replay
6. **PCR Monitoring**: Alert on unexpected PCR value changes
7. **Root CA Protection**: Store root CA keys in HSM with strict access control
8. **Identity Rotation**: Plan for periodic identity rotation and key updates
9. **Hardware Failure**: Implement backup attestation methods for TPM failure
10. **Performance**: Cache verification results with short TTL to reduce TPM operations

## CodeRalphie Integration

The identity crate exposes APIs for external systems:

- **Identity Enrollment**: `/api/identity/enroll` - Register new platform identities
- **Identity Verification**: `/api/identity/verify` - Verify identity proofs
- **Identity Revocation**: `/api/identity/revoke` - Revoke compromised identities
- **Audit Log Stream**: `/api/identity/audit` - Stream identity events
