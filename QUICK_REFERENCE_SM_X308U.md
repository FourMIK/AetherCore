# Quick Reference - Samsung SM-X308U AetherCore Installation

**Status**: ✅ INSTALLED & VERIFIED  
**Device**: Samsung Galaxy Tab S9 FE (SM-X308U)  
**Serial**: R52X601NK7F  
**Android Version**: 16  
**Plugin Location**: `/sdcard/atak/plugins/main.jar`

---

## ✅ Installation Complete

| Component | Status | Details |
|-----------|--------|---------|
| Build | ✅ PASSED | 7 KB main.jar |
| Deployment | ✅ PASSED | Pushed to device |
| Verification | ✅ PASSED | File exists on device |
| Plugin Reload | ✅ SENT | ATAK notified |
| Device Ready | ✅ YES | Android 16, SM-X308U |

---

## Next Step: Verify in ATAK

On your Samsung tablet:
1. Open **ATAK-Civ** app
2. Go to **Settings → Plugins**
3. Look for **"AetherCore Trust Overlay"**
4. Should show status: **Loaded** ✅

---

## Useful Commands

### Check Plugin Status
```powershell
$adb = "$env:LOCALAPPDATA\Android\Sdk\platform-tools\adb.exe"
& $adb -s R52X601NK7F shell ls -lh /sdcard/atak/plugins/
```

### Monitor Logs in Real-time
```powershell
$adb = "$env:LOCALAPPDATA\Android\Sdk\platform-tools\adb.exe"
& $adb -s R52X601NK7F logcat | findstr /I "AetherCore"
```

### Reload Plugin (if needed)
```powershell
$adb = "$env:LOCALAPPDATA\Android\Sdk\platform-tools\adb.exe"
& $adb -s R52X601NK7F shell am broadcast -a com.atakmap.app.RELOAD_PLUGINS
```

### Redeploy Plugin
```powershell
pnpm run build:atak    # Rebuild if source changed
pnpm run deploy:atak   # Redeploy to device
```

---

## Documentation

- **Full Installation Guide**: `SAMSUNG_SM_X308U_INSTALLATION.md`
- **Deployment Summary**: `DEPLOYMENT_COMPLETE_SM_X308U.md`
- **ATAK Build Guide**: `docs/ATAK_PLUGIN_BUILD_GUIDE.md`
- **Trust Schema Spec**: `docs/atak-trust-cot-schema.md`
- **Architecture**: `ARCHITECTURE.md`

---

## Device Specs

- **Model**: Samsung Galaxy Tab S9 FE (SM-X308U)
- **Display**: 11.0" 90Hz AMOLED
- **Processor**: MediaTek Kompanio 1300T
- **RAM**: 4/6 GB
- **Storage**: 64/128 GB
- **Battery**: 10,090 mAh
- **Network**: WiFi 6E + Bluetooth 5.3
- **Android**: Version 16 (upgradeable)

---

## Troubleshooting

| Issue | Solution |
|-------|----------|
| Plugin not in list | Restart ATAK or run reload broadcast |
| Plugin shows error | Check logs with `adb logcat \| grep AetherCore` |
| File not on device | Redeploy: `pnpm run deploy:atak` |
| Connection lost | Check USB cable and `adb devices` |

---

## Support

For issues or questions:
1. Check `DEPLOYMENT_COMPLETE_SM_X308U.md` troubleshooting section
2. Review logs: `& $adb -s R52X601NK7F logcat`
3. Verify prerequisites: Device must have ATAK-Civ installed and USB debugging enabled

---

**Installation Date**: 2026-03-05  
**Device Serial**: R52X601NK7F  
**Plugin Version**: 0.2.0  
**AetherCore Version**: 0.2.0 (Alpha)

