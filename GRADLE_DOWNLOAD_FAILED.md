# ✅ FIX: Gradle Download Failed - Complete Solutions

**Issue:** `ERROR: Failed to download Gradle. Check internet connection.`  
**Cause:** Gradle wrapper download failed (network, firewall, or timeout)  
**Solutions:** 3 options provided below

---

## Option 1: Retry Automatic (Quickest)

```bash
# Clean and try again
pnpm run clean:atak

# Build again
pnpm run build:atak
```

**Why this works:**
- Network might be temporary glitch
- Second attempt often succeeds
- Takes 30-60 seconds

**If still fails:** Try Option 2

---

## Option 2: Manual Gradle Installation (Most Reliable)

### Step 1: Download Gradle

```
URL: https://services.gradle.org/distributions/gradle-8.5-bin.zip
Size: ~60 MB
File: gradle-8.5-bin.zip
```

### Step 2: Extract

```cmd
cd plugins\atak-trust-overlay

REM Extract with PowerShell
powershell -Command "Expand-Archive -Path C:\path\to\gradle-8.5-bin.zip -DestinationPath gradle\ -Force"

REM Or Windows Explorer:
REM 1. Right-click gradle-8.5-bin.zip
REM 2. "Extract All..."
REM 3. Choose: plugins\atak-trust-overlay\gradle\
```

### Step 3: Verify

```cmd
dir gradle\gradle-8.5\bin\gradle.bat
REM Should show: gradle.bat file exists
```

### Step 4: Build

```bash
pnpm run build:atak
```

**Time:** 5 minutes  
**Result:** Reliable - works without network

---

## Option 3: Install Gradle System-Wide

### Windows (Chocolatey)

```powershell
choco install gradle

# Verify
gradle --version
# Should show: Gradle 8.5 or similar
```

Then build:
```bash
pnpm run build:atak
```

### Windows (Manual)

1. Download: https://gradle.org/releases/
2. Extract to: `C:\Program Files\gradle-8.5`
3. Add to PATH: `C:\Program Files\gradle-8.5\bin`
4. Restart terminal
5. Verify: `gradle --version`
6. Build: `pnpm run build:atak`

### macOS

```bash
brew install gradle

# Verify
gradle --version

# Build
pnpm run build:atak
```

### Linux

```bash
sudo apt-get install gradle

# Verify
gradle --version

# Build
pnpm run build:atak
```

---

## Why Automatic Download Failed

Common causes:

1. **Internet Issue**
   - Check: `ping google.com`
   - Solution: Fix connection, retry

2. **Firewall/Proxy Blocking**
   - Check: Can you access the URL in browser?
   - Solution: Allow gradle.org, or manually install

3. **PowerShell Execution Policy**
   - Check: `Get-ExecutionPolicy`
   - Solution: `Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser`

4. **Download Timeout**
   - Check: Try again (often transient)
   - Solution: Use manual install instead

5. **SSL/TLS Issues**
   - Check: Try browser first
   - Solution: Update PowerShell or use manual install

---

## Recommended Solution: Manual Install

**Why?**
- ✅ Works without network after extraction
- ✅ No PowerShell issues
- ✅ No firewall problems
- ✅ Most reliable
- ✅ Fastest once extracted

**Steps:**
1. Download gradle-8.5-bin.zip (from browser)
2. Extract to `plugins/atak-trust-overlay/gradle/`
3. Build: `pnpm run build:atak`

---

## Complete Fix Workflow

### If You Want Automatic to Work

```cmd
REM 1. Check internet
ping google.com

REM 2. Check PowerShell can download
powershell -Command "Invoke-WebRequest -Uri 'https://services.gradle.org/distributions/gradle-8.5-bin.zip' -OutFile 'test.zip' -UseBasicParsing"

REM 3. If successful, cleanup and try build
del test.zip
pnpm run clean:atak
pnpm run build:atak
```

### If That Doesn't Work (Use Manual)

```cmd
REM Download from browser
REM Save: gradle-8.5-bin.zip to C:\Users\Owner\Downloads\

REM Extract to plugin directory
cd plugins\atak-trust-overlay
powershell -Command "Expand-Archive -Path C:\Users\Owner\Downloads\gradle-8.5-bin.zip -DestinationPath gradle\ -Force"

REM Build
pnpm run build:atak
```

---

## Verification Steps

### Check Gradle Installed

```cmd
cd plugins\atak-trust-overlay

REM If using manual install
dir gradle\gradle-8.5\bin\gradle.bat
REM Should exist

REM Test wrapper
gradlew.bat --version
REM Should output: Gradle 8.5
```

### Check Java

Gradle needs Java 17+:

```cmd
java -version
REM Should show: openjdk 17.x or higher

REM If not found, install from jdk.java.net
```

### Check Build Directory

```cmd
cd plugins\atak-trust-overlay

REM Before build
dir build
REM Should not exist or be empty

REM After build
dir build\outputs\main.jar
REM Should exist and be ~40-100 KB
```

---

## Quick Checklist

- [ ] Check internet connection
- [ ] Try: `pnpm run clean:atak && pnpm run build:atak`
- [ ] If fails, download gradle-8.5-bin.zip manually
- [ ] Extract to `plugins/atak-trust-overlay/gradle/`
- [ ] Verify: `dir gradle\gradle-8.5\bin\gradle.bat`
- [ ] Try build again: `pnpm run build:atak`
- [ ] Should create: `dist/atak/main.jar`

---

## Still Not Working?

### Debug Build

```cmd
cd plugins\atak-trust-overlay

REM Full verbose output
gradlew.bat assembleMainJar --stacktrace --info
```

**Look for error messages - they indicate specific issues**

### Check Resources

```cmd
REM Check disk space
cd plugins\atak-trust-overlay
dir
REM Should have: gradle\, src\, build.gradle.kts, etc.

REM Check gradle cache
cd %USERPROFILE%\.gradle
dir
REM Should have caches directory
```

### Manual Gradle Directory Creation

If extraction issues:

```cmd
REM 1. Download gradle-8.5-bin.zip
REM 2. Use 7-Zip or WinRAR to extract:
REM    - Open: gradle-8.5-bin.zip
REM    - Extract to: plugins\atak-trust-overlay\gradle\
REM 3. Should create: gradle\gradle-8.5\

REM 4. Verify structure
cd plugins\atak-trust-overlay\gradle\gradle-8.5\bin
dir gradle.bat
```

---

## Summary

| Issue | Solution | Time |
|---|---|---|
| **Auto-download fails** | Retry (often works) | 1 min |
| **Retry fails** | Manual install | 5 min |
| **Manual fails** | System Gradle install | 10 min |
| **Still fails** | Debug with `--stacktrace` | Varies |

---

## Next Steps

1. **Try Option 1 first:** `pnpm run clean:atak && pnpm run build:atak`
2. **If fails, use Option 2:** Manual gradle-8.5-bin.zip install
3. **Should succeed:** `pnpm run build:atak` creates main.jar
4. **Then deploy:** `pnpm run deploy:atak`

---

## Resources

- **Gradle Downloads:** https://gradle.org/releases/
- **Manual Install Guide:** `MANUAL_GRADLE_INSTALL.md`
- **Build Guide:** `docs/ATAK_PLUGIN_BUILD_GUIDE.md`
- **Troubleshooting:** `GRADLE_NOT_FOUND_FIX.md`

---

**Choose your solution above and execute. One will work!** 🚀

See: `MANUAL_GRADLE_INSTALL.md` for step-by-step manual installation
