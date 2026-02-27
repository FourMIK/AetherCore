# ATAK Plugin Quick Start Guide

## Overview

This guide helps developers quickly understand and work on the ATAK Trust Overlay Plugin.

## Project Structure

```
plugins/atak-trust-overlay/          # Android plugin module
├── src/main/kotlin/                 # Kotlin source code
│   └── com/aethercore/atak/trustoverlay/
│       ├── core/                    # Core plugin components
│       │   ├── TrustOverlayLifecycle.kt      # Plugin entry point
│       │   ├── RalphieNodeDaemon.kt          # JNI bridge to Rust
│       │   ├── TrustStateStore.kt            # Trust state management
│       │   └── TrustModel.kt                 # Data models
│       ├── cot/                     # CoT event processing
│       │   ├── TrustCoTSubscriber.kt         # CoT subscription
│       │   └── TrustEventParser.kt           # Event validation & parsing
│       ├── map/                     # Map rendering
│       │   └── TrustMarkerRenderer.kt        # Marker rendering
│       ├── ui/                      # UI components
│       │   └── TrustDetailPanelController.kt # Detail panels
│       └── widget/                  # Widgets
│           └── TrustFeedHealthWidgetController.kt
├── src/main/res/                    # Android resources
│   └── drawable/                    # Marker icons (green/amber/red)
└── libs/                            # ATAK SDK artifacts (gitignored)

external/aethercore-jni/             # JNI bridge to Rust
└── src/lib.rs                       # Native method implementations

crates/identity/                     # Identity & attestation
└── src/grpc_server.rs              # Identity Registry gRPC service

crates/crypto/                       # Cryptographic operations
└── src/signing.rs                  # Event signing service
```

## Key Components

### 1. Trust Event Flow

```
CoT Event (a-f-AETHERCORE-TRUST)
    ↓
TrustCoTSubscriber → receives event
    ↓
TrustEventParser → validates & parses
    ↓
TrustEvent model → normalized event
    ↓
TrustStateStore → tracks state with TTL
    ↓
TrustMarkerRenderer → renders colored marker
    ↓
ATAK Map → displays marker
    ↓
User taps marker
    ↓
TrustDetailPanelController → shows details
```

### 2. Trust Levels & Colors

| Trust Level | Score Range | Color | Icon Resource | Status |
|-------------|-------------|-------|---------------|--------|
| HIGH | ≥0.90 | Green | `trust_marker_green.xml` | Healthy |
| MEDIUM | 0.60-0.89 | Amber | `trust_marker_amber.xml` | Suspect |
| LOW | <0.60 | Red | `trust_marker_red.xml` | Quarantined |
| UNKNOWN | - | Red | `trust_marker_red.xml` | Unknown |

**Special Cases**:
- Stale (>5min TTL) → Red
- Unverified signature → Red with "UNVERIFIED" label

### 3. JNI Native Methods

| Method | Purpose | Status |
|--------|---------|--------|
| `nativeInitialize()` | Initialize daemon with storage path | ✅ Implemented |
| `nativeStartDaemon()` | Start trust daemon | ✅ Implemented |
| `nativeStopDaemon()` | Stop trust daemon | ✅ Implemented |
| `nativeTriggerAethericSweep()` | Trigger Byzantine detection | ✅ Stub |
| `nativeVerifySignature()` | Verify Ed25519 signature | ⚠️ Stub (needs implementation) |

## Development Setup

### Prerequisites

1. **Android Studio** - Arctic Fox or later
2. **JDK 17** - Required for Android Gradle Plugin 8.2.x
3. **Rust Toolchain** - For JNI compilation
4. **cargo-ndk** - `cargo install cargo-ndk`
5. **Android NDK** - Install via Android Studio SDK Manager
6. **protobuf-compiler** - `sudo apt-get install protobuf-compiler`

### Build Steps

1. **Clone repository**:
   ```bash
   git clone https://github.com/FourMIK/AetherCore.git
   cd AetherCore
   ```

2. **Create local.properties**:
   ```properties
   sdk.dir=/path/to/Android/Sdk
   aethercore.jni.dir=/absolute/path/to/AetherCore/external/aethercore-jni
   ```

3. **Place ATAK SDK artifacts** (see CONFIGURATION.md):
   ```bash
   mkdir -p plugins/atak-trust-overlay/libs
   # Copy ATAK SDK jars here
   ```

4. **Build JNI library**:
   ```bash
   cd external/aethercore-jni
   cargo build
   ```

5. **Build Android plugin**:
   ```bash
   cd plugins/atak-trust-overlay
   ./gradlew assembleDebug
   ```

## Common Development Tasks

### Testing Changes Locally

```bash
# Build APK
cd plugins/atak-trust-overlay
./gradlew assembleDebug

# Install to device
adb install -r build/outputs/apk/debug/atak-trust-overlay-debug.apk

# View logs
adb logcat | grep -E "TrustOverlay|RalphieNode"
```

### Debugging JNI

```bash
# Enable verbose logging
export RUST_LOG=debug

# Rebuild with debug symbols
cd external/aethercore-jni
cargo build

# View native logs
adb logcat | grep aethercore-jni
```

### Testing CoT Events

Send test trust events via ATAK CoT API or netcat:

```xml
<?xml version="1.0"?>
<event version="2.0" uid="test-unit-001" type="a-f-AETHERCORE-TRUST" time="2026-02-21T04:00:00Z" start="2026-02-21T04:00:00Z" stale="2026-02-21T04:10:00Z">
  <point lat="38.0" lon="-77.0" hae="100.0" ce="10.0" le="10.0"/>
  <detail>
    <trust_score>0.95</trust_score>
    <trust.level>high</trust.level>
    <trust.source>aethercore</trust.source>
    <trust.callsign>ALPHA-1</trust.callsign>
    <trust.last_updated>2026-02-21T04:00:00Z</trust.last_updated>
    <trust.signature_hex>0123456789abcdef...</trust.signature_hex>
    <trust.signer_node_id>node-authority-001</trust.signer_node_id>
    <integrity_latency_ms>45.2</integrity_latency_ms>
  </detail>
</event>
```

## Code Style

### Kotlin

- Use functional style with immutable data classes
- Prefer `?.` safe call over explicit null checks
- Use `runCatching` for exception handling
- Follow Android naming conventions

### Rust

- Use `Result<T, E>` for all fallible operations (never `unwrap()`)
- Use `tracing` for logging (not `println!`)
- Favor zero-copy with references and `Cow`
- Use BLAKE3 for hashing, Ed25519 for signing

## Debugging Tips

### Issue: Plugin not loading

```bash
# Check if plugin is installed
adb shell pm list packages | grep aethercore

# Check ATAK logs
adb logcat | grep TrustOverlayLifecycle

# Verify ATAK version
adb shell dumpsys package com.atakmap.app.civ | grep versionName
```

### Issue: JNI load failure

```bash
# Check if .so is in APK
unzip -l app.apk | grep libaethercore_jni.so

# Check target architecture
adb shell getprop ro.product.cpu.abi

# View JNI errors
adb logcat | grep "UnsatisfiedLinkError\|JNI"
```

### Issue: Trust markers not appearing

```bash
# Check if CoT events are received
adb logcat | grep TrustCoTSubscriber

# Check for rejection reasons
adb logcat | grep trust_event_rejected

# Verify event type
# Must be: a-f-AETHERCORE-TRUST
```

### Issue: Signature verification failures

```bash
# Check if Identity Registry service is running
curl http://localhost:50051

# Verify signature format
# Must be: 64-byte hex string (128 characters)

# Check node enrollment
# Node ID must be registered in Identity Registry
```

## Testing Scenarios

### Scenario 1: Verified Unit (Green)
- Trust score: 0.95
- Signature: Valid Ed25519 signature
- Status: Not stale (<5 minutes)
- Expected: Green marker with "Trust 0.95 (Healthy)"

### Scenario 2: Suspect Unit (Amber)
- Trust score: 0.75
- Signature: Valid
- Status: Not stale
- Expected: Amber marker with "Trust 0.75 (Suspect)"

### Scenario 3: Unverified Unit (Red)
- Trust score: 0.95
- Signature: Invalid or missing
- Status: Not stale
- Expected: Red marker with "Trust 0.95 (UNVERIFIED)"

### Scenario 4: Stale Unit (Red)
- Trust score: 0.95
- Signature: Valid
- Status: Stale (>5 minutes)
- Expected: Red marker with "Trust 0.95 (Stale)"

### Scenario 5: Quarantined Unit (Red)
- Trust score: 0.40
- Signature: Valid
- Status: Not stale
- Expected: Red marker with "Trust 0.40 (Quarantined)"

## References

- **Architecture**: `/ARCHITECTURE.md`
- **Configuration**: `plugins/atak-trust-overlay/CONFIGURATION.md`
- **Completion Analysis**: `docs/ATAK_PLUGIN_COMPLETION_ANALYSIS.md`
- **Remaining Tasks**: `docs/ATAK_PLUGIN_REMAINING_TASKS.md`
- **Identity Proto**: `crates/identity/proto/identity_registry.proto`
- **Signing API**: `crates/crypto/src/signing.rs`

## Quick Commands

```bash
# Build everything
cargo build && cd plugins/atak-trust-overlay && ./gradlew assembleDebug

# Install and test
adb install -r build/outputs/apk/debug/atak-trust-overlay-debug.apk
adb logcat -c && adb logcat | grep -E "TrustOverlay|aethercore"

# Check JNI compilation
cd external/aethercore-jni && cargo check

# Run Rust tests
cargo test --all

# Format code
cargo fmt --all
cd plugins/atak-trust-overlay && ./gradlew ktlintFormat
```

## Getting Help

1. **Build Issues**: See `plugins/atak-trust-overlay/README.md`
2. **JNI Issues**: See JNI troubleshooting in plugin README
3. **gRPC Issues**: See `crates/identity/src/grpc_server.rs` documentation
4. **Security Questions**: See `SECURITY.md`
