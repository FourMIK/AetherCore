# ⚡ Quick Fix: Gradle Not Found

**Status:** Build script updated to use Gradle wrapper  
**Your Issue:** `'gradle' is not recognized`

---

## Quick Solution

The Gradle wrapper is already bundled. Use it directly:

```bash
cd plugins/atak-trust-overlay
gradlew.bat assembleMainJar
```

Or let the build script find it:

```bash
pnpm run build:atak
```

Script will now:
1. ✅ Check for Gradle wrapper first (it exists!)
2. ✅ Use wrapper to build
3. ✅ Fall back to system Gradle if wrapper unavailable

---

## What Gradle Is

Gradle is a build tool for Java/Android projects. It:
- Compiles Kotlin source code → bytecode
- Packages classes → JAR file
- Manages dependencies

We've bundled Gradle Wrapper so you don't need to install it globally.

---

## How to Fix

### Option A: Let the Script Handle It (Easiest)

The build script is now updated to use the Gradle wrapper automatically.

Just run:
```bash
pnpm run build:atak
```

✅ Script will find and use `gradlew.bat`

### Option B: Use Gradle Wrapper Directly

```bash
cd plugins/atak-trust-overlay
gradlew.bat assembleMainJar
```

### Option C: Install Gradle Globally

If you want system Gradle:

**Windows (Chocolatey):**
```powershell
choco install gradle
```

**Windows (Manual):**
1. Download from https://gradle.org/releases/
2. Extract to `C:\Program Files\gradle`
3. Add to PATH: `C:\Program Files\gradle\bin`
4. Restart terminal

**macOS (Homebrew):**
```bash
brew install gradle
```

**Linux (APT):**
```bash
sudo apt-get install gradle
```

---

## What's Bundled

You already have Gradle included:

```
plugins/atak-trust-overlay/
├── gradlew          ← Gradle wrapper (Unix)
├── gradlew.bat      ← Gradle wrapper (Windows) ✅
└── gradle/          ← Gradle distribution (auto-downloaded)
```

The wrapper will automatically download Gradle on first run (one-time).

---

## Try Now

```bash
pnpm run build:atak
```

The script will:
1. ✅ Check for `gradlew.bat`
2. ✅ Find it
3. ✅ Build plugin using wrapper
4. ✅ Create `dist/atak/main.jar`

---

## What Happens

### First Build
```
Executing: C:\...\plugins\atak-trust-overlay\gradlew.bat assembleMainJar

> Downloading gradle...  (one-time, ~60MB)
> Compiling Kotlin sources...
> Packaging main.jar...

✅ Build succeeded
```

### Subsequent Builds
```
Executing: gradlew.bat assembleMainJar

> Compiling Kotlin sources...  (cached)
> Packaging main.jar...

✅ Build succeeded
```

---

## If Still Having Issues

### Check Wrapper Exists

```bash
cd plugins/atak-trust-overlay
dir gradlew.bat
# Should show: gradlew.bat file exists
```

### Try Wrapper Directly

```bash
cd plugins/atak-trust-overlay
gradlew.bat assembleMainJar

# Or with explicit Java path
"C:\Program Files\Java\jdk-17\bin\java.exe" -version
# Verify Java 17+ installed
```

### Check Java

Gradle needs Java 17+:

```bash
java -version
# Should show: openjdk version 17.x or higher
```

If Java not found: Install from https://jdk.java.net/

---

## Troubleshooting

### "gradlew.bat is not recognized"

```bash
# Make sure you're in the right directory
cd plugins/atak-trust-overlay

# Then run
gradlew.bat assembleMainJar
```

### "java.exe not found"

```bash
# Check Java installation
java -version

# If not found:
# Install Java 17+ from jdk.java.net
# Or: choco install openjdk17
```

### "Gradle download failed"

```bash
# Check internet connection
# Gradle wrapper downloads Gradle on first run (automatic)

# If stuck, delete cache and retry
rm -r plugins/atak-trust-overlay/gradle
pnpm run build:atak
```

---

## Complete Solution

### Step 1: Run Updated Build Script

```bash
pnpm run build:atak
```

The script now:
- ✅ Checks for wrapper first
- ✅ Uses wrapper automatically
- ✅ Falls back to system Gradle if needed
- ✅ Clear error messages if issues

### Step 2: Build Succeeds

```
✅ Build succeeded
✅ main.jar created at: dist/atak/main.jar
```

### Step 3: Deploy

```bash
pnpm run deploy:atak
```

---

## Why This Works

**Gradle Wrapper Benefits:**
- ✅ No installation needed
- ✅ Exact version guaranteed (reproducible builds)
- ✅ Works on any system (auto-downloads)
- ✅ Isolated from system Gradle version
- ✅ Included in the repository

**Your Setup:**
- ✅ Wrapper already created (`gradlew.bat`)
- ✅ No manual setup needed
- ✅ Auto-downloads Gradle on first run
- ✅ Subsequent builds use cache

---

## Commands

```bash
# Build (uses wrapper automatically)
pnpm run build:atak

# Or direct wrapper
cd plugins/atak-trust-overlay
gradlew.bat assembleMainJar

# With output
gradlew.bat assembleMainJar --stacktrace --info
```

---

## Next Step

```bash
pnpm run build:atak
```

✅ Script detects wrapper  
✅ Uses it to build  
✅ Creates main.jar  
✅ Ready to deploy  

**Time:** 10-15 seconds (first build downloads Gradle, ~60MB)

---

**Ready to build?**

```bash
pnpm run build:atak
```

Works immediately - no installation required! 🚀
