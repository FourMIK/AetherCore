# Identity Registry gRPC Server Implementation

## Overview

The Identity Registry gRPC Server implementation provides hardware-rooted identity verification for the 4MIK Trust Fabric. This server is the gatekeeper of the "Great Gospel" - the system-wide ledger of identity enrollment and revocation.

## Architecture

### Components

1. **IdentityRegistryService**: Core gRPC service implementing the IdentityRegistry trait
2. **IdentityManager**: In-memory identity storage and lifecycle management
3. **TpmManager**: TPM attestation validation (hardware-rooted trust)
4. **Admin Authority**: Signature-based revocation control

### Security Model

The implementation follows these strict security principles:

#### NO GRACEFUL DEGRADATION
If hardware attestation fails, the node is **Byzantine** and is rejected immediately. There is no fallback to software-only attestation for production node registration.

#### Hardware-Rooted Trust (CodeRalphie Integration)
All nodes must provide:
- **TPM Quote**: Hardware-signed attestation
- **PCR Values**: Platform Configuration Register measurements
- **AK Certificate**: Attestation Key certificate

#### Fail-Visible Logging
Every failed registration attempt is logged with:
- Node ID
- Specific rejection reason
- Timestamp
- Error classification (e.g., "Invalid EK Signature", "NodeID mismatch")

## Endpoints

### RegisterNode
Registers a new device with hardware attestation.

**Security Checks:**
1. Validates NodeID matches BLAKE3(public_key)
2. Requires non-empty TPM quote
3. Validates TPM quote signature using TpmManager
4. Requires PCR values
5. Requires AK certificate

**Failure Modes:**
- `Status::InvalidArgument`: Malformed request data
- `Status::PermissionDenied`: TPM attestation validation failure, NodeID mismatch

**Example Request:**
```rust
RegisterNodeRequest {
    node_id: "a1b2c3...", // BLAKE3 hash of public key
    public_key_hex: "0123456789abcdef...",
    tpm_quote: vec![...], // TPM signature
    pcrs: vec![...], // PCR measurements
    ak_cert: vec![...], // AK certificate
    timestamp_ms: 1704326400000,
}
```

### VerifySignature
Verifies a signed message from an enrolled node.

**Security Checks:**
1. Node must be enrolled (registered and not revoked)
2. Timestamp must be within 5-minute window (replay protection)
3. Ed25519 signature verification

**Failure Modes:**
- Unknown node
- Replay attack detection
- Invalid signature

### IsNodeEnrolled
Checks if a node is currently enrolled (registered and not revoked).

### GetPublicKey
Retrieves the Ed25519 public key for an enrolled node.

### RevokeNode (Aetheric Sweep)
Revokes a node's identity. **Requires admin authority signature.**

**Security Checks:**
1. Verifies admin nodes are configured
2. Validates authority signature against admin node public keys
3. Payload includes: node_id + reason + timestamp

**Failure Modes:**
- `Status::PermissionDenied`: No admin nodes configured or invalid authority signature

## Usage

### Starting the Server

```rust
use aethercore_identity::grpc_server::start_grpc_server;
use aethercore_identity::{IdentityManager, TpmManager};
use std::sync::{Arc, Mutex};

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let identity_manager = Arc::new(Mutex::new(IdentityManager::new()));
    let tpm_manager = Arc::new(Mutex::new(TpmManager::new(false))); // Use true for hardware TPM
    
    let addr = "0.0.0.0:50051".parse()?;
    start_grpc_server(addr, identity_manager, tpm_manager).await?;
    
    Ok(())
}
```

### Client Example

```rust
use aethercore_identity::grpc_server::proto::identity_registry_client::IdentityRegistryClient;
use aethercore_identity::grpc_server::proto::*;

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let mut client = IdentityRegistryClient::connect("http://127.0.0.1:50051").await?;
    
    // Register a node
    let response = client.register_node(RegisterNodeRequest {
        node_id: compute_node_id(&public_key),
        public_key_hex: hex::encode(&public_key),
        tpm_quote: generate_tpm_quote(),
        pcrs: get_pcr_values(),
        ak_cert: get_ak_certificate(),
        timestamp_ms: current_timestamp_ms(),
    }).await?;
    
    Ok(())
}
```

## Testing

Comprehensive integration tests are provided in `tests/grpc_server_integration.rs`:

```bash
# Run all tests
cargo test -p aethercore-identity --features grpc-server

# Run specific integration tests
cargo test -p aethercore-identity --features grpc-server --test grpc_server_integration
```

### Test Coverage

- ✅ Node registration with valid TPM attestation
- ✅ Registration failure without TPM quote
- ✅ Registration failure with invalid NodeID
- ✅ Node enrollment status check
- ✅ Public key retrieval
- ✅ Signature verification with enrolled node
- ✅ Revocation without authority signature (failure)

## Configuration

### TPM Manager

The TpmManager can be configured for:
- **Stub Mode** (`use_hardware=false`): For testing and development
- **Hardware Mode** (`use_hardware=true`): For production with real TPM 2.0

### Admin Nodes

Admin nodes can be configured using the `with_admin_nodes` constructor:

```rust
let service = IdentityRegistryService::with_admin_nodes(
    identity_manager,
    tpm_manager,
    vec!["admin_node_id_1".to_string(), "admin_node_id_2".to_string()],
);
```

## Security Considerations

### TPM Attestation
- In stub mode, basic structural validation is performed
- In hardware mode, full TPM 2.0 quote verification is required
- Invalid attestation results in immediate rejection with `Status::PermissionDenied`

### Signature Verification
- Uses Ed25519 for cryptographic signatures
- 5-minute timestamp window for replay protection
- All signature failures are logged with security event types

### Authority Control
- Revocation requires signature from configured admin nodes
- Admin signatures verified using Ed25519 with admin node public keys
- Payload binding: signature covers node_id + reason + timestamp

## Logging

The implementation uses structured logging with `tracing`:

```rust
tracing::info!("Node {} successfully registered with TPM attestation", node_id);
tracing::warn!("Registration failed for node {}: {}", node_id, reason);
tracing::error!("Registration DENIED for node {}: Invalid TPM attestation", node_id);
```

### Log Levels
- **INFO**: Successful operations
- **WARN**: Failed registration attempts (client errors)
- **ERROR**: Security failures (Byzantine nodes)

## Future Enhancements

1. **PostgreSQL Backend**: Replace in-memory storage with persistent database
2. **Challenge-Response**: Full challenge-response protocol for RegisterNode
3. **Certificate Revocation List**: Maintain CRL for revoked nodes
4. **Metrics**: Prometheus metrics for monitoring
5. **Rate Limiting**: Protection against DoS attacks
6. **TLS**: Mutual TLS authentication for gRPC connections

## References

- Protocol Buffer Definition: `proto/identity_registry.proto`
- Attestation Manager: `src/attestation.rs`
- TPM Manager: `src/tpm.rs`
- Identity Manager: `src/device.rs`
