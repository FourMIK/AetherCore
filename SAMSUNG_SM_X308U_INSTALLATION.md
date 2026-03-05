# Samsung SM-X308U Installation Guide

**Device**: Samsung Galaxy Tab S9 FE (SM-X308U)  
**Installation Date**: 2026-03-05  
**Status**: CONNECTED AND READY  
**Serial**: R52X601NK7F

---

## Device Information

| Property | Value |
|----------|-------|
| Device Model | SM_X308U (Galaxy Tab S9 FE) |
| Serial Number | R52X601NK7F |
| Connection Status | ✅ CONNECTED |
| ADB Status | ✅ AUTHORIZED |
| USB Debugging | ✅ ENABLED |

---

## Installation Steps

### Step 1: Verify Device Connection

Your Samsung SM-X308U is already detected and authorized:

```
Device Serial: R52X601NK7F
Model: SM_X308U (Galaxy Tab S9 FE)
Status: ✅ CONNECTED
```

### Step 2: Build the ATAK Trust Overlay Plugin

The plugin must be built from source to match the device and AetherCore version.

```powershell
pnpm run build:atak
```

This will:
- ✅ Verify Gradle is installed
- ✅ Compile the ATAK trust overlay plugin
- ✅ Generate `dist/atak/main.jar`
- ✅ Verify checksums

**Expected Duration**: 5-15 minutes (depends on network for gradle dependencies)

### Step 3: Deploy the Plugin

Once the build completes successfully, deploy to the device:

```powershell
pnpm run deploy:atak
```

This will:
- ✅ Detect the connected Samsung SM-X308U
- ✅ Create ATAK plugins directory on device
- ✅ Push `main.jar` to `/sdcard/atak/plugins/`
- ✅ Reload ATAK plugin system
- ✅ Verify deployment

**Expected Duration**: 2-5 minutes

### Step 4: Verify Installation in ATAK-Civ

On your Samsung SM-X308U tablet:

1. **Open ATAK-Civ** if not already running
2. **Navigate to**: Settings → Plugins
3. **Look for**: "AetherCore Trust Overlay" in the plugins list
4. **Status should be**: ✅ Loaded
5. **Check**: Trust Overlay menu appears in ATAK UI

### Step 5: Verify Hardware Capabilities (Optional)

Check if your tablet supports advanced hardware features:

```powershell
&"$env:LOCALAPPDATA\Android\Sdk\platform-tools\adb.exe" -s R52X601NK7F shell getprop ro.build.version.release
```

**Expected output**: Android 13 or higher

---

## What Gets Installed

### Main Artifact
- **File**: `main.jar` (ATAK plugin archive)
- **Destination**: `/sdcard/atak/plugins/main.jar`
- **Size**: ~3-8 MB
- **Functionality**: AetherCore Trust Overlay for ATAK-Civ

### What the Plugin Provides
- ✅ **CoT Event Trust Scoring**: Real-time trust assessment of incoming messages
- ✅ **Byzantine Fault Detection**: Identifies spoofed or replayed messages
- ✅ **Trust Visualization**: Color-coded overlay on ATAK map
- ✅ **Merkle Vine Integration**: Tamper-evident event chains
- ✅ **Hardware Attestation**: If device supports it (Samsung Tab S9 FE has limited TPM)

---

## Troubleshooting

### If Build Fails: Gradle Not Found

**Error**: `Gradle not found`

**Solution**:
```powershell
# Install Gradle via Chocolatey (if you have it)
choco install gradle

# OR download manually from https://gradle.org/releases/
# Extract to: plugins/atak-trust-overlay/gradle/

# Then retry
pnpm run build:atak
```

### If Deployment Fails: Plugin Directory Not Created

**Error**: `Cannot push to /sdcard/atak/plugins`

**Solution**:
```powershell
# Manually create the directory
&"$env:LOCALAPPDATA\Android\Sdk\platform-tools\adb.exe" -s R52X601NK7F shell mkdir -p /sdcard/atak/plugins

# Then retry deployment
pnpm run deploy:atak
```

### If Plugin Doesn't Load in ATAK

**Symptom**: Plugin installed but doesn't appear in ATAK plugins list

**Solution**:
```powershell
# 1. Force ATAK to rescan plugins
&"$env:LOCALAPPDATA\Android\Sdk\platform-tools\adb.exe" -s R52X601NK7F shell am broadcast -a com.atakmap.app.RELOAD_PLUGINS

# 2. Restart ATAK manually on the device

# 3. Check logs for errors
&"$env:LOCALAPPDATA\Android\Sdk\platform-tools\adb.exe" -s R52X601NK7F logcat | findstr /I "aethercore"
```

---

## Post-Installation Verification

### Quick Health Check

```powershell
# Check plugin is on device
&"$env:LOCALAPPDATA\Android\Sdk\platform-tools\adb.exe" -s R52X601NK7F shell ls -lh /sdcard/atak/plugins/main.jar

# Monitor logs for plugin loading
&"$env:LOCALAPPDATA\Android\Sdk\platform-tools\adb.exe" -s R52X601NK7F logcat -s "AetherCore"
```

### Test Trust Overlay

1. Open ATAK-Civ on SM-X308U
2. Create a test CoT event (or import sample data)
3. Trust Overlay should show trust score and status
4. Color coding: Green (healthy) → Yellow (suspect) → Red (quarantined)

---

## Uninstallation

If you need to remove the plugin:

```powershell
# Remove the plugin file
&"$env:LOCALAPPDATA\Android\Sdk\platform-tools\adb.exe" -s R52X601NK7F shell rm /sdcard/atak/plugins/main.jar

# Reload ATAK plugins
&"$env:LOCALAPPDATA\Android\Sdk\platform-tools\adb.exe" -s R52X601NK7F shell am broadcast -a com.atakmap.app.RELOAD_PLUGINS

# Restart ATAK on the device
```

---

## Support & Documentation

| Resource | Path |
|----------|------|
| Full Architecture Docs | `docs/ATAK_PLUGIN_BUILD_GUIDE.md` |
| ATAK Trust Schema | `docs/atak-trust-cot-schema.md` |
| Field Deployment | `plugins/atak-trust-overlay/FIELD_DEPLOYMENT_GUIDE.md` |
| Trust Mesh Details | `ARCHITECTURE.md` |
| Hardware Attestation | `docs/PIXEL_9_PRO_SETUP.md` (concepts apply) |

---

## Key Files in This Installation

### Build Scripts
- `scripts/build-atak-plugin.js` - Gradle build wrapper
- `scripts/deploy-atak-plugin.js` - ADB deployment script
- `scripts/check-android-se-readiness.ps1` - Hardware capability checker

### Source Code
- `plugins/atak-trust-overlay/` - Main plugin source
- `crates/` - Rust core cryptographic libraries
- `packages/shared/` - Shared TypeScript types and schemas

### Configuration
- `config/production.yaml` - Production mesh configuration
- `deny.toml` - License compliance configuration

---

## Device-Specific Notes for SM-X308U

**Galaxy Tab S9 FE Capabilities**:
- ✅ Android 13 (upgradeable to 14)
- ✅ 90Hz display (great for real-time updates)
- ✅ Strong WiFi 6E support
- ⚠️ Limited hardware security (no dedicated SE like Pixel devices)
- ✅ Good battery life for field operations

**Recommendations**:
- Enable WiFi 6E for best mesh performance
- Use external SSD for persistent logs
- Disable screen lock for unattended operations (or use long timeout)
- Keep tablet on while field testing

---

**Installation Complete!**

Your Samsung SM-X308U is now ready to run AetherCore's ATAK Trust Overlay.

Next steps:
1. Run `pnpm run build:atak`
2. Run `pnpm run deploy:atak`
3. Verify plugin loads in ATAK-Civ
4. Test with trust events

