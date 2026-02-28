# 🚀 Quick Start: Android Emulator + ATAK + Trust Overlay

**Time:** ~10-15 minutes (first time)  
**Difficulty:** Beginner  
**Status:** ✅ Fully automated

---

## Prerequisites Checklist

- [ ] **Visual Studio** (Community is free) OR **Android SDK standalone**
- [ ] **Android Emulator** (included with VS Android development workload)
- [ ] **ADB** (Android Debug Bridge - included with SDK)
- [ ] **ATAK-Civ APK** (download from TAK.gov, save as `atak-civ.apk` in repo root)

### Check Your Setup

```bash
# Verify Android SDK
adb version
emulator -version

# Should return version numbers, not "command not found"
```

If commands don't work, install Android SDK via Visual Studio or standalone.

---

## One-Command Setup

```bash
node scripts/setup-atak-emulator.js
```

**What this does:**
1. ✅ Checks prerequisites
2. ✅ Creates emulator if needed
3. ✅ Starts emulator (waits for boot)
4. ✅ Installs ATAK-Civ (if APK provided)
5. ✅ Builds trust overlay plugin
6. ✅ Deploys plugin to emulator
7. ✅ Prints next steps

**Output:**
```
═══════════════════════════════════════════════════════════════════
AetherCore ATAK Emulator Setup
Visual Studio Android Emulator + ATAK-Civ + Trust Overlay
═══════════════════════════════════════════════════════════════════

Checking Prerequisites...
✅ Android SDK: /path/to/sdk
✅ ADB available: /path/to/platform-tools/adb
✅ Emulator available: /path/to/emulator/emulator

Emulator Configuration...
✅ Found 1 emulator(s):
   - aether-atak-api28

Starting Emulator...
⏳ Waiting for emulator to boot...
.....✅ Emulator ready!

Building Trust Overlay Plugin...
Executing: pnpm run build:atak

BUILD SUCCESSFUL in 12s
✅ Build succeeded

Deploying Trust Overlay Plugin...
Executing: pnpm run deploy:atak

✅ Plugin deployed successfully

Verifying Plugin Installation...
✅ Plugin JAR found on device

═════════════════════════════════════════════════════════════════════
Next Steps
═════════════════════════════════════════════════════════════════════

1. Launch ATAK-Civ on emulator:
   - Click on emulator screen
   - Find ATAK app in launcher
   - Tap to open

2. Verify plugin loads:
   - Open Settings → Plugins
   - Look for "AetherCore Trust Overlay"
   - Status should show "Loaded"

3. Monitor logs:
   $ adb logcat | grep -i aethercore

4. Test functionality:
   - Open Trust Overlay in ATAK
   - Verify trust data displays
   - Check for any errors

✅ Setup Complete!

Emulator Status:
  Device: emulator-5554
  ATAK: Installed
  Plugin: Built and staged to dist/atak/main.jar
```

---

## Manual Steps (If Needed)

### 1. Download ATAK-Civ APK

```bash
# Save APK in repository root as:
atak-civ.apk

# Verify
ls -lh atak-civ.apk
```

### 2. Check Prerequisites

```bash
# Check Android SDK is installed
adb version
# Output: Android Debug Bridge version X.X.X

emulator -version
# Output: emulator version X.X.X

# If not found: Install Android SDK (see docs/ANDROID_EMULATOR_SETUP.md)
```

### 3. Create Emulator (if not present)

```bash
# List available emulators
emulator -list-avds

# If none: Create new one
avdmanager create avd \
  -n aether-atak-api28 \
  -k "system-images;android-28;google_apis;x86" \
  --device "pixel"
```

### 4. Start Emulator

```bash
# Start
emulator -avd aether-atak-api28 -no-snapshot-load

# Monitor (in another terminal)
adb devices
# Wait for "emulator-5554 device"
```

### 5. Install ATAK-Civ

```bash
# Install
adb install -r atak-civ.apk

# Verify
adb shell pm list packages | grep atak
# Should show: package:com.atakmap.app.civ
```

### 6. Build Plugin

```bash
pnpm run build:atak

# Output: dist/atak/main.jar
```

### 7. Deploy Plugin

```bash
pnpm run deploy:atak

# Verifies and stages JAR to device
```

---

## Verify Installation

### Check Device Connection

```bash
adb devices -l

# Expected:
# emulator-5554 device ...
```

### Check Plugin on Device

```bash
adb shell ls -lh /sdcard/atak/plugins/

# Expected:
# -rw-rw---- root shell 48234 main.jar
```

### Check Plugin in ATAK UI

1. **Tap ATAK app** (on emulator screen)
2. **Navigate:** Settings → Plugins
3. **Look for:** "AetherCore Trust Overlay"
4. **Check Status:** Should show "Loaded" (green checkmark)

### Monitor Logs

```bash
# Watch logs in real-time
adb logcat | grep -i "aethercore\|trustoverlay"

# Should see:
# I AetherCore: Trust Overlay initialized
# I TrustOverlay: Plugin loaded successfully
```

---

## All Commands

```bash
# Automated setup (recommended)
node scripts/setup-atak-emulator.js

# Manual steps
emulator -avd aether-atak-api28               # Start emulator
adb devices                                    # Check connection
adb install -r atak-civ.apk                   # Install ATAK
pnpm run build:atak                           # Build plugin
pnpm run deploy:atak                          # Deploy to device

# Verification
adb shell pm list packages | grep atak        # Check ATAK installed
adb shell ls -lh /sdcard/atak/plugins/        # Check plugin deployed
adb logcat | grep -i aethercore              # Monitor logs
```

---

## Troubleshooting

### Emulator won't start

**Solution:**
```bash
# Restart ADB
adb kill-server
adb start-server

# Or delete and recreate emulator
rm -rf ~/.android/avd/aether-atak-api28.avd
node scripts/setup-atak-emulator.js
```

### ATAK says "Not installed" after setup

**Solution:**
```bash
# Verify APK filename
ls -lh atak-civ.apk  # Must be exactly "atak-civ.apk"

# Reinstall
adb uninstall com.atakmap.app.civ
adb install -r atak-civ.apk
```

### Plugin doesn't load in ATAK

**Solution:**
```bash
# Check logs
adb logcat | grep -i aethercore

# Reload plugins
adb shell am broadcast -a com.atakmap.app.RELOAD_PLUGINS

# Or restart ATAK
adb shell am kill com.atakmap.app.civ
adb shell am start -n com.atakmap.app.civ/.MainActivity
```

---

## What's Next

### Test Trust Overlay

1. Open ATAK on emulator
2. Look for "Trust Overlay" menu option
3. Verify trust data displays
4. Check for any error messages

### View Documentation

```bash
# Quick reference
cat plugins/atak-trust-overlay/QUICKBUILD.md

# Full guide
cat docs/ATAK_PLUGIN_WORKFLOW.md

# Emulator guide
cat docs/ANDROID_EMULATOR_SETUP.md
```

### Monitor Development

```bash
# Watch logs while testing
watch 'adb logcat | tail -20 | grep -i aethercore'

# Build and redeploy after code changes
pnpm run build:atak && pnpm run deploy:atak
```

---

## Common Commands

```bash
# Emulator
emulator -avd aether-atak-api28            # Start emulator
emulator -list-avds                         # List emulators

# ADB
adb devices -l                              # List devices
adb shell pm list packages | grep atak     # Find installed apps
adb logcat | grep keyword                  # Monitor logs
adb push local /sdcard/remote               # Copy file to device
adb pull /sdcard/remote local              # Copy file from device
adb shell am start -n package/activity     # Launch app

# Plugin
pnpm run build:atak                         # Build plugin
pnpm run deploy:atak                        # Deploy to device
pnpm run verify:atak                        # Check configuration
pnpm run setup:emulator                     # Setup emulator
```

---

## Resources

| Document | Purpose |
|---|---|
| `docs/ANDROID_EMULATOR_SETUP.md` | Complete emulator setup guide |
| `docs/ATAK_PLUGIN_WORKFLOW.md` | Development workflow |
| `plugins/atak-trust-overlay/QUICKBUILD.md` | Quick command reference |
| `scripts/setup-atak-emulator.js` | Automation script source |

---

## Status

✅ **Automated Setup Available:** `node scripts/setup-atak-emulator.js`  
✅ **Documentation Complete:** All guides provided  
✅ **Commands Ready:** All npm scripts integrated  
✅ **Ready to Deploy:** No additional configuration needed

---

**Ready?** Run: `node scripts/setup-atak-emulator.js` 🚀
