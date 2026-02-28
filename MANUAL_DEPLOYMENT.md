# 🚀 Manual ATAK + Trust Overlay Setup

**Your main.jar is ready!** Now let's deploy it manually.

---

## Step 1: Start Emulator via Android Studio (Most Reliable)

```
1. Open Android Studio
2. Click "AVD Manager" (top right toolbar)
3. Find "Medium_Phone" emulator
4. Click the green ▶ Play button to launch
5. Wait for Android to boot (2-3 minutes)
```

---

## Step 2: Verify Device Connection

```cmd
C:\Users\Owner\AppData\Local\Android\Sdk\platform-tools\adb.exe devices -l

# Should show:
# emulator-5554          device ...
```

**If it says "offline":** Wait 30 more seconds and try again.

---

## Step 3: Prepare Plugin Directory

```cmd
C:\Users\Owner\AppData\Local\Android\Sdk\platform-tools\adb.exe shell mkdir -p /sdcard/atak/plugins
```

---

## Step 4: Deploy Our Plugin JAR

```cmd
C:\Users\Owner\AppData\Local\Android\Sdk\platform-tools\adb.exe push "C:\Users\Owner\source\repos\FourMIK\AetherCore\dist\atak\main.jar" /sdcard/atak/plugins/main.jar
```

**Expected output:**
```
dist/atak/main.jar: 1 file pushed. 0.1 MB/s (1512 bytes in 0.015s)
```

---

## Step 5: Verify Deployment

```cmd
C:\Users\Owner\AppData\Local\Android\Sdk\platform-tools\adb.exe shell ls -lh /sdcard/atak/plugins/main.jar

# Should show:
# -rw-rw-rw- root root main.jar
```

---

## Step 6: Install ATAK (If Needed)

**Check if ATAK is installed:**
```cmd
C:\Users\Owner\AppData\Local\Android\Sdk\platform-tools\adb.exe shell pm list packages | findstr atak
```

**If NOT installed:**
1. Download ATAK-Civ APK from https://www.tak.gov/
2. Save as: `C:\Users\Owner\atak-civ.apk`
3. Install:
```cmd
C:\Users\Owner\AppData\Local\Android\Sdk\platform-tools\adb.exe install -r C:\Users\Owner\atak-civ.apk
```

Wait 1-2 minutes for installation.

---

## Step 7: Launch ATAK

```cmd
C:\Users\Owner\AppData\Local\Android\Sdk\platform-tools\adb.exe shell am start -n com.atakmap.app.civ/com.atakmap.app.MainActivity
```

Wait 10-15 seconds for ATAK to open on the emulator screen.

---

## Step 8: Verify Plugin Loaded

**On emulator screen:**

1. ATAK app opens
2. Tap **Settings** ⚙️
3. Tap **Plugins**
4. Look for **"AetherCore Trust Overlay"**
5. Status should show **"Loaded"** ✅

---

## Step 9: Monitor Logs (Optional)

```cmd
C:\Users\Owner\AppData\Local\Android\Sdk\platform-tools\adb.exe logcat | findstr /I "aethercore trustoverlay"
```

You should see initialization messages.

---

## Troubleshooting

### Device shows "offline"

```cmd
# Restart ADB
C:\Users\Owner\AppData\Local\Android\Sdk\platform-tools\adb.exe kill-server
timeout /t 2
C:\Users\Owner\AppData\Local\Android\Sdk\platform-tools\adb.exe start-server

# Wait 30 seconds and check
C:\Users\Owner\AppData\Local\Android\Sdk\platform-tools\adb.exe devices -l
```

### Plugin doesn't show in ATAK

```cmd
# Reload plugins
C:\Users\Owner\AppData\Local\Android\Sdk\platform-tools\adb.exe shell am broadcast -a com.atakmap.app.RELOAD_PLUGINS

# Or restart ATAK
C:\Users\Owner\AppData\Local\Android\Sdk\platform-tools\adb.exe shell am kill com.atakmap.app.civ
```

### ATAK won't launch

- ATAK might not be installed yet
- Download from TAK.gov and install via: `adb install -r atak-civ.apk`

---

## Summary

| Step | Command | Purpose |
|------|---------|---------|
| 1 | Start via Android Studio | Launch emulator |
| 2 | `adb devices -l` | Verify connection |
| 3 | `adb shell mkdir -p /sdcard/atak/plugins` | Create directory |
| 4 | `adb push dist/atak/main.jar /sdcard/atak/plugins/main.jar` | Deploy JAR |
| 5 | `adb shell ls /sdcard/atak/plugins/main.jar` | Verify |
| 6 | `adb install atak-civ.apk` | Install ATAK (if needed) |
| 7 | `adb shell am start -n com.atakmap.app.civ/...` | Launch ATAK |
| 8 | Check UI: Settings → Plugins | Verify plugin loaded |

---

## Key Paths

```
Emulator: Android Studio AVD Manager
ADB: C:\Users\Owner\AppData\Local\Android\Sdk\platform-tools\adb.exe
JAR: C:\Users\Owner\source\repos\FourMIK\AetherCore\dist\atak\main.jar
Remote: /sdcard/atak/plugins/main.jar
```

---

**Start with Step 1 - open Android Studio and launch Medium_Phone emulator!** 🚀
