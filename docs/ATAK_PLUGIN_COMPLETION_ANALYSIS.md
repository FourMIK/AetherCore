# ATAK Plugin Completion Analysis

## Executive Summary

The ATAK Trust Overlay Plugin (`plugins/atak-trust-overlay`) is **architecturally complete** for displaying verification status markers on the ATAK UI, but contains **critical gaps** in the integration between the Android/Kotlin layer and the underlying Rust trust engine. The plugin currently renders trust markers (green/amber/red) based on trust scores from CoT events, but lacks real cryptographic signature verification and hardware-rooted identity validation.

## Current Status: What Works

### ✅ UI Layer (Complete)
- **Marker Rendering**: `TrustMarkerRenderer.kt` successfully maps trust levels to colored markers:
  - `TrustLevel.HIGH` → Green marker (`trust_marker_green.xml`)
  - `TrustLevel.MEDIUM` → Amber marker (`trust_marker_amber.xml`)
  - `TrustLevel.LOW` → Red marker (`trust_marker_red.xml`)
  - `TrustLevel.UNKNOWN` or stale → Red marker
- **Status Labels**: Markers display trust scores and status (e.g., "Trust 0.95 (Healthy)", "Trust 0.85 (Stale)")
- **Detail Panel**: Tap interactions show full trust details via `TrustDetailPanelController.kt`
- **Feed Health Widget**: Optional widget displays feed health and event statistics

### ✅ CoT Event Processing (Complete)
- **Event Subscription**: `TrustCoTSubscriber.kt` listens for `a-f-AETHERCORE-TRUST` CoT events
- **Event Parsing**: `TrustEventParser.kt` validates and normalizes trust events
- **State Management**: `TrustStateStore.kt` tracks trust state with 5-minute TTL
- **Rejection Handling**: Malformed events are logged with specific rejection reasons

### ✅ ATAK Integration (Complete)
- **Reflection-Based Adapters**: `AtakUiAdapters.kt` provides robust integration with ATAK SDK
- **Lifecycle Management**: `TrustOverlayLifecycle.kt` handles plugin startup/shutdown
- **Compatibility**: Targets ATAK 4.6.0.5+ with graceful fallbacks

## Critical Gaps: What's Missing

### ❌ 1. AndroidEnrollmentKeyManager Integration (CRITICAL)

**Location**: `RalphieNodeDaemon.kt:94`

**Issue**: The plugin calls `AndroidEnrollmentKeyManager(context).getHardwareFingerprint()`, but:
1. `AndroidEnrollmentKeyManager` doesn't have a constructor that accepts just `Context`
2. There is no `getHardwareFingerprint()` method in the class

**Current Code**:
```kotlin
val fingerprint = runCatching {
    AndroidEnrollmentKeyManager(context).getHardwareFingerprint().trim()
}.getOrElse { throwable ->
    throw HardwareBindingException("Hardware fingerprint acquisition failed", throwable)
}
```

**Required**:
- Add a companion factory method to `AndroidEnrollmentKeyManager` that accepts `Context`
- Implement `getHardwareFingerprint()` method that returns a stable hardware identifier

**Recommendation**:
```kotlin
companion object {
    fun create(context: Context): AndroidEnrollmentKeyManager {
        return AndroidEnrollmentKeyManager(
            keyStore = AndroidKeyStoreFacade(),
            aliasStore = SharedPreferencesKeyAliasStore(context),
            strongBoxSupport = DeviceStrongBoxSupport()
        )
    }
}

fun getHardwareFingerprint(): String {
    // Use Android Build identifiers or derive from key attestation
    return "${Build.MANUFACTURER}-${Build.MODEL}-${Build.SERIAL}".hashCode().toString()
}
```

### ❌ 2. JNI Native Method Implementations (CRITICAL)

**Location**: `external/aethercore-jni/src/lib.rs`

**Issue**: The JNI crate contains only a health check stub. The following native methods are **declared but not implemented**:

Required JNI methods in `RalphieNodeDaemon.kt`:
- `nativeInitialize(storagePath: String, hardwareId: String): Boolean`
- `nativeStartDaemon(): Boolean`
- `nativeStopDaemon(): Boolean`
- `nativeTriggerAethericSweep(): Boolean`

**Current JNI Implementation**:
```rust
// Only has this stub:
pub extern "system" fn Java_com_aethercore_atak_trustoverlay_NativeBridge_nativeHealthcheck(
    env: JNIEnv,
    _class: JClass,
) -> jstring {
    env.new_string("aethercore-jni-ok")
        .expect("JNI string allocation failed")
        .into_raw()
}
```

**Required Implementation**:
```rust
// Add these JNI methods to external/aethercore-jni/src/lib.rs:

#[no_mangle]
pub extern "system" fn Java_com_aethercore_atak_trustoverlay_core_RalphieNodeDaemon_nativeInitialize(
    mut env: JNIEnv,
    _class: JClass,
    storage_path: JString,
    hardware_id: JString,
) -> jboolean {
    // 1. Convert JString to Rust String
    // 2. Initialize identity manager with storage path
    // 3. Bind to hardware ID
    // 4. Return success/failure
}

#[no_mangle]
pub extern "system" fn Java_com_aethercore_atak_trustoverlay_core_RalphieNodeDaemon_nativeStartDaemon(
    _env: JNIEnv,
    _class: JClass,
) -> jboolean {
    // 1. Start gRPC client connection to identity registry service
    // 2. Start background thread for trust event generation
    // 3. Return success/failure
}

#[no_mangle]
pub extern "system" fn Java_com_aethercore_atak_trustoverlay_core_RalphieNodeDaemon_nativeStopDaemon(
    _env: JNIEnv,
    _class: JClass,
) -> jboolean {
    // 1. Stop background threads
    // 2. Disconnect gRPC clients
    // 3. Return success/failure
}

#[no_mangle]
pub extern "system" fn Java_com_aethercore_atak_trustoverlay_core_RalphieNodeDaemon_nativeTriggerAethericSweep(
    _env: JNIEnv,
    _class: JClass,
) -> jboolean {
    // 1. Trigger Byzantine node detection
    // 2. Revoke compromised identities
    // 3. Return success/failure
}
```

**Dependencies to Add**:
```toml
[dependencies]
jni = "0.21"
tokio = { version = "1.0", features = ["rt-multi-thread"] }
tonic = "0.10"
prost = "0.12"

# AetherCore crates
aethercore-identity = { path = "../../crates/identity" }
aethercore-crypto = { path = "../../crates/crypto" }
```

### ❌ 3. Signature Verification Pipeline (CRITICAL)

**Location**: `TrustEventParser.kt` and `TrustCoTSubscriber.kt`

**Issue**: Trust events are currently accepted based solely on trust score values in CoT detail fields. There is **no cryptographic signature verification** happening in the Android layer.

**Current Behavior**:
- Parser extracts `trust_score` from CoT detail
- Derives trust level from score (≥0.9 = HIGH, ≥0.6 = MEDIUM, <0.6 = LOW)
- No validation that the trust score is authentic or came from a trusted source

**Required**:
1. Add signature fields to CoT trust event schema:
   ```
   trust.signature_hex (64-byte Ed25519 signature)
   trust.signer_node_id (NodeID of signing authority)
   trust.signed_payload_hash (BLAKE3 hash of canonical payload)
   ```

2. Implement JNI method for signature verification:
   ```rust
   #[no_mangle]
   pub extern "system" fn Java_com_aethercore_atak_trustoverlay_cot_TrustEventParser_nativeVerifySignature(
       mut env: JNIEnv,
       _class: JClass,
       node_id: JString,
       payload: JByteArray,
       signature_hex: JString,
   ) -> jboolean {
       // Call IdentityRegistry.VerifySignature via gRPC
       // Return verification result
   }
   ```

3. Update `TrustEventParser.parse()` to call native verification:
   ```kotlin
   // After parsing trust_score, before accepting event:
   val signatureHex = extractRequired(envelope, SIGNATURE_KEYS) 
       ?: return reject("missing_signature", envelope)
   val signerNodeId = extractRequired(envelope, SIGNER_NODE_ID_KEYS)
       ?: return reject("missing_signer_node_id", envelope)
   
   if (!nativeVerifySignature(signerNodeId, payload, signatureHex)) {
       return reject("signature_verification_failed", envelope)
   }
   ```

4. **Fail-Visible Design**: If signature verification fails, the event MUST be rejected and marked as `SPOOFED` in logs/metrics.

### ❌ 4. Identity Registry gRPC Integration (CRITICAL)

**Issue**: The JNI layer needs to call the Identity Registry gRPC service (`crates/identity/src/grpc_server.rs`) to verify signatures and check enrollment status.

**Required gRPC Service Calls**:

1. **VerifySignature**: Verify trust event signatures
   ```
   Request: node_id, payload, signature_hex, timestamp_ms, nonce_hex
   Response: is_valid, failure_reason, security_event_type
   ```

2. **IsNodeEnrolled**: Check if a node is enrolled before accepting its trust events
   ```
   Request: node_id
   Response: is_enrolled
   ```

3. **GetPublicKey**: Retrieve public keys for signature verification
   ```
   Request: node_id
   Response: public_key_hex
   ```

**Implementation Location**: `external/aethercore-jni/src/lib.rs`

**Required**:
- Add `tonic` gRPC client dependency
- Connect to Identity Registry service (likely at `localhost:50051` or via Unix socket)
- Implement retry logic with exponential backoff for contested/congested networks
- Add timeout handling (5ms target for identity lookups per SECURITY.md)

### ❌ 5. Plugin Settings Persistence (HIGH)

**Location**: `TrustOverlayLifecycle.kt:130-132`

**Issue**: `DefaultPluginSettings` is a mock implementation that returns default values for all keys.

**Current Code**:
```kotlin
private object DefaultPluginSettings : PluginSettings {
    override fun getLong(key: String, defaultValue: Long): Long = defaultValue
}
```

**Impact**: The plugin cannot persist configuration such as:
- `trust.state.ttl.seconds` (TTL for trust state freshness)
- Custom trust thresholds
- Allowed trust sources

**Required**:
```kotlin
private class SharedPreferencesPluginSettings(
    private val context: Context
) : PluginSettings {
    private val prefs = context.getSharedPreferences("atak_trust_overlay", Context.MODE_PRIVATE)
    
    override fun getLong(key: String, defaultValue: Long): Long {
        return prefs.getLong(key, defaultValue)
    }
}

// Update onCreate to use:
override val settings: PluginSettings = SharedPreferencesPluginSettings(resolvedContext)
```

### ❌ 6. Signature Field Extraction (HIGH)

**Location**: `TrustEventParser.kt`

**Issue**: The parser doesn't extract signature-related fields from CoT events.

**Required CoT Schema Extension**:
```kotlin
companion object {
    // Add these field key lists:
    private val SIGNATURE_KEYS = listOf("trust.signature_hex", "signature_hex", "sig")
    private val SIGNER_NODE_ID_KEYS = listOf("trust.signer_node_id", "signer_node_id", "signer")
    private val PAYLOAD_HASH_KEYS = listOf("trust.payload_hash", "payload_hash")
}

// Update TrustEvent data class to include:
data class TrustEvent(
    // ... existing fields ...
    val signatureHex: String?,
    val signerNodeId: String?,
    val payloadHash: String?,
)
```

### ❌ 7. Rust gRPC Service Deployment (HIGH)

**Issue**: The Identity Registry gRPC service must be running and accessible to the JNI layer.

**Required**:
1. Deploy `crates/identity` gRPC server on the Android device (or gateway)
2. Configure service endpoint in JNI initialization
3. Ensure TLS 1.3 for all gRPC communication
4. Handle service unavailability without crashing plugin

**Service Start Command**:
```bash
# On Android or gateway device:
./aethercore-identity-server --bind 0.0.0.0:50051 --tpm-enabled=true
```

### ❌ 8. Byzantine Node Detection (MEDIUM)

**Location**: `RalphieNodeDaemon.forceSweep()`

**Issue**: The Aetheric Sweep is triggered via JNI but has no implementation.

**Required**:
1. Implement `nativeTriggerAethericSweep()` in JNI
2. Call `IdentityRegistry.RevokeNode()` for compromised nodes
3. Broadcast revocation events to trust mesh
4. Update UI to show revoked nodes as red/quarantined immediately

### ❌ 9. Merkle Vine Integration (MEDIUM)

**Per Agent Instructions**: "All data streams are structured as Merkle Vines. Every event must contain a hash of its ancestor."

**Issue**: Trust events don't currently track parent hashes or maintain Merkle Vine structure.

**Required**:
1. Add `parent_hash` field to trust events
2. Validate hash chain in `TrustEventParser`
3. Reject events with broken hash chains
4. Use BLAKE3 exclusively (no SHA-256)

### ❌ 10. TPM-Backed Signing Integration (CRITICAL)

**Per Agent Instructions**: "Signing: Use TPM-backed Ed25519 (CodeRalphie). Private keys must never reside in system memory."

**Issue**: The current implementation doesn't enforce TPM-backed signing. Trust scores could be spoofed.

**Required**:
1. Verify that trust events are signed by TPM-backed keys via `IdentityRegistry.VerifySignature()`
2. Reject events signed with software-only keys (unless `TPM_ENABLED=false` for testing)
3. Query TPM attestation status from `RalphieNodeDaemon`
4. Display TPM status in trust detail panel

### ❌ 11. BLAKE3 Hash Validation (MEDIUM)

**Per Agent Instructions**: "Hashing: Use BLAKE3 exclusively. Deprecate and remove all SHA-256 implementations."

**Issue**: Need to verify that trust event hashes use BLAKE3, not SHA-256.

**Required**:
1. Add BLAKE3 hash validation to trust events
2. Verify `payload_hash` field uses BLAKE3
3. Add hash verification to `TrustEventParser`

## Implementation Priority

### Phase 1: Critical Path (Required for Basic Operation)
1. **Fix AndroidEnrollmentKeyManager** - Add factory method and `getHardwareFingerprint()`
2. **Implement JNI Native Methods** - All four methods in `external/aethercore-jni/src/lib.rs`
3. **Deploy Identity Registry Service** - Start gRPC server for verification
4. **Integrate gRPC Client in JNI** - Connect to Identity Registry from native code

### Phase 2: Signature Verification (Required for Trust)
5. **Extend CoT Schema** - Add signature fields
6. **Implement Signature Verification** - Call gRPC service via JNI
7. **Update Parser Logic** - Reject unsigned/unverified events
8. **Replace DefaultPluginSettings** - Use SharedPreferences

### Phase 3: Advanced Features (Required for Production)
9. **Implement Aetheric Sweep** - Byzantine node detection and revocation
10. **Add Merkle Vine Validation** - Parent hash chain verification
11. **Enforce TPM-Only Signing** - Reject software-signed events
12. **BLAKE3 Hash Verification** - Validate event hashes

## Architectural Alignment

Per agent instructions, the following patterns must be enforced:

### ✅ Aligned
- **Fail-Visible Design**: Markers explicitly show untrusted/stale status as red
- **Functional Style**: Immutable state patterns used throughout
- **Zod/Schema Enforcement**: CoT events validated against strict schema

### ❌ Not Aligned
- **No Mocks in Production**: `DefaultPluginSettings` is a mock that must be replaced
- **TPM-Backed Signing**: Not enforced - events could be spoofed
- **BLAKE3 Exclusively**: Hash algorithm validation not implemented
- **gRPC/FFI Integration**: JNI bridge is incomplete

## Testing Requirements

### Unit Tests (Exist)
- `TrustEventParserTest.kt` - Parser validation ✅
- `TrustStateStoreTest.kt` - State management ✅
- `MarkerIconCatalogTest.kt` - Icon resolution ✅
- `RalphieNodeDaemonTest.kt` - JNI loading ✅

### Integration Tests (Missing)
- [ ] End-to-end signature verification flow
- [ ] gRPC service connectivity and timeout handling
- [ ] TPM attestation validation
- [ ] Merkle Vine chain verification
- [ ] Byzantine node revocation flow

## Deployment Blockers

1. **JNI Library Build**: `libaethercore_jni.so` must be compiled for `armeabi-v7a` and `arm64-v8a`
2. **ATAK SDK Artifacts**: `main.jar` must be present in `plugins/atak-trust-overlay/libs/`
3. **Identity Registry Service**: Must be running and accessible via gRPC
4. **TPM Configuration**: CodeRalphie TPM integration must be configured on target devices

## Recommendations

### Immediate Actions
1. **Implement AndroidEnrollmentKeyManager.create(Context)** factory method
2. **Implement missing JNI native methods** with gRPC integration
3. **Deploy Identity Registry gRPC service** for signature verification
4. **Replace DefaultPluginSettings** with SharedPreferences

### Follow-Up Actions
5. Add signature verification to trust event pipeline
6. Implement Merkle Vine parent hash validation
7. Add integration tests for signature verification flow
8. Document TPM setup requirements in INSTALLATION.md

### Security Priorities
- **NO GRACEFUL DEGRADATION**: If signature verification fails, reject the event
- **FAIL-VISIBLE**: Mark unverified units explicitly as SPOOFED or UNVERIFIED
- **TPM ENFORCEMENT**: In production, require TPM-backed signatures

## Conclusion

The ATAK Trust Overlay Plugin has a **complete UI and event processing pipeline**, but is **missing the cryptographic foundation** required for production deployment. The primary gaps are:

1. Missing JNI implementations that bridge to Rust trust engine
2. Missing signature verification integration
3. Missing gRPC client connection to Identity Registry
4. Incomplete hardware binding (no getHardwareFingerprint method)

Once these gaps are filled, the plugin will successfully indicate verified vs. unverified units on the ATAK UI according to the 4MIK Trust Fabric security model.
