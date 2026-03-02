# ATAK Plugin Development Workflow

**Complete end-to-end guide for building, verifying, and deploying the ATAK-Civ plugin.**

---

## Quick Reference

| **Task** | **Command** |
|---|---|
| **Build** | `pnpm run build:atak` |
| **Verify Build** | `pnpm run verify:atak` |
| **Deploy to Device** | `pnpm run deploy:atak` |
| **Clean** | `pnpm run clean:atak` |

---

## Workflow Stages

### Stage 1: Prepare Environment

**Prerequisites:**
- Node.js 20.x
- pnpm 9.15.0
- Java Development Kit (JDK) 17+
- (Optional) Android SDK with adb for device deployment

**Check Environment:**
```bash
node --version     # v20.x.x
pnpm --version     # 9.15.0
java -version      # 17+
# Optional:
adb version        # Android SDK installed
```

### Stage 2: Verify Build System

**Purpose:** Ensure all build configuration files are in place

```bash
pnpm run verify:atak
```

**Expected Output:**
```
════════════════════════════════════════════════════════════
AetherCore ATAK Plugin Build Verification
════════════════════════════════════════════════════════════

✅ Build Configuration
   ✅ build.gradle.kts exists
   ✅ JAR name configured as "main"
   ...

✅ Source Files
   ✅ Plugin source directory exists
   ✅ Found 5 source file(s)
   ✅ Found 5 Kotlin file(s)

✅ Android Manifest
   ✅ AndroidManifest.xml exists
   ✅ Package name correct

✅ ATAK Plugin Descriptor
   ✅ plugin.xml exists
   ✅ Plugin name: "AetherCore Trust Overlay"
   ...

✅ Gradle Wrapper
   ✅ gradlew script exists (Unix)
   ✅ gradlew.bat script exists (Windows)

✅ Build Configuration
✅ Source Files
✅ Android Manifest
✅ ATAK Plugin Descriptor
✅ Gradle Wrapper

════════════════════════════════════════════════════════════
Summary
════════════════════════════════════════════════════════════

✅ All verification groups passed

Build system is ready for use:
  1. Run: pnpm run build:atak
  2. Verify: jar tf dist/atak/main.jar
  3. Deploy: node scripts/deploy-atak-plugin.js
```

**Troubleshooting:**
- If verification fails, check the specific error message
- Run `pnpm run doctor` for general environment diagnostics

### Stage 3: Build Plugin

**Purpose:** Compile Kotlin source code and package into main.jar

```bash
pnpm run build:atak
```

**What Happens:**
1. ✅ Prerequisite checks (build.gradle.kts, Gradle available)
2. ✅ Clean previous build artifacts
3. ✅ Compile Kotlin source code to bytecode
4. ✅ Package classes into JAR with manifest
5. ✅ Verify artifact size and existence
6. ✅ Stage JAR to dist/atak/main.jar

**Expected Output:**
```
============================================================
AetherCore ATAK-Civ Plugin Builder
============================================================

✅ Prerequisites check passed

============================================================
Building ATAK Plugin
============================================================

Executing: gradle assembleMainJar

> Configure project :atak-trust-overlay

BUILD SUCCESSFUL in 12s

✅ Build succeeded

============================================================
Verifying main.jar
============================================================

✅ Artifact verification passed
   Location: plugins/atak-trust-overlay/build/outputs/main.jar
   Size: 47 KB (48234 bytes)

============================================================
Staging Artifact for Deployment
============================================================

✅ Artifact staged
   Deployment path: dist/atak/main.jar

============================================================
Build Summary
============================================================

✅ ATAK Plugin Build Complete

Artifacts:
  - Build output: plugins/atak-trust-overlay/build/outputs/main.jar
  - Deployment:   dist/atak/main.jar

Next Steps:
  1. Verify JAR contents: jar tf dist/atak/main.jar
  2. Deploy to ATAK device/emulator
  3. Verify plugin loads in ATAK
```

**Manual Verification:**
```bash
# Check JAR exists and has reasonable size
ls -lh dist/atak/main.jar

# List contents (verify structure)
jar tf dist/atak/main.jar | head -20

# Check manifest
unzip -p dist/atak/main.jar META-INF/MANIFEST.MF

# Expected manifest includes:
# Implementation-Title: AetherCore ATAK Trust Overlay
# Plugin-Type: ATAK-CIV
# AetherCore-Version: 0.2.0
```

### Stage 4: Deploy to Device (Optional)

**Prerequisites:**
- Android device or emulator connected
- ATAK CIV application installed
- adb available in PATH

**Deploy:**
```bash
pnpm run deploy:atak
```

**Interactive Options:**
```bash
# Deploy to specific device
pnpm run deploy:atak -- --device emulator-5554

# Deploy and monitor logs
pnpm run deploy:atak -- --wait
```

**What Happens:**
1. ✅ Check device connectivity
2. ✅ Push main.jar to /sdcard/atak/plugins/
3. ✅ Verify JAR copied successfully
4. ✅ Send plugin reload broadcast
5. ✅ Monitor logcat for plugin errors

**Expected Output:**
```
============================================================
AetherCore ATAK Plugin Deployment
============================================================

✅ Found main.jar (47 KB)
✅ adb available: Android SDK Platform Tools version x.x.x
✅ Android device(s) connected

✅ Using device: emulator-5554 (Android SDK built for x86)

============================================================
Deploying Plugin
============================================================

Creating ATAK plugins directory...
Pushing main.jar to /sdcard/atak/plugins...
main.jar: 1 file pushed. 0.1s, 47 KB/s
✅ Pushed to device: /sdcard/atak/plugins/main.jar

============================================================
Verifying Deployment
============================================================

✅ JAR found on device
   -rw-rw---- root shell 48234 2025-01-27 12:34 /sdcard/atak/plugins/main.jar

============================================================
Reloading ATAK Plugins
============================================================

✅ Plugin reload broadcast sent
   Allow 5-10 seconds for ATAK to reload plugins

============================================================
Deployment Summary
============================================================

✅ Plugin Deployed Successfully

Device Information:
  Serial: emulator-5554
  Model: Android SDK built for x86

Deployment Path:
  Remote: /sdcard/atak/plugins/main.jar
  Local: dist/atak/main.jar

Next Steps:
  1. Verify plugin loads: Settings → Plugins → Check AetherCore Trust Overlay
  2. Monitor logs: adb logcat | grep -i aethercore
  3. Test functionality: Open Trust Overlay in ATAK UI
```

**Troubleshooting:**
```bash
# Check device connection
adb devices

# Monitor plugin loading
adb logcat | grep -i aethercore

# Restart ATAK plugin system
adb shell am broadcast -a com.atakmap.app.RELOAD_PLUGINS

# Clear ATAK app data (if needed)
adb shell pm clear com.atakmap.app.civ
```

### Stage 5: Verify Plugin Loads

**In ATAK Application:**
1. Open ATAK
2. Navigate to: Settings → Plugins
3. Look for "AetherCore Trust Overlay" in the plugin list
4. Check that status is "Loaded" (green checkmark)

**Via Logcat:**
```bash
# Monitor logs during ATAK startup
adb logcat -c
adb logcat | grep -i "aethercore\|trustoverlay\|plugin"

# Look for messages like:
# I AetherCore: Trust Overlay initialized
# I TrustOverlay: Plugin loaded successfully
# E AetherCore: Plugin error (if any issues)
```

**Test Functionality:**
- Open Trust Overlay UI in ATAK
- Verify trust data displays correctly
- Check for any runtime exceptions

---

## Full Workflow Examples

### Example 1: Development Build Cycle

```bash
# 1. Prepare
pnpm install
pnpm run doctor

# 2. Verify system
pnpm run verify:atak

# 3. Make code changes
# (edit plugins/atak-trust-overlay/src/main/kotlin/...)

# 4. Build
pnpm run build:atak

# 5. Manual artifact inspection
jar tf dist/atak/main.jar | grep -E "\.class$" | head -5

# 6. If ATAK SDK integrated:
# - Verify classes include ATAK framework classes
# - Check for compilation errors in build output
```

### Example 2: Deploy to Local Device

```bash
# 1. Build
pnpm run build:atak

# 2. Connect device
adb devices
# emulator-5554 device

# 3. Deploy
pnpm run deploy:atak

# 4. Verify plugin loads
adb logcat | grep AetherCore

# 5. Test in ATAK UI
# (manual verification in application)
```

### Example 3: CI/CD Pipeline

```bash
# In GitHub Actions or similar:

- name: Verify Build System
  run: pnpm run verify:atak

- name: Build ATAK Plugin
  run: pnpm run build:atak

- name: Upload Artifact
  uses: actions/upload-artifact@v4
  with:
    name: main.jar
    path: dist/atak/main.jar

- name: Verify Artifact
  run: |
    ls -lh dist/atak/main.jar
    jar tf dist/atak/main.jar | head -10
```

---

## Troubleshooting Guide

### Build Issues

**Error: "Gradle not found"**
```bash
# Solution: Use bundled wrapper
plugins/atak-trust-overlay/gradlew assembleMainJar

# Or install Gradle globally
brew install gradle  # macOS
choco install gradle # Windows
sdk install gradle   # Linux
```

**Error: "main.jar not generated"**
```bash
# Check for Kotlin compilation errors
cd plugins/atak-trust-overlay
./gradlew assembleMainJar --stacktrace

# Verify source files exist
ls -la src/main/kotlin/com/aethercore/atak/trustoverlay/

# If empty, source code may not be checked out
git status plugins/atak-trust-overlay/src
```

**Error: "JAR size < 1KB"**
```bash
# JAR is likely empty - verify build
ls -lh build/outputs/main.jar
jar tf build/outputs/main.jar

# Check compilation output directory
ls -la build/intermediates/javac/release/classes/
ls -la build/tmp/kotlin-classes/release/
```

### Deployment Issues

**Error: "adb not found"**
```bash
# Install Android SDK
# macOS
brew install android-sdk

# Windows
choco install android-sdk

# Or add to PATH
export PATH=$PATH:~/Android/Sdk/platform-tools
```

**Error: "No devices found"**
```bash
# Check connection
adb devices

# If emulator not running:
emulator -avd Android_API_28 &

# If physical device: enable USB debugging
# Settings → About Phone → Build Number (tap 7 times)
# Settings → Developer Options → USB Debugging
```

**Error: "Plugin fails to load"**
```bash
# Check ATAK logs
adb logcat | grep -E "AetherCore|trustoverlay|error"

# Verify JAR on device
adb shell ls -lh /sdcard/atak/plugins/main.jar

# Check ATAK plugin directory permissions
adb shell ls -la /sdcard/atak/plugins/

# If needed, manually create directory
adb shell mkdir -p /sdcard/atak/plugins
```

---

## Command Reference

### Build Commands

```bash
# From repository root
pnpm run build:atak          # Build main.jar (full pipeline)
pnpm run clean:atak          # Remove build artifacts
pnpm run verify:atak         # Verify build system configuration

# From plugin directory
cd plugins/atak-trust-overlay
./gradlew assembleMainJar    # Direct Gradle build
./gradlew clean              # Clean build artifacts
./gradlew build              # Full Gradle build (includes tests)
```

### Deployment Commands

```bash
# Deploy to default device
pnpm run deploy:atak

# Deploy to specific device
pnpm run deploy:atak -- --device emulator-5554

# Monitor logs after deployment
pnpm run deploy:atak -- --wait
adb logcat | grep -i aethercore
```

### Verification Commands

```bash
# Verify build configuration
pnpm run verify:atak

# Check JAR contents
jar tf dist/atak/main.jar

# Inspect manifest
unzip -p dist/atak/main.jar META-INF/MANIFEST.MF

# Get JAR file info
ls -lh dist/atak/main.jar
file dist/atak/main.jar
```

### Device Commands

```bash
# List connected devices
adb devices -l

# Forward adb port (if needed)
adb forward tcp:5555 tcp:5555

# Monitor logcat
adb logcat | grep AetherCore

# Install specific APK/app
adb install -r path/to/app.apk

# Reload plugins in ATAK
adb shell am broadcast -a com.atakmap.app.RELOAD_PLUGINS
```

---

## File Locations Reference

| **File** | **Path** | **Purpose** |
|---|---|---|
| **Build Config** | `plugins/atak-trust-overlay/build.gradle.kts` | Gradle build configuration |
| **Settings** | `plugins/atak-trust-overlay/settings.gradle.kts` | Gradle module settings |
| **Properties** | `plugins/atak-trust-overlay/gradle.properties` | Build properties |
| **Manifest** | `plugins/atak-trust-overlay/src/main/AndroidManifest.xml` | Android manifest |
| **Plugin Descriptor** | `plugins/atak-trust-overlay/src/main/resources/META-INF/plugin.xml` | ATAK plugin descriptor |
| **Build Output** | `plugins/atak-trust-overlay/build/outputs/main.jar` | Local build artifact |
| **Staged Artifact** | `dist/atak/main.jar` | Deployment staging location |
| **Build Script** | `scripts/build-atak-plugin.js` | Build orchestration |
| **Deploy Script** | `scripts/deploy-atak-plugin.js` | Deployment automation |
| **Verify Script** | `scripts/verify-atak-build.js` | Build system verification |

---

## Environment Variables

```bash
# Skip toolchain verification (used in Docker)
export SKIP_TOOLCHAIN_CHECK=1

# Android SDK location (if not in default path)
export ANDROID_SDK_ROOT=/path/to/android/sdk

# Java home (if multiple Java versions)
export JAVA_HOME=/path/to/jdk-17

# Gradle options (performance tuning)
export GRADLE_OPTS="-Xmx2g -XX:+UseG1GC"
```

---

## Documentation Index

- **Build Guide**: `docs/ATAK_PLUGIN_BUILD_GUIDE.md` - Comprehensive build documentation
- **Integration Summary**: `docs/ATAK_PLUGIN_INTEGRATION_SUMMARY.md` - Integration overview
- **Final Report**: `docs/ATAK_PLUGIN_FINAL_REPORT.md` - Complete implementation details
- **Quick Build**: `plugins/atak-trust-overlay/QUICKBUILD.md` - One-page quick reference

---

## Support & Escalation

### Quick Help

```bash
# Environment check
pnpm run doctor

# Build system verification
pnpm run verify:atak

# Build with full output
cd plugins/atak-trust-overlay
./gradlew assembleMainJar --stacktrace --info
```

### Reporting Issues

Include:
- Output from `pnpm run doctor`
- Output from failed command with `--stacktrace` flag
- Device/emulator information (adb devices -l)
- ATAK version and device OS
- Steps to reproduce

---

## Next Steps

- ✅ Verify build system: `pnpm run verify:atak`
- ✅ Build plugin: `pnpm run build:atak`
- ✅ Check artifact: `jar tf dist/atak/main.jar`
- ✅ Deploy (optional): `pnpm run deploy:atak`
- ✅ Verify plugin loads in ATAK UI

**Good luck! 🚀**
