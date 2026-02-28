# Android Emulator Setup Guide - ATAK-Civ + AetherCore Trust Overlay

**Status:** Complete Setup Automation Available  
**Date:** 2025-01-27

---

## Quick Start

### Automated Setup (Recommended)

```bash
node scripts/setup-atak-emulator.js
```

This script will:
1. ✅ Check prerequisites (Android SDK, ADB, emulator)
2. ✅ Find or create emulator
3. ✅ Start emulator
4. ✅ Install ATAK-Civ (if APK provided)
5. ✅ Build trust overlay plugin
6. ✅ Deploy plugin to emulator
7. ✅ Verify plugin loads

---

## Prerequisites

### Windows (Recommended)

**Visual Studio with Android Development:**
```
Visual Studio 2022 Community (Free)
├── Android development workload
├── Android SDK (automatically installed)
├── Android emulator
└── Java Development Kit (17+)
```

**Installation Steps:**

1. Download Visual Studio Installer
2. Select "Mobile development with .NET"
   - Includes Android SDK, emulator, ADB
3. Complete installation (~5 GB)

**Verify Installation:**
```cmd
echo %ANDROID_SDK_ROOT%
adb version
emulator -version
```

### macOS

**Using Homebrew:**
```bash
# Install Android SDK
brew install --cask android-sdk

# Install emulator
/usr/local/share/android-sdk/tools/bin/sdkmanager "emulator" "system-images;android-28;google_apis;x86_64"

# Set environment
export ANDROID_SDK_ROOT=/usr/local/share/android-sdk
export PATH=$PATH:$ANDROID_SDK_ROOT/platform-tools:$ANDROID_SDK_ROOT/emulator
```

### Linux

**Using APT (Ubuntu/Debian):**
```bash
# Install Android SDK
sudo apt-get install android-sdk android-sdk-emulator

# Set environment
export ANDROID_SDK_ROOT=/usr/lib/android-sdk
export PATH=$PATH:$ANDROID_SDK_ROOT/platform-tools:$ANDROID_SDK_ROOT/emulator
```

---

## Emulator Configuration

### Create Emulator (Manual)

```bash
# Create AVD (Android Virtual Device)
avdmanager create avd \
  -n aether-atak-api28 \
  -k "system-images;android-28;google_apis;x86" \
  --device "pixel"

# Verify
emulator -list-avds
```

### Create Emulator (Automated)

```bash
node scripts/setup-atak-emulator.js
# Automatically creates if needed
```

### Emulator Specifications

| Property | Recommended | Minimum |
|---|---|---|
| API Level | 28 (Android 9.0) | 28 |
| ABI | x86_64 | x86 or armeabi-v7a |
| RAM | 2 GB | 1.5 GB |
| Storage | 2 GB | 1 GB |
| CPU Cores | 4 | 2 |

---

## Starting Emulator

### Manual Start

```bash
# Start emulator
emulator -avd aether-atak-api28 -no-snapshot-load

# Monitor ADB connection
adb devices -l

# Wait for "device" status
emulator-5554 device ...
```

### Automated Start

```bash
node scripts/setup-atak-emulator.js
# Handles startup and waiting
```

### Verify Emulator Ready

```bash
adb devices -l
# Should show: emulator-5554 device ...

adb shell getprop ro.build.version.release
# Should show: 9.0 (or API 28 equivalent)
```

---

## Installing ATAK-Civ

### Get ATAK APK

1. Visit: https://www.tak.gov/
2. Download: ATAK-Civ APK
3. Save as: `atak-civ.apk` in repository root

### Install via ADB

```bash
# Place APK in repo root
cp ~/Downloads/atak-civ.apk ./atak-civ.apk

# Install
adb install -r atak-civ.apk

# Verify
adb shell pm list packages | grep atak
# Should show: package:com.atakmap.app.civ
```

### Automated Installation

```bash
# Script checks for atak-civ.apk automatically
node scripts/setup-atak-emulator.js
```

### Launch ATAK

```bash
# Click emulator window → find ATAK app
# Or use ADB
adb shell am start -n com.atakmap.app.civ/.MainActivity

# Check logs
adb logcat | grep -i atak
```

---

## Building & Deploying Trust Overlay

### Build Plugin

```bash
# Full build with verification
pnpm run build:atak

# Output: dist/atak/main.jar
```

### Deploy to Emulator

```bash
# Deploy to connected device/emulator
pnpm run deploy:atak

# Verify
adb shell ls -lh /sdcard/atak/plugins/main.jar
```

### All-in-One Setup

```bash
# Complete automation
node scripts/setup-atak-emulator.js
```

---

## Verification Steps

### 1. Check Device Connection

```bash
adb devices -l

# Expected output:
# emulator-5554 device ...
```

### 2. Verify Plugin Deployed

```bash
adb shell ls -lh /sdcard/atak/plugins/

# Expected: main.jar present
# -rw-rw---- root shell 48234 main.jar
```

### 3. Check Plugin Manifest

```bash
adb shell unzip -p /sdcard/atak/plugins/main.jar META-INF/MANIFEST.MF

# Expected attributes:
# Plugin-Type: ATAK-CIV
# AetherCore-Version: 0.2.0
```

### 4. Monitor Plugin Loading

```bash
adb logcat -c
adb logcat | grep -i "aethercore\|trustoverlay\|plugin"

# Look for:
# I AetherCore: Trust Overlay initialized
# I TrustOverlay: Plugin loaded successfully
```

### 5. Verify in ATAK UI

```
1. Open ATAK app on emulator
2. Navigate: Settings → Plugins
3. Look for: "AetherCore Trust Overlay"
4. Status should be: "Loaded" (green checkmark)
```

### 6. Test Plugin Functionality

```
1. In ATAK: Open map view
2. Look for trust overlay layer
3. Verify trust data displays
4. Check for any error messages
```

---

## Troubleshooting

### Emulator Won't Start

**Problem:** Emulator launches but hangs

**Solutions:**
```bash
# 1. Check system image is installed
sdkmanager --list | grep system-images

# 2. Install missing image
sdkmanager "system-images;android-28;google_apis;x86"

# 3. Delete and recreate AVD
rm -rf ~/.android/avd/aether-atak-api28.avd
avdmanager create avd -n aether-atak-api28 ...

# 4. Start with reset
emulator -avd aether-atak-api28 -wipe-data
```

### ADB Not Recognizing Emulator

**Problem:** `adb devices` shows no devices

**Solutions:**
```bash
# 1. Restart ADB
adb kill-server
adb start-server

# 2. Check emulator is running
# (should see "Android" window)

# 3. Verify environment
echo $ANDROID_SDK_ROOT
echo $PATH | grep platform-tools

# 4. Force re-connect
adb connect localhost:5555
```

### ATAK Installation Fails

**Problem:** `adb install -r atak-civ.apk` fails

**Solutions:**
```bash
# 1. Ensure emulator is ready
adb devices  # Should show "device" (not "offline")

# 2. Clear previous installation
adb uninstall com.atakmap.app.civ

# 3. Try again with verbose output
adb install -r -s atak-civ.apk

# 4. Check disk space on emulator
adb shell df -h
# Should have >100MB free
```

### Plugin JAR Won't Deploy

**Problem:** `adb push main.jar ...` fails

**Solutions:**
```bash
# 1. Create plugin directory
adb shell mkdir -p /sdcard/atak/plugins

# 2. Check permissions
adb shell ls -la /sdcard/atak/

# 3. Verify JAR exists locally
ls -lh dist/atak/main.jar

# 4. Try manual push
adb push dist/atak/main.jar /sdcard/atak/plugins/

# 5. Verify on device
adb shell ls -lh /sdcard/atak/plugins/main.jar
```

### Plugin Doesn't Load in ATAK

**Problem:** Plugin visible but shows as "Failed" or "Offline"

**Solutions:**
```bash
# 1. Check logs
adb logcat | grep -i aethercore

# 2. Restart ATAK
adb shell am kill com.atakmap.app.civ
adb shell am start -n com.atakmap.app.civ/.MainActivity

# 3. Reload plugins
adb shell am broadcast -a com.atakmap.app.RELOAD_PLUGINS

# 4. Check plugin format
jar tf dist/atak/main.jar | head -20
# Should show META-INF, .class files, etc.
```

---

## Performance Optimization

### Emulator Performance

**For Better Speed:**

```bash
# Use hardware acceleration
emulator -avd aether-atak-api28 \
  -accel on \
  -accel-check \
  -no-snapshot

# Allocate more resources
emulator -avd aether-atak-api28 \
  -memory 2048 \
  -cores 4 \
  -partition-size 1024
```

**GPU Acceleration (Windows):**
```bash
emulator -avd aether-atak-api28 -gpu on
```

### Improve Build Speed

```bash
# Gradle parallel builds
export GRADLE_OPTS="-Xmx2g -XX:+UseG1GC"

# Build with caching
pnpm run build:atak  # Uses Gradle cache
```

---

## Advanced Configuration

### Custom Emulator Properties

Edit `~/.android/avd/aether-atak-api28.avd/config.ini`:

```ini
# Performance
hw.cpu.cores=4
hw.ramSize=2048
hw.gpu.enabled=yes

# Display
hw.lcd.density=420
hw.lcd.height=2340
hw.lcd.width=1080

# Storage
disk.dataPartition.size=2048

# Networking
net.dns1=8.8.8.8
```

### Custom ADB Port

```bash
# Start on custom port
emulator -avd aether-atak-api28 -port 5556

# Connect
adb connect localhost:5556
```

### Snapshot Management

```bash
# Load from snapshot
emulator -avd aether-atak-api28 -snapshot default

# Skip snapshot (fresh boot)
emulator -avd aether-atak-api28 -no-snapshot-load

# Save state on exit
emulator -avd aether-atak-api28 -snapshot-save
```

---

## Command Reference

### Emulator Commands

```bash
# List AVDs
emulator -list-avds

# Start emulator
emulator -avd aether-atak-api28

# Start with options
emulator -avd aether-atak-api28 \
  -memory 2048 \
  -cores 4 \
  -gpu on \
  -no-snapshot-load

# Create AVD
avdmanager create avd \
  -n aether-atak-api28 \
  -k "system-images;android-28;google_apis;x86"

# Delete AVD
avdmanager delete avd -n aether-atak-api28

# List system images
sdkmanager --list | grep system-images

# Install system image
sdkmanager "system-images;android-28;google_apis;x86"
```

### ADB Commands

```bash
# List devices
adb devices -l

# Connect to emulator
adb connect localhost:5555

# Install APK
adb install -r path/to/app.apk

# Uninstall app
adb uninstall com.package.name

# Push file to device
adb push local/path /sdcard/remote/path

# Pull file from device
adb pull /sdcard/remote/path local/path

# Execute shell command
adb shell command

# Monitor logs
adb logcat | grep -i keyword

# Clear logs
adb logcat -c

# Restart ADB
adb kill-server
adb start-server

# Port forwarding
adb forward tcp:5555 tcp:5555
```

### Plugin Commands

```bash
# Build plugin
pnpm run build:atak

# Deploy plugin
pnpm run deploy:atak

# Verify build
pnpm run verify:atak

# Clean artifacts
pnpm run clean:atak

# Setup emulator
node scripts/setup-atak-emulator.js
```

---

## Complete Workflow Example

### Step-by-Step

```bash
# 1. Setup emulator (one time)
node scripts/setup-atak-emulator.js
# Waits for emulator to boot, installs ATAK, builds & deploys plugin

# 2. Verify connection
adb devices

# 3. Open ATAK
adb shell am start -n com.atakmap.app.civ/.MainActivity

# 4. Check logs
adb logcat | grep -i aethercore

# 5. Verify in UI
# Settings → Plugins → Look for "AetherCore Trust Overlay"

# 6. Monitor logs
watch 'adb logcat | grep -i aethercore'
```

---

## Documentation References

- **Build Guide:** `docs/ATAK_PLUGIN_BUILD_GUIDE.md`
- **Workflow Guide:** `docs/ATAK_PLUGIN_WORKFLOW.md`
- **Quick Build:** `plugins/atak-trust-overlay/QUICKBUILD.md`
- **Setup Script:** `scripts/setup-atak-emulator.js`
- **Deployment Script:** `scripts/deploy-atak-plugin.js`

---

## Support

### Quick Help

```bash
# Check environment
pnpm run doctor

# Verify build system
pnpm run verify:atak

# Full setup
node scripts/setup-atak-emulator.js
```

### Getting Help

Include when reporting issues:
1. Output from `node scripts/setup-atak-emulator.js`
2. `adb devices -l` output
3. `adb logcat | grep aethercore` (last 50 lines)
4. Emulator specs (RAM, cores, API level)

---

## Next Steps

1. **Ensure Prerequisites:** Android SDK, emulator, ADB installed
2. **Run Setup:** `node scripts/setup-atak-emulator.js`
3. **Wait:** Emulator boots (1-2 minutes)
4. **Install ATAK:** APK must be in repository root
5. **Deploy Plugin:** Script handles automatically
6. **Verify:** Settings → Plugins in ATAK UI
7. **Test:** Open Trust Overlay and verify functionality

---

**Status:** ✅ Complete automation available  
**Last Updated:** 2025-01-27  
**Ready to:** Build, deploy, and test ATAK plugin
