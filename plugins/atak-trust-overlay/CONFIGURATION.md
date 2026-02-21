# ATAK Trust Overlay Plugin - Configuration Guide

## Overview

This document describes the configuration options available for the ATAK Trust Overlay plugin.

## Plugin Settings

The plugin uses Android SharedPreferences for persistent configuration storage.

### Storage Location
- **Preference File**: `atak_trust_overlay`
- **Mode**: `MODE_PRIVATE` (app-private storage)

### Supported Settings

| Setting Key | Type | Default | Description |
|-------------|------|---------|-------------|
| `trust.state.ttl.seconds` | Long | 300 | Time-to-live for trust state entries (5 minutes) |

### Setting Configuration

Settings can be configured programmatically or via ATAK plugin preferences UI:

```kotlin
val prefs = context.getSharedPreferences("atak_trust_overlay", Context.MODE_PRIVATE)
prefs.edit()
    .putLong("trust.state.ttl.seconds", 600) // 10 minutes
    .apply()
```

## JNI Configuration

The native Rust layer can be configured via environment variables or system properties.

### Identity Registry Endpoint

**Environment Variable**: `IDENTITY_REGISTRY_ENDPOINT`

**Default**: `http://localhost:50051`

**Description**: gRPC endpoint for the Identity Registry service used for signature verification and enrollment checks.

**Examples**:
```bash
# Local service
IDENTITY_REGISTRY_ENDPOINT=http://localhost:50051

# Gateway service
IDENTITY_REGISTRY_ENDPOINT=https://gateway.aethercore.local:50051

# Unix socket (future support)
IDENTITY_REGISTRY_ENDPOINT=unix:///var/run/aethercore/identity.sock
```

### TPM Enforcement

**Environment Variable**: `TPM_ENABLED`

**Default**: `false`

**Valid Values**: `true`, `false`, `1`, `0`, `yes`, `no`, `on`, `off`

**Description**: When enabled, requires all signatures to be TPM-backed. Software-signed events are rejected.

**Security Note**: In production environments, this MUST be set to `true` to enforce hardware-rooted trust.

```bash
# Production (enforce TPM)
TPM_ENABLED=true

# Development/Testing (allow software signatures)
TPM_ENABLED=false
```

### Logging Level

**Environment Variable**: `RUST_LOG`

**Default**: `info`

**Valid Values**: `trace`, `debug`, `info`, `warn`, `error`

**Description**: Controls the verbosity of Rust native layer logging.

```bash
# Verbose logging for debugging
RUST_LOG=debug

# Production logging
RUST_LOG=warn
```

## CoT Event Schema

Trust events must conform to the following CoT schema to be accepted by the plugin.

### Required Fields

| Field | Type | Description |
|-------|------|-------------|
| `uid` | String | Unique identifier for the unit |
| `type` | String | Must be `a-f-AETHERCORE-TRUST` |
| `time` | ISO8601 | Event timestamp |
| `stale` | ISO8601 | Event expiration timestamp |
| `trust_score` or `trust.score` | Float [0.0-1.0] | Trust score for the unit |
| `last_updated` or `trust.last_updated` | ISO8601 | Last trust update timestamp |

### Optional Fields (Recommended)

| Field | Type | Description |
|-------|------|-------------|
| `callsign` or `trust.callsign` | String | Display name for the unit |
| `source` or `trust.source` | String | Trust data source identifier |
| `point.lat` or `lat` | Float | Latitude coordinate |
| `point.lon` or `lon` | Float | Longitude coordinate |
| `trust.signature_hex` | Hex String | Ed25519 signature (64 bytes) |
| `trust.signer_node_id` | String | NodeID of signing authority |
| `trust.payload_hash` | Hex String | BLAKE3 hash of signed payload |

### Integrity Metrics

Metrics prefixed with `integrity_` are automatically extracted:

```
integrity_latency_ms=45.2
integrity_packet_loss=0.05
integrity_signal_strength=0.92
```

### Source Metadata

Metadata prefixed with `source_meta.` or `source.meta.` is automatically extracted:

```
source_meta.version=1.2.3
source_meta.platform=android
source.meta.operator_callsign=ALPHA-6
```

## Trust Level Thresholds

Trust scores are mapped to trust levels using the following thresholds:

| Trust Level | Score Range | Marker Color | Status Label |
|-------------|-------------|--------------|--------------|
| HIGH | ≥ 0.90 | Green | Healthy |
| MEDIUM | 0.60 - 0.89 | Amber | Suspect |
| LOW | < 0.60 | Red | Quarantined |
| UNKNOWN | No score | Red | Unknown |

### Special Cases

- **Stale Events**: Events older than TTL are marked red regardless of trust level
- **Unverified Signatures**: Events with invalid signatures are marked red with "UNVERIFIED" label
- **Missing Signatures**: Events without signature fields are accepted but marked as unverified

## Allowed Trust Sources

By default, the plugin accepts trust events from the following sources:

- `aethercore`
- `trust-mesh`
- `trusted-gateway`
- `unknown`

Events from other sources are rejected with reason `blocked_source`.

## ATAK Compatibility

### Minimum Version
- **ATAK**: 4.6.0.5

### Target Version
- **ATAK**: 5.2.x

The plugin uses reflection-based adapters to maintain compatibility across ATAK versions. If a required ATAK API is unavailable, the plugin logs a warning and degrades gracefully.

## Build Configuration

### SDK Artifacts

Place ATAK SDK artifacts in `plugins/atak-trust-overlay/libs/`:

```bash
mkdir -p plugins/atak-trust-overlay/libs
cp atak/ATAK/app/build/libs/main.jar plugins/atak-trust-overlay/libs/main.jar
```

### JNI Crate Location

By default, the JNI crate is expected at `external/aethercore-jni` relative to the repository root.

Override via `local.properties`:
```properties
aethercore.jni.dir=/absolute/path/to/aethercore-jni
```

### Android SDK

Configure Android SDK path in `local.properties`:
```properties
sdk.dir=/absolute/path/to/Android/Sdk
```

## Deployment

### APK Build

```bash
cd plugins/atak-trust-overlay
./gradlew assembleDebug
```

Output: `build/outputs/apk/debug/atak-trust-overlay-debug.apk`

### Installation

```bash
adb install -r build/outputs/apk/debug/atak-trust-overlay-debug.apk
```

### Runtime Requirements

1. **ATAK Application**: Must be installed and running
2. **Identity Registry Service**: Must be accessible via gRPC (when signature verification is enabled)
3. **Network Connectivity**: Required for gRPC communication
4. **Storage Permissions**: For plugin state persistence

## Troubleshooting

### Plugin Not Loading

**Symptom**: Plugin doesn't appear in ATAK plugins list

**Solutions**:
1. Check ATAK version compatibility (minimum 4.6.0.5)
2. Verify plugin APK is installed: `adb shell pm list packages | grep aethercore`
3. Check logcat for errors: `adb logcat | grep TrustOverlayLifecycle`

### JNI Library Load Failure

**Symptom**: Log message "Failed to load AetherCore JNI library"

**Solutions**:
1. Verify JNI library is included in APK: `unzip -l app.apk | grep libaethercore_jni.so`
2. Check target architecture matches device: `armeabi-v7a` or `arm64-v8a`
3. Review JNI build logs for compilation errors

### Trust Markers Not Appearing

**Symptom**: Map doesn't show trust markers

**Solutions**:
1. Verify CoT events are being received: Check widget for event counts
2. Check event format against schema requirements
3. Review rejection reasons in logs: `adb logcat | grep trust_event_rejected`
4. Verify trust event type is `a-f-AETHERCORE-TRUST`

### Signature Verification Failures

**Symptom**: All events show "UNVERIFIED" status

**Solutions**:
1. Verify Identity Registry service is running and accessible
2. Check `IDENTITY_REGISTRY_ENDPOINT` configuration
3. Review signature format (must be 64-byte Ed25519 hex string)
4. Verify signer NodeID is enrolled in Identity Registry
5. Check network connectivity between plugin and service

## Security Considerations

### Production Deployment

For production deployments, the following settings are **mandatory**:

1. `TPM_ENABLED=true` - Enforce hardware-rooted signatures
2. Use TLS 1.3 for all gRPC communication
3. Deploy Identity Registry service with proper authentication
4. Regular key rotation and revocation checks
5. Monitor logs for signature verification failures (potential security events)

### Testing/Development

For testing purposes, you may use:

1. `TPM_ENABLED=false` - Allow software-signed events
2. Local Identity Registry without TLS
3. Self-signed certificates

**Warning**: Never deploy with testing configuration to production environments.

## Support

For issues or questions:
1. Review logs: `adb logcat | grep -E "TrustOverlay|RalphieNode|aethercore"`
2. Check documentation: `plugins/atak-trust-overlay/README.md`
3. Review architecture: `ARCHITECTURE.md`
4. Security issues: See `SECURITY.md`
