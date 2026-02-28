# ATAK Plugin - Remaining Implementation Tasks

## Summary

This document provides a prioritized list of tasks that remain to complete the ATAK Trust Overlay Plugin for production deployment.

## Completed ✅

1. **AndroidEnrollmentKeyManager Integration**
   - Added `create(Context)` factory method
   - Implemented `getHardwareFingerprint()` method
   - Uses device identifiers + key security level

2. **JNI Native Methods**
   - Implemented `nativeInitialize()` - daemon initialization
   - Implemented `nativeStartDaemon()` - start trust daemon
   - Implemented `nativeStopDaemon()` - stop trust daemon
   - Implemented `nativeTriggerAethericSweep()` - Byzantine detection trigger

3. **Plugin Settings Persistence**
   - Replaced `DefaultPluginSettings` mock with `SharedPreferencesPluginSettings`
   - Uses `atak_trust_overlay` SharedPreferences

4. **Signature Field Support**
   - Added `signatureHex`, `signerNodeId`, `payloadHash` to `TrustEvent`
   - Parser extracts signature fields from CoT events
   - UI displays "UNVERIFIED" status for unsigned/unverified events

5. **UI Verification Status Display**
   - Markers show green (verified), amber (suspect), red (unverified/stale)
   - Detail panel shows signature verification status
   - Fail-visible design: unverified units explicitly marked

6. **JNI Dependencies**
   - Added `ed25519-dalek`, `hex`, `blake3` for crypto operations
   - Added `tonic`, `prost`, `tokio` for gRPC integration
   - Linked to `aethercore-identity` and `aethercore-crypto` crates

7. **Configuration Infrastructure**
   - Created `CONFIGURATION.md` with all settings documented
   - Environment variable support for `IDENTITY_REGISTRY_ENDPOINT` and `TPM_ENABLED`

## Remaining Tasks

### 🔴 Critical Priority (Required for Basic Operation)

#### 1. Complete Signature Verification Logic

**File**: `external/aethercore-jni/src/lib.rs:180-230`

**Task**: Implement the signature verification logic in `nativeVerifySignature()`.

**Two Implementation Options**:

**Option A: Local Verification (Simpler)**
```rust
// 1. Lookup public key for node_id from identity_manager
let identity_mgr = state.identity_manager.as_ref().ok_or(...)?;
let identity = identity_mgr.lock().unwrap().get(&node_id_str).ok_or(...)?;

// 2. Decode signature from hex
let signature_bytes = hex::decode(&signature_hex_str)?;
let signature = ed25519_dalek::Signature::from_slice(&signature_bytes)?;

// 3. Get verifying key from identity
let verifying_key = ed25519_dalek::VerifyingKey::from_bytes(&identity.public_key[..])?;

// 4. Verify signature
use ed25519_dalek::Verifier;
match verifying_key.verify(&payload_bytes, &signature) {
    Ok(_) => return JNI_TRUE,
    Err(_) => return JNI_FALSE,
}
```

**Option B: gRPC Remote Verification (Recommended for consistency)**
```rust
// 1. Create gRPC client to Identity Registry
let endpoint = state.grpc_endpoint.clone();
drop(state); // Release lock before async call

// 2. Make async gRPC call (requires tokio runtime)
let result = tokio::runtime::Runtime::new()
    .unwrap()
    .block_on(async {
        let mut client = IdentityRegistryClient::connect(endpoint).await?;
        let request = tonic::Request::new(VerifySignatureRequest {
            node_id: node_id_str,
            payload: payload_bytes,
            signature_hex: signature_hex_str,
            timestamp_ms: current_timestamp_ms(),
            nonce_hex: String::new(), // Generate nonce if needed
        });
        let response = client.verify_signature(request).await?;
        Ok(response.into_inner().is_valid)
    });

match result {
    Ok(true) => JNI_TRUE,
    _ => JNI_FALSE,
}
```

**Recommendation**: Start with Option A for simplicity, then migrate to Option B for production.

**Estimated Effort**: 2-4 hours

---

#### 2. Populate Identity Manager with Node Public Keys

**File**: `external/aethercore-jni/src/lib.rs`

**Task**: The identity manager is currently empty. Need to:

1. Load enrolled nodes from persistent storage or service
2. Register nodes with their public keys during daemon initialization
3. OR implement gRPC `GetPublicKey()` call to fetch keys on-demand

**Implementation**:
```rust
// In nativeInitialize, after creating identity_manager:

// Option A: Load from local storage
let enrolled_nodes = load_enrolled_nodes_from_storage(&storage_path_str)?;
for (node_id, public_key) in enrolled_nodes {
    let identity = PlatformIdentity {
        id: node_id,
        public_key,
        attestation: Attestation::None, // Or load from storage
        created_at: 0,
        metadata: HashMap::new(),
    };
    identity_manager.lock().unwrap().register(identity)?;
}

// Option B: Lazy load via gRPC when verification is needed
// (Implemented in nativeVerifySignature)
```

**Estimated Effort**: 3-5 hours

---

#### 3. Deploy Identity Registry gRPC Service

**Task**: The Identity Registry service must be running and accessible.

**Service Location**: `crates/identity/src/grpc_server.rs`

**Deployment Steps**:
1. Build the identity service binary:
   ```bash
   cargo build --release --bin aethercore-identity-server --features grpc-server
   ```

2. Deploy on device or gateway:
   ```bash
   ./target/release/aethercore-identity-server --bind 0.0.0.0:50051 --tpm-enabled=true
   ```

3. Configure endpoint in JNI:
   ```bash
   export IDENTITY_REGISTRY_ENDPOINT=http://localhost:50051
   ```

**Note**: For Android deployment, the service may need to run as a separate process or on a gateway device.

**Estimated Effort**: 4-6 hours (including deployment automation)

---

### 🟡 High Priority (Required for Trust)

#### 4. Add gRPC Client Integration in JNI

**File**: `external/aethercore-jni/src/lib.rs`

**Task**: Create a gRPC client module for Identity Registry service calls.

**Implementation**:
```rust
// Add module for gRPC client
mod identity_client {
    use tonic::transport::Channel;
    
    pub struct IdentityRegistryClient {
        client: aethercore_identity::proto::identity_registry_client::IdentityRegistryClient<Channel>,
    }
    
    impl IdentityRegistryClient {
        pub async fn connect(endpoint: &str) -> Result<Self, Box<dyn std::error::Error>> {
            let client = aethercore_identity::proto::identity_registry_client::IdentityRegistryClient::connect(endpoint.to_string()).await?;
            Ok(Self { client })
        }
        
        pub async fn verify_signature(
            &mut self,
            node_id: String,
            payload: Vec<u8>,
            signature_hex: String,
        ) -> Result<bool, Box<dyn std::error::Error>> {
            let request = tonic::Request::new(VerifySignatureRequest {
                node_id,
                payload,
                signature_hex,
                timestamp_ms: current_timestamp_ms(),
                nonce_hex: String::new(),
            });
            
            let response = self.client.verify_signature(request).await?;
            Ok(response.into_inner().is_valid)
        }
    }
}
```

**Challenges**:
- Need to manage tokio runtime in JNI context (consider lazy static runtime)
- Handle async/await in JNI callback (use `block_on`)
- Add connection retry logic and timeouts

**Estimated Effort**: 4-6 hours

---

#### 5. Add Signature Validation to Parser

**File**: `plugins/atak-trust-overlay/src/main/kotlin/com/aethercore/atak/trustoverlay/cot/TrustEventParser.kt`

**Task**: Optionally enforce signature verification before accepting events.

**Current State**: Parser extracts signature fields but doesn't verify them.

**Options**:

**Option A: Optional Verification (Current Behavior)**
```kotlin
// Accept events with or without signatures
// Mark signature status in TrustEvent
// UI shows UNVERIFIED for unsigned events
```

**Option B: Mandatory Verification (Production Mode)**
```kotlin
// After extracting signature fields:
val signatureHex = extractRequired(envelope, SIGNATURE_KEYS)
    ?: return reject("missing_signature", envelope)
val signerNodeId = extractRequired(envelope, SIGNER_NODE_ID_KEYS)
    ?: return reject("missing_signer_node_id", envelope)

// Call JNI verification
val verified = nativeVerifySignature(
    signerNodeId,
    canonicalPayload.toByteArray(),
    signatureHex
)

if (!verified) {
    return reject("signature_verification_failed", envelope)
}
```

**Recommendation**: Start with Option A, add Option B as a configurable mode via settings.

**Estimated Effort**: 2-3 hours

---

### 🟢 Medium Priority (Required for Production)

#### 6. Add Merkle Vine Parent Hash Validation

**Files**: 
- `TrustModel.kt` - Add `parentHash` field
- `TrustEventParser.kt` - Extract and validate parent hash
- `TrustStateStore.kt` - Track hash chain

**Task**: Validate that events form a valid Merkle Vine chain.

**Implementation**:
```kotlin
// In TrustEvent:
val parentHash: String? = null

// In TrustEventParser:
val parentHash = extractOptional(envelope, PARENT_HASH_KEYS)

// Validation (future):
if (parentHash != null) {
    val expectedParent = stateStore.getLastHashForUid(uid)
    if (expectedParent != null && expectedParent != parentHash) {
        return reject("parent_hash_mismatch", envelope)
    }
}
```

**Estimated Effort**: 3-4 hours

---

#### 7. Implement Byzantine Node Revocation

**File**: `external/aethercore-jni/src/lib.rs:156-177`

**Task**: Complete the `nativeTriggerAethericSweep()` implementation.

**Implementation**:
```rust
// In nativeTriggerAethericSweep:

// 1. Identify compromised nodes (based on metrics, failed verifications)
let identity_mgr = state.identity_manager.as_ref().ok_or(...)?;

// 2. Call gRPC RevokeNode for each compromised node
let client = create_identity_client(&state.grpc_endpoint).await?;
for compromised_node_id in compromised_nodes {
    client.revoke_node(compromised_node_id, "Byzantine behavior detected").await?;
}

// 3. Update local identity manager
identity_mgr.lock().unwrap().revoke(compromised_node_id)?;

// 4. Broadcast revocation via CoT event (optional)
```

**Estimated Effort**: 4-6 hours

---

#### 8. Add BLAKE3 Hash Validation

**Files**: `TrustEventParser.kt`, JNI

**Task**: Verify that payload hashes use BLAKE3, not SHA-256.

**Implementation**:
```kotlin
// In TrustEventParser, after extracting payloadHash:
if (payloadHash != null) {
    val computedHash = computeBlake3Hash(canonicalPayload)
    if (computedHash != payloadHash) {
        return reject("payload_hash_mismatch", envelope)
    }
}

// Add JNI method:
private external fun nativeComputeBlake3Hash(payload: ByteArray): String
```

**Estimated Effort**: 2-3 hours

---

#### 9. Add TPM Enforcement Mode

**Files**: JNI, `TrustEventParser.kt`

**Task**: When `TPM_ENABLED=true`, reject events not signed by TPM-backed keys.

**Implementation**:
```rust
// In nativeVerifySignature:
if tpm_enabled {
    // Query attestation type for signer
    let attestation = get_node_attestation(&node_id_str)?;
    match attestation {
        Attestation::Tpm { .. } => { /* OK */ }
        Attestation::Android { .. } => { /* OK if StrongBox */ }
        _ => {
            warn!("Rejecting non-TPM signature in TPM enforcement mode");
            return JNI_FALSE;
        }
    }
}
```

**Estimated Effort**: 2-3 hours

---

### 🔵 Low Priority (Nice to Have)

#### 10. Add Integration Tests

**File**: Create `plugins/atak-trust-overlay/src/androidTest/...`

**Task**: Add end-to-end integration tests for:
- Signature verification flow
- gRPC service connectivity
- Trust marker rendering with various states
- Detail panel interaction

**Estimated Effort**: 6-8 hours

---

#### 11. Add CoT Event Signature at Source

**Task**: Ensure that trust events are generated with proper signatures.

**Location**: Trust event generation code (likely in services or mesh components)

**Requirements**:
1. Sign trust events with TPM-backed Ed25519 keys
2. Include `trust.signature_hex`, `trust.signer_node_id`, `trust.payload_hash` fields
3. Use canonical JSON serialization for deterministic signing
4. Use BLAKE3 for payload hashing

**Estimated Effort**: 4-6 hours

---

#### 12. Add Retry and Timeout Logic

**File**: `external/aethercore-jni/src/lib.rs`

**Task**: Add exponential backoff retry and timeout handling for gRPC calls.

**Implementation**:
```rust
use tokio::time::{timeout, Duration};

async fn verify_with_retry(
    client: &mut IdentityRegistryClient,
    request: VerifySignatureRequest,
    max_retries: u32,
) -> Result<bool, Error> {
    let mut retry_delay = Duration::from_millis(10);
    
    for attempt in 0..max_retries {
        match timeout(Duration::from_millis(5), client.verify_signature(request.clone())).await {
            Ok(Ok(response)) => return Ok(response.is_valid),
            Ok(Err(e)) if is_retryable(&e) => {
                warn!("Verification failed (attempt {}), retrying in {:?}", attempt, retry_delay);
                tokio::time::sleep(retry_delay).await;
                retry_delay *= 2; // Exponential backoff
            }
            Ok(Err(e)) => return Err(e),
            Err(_) => {
                warn!("Verification timeout (attempt {})", attempt);
                retry_delay *= 2;
            }
        }
    }
    
    Err(Error::MaxRetriesExceeded)
}
```

**Estimated Effort**: 3-4 hours

---

## Total Estimated Effort

- **Critical Priority**: 10-17 hours
- **High Priority**: 2-3 hours
- **Medium Priority**: 11-16 hours
- **Low Priority**: 13-18 hours

**Total**: 36-54 hours (4.5-6.75 days)

**Minimum Viable Product**: Critical + High Priority = 12-20 hours (1.5-2.5 days)

## Testing Strategy

### Unit Tests
- ✅ Existing tests continue to pass
- Add tests for new signature verification logic
- Add tests for gRPC client error handling

### Integration Tests
- Test signature verification with real Identity Registry service
- Test trust marker rendering with various verification states
- Test Byzantine node detection and revocation
- Test Merkle Vine chain validation

### System Tests
- Deploy plugin to ATAK device
- Generate signed trust events from test sources
- Verify markers appear with correct colors and labels
- Test detail panel displays signature status
- Verify unverified events are marked red

## Deployment Checklist

Before production deployment:

- [ ] All Critical Priority tasks completed
- [ ] Identity Registry service deployed and accessible
- [ ] TPM_ENABLED=true in production environments
- [ ] gRPC communication uses TLS 1.3
- [ ] Integration tests pass
- [ ] System tests on target ATAK device
- [ ] Security review completed
- [ ] Documentation updated with deployment procedures

## Known Limitations

1. **Signature Verification**: Currently returns `false` for all signatures until implementation is complete
2. **Identity Manager**: Empty by default, needs node enrollment integration
3. **gRPC Client**: Dependencies added but client not implemented
4. **Merkle Vine**: Parent hash fields present but validation not implemented
5. **TPM Enforcement**: Can be configured but not enforced in verification logic

## Next Steps

1. **Implement Local Signature Verification** (Option A) - Fastest path to working verification
2. **Populate Identity Manager** - Load enrolled nodes or implement lazy gRPC lookup
3. **Test End-to-End** - Generate signed trust events and verify they display correctly
4. **Deploy Identity Registry Service** - Get service running on test device/gateway
5. **Add gRPC Client** (Option B) - Migrate to remote verification for production
6. **Implement Remaining Features** - Merkle Vine, TPM enforcement, Byzantine detection

## Support

For questions or issues during implementation:
- Review `CONFIGURATION.md` for configuration options
- Review `ATAK_PLUGIN_COMPLETION_ANALYSIS.md` for architectural details
- Check `crates/identity/proto/identity_registry.proto` for gRPC API
- See `crates/crypto/src/signing.rs` for signing examples
