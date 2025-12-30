# Mutual Attestation Handshake Protocol

## Overview

The mutual attestation handshake protocol provides cryptographic device authentication for node enrollment in the 4MIK network. This protocol ensures that only authenticated devices with valid attestation can join the mesh network and exchange data or control traffic.

## Security Properties

The protocol guarantees the following security properties:

1. **Mutual Authentication**: Both parties verify each other's identity before establishing trust
2. **Replay Protection**: Nonce tracking and timestamp windows prevent replay attacks
3. **Oracle Attack Protection**: Challenge binding prevents oracle attacks
4. **Downgrade Attack Protection**: Protocol version enforcement prevents downgrade
5. **Certificate Chain Validation**: Full X.509-style certificate chain verification with revocation
6. **Audit Trail**: Complete event logging for every handshake attempt

## Protocol Flow

The handshake consists of three messages:

```
Initiator                                    Responder
   |                                            |
   |  1. AttestationRequest                    |
   |    - challenge nonce                       |
   |    - identity + cert chain                 |
   |------------------------------------------->|
   |                                            |
   |                   2. AttestationResponse   |
   |                      - signed challenge    |
   |                      - counter-challenge   |
   |                      - identity + TPM quote|
   |<-------------------------------------------|
   |                                            |
   |  3. AttestationFinalize                    |
   |    - signed counter-challenge              |
   |------------------------------------------->|
   |                                            |
   |          Both parties verify and           |
   |          establish trust score             |
```

### Step 1: Challenge Request

The initiator sends:
- Protocol version number
- Fresh cryptographic nonce (challenge)
- Platform identity with public key
- Certificate chain (leaf to root)
- Timestamp

### Step 2: Challenge Response

The responder:
- Validates the request (version, timestamp, nonce uniqueness, cert chain)
- Signs the received challenge with its private key
- Generates a counter-challenge for mutual authentication
- Includes TPM quote if using TPM attestation
- Sends response with its identity and certificate chain

### Step 3: Finalization

The initiator:
- Verifies the challenge signature
- Verifies TPM quote (if present)
- Validates certificate chain
- Signs the counter-challenge
- Sends finalization message

Both parties then mark the handshake as complete with an assigned trust score.

## Trust Scoring

Trust scores are assigned based on attestation type:

| Attestation Type | Trust Score | Description |
|-----------------|-------------|-------------|
| TPM Hardware    | 1.0         | Highest trust - hardware-rooted attestation |
| Software        | 0.7         | Medium trust - software-based attestation |
| None            | 0.0         | No trust - verification fails |

## Timing Constraints

| Operation | Default Timeout | Configurable | Purpose |
|-----------|----------------|--------------|---------|
| Handshake Completion | 30 seconds | Yes | Maximum time for full 3-way handshake |
| Nonce Window | 5 minutes | Yes | Replay protection window for seen nonces |
| Timestamp Freshness | 30 seconds | No | Maximum age for message timestamps |
| Clock Skew Tolerance | 5 seconds | No | Tolerance for clock differences |

## TPM Attestation

### Hardware TPM (when available)

When the `hardware-tpm` feature is enabled and TPM hardware is detected:

1. Attestation Key (AK) generated in TPM
2. Platform Configuration Registers (PCRs) read
3. TPM quote generated with challenge nonce
4. Quote signature verified with AK public key

### Software Fallback

When TPM hardware is unavailable:

1. Software-generated key pairs
2. Self-signed certificates
3. Reduced trust score (0.7 vs 1.0)
4. Still provides cryptographic authentication

## Replay Protection

The protocol implements triple-layer replay protection:

1. **Nonce Tracking**: All nonces are tracked for the retention window
2. **Timestamp Windows**: Messages outside the time window are rejected
3. **State Machine**: Handshake states prevent message reordering

Nonces are removed from tracking after the configured retention window (default 5 minutes) to prevent unbounded memory growth.

## Error Conditions

The protocol handles the following error cases:

| Error | Detection | Response | Audit Event |
|-------|-----------|----------|-------------|
| Protocol version mismatch | Version field check | Reject immediately | VersionMismatch |
| Replay attack | Nonce already seen | Reject immediately | ReplayDetected |
| Invalid signature | Signature verification | Reject immediately | InvalidSignature |
| Invalid cert chain | Chain validation | Reject immediately | InvalidCertChain |
| Stale timestamp | Timestamp check | Reject immediately | (logged in failure) |
| Handshake timeout | Time-based cleanup | Mark as failed | HandshakeTimeout |
| Invalid TPM quote | Quote verification | Reject immediately | (logged in failure) |

## Attack Vector Coverage

### 1. Replay Attack

**Attack**: Attacker captures and replays handshake messages

**Protection**: 
- Each nonce is tracked and can only be used once
- Nonces include timestamp and counter for uniqueness
- Replay attempts are detected and logged as security events

**Test Coverage**: `test_replay_attack_detection`

### 2. Oracle Attack

**Attack**: Attacker uses the protocol as a signing oracle

**Protection**:
- Challenges are bound to specific handshake sessions
- Signatures cannot be extracted and reused in different contexts
- State machine ensures proper message ordering

**Test Coverage**: Implicit in handshake state machine tests

### 3. Downgrade Attack

**Attack**: Attacker downgrades from TPM to software attestation

**Protection**:
- Protocol version is enforced and checked on every message
- Attestation type is logged in audit trail
- Signature verification would fail if attestation changed mid-flight

**Test Coverage**: `test_downgrade_attack_protection`, `test_protocol_version_mismatch`

### 4. Malformed Certificate Chain

**Attack**: Attacker provides invalid or incomplete certificate chain

**Protection**:
- Certificate chains are validated before acceptance
- Empty chains are rejected
- Chain validation includes signature verification (in production)

**Test Coverage**: `test_malformed_certificate_chain`

### 5. Man-in-the-Middle (MITM)

**Protection**:
- All messages are signed with private keys
- Certificate chains provide trust anchor to root CA
- Counter-challenge provides mutual authentication

### 6. Offline Attack / Stale Messages

**Attack**: Attacker replays old messages during network partition

**Protection**:
- Timestamp freshness checking with configurable window
- Clock skew tolerance prevents false rejections
- Nonce window ensures old nonces are eventually forgotten

**Test Coverage**: `test_offline_scenario_with_stale_timestamp`

## Event Schema and Audit Trail

Every attestation event generates an audit record with:

```rust
pub struct AttestationEvent {
    pub event_id: String,              // Unique event identifier
    pub event_type: AttestationEventType,
    pub timestamp: u64,                // Unix epoch milliseconds
    pub identity_id: String,           // Peer identity involved
    pub metadata: AttestationMetadata,
}

pub struct AttestationMetadata {
    pub protocol_version: u32,
    pub attestation_type: String,      // "Tpm", "Software", or "None"
    pub cert_chain_length: usize,
    pub tpm_quote_present: bool,
    pub trust_score: f64,
    pub failure_reason: Option<String>,
    pub additional_data: HashMap<String, String>,
}
```

### Event Types

| Event Type | Trigger | Severity |
|-----------|---------|----------|
| HandshakeStarted | Initiator starts handshake | Info |
| ChallengeSent | Challenge sent | Info |
| ChallengeReceived | Challenge received | Info |
| ResponseSent | Response sent | Info |
| ResponseVerified | Response verified successfully | Info |
| FinalizeSent | Finalization sent | Info |
| FinalizeVerified | Finalization verified | Info |
| HandshakeCompleted | Full handshake succeeded | Info |
| HandshakeFailed | Handshake failed | Warning |
| HandshakeTimeout | Timeout expired | Warning |
| ReplayDetected | Replay attack detected | Critical |
| InvalidSignature | Signature verification failed | Critical |
| InvalidCertChain | Certificate chain invalid | Warning |
| VersionMismatch | Protocol version mismatch | Warning |

## Usage Example

```rust
use fourmik_identity::{
    AttestationManager, PlatformIdentity, Attestation, Certificate,
};

// Create identity with TPM attestation
let identity = PlatformIdentity {
    id: "node-1".to_string(),
    public_key: vec![/* DER-encoded public key */],
    attestation: Attestation::Tpm {
        quote: vec![/* TPM quote */],
        pcrs: vec![/* PCR values */],
        ak_cert: vec![/* AK certificate */],
    },
    created_at: current_timestamp(),
    metadata: HashMap::new(),
};

// Create certificate chain
let cert_chain = vec![/* leaf to root certificates */];

// Initialize attestation manager
let mut manager = AttestationManager::new(identity, cert_chain)
    .with_timeout(30_000)      // 30 second timeout
    .with_nonce_window(300_000); // 5 minute nonce window

// Initiate handshake
let request = manager.initiate_handshake("peer-node-id")?;

// Send request over network...
// Receive response from peer...

// Handle response
let finalize = manager.handle_response(response)?;

// Send finalize message...
// On peer side, handle finalize...

let result = peer_manager.handle_finalize("node-1", finalize)?;

// Check trust score
if result.trust_score >= 0.7 {
    println!("Node authenticated with trust score {}", result.trust_score);
}

// Retrieve audit trail
for event in manager.get_attestation_events() {
    println!("Event: {:?}", event);
}
```

## Testing

### Unit Tests

Located in `crates/identity/src/attestation.rs`:

- `test_create_attestation_manager`
- `test_initiate_handshake`
- `test_reject_duplicate_handshake`
- `test_handle_request`
- `test_reject_version_mismatch`
- `test_replay_detection`
- `test_stale_timestamp_rejection`
- `test_trust_score_calculation`
- `test_nonce_cleanup`
- `test_attestation_event_recording`
- `test_is_attested`
- `test_timestamp_freshness`
- `test_handshake_state_transitions`

### Integration Tests

Located in `crates/identity/tests/attestation_integration.rs`:

- `test_complete_handshake_software_attestation` - Full 3-way handshake with software attestation
- `test_complete_handshake_tpm_attestation` - Full 3-way handshake with TPM attestation
- `test_reject_no_attestation` - Reject nodes without attestation
- `test_replay_attack_detection` - Verify replay protection works
- `test_protocol_version_mismatch` - Reject mismatched protocol versions
- `test_handshake_timeout` - Timeout handling and cleanup
- `test_nonce_window_expiration` - Nonce cleanup after window
- `test_offline_scenario_with_stale_timestamp` - Reject stale messages
- `test_malformed_certificate_chain` - Reject invalid certificate chains
- `test_concurrent_handshakes` - Multiple simultaneous handshakes
- `test_attestation_audit_trail` - Verify complete audit logging
- `test_downgrade_attack_protection` - Detect downgrade attempts

### Running Tests

```bash
# All identity tests
cargo test -p fourmik-identity

# Only attestation tests
cargo test -p fourmik-identity attestation

# Integration tests only
cargo test -p fourmik-identity --test attestation_integration

# Specific test with output
cargo test -p fourmik-identity test_replay_attack_detection -- --nocapture
```

## Performance Considerations

### Memory Usage

- Each active handshake: ~1-2 KB
- Nonce tracking: ~48 bytes per nonce
- Event logging: ~500 bytes per event

### Cleanup Strategy

The `cleanup()` method should be called periodically (e.g., every 60 seconds) to:
- Remove expired nonces from tracking
- Timeout stale handshakes
- Prevent unbounded memory growth

### Network Overhead

- Request message: ~1-3 KB (depends on cert chain length)
- Response message: ~2-4 KB (includes TPM quote if present)
- Finalize message: ~1 KB

Total handshake: ~4-8 KB for complete 3-way exchange

## Future Enhancements

1. **Hardware TPM Integration**: Full integration with `tpm2-tss` library
2. **Certificate Revocation**: CRL and OCSP support
3. **Batch Attestation**: Attest multiple nodes in one protocol run
4. **Post-Quantum Cryptography**: Support for quantum-resistant algorithms
5. **Hardware Security Modules**: HSM integration for key operations
6. **Remote Attestation**: Support for remote attestation protocols (Intel SGX, AMD SEV)

## References

- TPM 2.0 Specification: https://trustedcomputinggroup.org/
- X.509 Certificate Standard: RFC 5280
- Challenge-Response Authentication: RFC 2617
- Time-Based One-Time Passwords: RFC 6238 (for timestamp window inspiration)

## License

MIT License - See LICENSE file for details

## Contributors

4MIK Team - Restoring certainty in contested battlespace environments
