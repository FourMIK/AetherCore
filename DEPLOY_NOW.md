# ⚡ Quick Action: Deploy to Your VS Code Emulator

**Your Situation:** VS Code embedded Android emulator is running with API 28+  
**What You Need:** Deploy trust overlay plugin  
**Time:** 2 minutes

---

## Do This Now

### Command 1: Build Plugin

```bash
pnpm run build:atak
```

**Expected output:**
```
✅ Build succeeded
✅ main.jar created at: dist/atak/main.jar
```

### Command 2: Deploy to Your Device

```bash
pnpm run deploy:atak
```

**Expected output:**
```
✅ Emulator ready
✅ Plugin deployed successfully
✅ Plugin JAR found on device
```

### Command 3: Verify in ATAK

Open ATAK app on your emulator:
```
Settings → Plugins → "AetherCore Trust Overlay"
Status: Loaded ✅
```

---

## That's It! ✅

Your trust overlay plugin is now deployed to your VS Code emulator.

---

## Next: Test It

### Open Trust Overlay

In ATAK app:
1. Tap "Trust Overlay" menu
2. Verify trust data displays
3. Check for errors

### Monitor Logs

```bash
adb logcat | grep -i aethercore

# Should show:
# I AetherCore: Trust Overlay initialized
# I TrustOverlay: Plugin loaded successfully
```

---

## If Something Doesn't Work

### Device Not Showing

```bash
adb devices -l
# Should show your emulator
```

### Restart Everything

```bash
# Kill ADB
adb kill-server

# Restart
adb start-server

# Deploy again
pnpm run deploy:atak
```

### Clear & Reinstall

```bash
# Remove old plugin
adb shell rm /sdcard/atak/plugins/main.jar

# Redeploy
pnpm run deploy:atak
```

---

## Full Setup (Optional)

If you want ATAK auto-installed:

```bash
# 1. Download ATAK APK from TAK.gov
# 2. Save as: atak-civ.apk (in repo root)
# 3. Run:
node scripts/setup-atak-emulator.js
```

Script will:
- Detect your running emulator
- Install ATAK (if needed)
- Build & deploy plugin
- Verify everything works

---

## Commands Reference

```bash
pnpm run build:atak      # Build plugin
pnpm run deploy:atak     # Deploy to device
pnpm run verify:atak     # Verify build system

adb devices -l           # List devices
adb logcat               # Watch logs
adb shell ls /sdcard/atak/plugins/  # Check plugin
```

---

**Your emulator is ready. Go deploy!** 🚀

```bash
pnpm run build:atak && pnpm run deploy:atak
```
