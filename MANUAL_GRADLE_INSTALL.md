# Manual Gradle Installation - Reliable Method

**Status:** If automatic download fails, use this manual approach  
**Time:** 5 minutes

---

## Quick Method: Download & Extract

### Step 1: Download Gradle

Visit: https://gradle.org/releases/

**Download:** `gradle-8.5-bin.zip` (NOT source)

**File:** ~60 MB

### Step 2: Extract to Plugin Directory

```cmd
cd plugins\atak-trust-overlay

REM Extract to gradle\gradle-8.5\
powershell -Command "Expand-Archive -Path gradle-8.5-bin.zip -DestinationPath gradle\ -Force"

REM Or use Windows Explorer:
REM 1. Right-click gradle-8.5-bin.zip
REM 2. Extract All...
REM 3. Extract to: gradle\
```

### Step 3: Rename (if needed)

```cmd
cd plugins\atak-trust-overlay\gradle
ren gradle-8.5 gradle-8.5-bin
cd ..\..
```

Result: `plugins\atak-trust-overlay\gradle\gradle-8.5\bin\gradle.bat` exists

### Step 4: Build

```bash
pnpm run build:atak
```

Or directly:

```cmd
cd plugins\atak-trust-overlay
gradlew.bat assembleMainJar
```

---

## Complete Directory Structure

After extraction, should look like:

```
plugins\atak-trust-overlay\
├── gradle\
│   └── gradle-8.5\
│       ├── bin\
│       │   ├── gradle.bat
│       │   └── gradle (unix)
│       ├── lib\
│       └── ...
├── gradlew.bat
├── gradlew
├── build.gradle.kts
└── ...
```

---

## Verify Gradle Works

```cmd
cd plugins\atak-trust-overlay

REM Test gradle wrapper
gradlew.bat --version
REM Should output: Gradle 8.5
```

---

## Build Now

```bash
pnpm run build:atak
```

Should work immediately since Gradle is already present.

---

## If Download Link Not Working

**Alternative sources:**

1. **AWS S3:** `https://gradle-distributions.s3.amazonaws.com/gradle-8.5-bin.zip`
2. **Maven Central:** `https://repo1.maven.org/maven2/gradle/gradle/8.5/gradle-8.5-bin.zip`
3. **GitHub Releases:** Check if available on releases page

---

## Troubleshooting Manual Install

### "gradle-8.5\ directory not found"

```cmd
cd plugins\atak-trust-overlay\gradle
dir
REM Should show: gradle-8.5 directory
```

If not there, re-extract:
```cmd
powershell -Command "Expand-Archive -Path gradle-8.5-bin.zip -DestinationPath . -Force"
```

### "gradle.bat not found"

```cmd
cd plugins\atak-trust-overlay\gradle\gradle-8.5\bin
dir gradle.bat
REM Should show: gradle.bat file
```

If not there, extraction failed - try again.

### Build still fails

```cmd
cd plugins\atak-trust-overlay
gradlew.bat assembleMainJar --stacktrace --info
REM Shows detailed error messages
```

---

## Why Manual Install Works

1. ✅ No network issues (you downloaded directly)
2. ✅ You control the extraction
3. ✅ Can verify each step
4. ✅ No PowerShell/curl needed
5. ✅ Works offline after extraction

---

## Complete Flow

```cmd
REM 1. Download gradle-8.5-bin.zip to Downloads folder

REM 2. Navigate to plugin dir
cd plugins\atak-trust-overlay

REM 3. Extract
powershell -Command "Expand-Archive -Path C:\Users\Owner\Downloads\gradle-8.5-bin.zip -DestinationPath gradle\ -Force"

REM 4. Verify
dir gradle\gradle-8.5\bin\gradle.bat

REM 5. Build
pnpm run build:atak
```

---

## Gradle 8.5 Download Link

**Direct Download:**
```
https://services.gradle.org/distributions/gradle-8.5-bin.zip
```

**Browser:** Copy link above, paste in browser to download

**Command line (PowerShell):**
```powershell
$url = "https://services.gradle.org/distributions/gradle-8.5-bin.zip"
$file = "gradle-8.5-bin.zip"
Invoke-WebRequest -Uri $url -OutFile $file -UseBasicParsing
```

---

## Next Steps

1. Download gradle-8.5-bin.zip
2. Extract to `plugins/atak-trust-overlay/gradle/`
3. Run: `pnpm run build:atak`
4. Should create `dist/atak/main.jar`
5. Deploy: `pnpm run deploy:atak`

---

**Ready to build once Gradle is in place!** 🚀
