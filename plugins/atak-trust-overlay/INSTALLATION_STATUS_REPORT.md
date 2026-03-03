# Trust Overlay Installation Status Report

**Date:** March 1, 2026, 16:30  
**Device:** Pixel 9 Pro XL  
**Issue:** Plugin not being discovered by ATAK-Civ

---

## ✅ What IS Working

1. **APK Installation**: CONFIRMED
   - Package: `com.aethercore.atak.trustoverlay`
   - Version: 1.0.0-AetherCore
   - Size: 5.11 MB
   - Install date: 2026-03-01 16:07:40
   - Status: Successfully installed on device

2. **ATAK-Civ Installation**: CONFIRMED
   - Package: `com.atakmap.app.civ`
   - Version: 5.6.0.12
   - Status: Running on device

3. **Plugin Files**: CONFIRMED
   - ✅ `assets/plugin.xml` present in APK
   - ✅ `res/xml/trust_overlay_plugin.xml` present in APK
   - ✅ AndroidManifest meta-data correct
   - ✅ Native libraries (ARM64 + ARMv7) embedded

4. **Package Visibility**: CONFIRMED
   - Plugin package shows in `pm list packages`
   - Plugin is visible to the Android system
   - No installation errors

---

## ❌ What IS NOT Working

### ATAK Plugin Discovery

**Problem:** ATAK-Civ scans 344+ installed packages for plugins, but `com.aethercore.atak.trustoverlay` is NOT in the scan list.

**Evidence:**
```
AtakPluginRegistry: loadPlugins
  - Scanned: com.google.android.*, com.android.*, etc. (344 packages)
  - NOT scanned: com.aethercore.atak.trustoverlay
SideloadedPluginProvider: Loaded 0 plugins
SideloadedPluginProvider: No sideloaded plugins found
AtakPluginRegistry: loadPlugins complete
```

---

## 🔍 Root Cause Analysis

### Why ATAK Isn't Scanning Our Package

After extensive testing, the issue is likely one of the following:

### 1. **Package Signature / Code Signing** (Most Likely)
ATAK-Civ may require plugins to be signed with a **TAK.gov approved certificate**. Our APK is signed with the default debug keystore.

**Evidence:**
- Commercial ATAK plugins are distributed through TAK.gov
- ATAK may whitelist or validate plugin signatures
- Debug signatures might be rejected in production ATAK

### 2. **Plugin Distribution Method**
ATAK might expect plugins to be:
- Installed via TAK Server
- Side-loaded to specific directories (`/storage/emulated/0/atak/support/apks/`)
- Distributed as signed `.apk` files through ATAK's plugin manager

**Evidence from logs:**
```
SideloadedPluginProvider: Clearing local repo: /storage/emulated/0/atak/support/apks/sideloaded/
```

### 3. **ATAK-Civ vs ATAK-MIL**
The civilian version of ATAK may have restricted plugin loading for security/licensing reasons.

---

## 📋 Attempted Solutions

### What We Tried:
1. ✅ Force-stopped and restarted ATAK multiple times
2. ✅ Cleared ATAK's cache
3. ✅ Cleared system logcat and monitored fresh boot
4. ✅ Verified all plugin XML files and manifest entries
5. ✅ Confirmed APK structure matches ATAK requirements
6. ✅ Reinstalled plugin package
7. ✅ Waited for multiple plugin scan cycles

### Results:
- Package remains installed
- ATAK scans other packages but not ours
- No error messages about our package
- ATAK simply doesn't enumerate it during plugin discovery

---

## 🔧 Recommended Next Steps

### Option 1: Side-Load via ATAK's Plugin Directory (RECOMMENDED)
Copy the APK to ATAK's expected plugin location:

```powershell
# Copy APK to ATAK's plugin directory
adb push C:\Users\Owner\StudioProjects\AetherCore\plugins\atak-trust-overlay\build\outputs\apk\debug\atak-trust-overlay-debug.apk /storage/emulated/0/atak/support/apks/

# Or to the sideloaded directory
adb push atak-trust-overlay-debug.apk /storage/emulated/0/atak/support/apks/sideloaded/

# Then restart ATAK
adb shell am force-stop com.atakmap.app.civ
adb shell am start -n com.atakmap.app.civ/com.atakmap.app.ATAKActivityCiv
```

### Option 2: Sign with Production Certificate
If TAK.gov provides developer certificates:
1. Obtain TAK developer signing certificate
2. Rebuild APK with production signature
3. Reinstall on device

### Option 3: Use ATAK's Plugin Manager
If ATAK-Civ has a plugin manager UI:
1. Open ATAK → Settings → Plugins
2. Look for "Install Plugin" or "Add Plugin" option
3. Browse to APK location
4. Install through ATAK's interface

###option 4: Check ATAK-Civ Plugin Support
ATAK-Civ (Play Store version) may have **limited or no third-party plugin support** compared to ATAK-MIL.

**Verification needed:**
- Check if ATAK-Civ Settings has a "Plugins" menu
- Contact TAK.gov about plugin development for civilian version
- Verify if ATAK-Civ allows unsigned plugins

---

## 📊 Current Status

| Component | Status |
|-----------|--------|
| Plugin APK Built | ✅ Complete |
| Native Libraries | ✅ Included (ARM64 + ARMv7) |
| Plugin Files | ✅ Correct structure |
| APK Installed | ✅ On device |
| ATAK-Civ Installed | ✅ Running |
| Plugin Discovered | ❌ Not yet |
| Plugin Loaded | ❌ Not yet |
| Plugin Functional | ⏸️  Pending discovery |

---

## 💡 Alternative Approaches

### If ATAK Plugin Loading Fails:

### 1. Standalone Trust Overlay App
Convert the plugin to a standalone Android app that:
- Reads CoT messages via broadcast intents
- Displays trust overlays in its own UI
- Communicates with ATAK via Inter-Process Communication (IPC)

### 2. ATAK Data Package
Instead of a code plugin, create an ATAK Data Package (.zip) with:
- Map overlays
- Icons
- Pre-configured trust indicators
- No code execution

### 3. TAK Server Integration
Deploy trust verification on the TAK Server side:
- Server validates all CoT messages
- Server adds trust metadata
- ATAK clients receive pre-verified data

---

## 🔬 Diagnostics Run

```powershell
# All commands executed:
adb devices                                    ✅ Device connected
adb shell pm list packages | grep aethercore  ✅ Package installed
adb shell pm path com.aethercore.atak.trustoverlay  ✅ APK on device
adb shell dumpsys package com.aethercore.atak.trustoverlay  ✅ Package metadata
adb logcat -d | grep AtakPluginRegistry        ❌ Package not in scan
adb shell am force-stop / restart             ✅ Attempted multiple times
```

---

## 📞 Support Contacts

**For ATAK Plugin Development:**
- TAK.gov: https://tak.gov
- ATAK Development Forum
- TAK Product Center

**For AetherCore Specific Issues:**
- Check: `docs/ATAK_PLUGIN_INTEGRATION_SUMMARY.md`
- Review: `plugins/atak-trust-overlay/BUILD_SUCCESS.txt`

---

## 📝 Recommendations

### Immediate (Next 24 hours):
1. Try side-loading APK to `/storage/emulated/0/atak/support/apks/`
2. Check if ATAK-Civ has a plugin installation UI
3. Verify ATAK-Civ version supports third-party plugins

### Short-term (Next week):
1. Contact TAK.gov about plugin signing requirements
2. Test on ATAK-MIL version if available
3. Consider standalone app approach

### Long-term:
1. Obtain TAK developer certificate if required
2. Implement TAK Server-side trust verification
3. Explore ATAK Data Package format

---

## ✅ Verification Commands

### Check plugin is still installed:
```powershell
adb shell pm list packages | Select-String "aethercore"
```

### Monitor ATAK logs:
```powershell
adb logcat -s "AtakPluginRegistry:*" "ATAK:*"
```

### View plugin APK details:
```powershell
adb shell dumpsys package com.aethercore.atak.trustoverlay | Select-String "version|install"
```

---

**Status:** Plugin is properly built and installed, but ATAK-Civ is not discovering it through the standard plugin scan mechanism. Further investigation into ATAK-Civ's plugin loading requirements is needed.

**Next Action:** Attempt side-loading to ATAK's plugin directory.

