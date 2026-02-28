# Tactical Glass ATAK Plugin - Deployment Protocol

**Mission:** Deploy AetherCore Trust Overlay to ATAK End User Device (EUD)  
**Objective:** Eradicate Identity Collapse at the Tactical Edge via Hardware-Rooted Trust

---

## Phase 1: Pre-Flight Checklist

### ✅ Infrastructure Status

| Component | Status | Location |
|-----------|--------|----------|
| Rust JNI Bridge | ✅ READY | `crates/android-ffi/` |
| Kotlin Plugin Core | ✅ READY | `plugins/atak-trust-overlay/src/main/kotlin/` |
| Build Configuration | ✅ READY | `build.gradle.kts`, `CMakeLists.txt` |
| ATAK SDK | ❌ **REQUIRED** | `plugins/atak-trust-overlay/libs/` |

### ❌ Deployment Blockers

**BLOCKER 1: Android Development Environment**
- **Required:** Android SDK, NDK, CMake
- **Status:** Not detected on this system
- **Action:** Install Android Studio or command-line tools

**BLOCKER 2: Build Tools**
- **Required:** Gradle, cargo-ndk
- **Status:** Not installed
- **Action:** `cargo install cargo-ndk` + Gradle installation

**BLOCKER 3: ATAK SDK**
- **Required:** ATAK-CIV SDK 4.2+ (JAR or AAR)
- **Status:** Missing from `libs/` directory
- **Action:** Obtain from TAK.gov or authorized partner

---

## Phase 2: Environment Setup

### Option A: Local Development (Windows)

#### 1. Install Android SDK

```powershell
# Download Android Studio from:
# https://developer.android.com/studio

# Set environment variables (restart PowerShell after):
[System.Environment]::SetEnvironmentVariable('ANDROID_HOME', 'C:\Users\Owner\AppData\Local\Android\Sdk', 'User')
[System.Environment]::SetEnvironmentVariable('ANDROID_SDK_ROOT', 'C:\Users\Owner\AppData\Local\Android\Sdk', 'User')

# Verify:
$env:ANDROID_HOME
```

#### 2. Install Build Tools

```powershell
# Install cargo-ndk
cargo install cargo-ndk

# Add Rust Android targets
rustup target add aarch64-linux-android
rustup target add armv7-linux-androideabi

# Verify NDK installation via Android Studio SDK Manager:
# Tools → SDK Manager → SDK Tools → NDK (Side by side)
# Install version 26.1.10909125 or compatible
```

#### 3. Place ATAK SDK

```powershell
# Copy ATAK-CIV SDK to libs directory:
Copy-Item "path\to\atak-civ-sdk-4.10.0.jar" `
    "C:\Users\Owner\StudioProjects\AetherCore\plugins\atak-trust-overlay\libs\"

# Verify:
Get-ChildItem "C:\Users\Owner\StudioProjects\AetherCore\plugins\atak-trust-overlay\libs\"
```

### Option B: Docker Build Environment

```powershell
# Build the Docker image
docker build -t aethercore-android-builder `
    -f plugins/atak-trust-overlay/Dockerfile.build .

# Run the build (after placing ATAK SDK in libs/)
docker run --rm -v ${PWD}:/workspace aethercore-android-builder `
    bash -c "cd plugins/atak-trust-overlay && ./gradlew assembleCivDebug"
```

---

## Phase 3: Compilation Protocol

### Step 1: Generate Gradle Wrapper (First Time Only)

```powershell
cd C:\Users\Owner\StudioProjects\AetherCore\plugins\atak-trust-overlay

# If Gradle is installed globally:
gradle wrapper --gradle-version 8.5

# This creates gradlew.bat for Windows
```

### Step 2: Build the Plugin APK

```powershell
cd C:\Users\Owner\StudioProjects\AetherCore\plugins\atak-trust-overlay

# Build debug APK
.\gradlew assembleCivDebug

# Expected output:
# BUILD SUCCESSFUL
# APK location: build/outputs/apk/civDebug/atak-trust-overlay-civDebug.apk
```

**Build Process Details:**
1. Gradle invokes CMake
2. CMake executes `cargo ndk` to build Rust crate
3. `libaethercore_jni.so` compiled for `armeabi-v7a` and `arm64-v8a`
4. Native library packaged into APK alongside Kotlin code
5. APK signed with debug keystore

---

## Phase 4: Deployment to Android Virtual Device (AVD)

### Step 1: Verify AVD is Running

```powershell
# List available AVDs
emulator -list-avds

# Start an AVD (replace with your AVD name)
Start-Process emulator -ArgumentList "-avd","Pixel_5_API_34","-netdelay","none","-netspeed","full"

# Wait for boot (check with):
adb wait-for-device
adb shell getprop sys.boot_completed
# Should output: 1
```

### Step 2: Install ATAK-CIV Base Application

**CRITICAL:** The plugin requires ATAK-CIV 4.2+ to be installed first.

```powershell
# Install ATAK base app (obtain from TAK.gov)
adb install -r path\to\ATAK-CIV-4.10.0.apk

# Verify installation
adb shell pm list packages | Select-String "tak.civ"
```

### Step 3: Deploy Tactical Glass Plugin

```powershell
# Install the AetherCore plugin
adb install -r -t C:\Users\Owner\StudioProjects\AetherCore\plugins\atak-trust-overlay\build\outputs\apk\civDebug\atak-trust-overlay-civDebug.apk

# Verify installation
adb shell pm list packages | Select-String "aethercore"
# Expected: package:com.aethercore.atak.trustoverlay

# Check native library was extracted
adb shell "ls -lh /data/app/*/lib/arm64/"
# Should show: libaethercore_jni.so
```

### Step 4: Launch ATAK and Enable Plugin

```powershell
# Start ATAK application
adb shell am start -n com.atakmap.app.civ/com.atakmap.android.maps.MapActivity

# Monitor logs for plugin initialization
adb logcat -s RalphieNodeDaemon:I AetherCore:I
```

**Expected Log Output:**
```
I/RalphieNodeDaemon: AetherCore JNI loaded successfully.
I/AetherCore: Initializing AetherCore daemon: storage=/data/user/0/com.atakmap.app.civ/files
I/AetherCore: AetherCore daemon started successfully
```

---

## Phase 5: Fail-Visible Validation Test

### Objective: Prove Aetheric Sweep Visualization

We will inject two Cursor on Target (CoT) messages:
1. **Payload A (Verified):** Green trust state with genesis hash
2. **Payload B (Spoofed):** Red trust state (Byzantine/revoked)

### Payload A: Verified Track (Green Shield)

```xml
<?xml version="1.0" encoding="UTF-8"?>
<event version="2.0" uid="AETHERCORE-VERIFIED-001" type="a-f-G-E-S" how="m-g" time="2026-02-19T23:45:00.000Z" start="2026-02-19T23:45:00.000Z" stale="2026-02-19T23:50:00.000Z">
  <point lat="38.889931" lon="-77.009003" hae="25.0" ce="10.0" le="15.0"/>
  <detail>
    <contact callsign="BLUE-ACTUAL"/>
    <aethercore trustLevel="Green" trustScore="0.95" genesisHash="abc123def456789" merkleVineDepth="42" lastVerifiedEpoch="1708388700"/>
    <__group name="Blue Force" role="Team Lead"/>
  </detail>
</event>
```

### Payload B: Spoofed Track (Red/Ghosted)

```xml
<?xml version="1.0" encoding="UTF-8"?>
<event version="2.0" uid="AETHERCORE-SPOOFED-666" type="a-h-G" how="m-g" time="2026-02-19T23:45:05.000Z" start="2026-02-19T23:45:05.000Z" stale="2026-02-19T23:50:05.000Z">
  <point lat="38.891234" lon="-77.010567" hae="25.0" ce="50.0" le="50.0"/>
  <detail>
    <contact callsign="UNKNOWN-HOSTILE"/>
    <aethercore trustLevel="Red" trustScore="0.05" spoofReason="INVALID_SIGNATURE" byzantineViolation="BROKEN_HASH_CHAIN"/>
    <__group name="Unknown" role="Hostile"/>
  </detail>
</event>
```

### Injection Commands

```powershell
# Save payloads to files
$payloadA = @'
<?xml version="1.0" encoding="UTF-8"?>
<event version="2.0" uid="AETHERCORE-VERIFIED-001" type="a-f-G-E-S" how="m-g" time="2026-02-19T23:45:00.000Z" start="2026-02-19T23:45:00.000Z" stale="2026-02-19T23:50:00.000Z">
  <point lat="38.889931" lon="-77.009003" hae="25.0" ce="10.0" le="15.0"/>
  <detail>
    <contact callsign="BLUE-ACTUAL"/>
    <aethercore trustLevel="Green" trustScore="0.95" genesisHash="abc123def456789" merkleVineDepth="42" lastVerifiedEpoch="1708388700"/>
    <__group name="Blue Force" role="Team Lead"/>
  </detail>
</event>
'@

$payloadB = @'
<?xml version="1.0" encoding="UTF-8"?>
<event version="2.0" uid="AETHERCORE-SPOOFED-666" type="a-h-G" how="m-g" time="2026-02-19T23:45:05.000Z" start="2026-02-19T23:45:05.000Z" stale="2026-02-19T23:50:05.000Z">
  <point lat="38.891234" lon="-77.010567" hae="25.0" ce="50.0" le="50.0"/>
  <detail>
    <contact callsign="UNKNOWN-HOSTILE"/>
    <aethercore trustLevel="Red" trustScore="0.05" spoofReason="INVALID_SIGNATURE" byzantineViolation="BROKEN_HASH_CHAIN"/>
    <__group name="Unknown" role="Hostile"/>
  </detail>
</event>
'@

# Push to device
$payloadA | Out-File -Encoding UTF8 verified.xml
$payloadB | Out-File -Encoding UTF8 spoofed.xml

adb push verified.xml /sdcard/atak/tools/cotdispatch/verified.xml
adb push spoofed.xml /sdcard/atak/tools/cotdispatch/spoofed.xml

# Inject via ATAK broadcast intent
adb shell am broadcast -a com.atakmap.android.maps.COT_RECEIVED --es cot_xml "$(Get-Content verified.xml -Raw)"
Start-Sleep -Seconds 2
adb shell am broadcast -a com.atakmap.android.maps.COT_RECEIVED --es cot_xml "$(Get-Content spoofed.xml -Raw)"
```

### Expected Map Visualization

**Verified Track (BLUE-ACTUAL):**
- ✅ Green cryptographic shield overlay
- ✅ Normal opacity
- ✅ Trust score: 95%
- ✅ Detail panel shows: Genesis Hash, Merkle Vine depth

**Spoofed Track (UNKNOWN-HOSTILE):**
- ❌ Red/gray ghosted appearance
- ❌ Reduced opacity (50%)
- ❌ Flashing red indicator
- ❌ Detail panel shows: "SPOOFED - Invalid Signature"
- ❌ Audit log entry: "Byzantine violation detected"

---

## Success Criteria

✅ Plugin APK compiles with `libaethercore_jni.so`  
✅ Plugin loads in ATAK without crash  
✅ RalphieNodeDaemon initializes with hardware fingerprint  
✅ Verified CoT renders with green shield  
✅ Spoofed CoT renders with red/ghosted treatment  
✅ Aetheric Sweep can be triggered via plugin menu  

---

## Troubleshooting

### Issue: "UnsatisfiedLinkError: libaethercore_jni.so"

**Cause:** Native library not compiled or wrong ABI
**Fix:**
```powershell
# Check Rust targets
rustup target list | Select-String "android"

# Rebuild with verbose logging
cd crates/android-ffi
cargo ndk -t arm64-v8a -o ../../plugins/atak-trust-overlay/src/main/jniLibs build --release
```

### Issue: "ATAK SDK classes not found"

**Cause:** Missing ATAK SDK in `libs/`
**Fix:** Place `atak-civ-sdk-*.jar` in `plugins/atak-trust-overlay/libs/`

### Issue: "Plugin not appearing in ATAK"

**Cause:** Plugin manifest not registered
**Fix:** Verify `src/main/assets/plugin.xml` exists and check logs:
```powershell
adb logcat | Select-String "plugin"
```

---

## Next Steps After Successful Deployment

1. **Hardware Enrollment:** Integrate real TPM via AndroidEnrollmentKeyManager
2. **Mesh Networking:** Connect to production AetherCore mesh nodes
3. **Byzantine Red Cell:** Deploy adversarial node to test Aetheric Sweep
4. **Field Test:** Deploy to physical device with GNSS-denied scenario

---

**End of Deployment Protocol**

