# Fourmik Crypto Crate

## Scope

The `fourmik-crypto` crate provides cryptographic primitives and operations for the 4MIK trust stack. It implements signing, verification, hashing, and key management using vetted algorithms and secure coding practices.

## Responsibilities

- Digital signature generation and verification
- Cryptographic hashing and integrity checking
- Symmetric and asymmetric key management
- Message authentication codes (HMAC, AEAD)
- Secure random number generation
- **Session cipher rotation** with ephemeral key exchange

## Session Cipher Rotation

### Overview

Production-grade session cipher rotation layer that reinforces baseline Ed25519/BLAKE3 signatures with forward secrecy and automatic key rotation.

### Protocol

1. **Key Exchange**: X25519 Diffie-Hellman ephemeral key agreement
2. **Session Cipher**: ChaCha20-Poly1305 authenticated encryption
3. **Rotation**: Automatic re-keying after N messages or T seconds
4. **Zeroization**: All key material securely erased after rotation

### Key Features

- **Forward Secrecy**: Compromise of long-term keys doesn't expose past sessions
- **Automatic Rotation**: Configurable epochs (default: 10,000 messages or 1 hour)
- **Hardware Entropy**: TPM/RNG integration with software fallback
- **Key Zeroization**: All ephemeral keys zeroized immediately after use
- **Replay Protection**: Combined with nonce tracking from stream layer

### Performance

Measured performance (debug build):
- Key generation: ~130μs median
- Key exchange (DH): ~680μs median
- **Full rotation: ~1.6ms median** ✓ (target: <5ms)
- Encryption: ~110μs per message
- Decryption: ~110μs per message

Release builds are typically 10-20x faster.

### Security Guarantees

**Protected Against:**
- Passive eavesdropping (authenticated encryption)
- Key compromise after rotation (forward secrecy)
- Message tampering (AEAD auth tag)
- Replay attacks (when combined with nonce tracking)

**Threat Model:**
- Long-term signing keys may be compromised → session keys provide forward secrecy
- Network attacker may capture traffic → cannot decrypt without session keys
- Active attacker may tamper with messages → AEAD detects tampering

**Not Protected Against:**
- Compromised session keys before rotation → rotate frequently
- Side-channel attacks → use constant-time operations
- Denial of service → apply rate limiting externally

### Usage Example

```rust
use fourmik_crypto::{SessionManager, KeyExchangeMessage};

// Initialize session managers for two parties
let mut alice = SessionManager::new("alice".to_string());
let mut bob = SessionManager::new("bob".to_string());

// Initial key exchange handshake
let alice_msg = alice.initiate_session()?;
let bob_msg = bob.initiate_session()?;

// In production: sign these messages with Ed25519 identity keys
// and verify signatures before completing handshake

alice.complete_key_exchange(&bob_msg)?;
bob.complete_key_exchange(&alice_msg)?;

// Encrypt and decrypt messages
let plaintext = b"Sensitive operational data";
let (ciphertext, nonce) = alice.encrypt(plaintext)?;
let decrypted = bob.decrypt(&ciphertext, &nonce)?;

// Check if rotation is needed
if alice.rotation_required() {
    let alice_rotate = alice.initiate_rotation()?;
    let bob_rotate = bob.initiate_rotation()?;
    
    // Sign and verify rotation messages
    
    alice.complete_rotation(&bob_rotate)?;
    bob.complete_rotation(&alice_rotate)?;
}
```

### Handshake Protocol

#### Initial Session Establishment

1. Both parties generate ephemeral X25519 keypairs
2. Exchange `KeyExchangeMessage` containing:
   - Ephemeral public key (32 bytes)
   - Sender identity ID
   - Timestamp (replay protection)
   - Epoch number
   - Ed25519 signature over all fields
3. Verify peer's Ed25519 signature
4. Compute shared secret via X25519 DH
5. Derive ChaCha20-Poly1305 session key from shared secret

#### Key Rotation

Rotation is triggered when:
- Message count reaches 10,000 (configurable)
- Epoch duration exceeds 1 hour (configurable)
- Manual rotation requested

Rotation protocol:
1. Both parties generate new ephemeral X25519 keypairs
2. Exchange new `KeyExchangeMessage` (epoch incremented)
3. Verify signatures
4. Compute new shared secret
5. Rotate to new session cipher
6. Old keys are immediately zeroized

#### Fallback Mechanisms

If key rotation fails:
- Session remains in current epoch
- Continue using current keys until rotation succeeds
- Log rotation failure for monitoring
- Retry rotation on next message

If entropy source is unavailable:
- Fall back to OS RNG (cryptographically secure)
- Log entropy source failure
- Continue operation with degraded entropy indicator

### Entropy Sources

**Primary**: Hardware RNG (TPM 2.0 or system RNG)
- `/dev/hwrng` on Linux
- TPM 2.0 `TPM2_GetRandom`
- Intel RDRAND instruction

**Fallback**: OS-provided CSPRNG
- `/dev/urandom` on Unix
- `getrandom()` syscall
- `BCryptGenRandom` on Windows

The implementation automatically falls back to OS RNG if hardware entropy is unavailable.

### Key Material Lifecycle

1. **Generation**: Ephemeral keys generated from hardware entropy
2. **Exchange**: Public keys exchanged, signed by identity keys
3. **Use**: Session cipher encrypts/decrypts messages
4. **Rotation**: New keys generated, old keys replaced
5. **Zeroization**: Old keys overwritten with zeros immediately
6. **Drop**: Rust Drop trait ensures cleanup on scope exit

All secret key material is held in memory structures that implement secure cleanup:
- `EphemeralSecret`: Zeroized by x25519-dalek
- `SharedSecret`: Zeroized by x25519-dalek
- Session keys: Zeroized on rotation or drop

### Integration with Identity Layer

Session cipher rotation works in tandem with the identity layer:

1. **Identity Keys**: Long-term Ed25519 keys (from `fourmik-identity`)
2. **Session Keys**: Ephemeral X25519 keys (this module)
3. **Handshake**: Key exchange messages signed with identity keys
4. **Verification**: Signatures verified before completing handshake
5. **Trust Score**: Identity trust score affects session establishment

Example integration:

```rust
use fourmik_identity::IdentityManager;
use fourmik_crypto::SessionManager;

// Identity layer
let identity_mgr = IdentityManager::new();
let my_identity = identity_mgr.get("alice")?;

// Session layer
let mut session_mgr = SessionManager::new("alice".to_string());
let key_exchange_msg = session_mgr.initiate_session()?;

// Sign key exchange with identity key
let signature = sign_with_identity(&my_identity, &key_exchange_msg)?;
key_exchange_msg.signature = signature;

// Send to peer, receive peer's message
// Verify peer's identity signature before completing handshake
verify_peer_identity(&peer_msg)?;
session_mgr.complete_key_exchange(&peer_msg)?;
```

## Data Contracts

### Core Types

```rust
/// Cryptographic signature with metadata
pub struct Signature {
    pub algorithm: SignatureAlgorithm,  // Ed25519, ECDSA, RSA-PSS
    pub signature_bytes: Vec<u8>,
    pub public_key: Vec<u8>,
    pub timestamp: u64,
}

/// Supported signature algorithms
pub enum SignatureAlgorithm {
    Ed25519,
    EcdsaP256,
    EcdsaSecp256k1,
    RsaPss2048,
    RsaPss4096,
}

/// Cryptographic hash with algorithm
pub struct Hash {
    pub algorithm: HashAlgorithm,       // SHA256, SHA3, BLAKE3
    pub hash_bytes: Vec<u8>,
}

/// Supported hash algorithms
pub enum HashAlgorithm {
    Sha256,
    Sha3_256,
    Blake3,
}

/// Key pair for asymmetric operations
pub struct KeyPair {
    pub algorithm: SignatureAlgorithm,
    pub public_key: Vec<u8>,
    pub secret_key: Vec<u8>,  // Must be zeroized on drop
    pub created_at: u64,
}

/// Session key exchange message
pub struct KeyExchangeMessage {
    pub public_key: [u8; 32],     // X25519 public key
    pub sender_id: String,         // Identity ID
    pub timestamp: u64,            // Unix epoch microseconds
    pub epoch: u64,                // Epoch number
    pub signature: Vec<u8>,        // Ed25519 signature
}
```

### API Surface

- `generate_keypair(algorithm: SignatureAlgorithm) -> Result<KeyPair>`
- `sign(message: &[u8], keypair: &KeyPair) -> Result<Signature>`
- `verify(message: &[u8], signature: &Signature) -> Result<bool>`
- `hash(data: &[u8], algorithm: HashAlgorithm) -> Result<Hash>`
- `hmac(key: &[u8], data: &[u8]) -> Result<Vec<u8>>`
- `secure_random(len: usize) -> Result<Vec<u8>>`

**Session Cipher API:**
- `SessionManager::new(local_id: String) -> SessionManager`
- `SessionManager::initiate_session() -> Result<KeyExchangeMessage>`
- `SessionManager::complete_key_exchange(peer_msg) -> Result<()>`
- `SessionManager::encrypt(plaintext) -> Result<(Vec<u8>, [u8; 12])>`
- `SessionManager::decrypt(ciphertext, nonce) -> Result<Vec<u8>>`
- `SessionManager::rotation_required() -> bool`
- `SessionManager::initiate_rotation() -> Result<KeyExchangeMessage>`
- `SessionManager::complete_rotation(peer_msg) -> Result<()>`

## Security Invariants

1. Never implement custom cryptographic primitives
2. All signatures must be verified before trust is granted
3. Secret keys must be zeroized immediately on drop
4. Use constant-time operations for sensitive comparisons
5. No cryptographic material in logs or error messages
6. Enforce minimum key sizes (Ed25519: 256-bit, RSA: 2048-bit)
7. **Session keys rotated automatically after epoch limit**
8. **All ephemeral keys zeroized after rotation**
9. **Hardware entropy preferred, software fallback available**
10. **Key exchange messages must be signed with identity keys**

## Integration

### With Identity
- Provides signature operations for identity binding
- Key generation for platform identities
- Session handshake signed with identity keys

### With Mesh
- Signs mesh messages for authentication
- Verifies signatures on received messages
- Encrypts mesh traffic with session ciphers

### With ISR/RF
- Hashing for data integrity and provenance
- Signature verification for authenticated feeds
- Session encryption for sensitive ISR data

## CodeRalphie Integration Points

Crypto operations exposed for external verification:

- **Signature Verification**: `/api/crypto/verify` - Verify signatures on external data
- **Public Key Distribution**: `/api/crypto/pubkey` - Retrieve public keys
- **Hash Verification**: `/api/crypto/hash` - Compute and verify hashes
- **Session Establishment**: `/api/crypto/session/init` - Initiate session with external system
- **Session Rotation**: `/api/crypto/session/rotate` - Coordinate key rotation

## Testing

Run unit tests:
```bash
cargo test -p fourmik-crypto
```

Run performance benchmarks:
```bash
cargo test -p fourmik-crypto bench_ -- --nocapture
```

Test coverage includes:
- ✓ Key generation and exchange
- ✓ Shared secret computation
- ✓ Encryption/decryption round-trip
- ✓ AEAD authentication tag verification
- ✓ Key rotation triggers (message count, time)
- ✓ Full session rotation protocol
- ✓ Session manager handshake and rotation
- ✓ Performance benchmarks (<5ms rotation target)
