# 🎯 TACTICAL GLASS ATAK PLUGIN - QUICK START CARD

## ⚠️ CURRENT STATUS: BLOCKED - TOOLCHAIN REQUIRED

---

## 📋 CHECKLIST

### Before You Begin
- [ ] Android Studio installed (or Android SDK command-line tools)
- [ ] `ANDROID_HOME` environment variable set
- [ ] cargo-ndk installed (`cargo install cargo-ndk`)
- [ ] ATAK-CIV SDK JAR placed in `libs/` directory
- [ ] Android emulator running OR physical device connected

---

## 🚀 BUILD COMMANDS

```powershell
# 1. Navigate to plugin directory
cd C:\Users\Owner\StudioProjects\AetherCore\plugins\atak-trust-overlay

# 2. Create Gradle wrapper (first time only)
gradle wrapper --gradle-version 8.5

# 3. Build the plugin
.\gradlew assembleCivDebug

# Output: build/outputs/apk/civDebug/atak-trust-overlay-civDebug.apk
```

---

## 📱 DEPLOYMENT COMMANDS

```powershell
# 1. Verify device connected
adb devices

# 2. Install ATAK base app (if not already installed)
adb install -r path\to\ATAK-CIV-4.10.0.apk

# 3. Deploy Tactical Glass plugin
adb install -r -t build\outputs\apk\civDebug\atak-trust-overlay-civDebug.apk

# 4. Launch ATAK
adb shell am start -n com.atakmap.app.civ/com.atakmap.android.maps.MapActivity

# 5. Monitor logs
adb logcat -s RalphieNodeDaemon:I AetherCore:I
```

---

## 🧪 TEST COMMANDS

```powershell
# Run CoT injection test (both verified and spoofed)
.\inject-cot-test.ps1

# Or separately:
.\inject-cot-test.ps1 -VerifiedOnly
.\inject-cot-test.ps1 -SpoofedOnly
```

**Expected Results:**
- ✅ **BLUE-ACTUAL** renders with GREEN SHIELD (verified)
- ❌ **UNKNOWN-HOSTILE** renders with RED GHOST (spoofed)

---

## 🛠️ SETUP ANDROID SDK (If Missing)

### Option A: Android Studio (Easiest)
1. Download: https://developer.android.com/studio
2. Install with default settings
3. SDK Manager → Install:
   - Android SDK Platform 34
   - Android SDK Build-Tools 34.0.0
   - NDK (Side by side) 26.1.10909125
   - CMake 3.22.1

### Option B: Command Line Tools
```powershell
# Download command-line tools from:
# https://developer.android.com/studio#command-tools

# Extract to C:\Android\cmdline-tools\latest\

# Set environment variable:
[System.Environment]::SetEnvironmentVariable('ANDROID_HOME', 'C:\Android', 'User')

# Install components:
sdkmanager "platforms;android-34" "build-tools;34.0.0" "ndk;26.1.10909125" "cmake;3.22.1"
```

---

## 🦀 SETUP RUST TOOLS

```powershell
# Install cargo-ndk
cargo install cargo-ndk

# Add Android targets
rustup target add aarch64-linux-android
rustup target add armv7-linux-androideabi

# Verify
rustup target list | Select-String "android"
```

---

## 📦 OBTAIN ATAK SDK

**Required:** `atak-civ-sdk-4.10.0.jar` (or compatible v4.2+)

**Sources:**
- TAK.gov (US Government users)
- TAK Product Center (authorized partners)

**Installation:**
```powershell
# Place in libs directory:
Copy-Item "path\to\atak-civ-sdk-4.10.0.jar" `
    "C:\Users\Owner\StudioProjects\AetherCore\plugins\atak-trust-overlay\libs\"

# Verify:
Get-ChildItem libs\
```

---

## 🐋 DOCKER ALTERNATIVE

If local Android setup is complex:

```powershell
# Build Docker image
docker build -t aethercore-android-builder -f Dockerfile.build .

# Run build
docker run --rm -v ${PWD}:/workspace aethercore-android-builder `
    bash -c "cd plugins/atak-trust-overlay && ./gradlew assembleCivDebug"
```

---

## 🔍 TROUBLESHOOTING

### "UnsatisfiedLinkError: libaethercore_jni.so"
- Check Rust targets: `rustup target list | Select-String "android"`
- Rebuild native library: `cargo ndk -t arm64-v8a build --release`

### "ATAK SDK classes not found"
- Verify SDK in `libs/`: `Get-ChildItem libs\*.jar`
- Check build.gradle.kts: `compileOnly(fileTree(...))`

### "Plugin not appearing in ATAK"
- Check plugin manifest: `src\main\assets\plugin.xml`
- Check logs: `adb logcat | Select-String "plugin"`

### "Gradle not found"
- Install globally: `choco install gradle` (or use Docker method)

---

## 📚 DOCUMENTATION

- **Full Deployment Guide:** `DEPLOYMENT.md`
- **Engineering Status:** `STATUS.md`
- **Project README:** `README.md`

---

## ✅ SUCCESS CRITERIA

When everything works:

✅ Plugin APK compiles with native libraries  
✅ Plugin loads in ATAK without errors  
✅ Verified CoT shows green shield on map  
✅ Spoofed CoT shows red ghost on map  
✅ Aetheric Sweep triggers Byzantine detection  

---

## 🚨 CRITICAL REMINDERS

1. **Never deploy Dev Mode to production** (no TPM integration)
2. **ATAK SDK is required** - no compilation without it
3. **Test on AVD first** before physical device
4. **Monitor logs** during testing: `adb logcat`

---

**4MIK - Fail-Visible Coordination at the Tactical Edge**

