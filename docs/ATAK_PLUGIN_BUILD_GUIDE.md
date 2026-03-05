# ATAK-Civ Plugin Build Guide

**Document Version:** 1.0  
**Last Updated:** 2025-01-27  
**Status:** Production-Ready

---

## Overview

This document describes the build and integration process for the **AetherCore ATAK-Civ Plugin** (`main.jar`). The plugin provides hardware-rooted trust overlay capabilities for ATAK (Android Team Awareness Kit) deployments.

## Quick Start

### Prerequisites

- **Java Development Kit (JDK):** 17 or higher
- **Gradle:** 7.0+ (or use system Gradle)
- **Node.js:** 22.x (for build script)
- **pnpm:** 9.15.0 (for monorepo integration)

### Build Commands

**From Repository Root:**

```bash
# Build main.jar and stage for deployment
pnpm run build:atak

# Clean build artifacts
pnpm run clean:atak
```

**Direct Gradle (from plugin directory):**

```bash
cd plugins/atak-trust-overlay

# Build main.jar
gradle assembleMainJar

# Clean build
gradle clean
```

## Artifact Locations

| **Artifact** | **Path** | **Purpose** |
|---|---|---|
| `main.jar` | `plugins/atak-trust-overlay/build/outputs/main.jar` | Build output |
| `main.jar` (staged) | `dist/atak/main.jar` | Deployment staging |

### Deterministic Output

The build system **guarantees** the artifact name is **exactly `main.jar`** with:
- No version suffixes
- No classifier prefixes
- No timestamp variations

## Build Workflow

```
User Command
  └─> pnpm run build:atak
      └─> scripts/build-atak-plugin.js
          └─> Prerequisite checks
              ├─ Verify build.gradle.kts exists
              ├─ Verify Gradle available
              └─ Check source files
          └─> Clean previous build
          └─> gradle assembleMainJar
              ├─ Compile Kotlin sources
              ├─ Package classes into JAR
              └─> Custom JAR task: buildMainJar
                  ├─ Set artifact name: main.jar
                  ├─ Add manifest attributes
                  └─ Output to build/outputs/
          └─> Verify artifact
              ├─ Check file exists
              ├─ Validate size (>1KB)
              └─ Log checksums
          └─> Stage to dist/atak/
          └─> Print summary
```

## Fail-Visible Verification

The build script enforces **fail-visible** principles:

### Hard Failures (Exit Code 1)

1. **Missing build.gradle.kts:** Build halts if Gradle configuration is absent
2. **Gradle not found:** No silent fallbacks; explicit error
3. **JAR not generated:** Build fails if `main.jar` is missing post-build
4. **Size validation:** JAR <1KB triggers failure (likely empty/corrupt)
5. **Build errors:** Any Gradle error propagates immediately

### Output Example (Success)

```
============================================================
AetherCore ATAK-Civ Plugin Builder
============================================================

✅ Prerequisites check passed

============================================================
Building ATAK Plugin
============================================================

Executing: gradle assembleMainJar

BUILD SUCCESSFUL in 12s
✅ Build succeeded

============================================================
Verifying main.jar
============================================================

✅ Artifact verification passed
   Location: plugins/atak-trust-overlay/build/outputs/main.jar
   Size: 47 KB (48234 bytes)

============================================================
Staging Artifact for Deployment
============================================================

✅ Artifact staged
   Deployment path: dist/atak/main.jar

============================================================
Build Summary
============================================================

✅ ATAK Plugin Build Complete

Artifacts:
  - Build output: plugins/atak-trust-overlay/build/outputs/main.jar
  - Deployment:   dist/atak/main.jar

Next Steps:
  1. Verify JAR contents: jar tf dist/atak/main.jar
  2. Deploy to ATAK device/emulator
  3. Verify plugin loads in ATAK
```

## Integration with AetherCore Monorepo

### Package.json Scripts

```json
{
  "scripts": {
    "build:atak": "node scripts/build-atak-plugin.js",
    "clean:atak": "rimraf plugins/atak-trust-overlay/build dist/atak"
  }
}
```

### Directory Structure

```
AetherCore/
├── plugins/
│   └── atak-trust-overlay/
│       ├── build.gradle.kts       ← Gradle build config
│       ├── settings.gradle.kts    ← Gradle settings
│       ├── gradle.properties      ← Build properties
│       ├── proguard-rules.pro     ← ProGuard config
│       ├── src/
│       │   ├── main/kotlin/       ← Plugin source code
│       │   └── test/kotlin/       ← Unit tests
│       └── build/
│           └── outputs/
│               └── main.jar       ← Build output
├── dist/
│   └── atak/
│       └── main.jar               ← Staged for deployment
├── scripts/
│   └── build-atak-plugin.js       ← Build orchestrator
└── package.json                   ← Root scripts
```

## Gradle Configuration Details

### build.gradle.kts Highlights

```kotlin
// Custom JAR task producing exactly "main.jar"
tasks.register<Jar>("buildMainJar") {
    archiveBaseName.set("main")
    archiveVersion.set("")         // No version suffix
    archiveClassifier.set("")      // No classifier
    archiveExtension.set("jar")    // Explicit extension
    
    destinationDirectory.set(layout.buildDirectory.dir("outputs"))
    
    // ATAK plugin manifest attributes
    manifest {
        attributes(
            mapOf(
                "Plugin-Type" to "ATAK-CIV",
                "AetherCore-Version" to "0.2.0"
            )
        )
    }
}

// Fail-visible verification task
tasks.register("assembleMainJar") {
    dependsOn("buildMainJar")
    
    doLast {
        val jarFile = layout.buildDirectory.file("outputs/main.jar").get().asFile
        if (!jarFile.exists()) {
            throw GradleException("❌ FAIL-VISIBLE: main.jar not generated")
        }
    }
}
```

### Key Configuration Files

- **`build.gradle.kts`:** Main build logic, JAR tasks, dependencies
- **`settings.gradle.kts`:** Repository configuration, module name
- **`gradle.properties`:** JVM args, build flags, versioning
- **`proguard-rules.pro`:** Code shrinking rules (currently disabled for ATAK compatibility)

## Verification Steps

### 1. Check JAR Contents

```bash
jar tf dist/atak/main.jar
```

**Expected Output:**
```
META-INF/MANIFEST.MF
com/aethercore/atak/trustoverlay/
com/aethercore/atak/trustoverlay/cot/TrustEventParser.class
com/aethercore/atak/trustoverlay/...
```

### 2. Inspect Manifest

```bash
unzip -p dist/atak/main.jar META-INF/MANIFEST.MF
```

**Expected Attributes:**
```
Manifest-Version: 1.0
Plugin-Type: ATAK-CIV
AetherCore-Version: 0.2.0
Implementation-Title: AetherCore ATAK Trust Overlay
```

### 3. Size Validation

```bash
ls -lh dist/atak/main.jar
```

**Typical Size:** 40-100 KB (varies with source complexity)

## Troubleshooting

### Build Fails: "Gradle not found"

**Cause:** No Gradle wrapper in plugin directory, system Gradle not installed

**Solutions:**
1. **Install Gradle system-wide:**
   ```bash
   # macOS (Homebrew)
   brew install gradle
   
   # Windows (Chocolatey)
   choco install gradle
   
   # Linux (SDKMAN)
   sdk install gradle
   ```

2. **Generate Gradle wrapper:**
   ```bash
   cd plugins/atak-trust-overlay
   gradle wrapper --gradle-version 8.5
   ```

### Build Fails: "main.jar not generated"

**Cause:** Kotlin compilation failed or JAR task didn't run

**Solutions:**
1. Check for compilation errors in Gradle output
2. Verify source files exist in `src/main/kotlin/`
3. Run with stacktrace: `gradle assembleMainJar --stacktrace`

### JAR Size < 1KB

**Cause:** Empty JAR or classes excluded

**Solutions:**
1. Check `build/intermediates/javac/release/classes/` for compiled classes
2. Verify source sets configured correctly in `build.gradle.kts`
3. Ensure Kotlin plugin applied: `id("org.jetbrains.kotlin.android")`

### ATAK SDK Not Found

**Cause:** ATAK SDK dependency commented out (expected for baseline build)

**Solutions:**
1. Obtain ATAK CIV SDK from TAK.gov
2. Place SDK AAR in `plugins/atak-trust-overlay/libs/`
3. Uncomment in `build.gradle.kts`:
   ```kotlin
   compileOnly(files("libs/atak-civ-sdk-4.10.0.aar"))
   ```

## CI/CD Integration

### GitHub Actions Example

```yaml
name: Build ATAK Plugin

on: [push, pull_request]

jobs:
  build-plugin:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      
      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '22'
      
      - name: Setup Java
        uses: actions/setup-java@v4
        with:
          distribution: 'temurin'
          java-version: '17'
      
      - name: Setup Gradle
        uses: gradle/gradle-build-action@v2
      
      - name: Build ATAK Plugin
        run: pnpm run build:atak
      
      - name: Upload Artifact
        uses: actions/upload-artifact@v4
        with:
          name: main.jar
          path: dist/atak/main.jar
```

### Deployment Pipeline

```bash
#!/bin/bash
# deploy-atak-plugin.sh

set -e  # Exit on error (fail-visible)

echo "Building ATAK plugin..."
pnpm run build:atak

echo "Generating BLAKE3 checksum..."
# In production, use crates/crypto for BLAKE3
b3sum dist/atak/main.jar > dist/atak/main.jar.b3sum

echo "Signing artifact..."
# Sign with CodeRalphie TPM-backed key
# (Implementation TBD - integrate with crates/identity)

echo "Deploying to artifact server..."
# Upload to deployment endpoint
curl -X POST https://artifacts.aethercore.internal/atak/plugins \
  -H "Authorization: Bearer $DEPLOY_TOKEN" \
  -F "file=@dist/atak/main.jar" \
  -F "checksum=@dist/atak/main.jar.b3sum"

echo "✅ Deployment complete"
```

## Security Considerations

### Production Deployment Requirements

1. **Code Signing:** All production JARs must be signed with organizational certificate
2. **Checksum Verification:** Use BLAKE3 (not SHA-256) per AetherCore standards
3. **Provenance Tracking:** Record build environment, commit hash, build timestamp
4. **Artifact Immutability:** Once released, `main.jar` for a given version is immutable

### Fail-Visible Security Checks

- **No mock implementations:** Plugin must call real gRPC/FFI to `crates/identity`
- **No degraded security:** If TPM unavailable, plugin must refuse to load (no software fallback)
- **Signature validation:** Plugin must validate all incoming trust overlay data

## Known Limitations

### Current State (v0.2.0)

- **ATAK SDK:** Not bundled (requires separate acquisition from TAK.gov)
- **Hardware Integration:** Placeholder for CodeRalphie TPM integration
- **BLAKE3 Checksums:** Build script uses SHA-256 fallback (pending Rust crypto integration)

### Roadmap

- [ ] Integrate ATAK SDK into offline build cache
- [ ] Connect to `crates/identity` for TPM-backed signing
- [ ] Implement BLAKE3 checksumming via FFI
- [ ] Add automated plugin loading tests (ATAK emulator)
- [ ] Produce signed release artifacts

## Support & Escalation

### Build Issues

1. Check this document's Troubleshooting section
2. Review `plugins/atak-trust-overlay/build/` logs
3. Run diagnostics: `pnpm run doctor`
4. Escalate to: AetherCore Build Team

### Plugin Runtime Issues

1. Check ATAK logcat: `adb logcat | grep AetherCore`
2. Verify plugin loaded: ATAK Settings → Plugins
3. Escalate to: AetherCore Plugin Team

---

## Appendix: File-by-File Change List

### Files Created

| **File** | **Purpose** |
|---|---|
| `plugins/atak-trust-overlay/build.gradle.kts` | Gradle build configuration |
| `plugins/atak-trust-overlay/settings.gradle.kts` | Gradle settings |
| `plugins/atak-trust-overlay/gradle.properties` | Build properties |
| `plugins/atak-trust-overlay/proguard-rules.pro` | ProGuard rules |
| `scripts/build-atak-plugin.js` | Build orchestration script |
| `docs/ATAK_PLUGIN_BUILD_GUIDE.md` | This document |

### Files Modified

| **File** | **Change** |
|---|---|
| `package.json` | Added `build:atak` and `clean:atak` scripts |

---

**End of Build Guide**
