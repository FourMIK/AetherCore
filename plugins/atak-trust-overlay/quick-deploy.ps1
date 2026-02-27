#!/usr/bin/env pwsh
# AetherCore ATAK Plugin - Quick Start Deployment Script
# Automates environment setup and APK deployment

param(
    [switch]$BuildOnly,
    [switch]$DeployOnly,
    [switch]$StartEmulator,
    [switch]$RunTests
)

$ErrorActionPreference = "Stop"

Write-Host @"
╔═══════════════════════════════════════════════════════════════╗
║                                                               ║
║   🎯 AETHERCORE TACTICAL GLASS - DEPLOYMENT AUTOMATION 🎯    ║
║                                                               ║
║   Mission: Deploy Trust Overlay to Android EUD               ║
║   Status: Executing Deployment Protocol                      ║
║                                                               ║
╚═══════════════════════════════════════════════════════════════╝
"@ -ForegroundColor Cyan

Write-Host ""

# ============================================================================
# PHASE 0: ENVIRONMENT SETUP
# ============================================================================

Write-Host "[PHASE 0] Environment Validation" -ForegroundColor Yellow
Write-Host "================================" -ForegroundColor Yellow

# Set Android SDK path
$androidSdk = "C:\Users\Owner\AppData\Local\Android\Sdk"
if (-not (Test-Path $androidSdk)) {
    Write-Host "✗ Android SDK not found at: $androidSdk" -ForegroundColor Red
    exit 1
}
$env:ANDROID_HOME = $androidSdk
$env:ANDROID_SDK_ROOT = $androidSdk
Write-Host "✓ ANDROID_HOME set to: $androidSdk" -ForegroundColor Green

# Set Java path
$javaPath = "C:\Program Files\Android\Android Studio\jbr"
if (-not (Test-Path $javaPath)) {
    Write-Host "✗ Java not found at: $javaPath" -ForegroundColor Red
    exit 1
}
$env:JAVA_HOME = $javaPath
Write-Host "✓ JAVA_HOME set to: $javaPath" -ForegroundColor Green

# Add tools to PATH
$env:PATH += ";$androidSdk\platform-tools;$androidSdk\emulator"
Write-Host "✓ Added adb and emulator to PATH" -ForegroundColor Green

# Verify cargo-ndk
try {
    $cargoNdkVersion = cargo ndk --version 2>&1 | Select-Object -First 1
    Write-Host "✓ cargo-ndk available: $cargoNdkVersion" -ForegroundColor Green
} catch {
    Write-Host "✗ cargo-ndk not installed" -ForegroundColor Red
    Write-Host "  Install with: cargo install cargo-ndk" -ForegroundColor Yellow
    exit 1
}

Write-Host ""

# ============================================================================
# PHASE 1: BUILD NATIVE LIBRARIES
# ============================================================================

if (-not $DeployOnly) {
    Write-Host "[PHASE 1] Building Native Libraries (Rust → Android)" -ForegroundColor Yellow
    Write-Host "======================================================" -ForegroundColor Yellow

    Push-Location "$PSScriptRoot\..\..\crates\android-ffi"

    Write-Host "→ Compiling libaethercore_jni.so for ARMv7 and ARM64..." -ForegroundColor Cyan
    cargo ndk -t armeabi-v7a -t arm64-v8a -o ..\..\plugins\atak-trust-overlay\src\main\jniLibs build --release

    if ($LASTEXITCODE -ne 0) {
        Write-Host "✗ Native library build failed" -ForegroundColor Red
        Pop-Location
        exit 1
    }

    Write-Host "✓ Native libraries built successfully" -ForegroundColor Green
    Pop-Location
    Write-Host ""
}

# ============================================================================
# PHASE 2: BUILD APK
# ============================================================================

if (-not $DeployOnly) {
    Write-Host "[PHASE 2] Building APK (Gradle)" -ForegroundColor Yellow
    Write-Host "===============================" -ForegroundColor Yellow

    Push-Location "$PSScriptRoot"

    Write-Host "→ Running: gradlew clean assembleDebug" -ForegroundColor Cyan
    .\gradlew.bat clean assembleDebug

    if ($LASTEXITCODE -ne 0) {
        Write-Host "✗ APK build failed" -ForegroundColor Red
        Pop-Location
        exit 1
    }

    $apkPath = ".\build\outputs\apk\debug\atak-trust-overlay-debug.apk"
    $apkSize = (Get-Item $apkPath).Length / 1MB
    Write-Host "✓ APK built successfully: $([math]::Round($apkSize, 2)) MB" -ForegroundColor Green

    Pop-Location
    Write-Host ""
}

if ($BuildOnly) {
    Write-Host "✓ Build complete (--BuildOnly flag set)" -ForegroundColor Green
    exit 0
}

# ============================================================================
# PHASE 3: START EMULATOR (Optional)
# ============================================================================

if ($StartEmulator) {
    Write-Host "[PHASE 3] Starting Android Emulator" -ForegroundColor Yellow
    Write-Host "===================================" -ForegroundColor Yellow

    $avdName = "Medium_Phone_API_36.1"

    # Check if emulator is already running
    $runningDevices = adb devices | Select-String "device$"
    if ($runningDevices.Count -gt 0) {
        Write-Host "✓ Emulator already running" -ForegroundColor Green
    } else {
        Write-Host "→ Starting AVD: $avdName" -ForegroundColor Cyan
        Start-Process -FilePath "$env:ANDROID_HOME\emulator\emulator.exe" -ArgumentList "-avd", $avdName -WindowStyle Hidden

        Write-Host "  Waiting for boot (45 seconds)..." -ForegroundColor Gray
        Start-Sleep -Seconds 45

        # Wait for device to be online
        $timeout = 30
        $elapsed = 0
        while ($elapsed -lt $timeout) {
            $devices = adb devices | Select-String "device$"
            if ($devices.Count -gt 0) {
                break
            }
            Start-Sleep -Seconds 2
            $elapsed += 2
            Write-Host "  Still waiting... ($elapsed/$timeout seconds)" -ForegroundColor Gray
        }

        Write-Host "✓ Emulator online" -ForegroundColor Green
    }
    Write-Host ""
}

# ============================================================================
# PHASE 4: DEPLOY APK
# ============================================================================

Write-Host "[PHASE 4] Deploying APK to Device" -ForegroundColor Yellow
Write-Host "===================================" -ForegroundColor Yellow

# Check device connectivity
$devices = adb devices | Select-String "device$"
if ($devices.Count -eq 0) {
    Write-Host "✗ No Android devices connected" -ForegroundColor Red
    Write-Host "  Start emulator with: .\quick-deploy.ps1 -StartEmulator" -ForegroundColor Yellow
    exit 1
}

Write-Host "✓ Device connected: $($devices[0])" -ForegroundColor Green

# Install APK
$apkPath = ".\build\outputs\apk\debug\atak-trust-overlay-debug.apk"
Write-Host "→ Installing: $apkPath" -ForegroundColor Cyan

adb install -r -t $apkPath

if ($LASTEXITCODE -ne 0) {
    Write-Host "✗ APK installation failed" -ForegroundColor Red
    exit 1
}

Write-Host "✓ APK installed successfully" -ForegroundColor Green
Write-Host ""

# ============================================================================
# PHASE 5: VERIFICATION
# ============================================================================

Write-Host "[PHASE 5] Deployment Verification" -ForegroundColor Yellow
Write-Host "==================================" -ForegroundColor Yellow

# Check if plugin is installed
$installedPackages = adb shell pm list packages | Select-String "aethercore"
if ($installedPackages) {
    Write-Host "✓ Plugin package verified: $($installedPackages -join ', ')" -ForegroundColor Green
} else {
    Write-Host "⚠ Plugin package not found (may need ATAK restart)" -ForegroundColor Yellow
}

# Check for native libraries
Write-Host "→ Verifying native libraries..." -ForegroundColor Cyan
$nativeLibs = adb shell "ls -1 /data/app/com.aethercore.atak.trustoverlay*/lib/*/libaethercore_jni.so 2>/dev/null" 2>$null
if ($nativeLibs) {
    Write-Host "✓ Native library present: libaethercore_jni.so" -ForegroundColor Green
} else {
    Write-Host "⚠ Native library not found (check logcat for JNI errors)" -ForegroundColor Yellow
}

Write-Host ""

# ============================================================================
# PHASE 6: LAUNCH & TEST (Optional)
# ============================================================================

if ($RunTests) {
    Write-Host "[PHASE 6] Launching ATAK and Running Tests" -ForegroundColor Yellow
    Write-Host "==========================================" -ForegroundColor Yellow

    # Launch ATAK
    Write-Host "→ Launching ATAK-CIV..." -ForegroundColor Cyan
    adb shell am start -n com.atakmap.app.civ/com.atakmap.app.ATAKActivity 2>$null

    Write-Host "  Waiting for ATAK to initialize (15 seconds)..." -ForegroundColor Gray
    Start-Sleep -Seconds 15

    # Check plugin logs
    Write-Host "→ Checking plugin initialization logs..." -ForegroundColor Cyan
    $logs = adb logcat -d -s "TrustOverlayPluginReceiver:*" "RalphieNodeDaemon:*" | Select-String -Pattern "(AetherCore|JNI|Trust)" | Select-Object -Last 10

    if ($logs) {
        Write-Host "✓ Plugin logs detected:" -ForegroundColor Green
        $logs | ForEach-Object { Write-Host "  $_" -ForegroundColor Gray }
    } else {
        Write-Host "⚠ No plugin logs found (check if ATAK loaded the plugin)" -ForegroundColor Yellow
    }

    Write-Host ""
    Write-Host "→ Running CoT injection tests..." -ForegroundColor Cyan
    Write-Host ""

    # Run CoT test script
    & "$PSScriptRoot\inject-cot-test.ps1"
}

# ============================================================================
# COMPLETION
# ============================================================================

Write-Host ""
Write-Host @"
╔═══════════════════════════════════════════════════════════════╗
║                                                               ║
║   ✅ DEPLOYMENT COMPLETE ✅                                   ║
║                                                               ║
║   Next Steps:                                                ║
║   1. Open ATAK on the emulator/device                        ║
║   2. Verify "AetherCore Trust Overlay" appears in plugins    ║
║   3. Run: .\inject-cot-test.ps1 to test visualization        ║
║                                                               ║
║   Troubleshooting:                                           ║
║   - Check logs: adb logcat -s RalphieNodeDaemon:*            ║
║   - Reinstall:  .\quick-deploy.ps1 -BuildOnly               ║
║   - Full guide: FIELD_DEPLOYMENT_GUIDE.md                    ║
║                                                               ║
╚═══════════════════════════════════════════════════════════════╝
"@ -ForegroundColor Green

Write-Host ""
Write-Host "Mission Status: ✅ READY FOR FAIL-VISIBLE VALIDATION" -ForegroundColor Cyan
Write-Host ""

