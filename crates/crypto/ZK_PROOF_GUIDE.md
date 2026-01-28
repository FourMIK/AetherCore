# Zero-Knowledge Proof System Guide

## Overview

The AetherCore ZK proof system implements Groth16 proofs over the BN254 elliptic curve for device attestation and location verification. This implementation replaces all security theater with cryptographically verifiable proofs.

## Architecture

### Dependencies

The system uses the **arkworks** cryptographic library ecosystem:

- `ark-bn254`: BN254 elliptic curve (Ethereum-compatible)
- `ark-groth16`: Groth16 zkSNARK proof system
- `ark-snark`: Generic SNARK trait definitions
- `ark-serialize`: Proof serialization/deserialization
- `ark-ff`: Finite field arithmetic
- `ark-ec`: Elliptic curve operations
- `ark-std`: Standard library abstractions

### Circuit Compatibility

The prover is designed to work with circuits compiled using **Circom**, the industry-standard zero-knowledge circuit compiler. This ensures:

- **Ethereum Compatibility**: BN254 curve is the standard for Ethereum zkSNARKs
- **Toolchain Interoperability**: Use existing Circom tooling for circuit development
- **Community Validation**: Leverage battle-tested circuit designs

## Deployment Modes

### Production Mode (with Circuit Artifacts)

In production, the prover requires three circuit artifacts:

1. **circuit.wasm** - Witness generator (compiled circuit logic)
2. **circuit.r1cs** - Rank-1 Constraint System (circuit constraints)
3. **circuit.zkey** - Proving Key (from trusted setup)

```rust
use std::path::Path;
use aethercore_crypto::zk::{ZkProver, ZkPrivateInputs, ZkPublicInputs};

let mut prover = ZkProver::new();

// Initialize with circuit artifacts
prover.initialize(
    Path::new("./circuits/device_auth.wasm"),
    Path::new("./circuits/device_auth.r1cs"),
    Path::new("./circuits/device_auth.zkey"),
)?;

// Generate proof
let private_inputs = ZkPrivateInputs::new(
    device_secret,      // [u8; 32] - TPM-backed device secret
    device_salt,        // [u8; 32] - Random salt for commitment
    location_hash,      // [u8; 32] - BLAKE3 hash of GPS coordinates
    location_nonce,     // [u8; 32] - Random nonce for location commitment
    timestamp,          // u64 - Unix milliseconds
    neighbor_attestations, // [[u8; 32]; 4] - Attestations from nearby devices
);

let public_inputs = ZkPublicInputs::new(
    device_commitment,           // [u8; 32] - Public commitment to device
    merkle_root,                // [u8; 32] - Root of authorized device tree
    current_time,               // u64 - Current time for temporal validation
    expected_location_commitment, // [u8; 32] - Expected location commitment
    expected_attestation_root,   // [u8; 32] - Expected attestation root
    max_age,                    // u64 - Maximum proof age in milliseconds
);

let proof = prover.generate_proof(&private_inputs, &public_inputs)?;
```

### Mock Mode (for Testing)

For development and testing without circuit artifacts:

```rust
let mut prover = ZkProver::new();
prover.initialize_mock()?;

// Generate mock proofs (structurally valid, cryptographically meaningless)
let proof = prover.generate_proof(&private_inputs, &public_inputs)?;
```

## Fail-Visible Security Pattern

The system follows the **"Truth as a Weapon"** doctrine - no graceful degradation for security failures.

### Missing Artifacts

```rust
let result = prover.initialize(
    Path::new("/nonexistent/circuit.wasm"),
    Path::new("/nonexistent/circuit.r1cs"),
    Path::new("/nonexistent/circuit.zkey"),
);

// Returns: Err(ZkError::ProvingKeyNotFound(
//   "CRITICAL: ZK Artifacts missing at /nonexistent/circuit.zkey. 
//    Deployment unsafe. Error: No such file or directory"
// ))
```

The system **PANICS** in production if artifacts are missing. There is no silent fallback.

### Temporal Violations

```rust
// Proof from the future
let result = prover.generate_proof(&private_inputs, &public_inputs);
// Returns: Err(ZkError::TemporalViolation(
//   "Timestamp 3000000 is in the future (current: 2000000)"
// ))

// Stale proof (exceeds max_age)
let result = prover.generate_proof(&old_private_inputs, &public_inputs);
// Returns: Err(ZkError::TemporalViolation(
//   "Proof age 1000000 exceeds maximum allowed age 300000"
// ))
```

## Proof Structure

### ZkProof Components

A Groth16 proof consists of three elliptic curve points:

```rust
pub struct ZkProof {
    pub pi_a: Vec<u8>,     // 64 bytes - G1 point (π_A)
    pub pi_b: Vec<u8>,     // 128 bytes - G2 point (π_B)
    pub pi_c: Vec<u8>,     // 64 bytes - G1 point (π_C)
    pub protocol: String,  // "groth16"
    pub curve: String,     // "bn254"
}
```

Total proof size: **256 bytes** (excluding metadata).

### Proof Verification

```rust
let is_valid = prover.verify_proof(&proof, &public_inputs)?;

if !is_valid {
    // Proof is INVALID - device is adversarial
    // Initiate Aetheric Sweep to purge Byzantine node
    return Err(SecurityError::InvalidProof);
}
```

## Circuit Development Workflow

### 1. Write Circom Circuit

```circom
pragma circom 2.0.0;

template DeviceAuth() {
    // Private inputs (witness)
    signal input deviceSecret;
    signal input deviceSalt;
    signal input locationHash;
    signal input locationNonce;
    
    // Public inputs
    signal input merkleRoot;
    signal input currentTime;
    
    // Outputs
    signal output deviceCommitment;
    signal output locationCommitment;
    
    // Compute commitments using Poseidon hash
    component poseidon = Poseidon(2);
    poseidon.inputs[0] <== deviceSecret;
    poseidon.inputs[1] <== deviceSalt;
    deviceCommitment <== poseidon.out;
    
    // ... additional constraints ...
}

component main = DeviceAuth();
```

### 2. Compile Circuit

```bash
# Compile to R1CS and WASM
circom device_auth.circom --r1cs --wasm --sym

# Generate witness
node device_auth_js/generate_witness.js \
  device_auth_js/device_auth.wasm \
  input.json \
  witness.wtns
```

### 3. Trusted Setup

```bash
# Powers of Tau ceremony (if not using existing ceremony)
snarkjs powersoftau new bn128 14 pot14_0000.ptau
snarkjs powersoftau contribute pot14_0000.ptau pot14_0001.ptau \
  --name="First contribution"

# Generate proving and verification keys
snarkjs groth16 setup device_auth.r1cs pot14_final.ptau device_auth_0000.zkey
snarkjs zkey contribute device_auth_0000.zkey device_auth_final.zkey \
  --name="First contribution"

# Export verification key
snarkjs zkey export verificationkey device_auth_final.zkey vkey.json
```

### 4. Deploy Artifacts

Place the compiled artifacts in your deployment:

```
circuits/
├── device_auth.wasm      # Witness generator
├── device_auth.r1cs      # Constraint system
└── device_auth.zkey      # Proving key
```

## Security Considerations

### Trusted Setup

Groth16 requires a **trusted setup** ceremony. The security of the system depends on at least one participant in the setup being honest and destroying their toxic waste.

**Recommendations:**
- Use a multi-party computation (MPC) ceremony
- Require N-of-M participants (e.g., 5-of-10)
- Document all participants and their contributions
- Store ceremony transcripts in The Great Gospel (system-wide ledger)

### Hash Function Selection

**BLAKE3 ONLY** - per architectural invariants:
- All commitments use BLAKE3
- Poseidon hash (for circuit compatibility) is acceptable
- **PROHIBITED**: SHA-256, MD5, SHA-1

### TPM Integration

Device secrets must be TPM-backed (CodeRalphie):
- Private keys never reside in system memory
- Use TPM 2.0 or Secure Enclave for key operations
- Integrate with `crates/identity` for hardware-rooted trust

### Replay Attack Prevention

Temporal validation prevents replay attacks:
- Every proof includes a timestamp
- System enforces maximum proof age (configurable)
- Proofs from the future are rejected
- Stale proofs are rejected

## Performance Characteristics

### Proof Generation

- **Time**: ~100-500ms (depends on circuit complexity)
- **Memory**: ~50-200MB (circuit-dependent)
- **Edge Optimization**: Designed for ARM/RISC-V low-power devices

### Proof Verification

- **Time**: ~5-10ms (constant, independent of circuit size)
- **Memory**: ~10MB (verification key size)
- **Ethereum Gas**: ~250,000-300,000 (if verified on-chain)

## Error Handling

All operations return `Result<T, ZkError>`:

```rust
pub enum ZkError {
    NotInitialized,                  // Prover not initialized
    ProvingKeyNotFound(String),      // Missing circuit artifacts
    VerificationKeyNotFound(String), // Missing verification key
    TemporalViolation(String),       // Time-based constraint failed
    CommitmentMismatch(String),      // Public input mismatch
    ProofGenerationFailed(String),   // Proof generation error
    VerificationFailed(String),      // Proof verification error
    InvalidInput(String),            // Invalid input data
    HashError(String),               // Hash computation error
}
```

**Never use `.unwrap()`** - all errors must be explicitly handled per Rust coding standards.

## Testing

### Unit Tests

```bash
cargo test --package aethercore-crypto --lib zk::prover
```

### Integration Tests

See `crates/crypto/src/zk/prover.rs` for comprehensive test examples:
- Initialization with missing artifacts
- Temporal validation (future timestamps, stale proofs)
- Invalid proof detection (wrong protocol, curve, size)
- Mock mode operation

## Future Roadmap

### Phase 1 (Current)
- ✅ Arkworks dependency integration
- ✅ Fail-visible artifact loading
- ✅ Mock proof generation for testing
- ✅ Structural proof validation

### Phase 2 (Next)
- Full Groth16 proof generation with loaded artifacts
- Circom circuit witness generation
- Production verification key integration
- Hardware acceleration for ARM/RISC-V

### Phase 3 (Future)
- High-assurance mode with online verification
- Distributed trusted setup automation
- Proof aggregation for mesh networks
- Ethereum L2 verification bridge

## References

- [Groth16 Paper](https://eprint.iacr.org/2016/260.pdf)
- [Arkworks Documentation](https://arkworks.rs/)
- [Circom Documentation](https://docs.circom.io/)
- [BN254 Curve Specification](https://eips.ethereum.org/EIPS/eip-196)
- [4MIK Architectural Invariants](../../docs/ARCHITECTURE.md)

## Support

For issues related to ZK proof implementation:
1. Check error messages (they are designed to be actionable)
2. Verify circuit artifacts are present and valid
3. Ensure temporal constraints are reasonable
4. Review architectural invariants compliance

**Remember**: If identity verification fails, the node is adversarial. No graceful degradation.
