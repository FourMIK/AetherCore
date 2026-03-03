# Pixel 9 Pro Hardware-Rooted Trust Setup

**Device:** Google Pixel 9 Pro  
**Security Chip:** Titan M2 (StrongBox)  
**Status:** Physical Device Connected  
**Date:** 2026-03-01

---

## Overview

Your Pixel 9 Pro is equipped with Google's **Titan M2** security coprocessor, making it an ideal CodeRalphie hardware root of trust for AetherCore edge nodes. This chip provides:

- **StrongBox Keymaster**: Hardware-isolated key storage (Android Keystore tier 2)
- **Verified Boot**: Cryptographic chain from bootloader to OS
- **Attestation**: Remote verification of device integrity
- **Anti-Rollback**: Protection against firmware downgrades

---

## Step 1: Enable USB Debugging

**On your Pixel 9 Pro:**

1. Navigate to **Settings → About Phone**
2. Scroll to **Build Number**
3. Tap **Build Number** 7 times
   - You'll see: "You are now a developer!"
4. Go back to **Settings → System → Developer Options**
5. Enable **USB Debugging**
6. When prompted by popup dialog, tap **"Allow"** to trust this computer

**Verify Connection:**
```powershell
pnpm run check:android
```

Expected output:
```
✅ StrongBox (Titan M2): AVAILABLE
✅ CodeRalphie Integration: READY
```

---

## Step 2: Verify Hardware Attestation Capabilities

Once USB debugging is enabled, the readiness probe will automatically check:

| Property | Expected Value | CodeRalphie Requirement |
|----------|----------------|-------------------------|
| `strongbox_feature` | `true` | ✅ REQUIRED |
| `verified_boot_state` | `green` | ✅ REQUIRED |
| `bootloader_locked` | `1` | ✅ REQUIRED |
| `security_patch` | Latest | ⚠️ RECOMMENDED |
| `keystore_impl` | `keymint` | ✅ REQUIRED |

**Run Full Diagnostics:**
```powershell
pnpm run check:android
```

**Machine-Readable Output:**
```
device_brand=Google
device_model=Pixel 9 Pro
android_release=15
android_sdk=35
verified_boot_state=green
bootloader_locked=1
security_patch=2026-02
keystore_hw_feature=True
strongbox_feature=True
hardware_root=Titan_M2
status=READY_STRONGBOX
```

---

## Step 3: Architectural Integration

### Android Keystore → CodeRalphie Bridge

```
Pixel 9 Pro (Titan M2)
    ↓
Android Keystore API (StrongBox)
    ↓
AetherCore JNI Bridge (crates/android-ffi)
    ↓
AndroidEnrollmentKeyManager.kt
    ↓
RalphieNodeDaemon (Rust)
    ↓
Trust Mesh (Byzantine-resistant)
```

### Key Files

| Component | Path | Purpose |
|-----------|------|---------|
| JNI Bridge | `crates/android-ffi/src/lib.rs` | Rust ↔ Java FFI boundary |
| Key Manager | `plugins/atak-trust-overlay/src/main/kotlin/com/aethercore/security/AndroidEnrollmentKeyManager.kt` | Hardware fingerprinting |
| Attestation Parser | `crates/identity/src/android_keystore.rs` | ASN.1 certificate chain validation |
| Readiness Probe | `scripts/check-android-se-readiness.ps1` | Pre-deployment verification |

---

## Step 4: Deploy ATAK Plugin

**Prerequisites:**
- USB Debugging enabled (see Step 1)
- ATAK-Civ APK installed (or build plugin standalone)

**Build and Deploy:**
```powershell
# Build the trust overlay plugin
pnpm run build:atak

# Deploy to connected Pixel 9 Pro
pnpm run deploy:atak
```

**Expected Output:**
```
✅ ATAK Trust Overlay deployed to /sdcard/atak/tools/aethercore-trust-overlay.zip
✅ Plugin installed successfully
✅ Restart ATAK to load plugin
```

---

## Step 5: Attestation Flow Test

### Generate Hardware-Backed Key Pair

**On Device (via ATAK plugin):**
```kotlin
val keyManager = AndroidEnrollmentKeyManager.create(context)
val hardwareFingerprint = keyManager.getHardwareFingerprint()
// Output: Google-Pixel_9_Pro-<serial>-<build_fingerprint>

// Initialize native daemon with hardware identity
RalphieNodeDaemon.nativeInitialize(
    storagePath = filesDir.absolutePath,
    hardwareId = hardwareFingerprint
)
```

**Expected Behavior:**
1. Private key generated in **Titan M2** (never touches system memory)
2. Public key extracted via Keystore API
3. Attestation certificate chain validated against Google's root CA
4. Node identity bound to hardware fingerprint

### Verify Byzantine Detection

**Test Scenario: Spoofed Signature**

```rust
// In crates/trust_mesh/src/byzantine_detector.rs
let spoofed_event = create_spoofed_event(); // Invalid signature
let result = detector.validate_event(&spoofed_event);

assert!(matches!(result, Err(ByzantineFaultType::InvalidSignature)));
// Node is quarantined via Aetheric Sweep
```

---

## Step 6: Field Test Checklist

**Before Deployment:**

- [ ] USB Debugging enabled and device detected by ADB
- [ ] `pnpm run check:android` returns `READY_STRONGBOX`
- [ ] Bootloader is **locked** (`bootloader_locked=1`)
- [ ] Verified Boot state is **green**
- [ ] Security patch is within 90 days
- [ ] ATAK plugin builds without errors
- [ ] Plugin deploys and loads in ATAK-Civ
- [ ] Node enrolls in trust mesh with hardware-backed identity
- [ ] Byzantine fault detection triggers on invalid signatures

---

## Architecture Notes

### Fail-Visible Enforcement

```rust
// crates/android-ffi/src/lib.rs
pub unsafe extern "C" fn Java_com_aethercore_atak_trustoverlay_core_RalphieNodeDaemon_nativeInitialize(
    // ...
) -> jboolean {
    // If hardware attestation fails, return JNI_FALSE immediately
    // NO graceful degradation - node is adversarial until proven otherwise
    if !verify_strongbox_attestation(&hardware_id_str) {
        error!("FAIL-VISIBLE: Hardware attestation failed for {}", hardware_id_str);
        return jni::sys::JNI_FALSE;
    }
    // ...
}
```

### Prohibited Patterns

❌ **Do NOT** simulate keys when StrongBox is available  
❌ **Do NOT** allow software fallback for signature operations  
❌ **Do NOT** cache private keys in memory  
❌ **Do NOT** use SHA-256 for integrity checks (use BLAKE3)

✅ **Do** enforce hardware-backed signing for all trust mesh operations  
✅ **Do** validate attestation certificates against Google's root CA  
✅ **Do** fail loudly if Titan M2 is unavailable  
✅ **Do** use BLAKE3 for Merkle Vine event hashing

---

## Troubleshooting

### Device Not Detected

**Symptom:** `adb_state=unknown`

**Fix:**
1. Disconnect and reconnect USB cable
2. Ensure USB mode is set to "File Transfer" (not "Charging Only")
3. Check Windows Device Manager for driver issues
4. Try different USB port (prefer USB 3.0 ports)

### StrongBox Not Available

**Symptom:** `strongbox_feature=False`

**Root Cause:** This should NOT happen on Pixel 9 Pro (Titan M2 is built-in)

**Investigate:**
```powershell
& "$env:LOCALAPPDATA\Android\Sdk\platform-tools\adb.exe" shell pm list features | Select-String "strongbox"
```

Expected: `feature:android.hardware.strongbox_keystore`

### Bootloader Unlocked Warning

**Symptom:** `bootloader_locked=0`

**Security Impact:** ⚠️ **HIGH** - Verified Boot chain is broken

**Fix:**
1. This is expected for development/testing
2. For production deployments, bootloader MUST be locked
3. Re-lock via: `fastboot flashing lock` (⚠️ WIPES DEVICE)

---

## Next Steps

1. **Enable USB Debugging** (see Step 1)
2. **Run**: `pnpm run check:android`
3. **Verify**: `status=READY_STRONGBOX`
4. **Build Plugin**: `pnpm run build:atak`
5. **Deploy**: `pnpm run deploy:atak`

Once the device is detected, we can proceed with:
- ATAK plugin integration testing
- Hardware-backed enrollment in trust mesh
- Field test preparation with real Titan M2 attestation

---

## References

- [Android Keystore System](https://developer.android.com/training/articles/keystore)
- [StrongBox Implementation](https://source.android.com/docs/security/features/keystore)
- [Titan M2 Security Chip](https://security.googleblog.com/2021/10/pixel-6-setting-new-standard-for-mobile.html)
- AetherCore: `docs/ANDROID_SE_ROLLOUT_PLAN.md`
- AetherCore: `crates/identity/src/android_keystore.rs`

