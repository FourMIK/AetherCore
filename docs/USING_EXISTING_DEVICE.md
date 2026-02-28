# Using Existing Android Device/Emulator

**Status:** Your VS Code emulator is already running and detected!  
**Next Step:** Deploy the trust overlay plugin

---

## Quick Start (2 minutes)

### Check Your Device Connection

```bash
adb devices -l

# Expected output:
# emulator-5554 device ...
# (or similar for VS Code embedded emulator)
```

### Build & Deploy Plugin

```bash
# Build the plugin
pnpm run build:atak

# Deploy to your existing device
pnpm run deploy:atak

# Done! ✅
```

### Verify in ATAK

```
On emulator:
1. Open ATAK app
2. Settings → Plugins
3. Look for "AetherCore Trust Overlay"
4. Status should show "Loaded" ✅
```

---

## What's Happening

Your VS Code embedded emulator is:
- ✅ Running and connected via ADB
- ✅ API 28+ compatible with ATAK
- ✅ Ready to receive the trust overlay plugin

The setup script now detects this automatically and will:
1. Skip emulator creation (you already have one running)
2. Deploy directly to your existing device
3. Verify the plugin loads

---

## All You Need to Do

### Option A: Quick Deploy (Recommended)

```bash
# Build and deploy in one go
pnpm run build:atak && pnpm run deploy:atak

# That's it! ✅
```

### Option B: Step by Step

```bash
# Step 1: Build plugin
pnpm run build:atak
# Output: dist/atak/main.jar

# Step 2: Verify connection
adb devices -l
# Should show your device

# Step 3: Deploy
pnpm run deploy:atak

# Step 4: Verify in ATAK
adb logcat | grep -i aethercore
```

---

## Checking Your Device

### List Connected Devices

```bash
adb devices -l

# Example output:
# emulator-5554           device           product:Android model:Android device:generic_x86_64
```

### Check API Level

```bash
adb shell getprop ro.build.version.sdk
# Should return: 28 or higher
```

### Check Available Storage

```bash
adb shell df -h /sdcard
# Verify you have at least 100MB free
```

---

## Troubleshooting

### Device Not Showing in `adb devices`

**Solution:**
```bash
# Restart ADB
adb kill-server
adb start-server

# Check again
adb devices -l
```

### Plugin Won't Deploy

**Solution:**
```bash
# Verify device connection
adb devices -l

# Create plugin directory
adb shell mkdir -p /sdcard/atak/plugins

# Try deploy again
pnpm run deploy:atak
```

### Plugin Shows as "Failed" in ATAK

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

## Commands Quick Reference

```bash
# Connection
adb devices -l                 # List devices
adb shell getprop ro.build.version.sdk  # Check API level

# Building
pnpm run build:atak            # Build plugin

# Deploying
pnpm run deploy:atak           # Deploy to device

# Verification
adb shell ls -lh /sdcard/atak/plugins/  # Check plugin deployed
adb logcat | grep -i aethercore         # Monitor logs

# Control
adb shell am kill com.atakmap.app.civ   # Close ATAK
adb shell am start -n com.atakmap.app.civ/.MainActivity  # Open ATAK
```

---

## Full Automated Setup (Optional)

If you want the script to handle everything including installation:

```bash
# Place ATAK APK in repo root
cp ~/Downloads/atak-civ.apk ./atak-civ.apk

# Run full setup
node scripts/setup-atak-emulator.js

# Script will:
# ✅ Detect your running emulator
# ✅ Install ATAK (if not already installed)
# ✅ Build plugin
# ✅ Deploy plugin
```

---

## You're Good to Go! ✅

Your device is connected and ready. Just run:

```bash
pnpm run build:atak && pnpm run deploy:atak
```

The trust overlay plugin will be deployed to your VS Code emulator.

---

## Next Steps

1. **Deploy plugin:** `pnpm run deploy:atak`
2. **Open ATAK:** On emulator screen
3. **Verify:** Settings → Plugins → "AetherCore Trust Overlay" (Loaded ✅)
4. **Test:** Use Trust Overlay menu in ATAK
5. **Monitor:** `adb logcat | grep -i aethercore`

---

**Your emulator is already running. Let's deploy!** 🚀
