#!/usr/bin/env pwsh
# AetherCore ATAK Plugin - System Readiness Check
# Validates all prerequisites before deployment

$ErrorActionPreference = "Continue"
$successCount = 0
$totalChecks = 12

Write-Host @"
╔═══════════════════════════════════════════════════════════════╗
║                                                               ║
║   🔍 AETHERCORE SYSTEM READINESS CHECK 🔍                    ║
║                                                               ║
║   Validating deployment prerequisites...                     ║
║                                                               ║
╚═══════════════════════════════════════════════════════════════╝
"@ -ForegroundColor Cyan

Write-Host ""

# ============================================================================
# CHECK 1: Android SDK
# ============================================================================
Write-Host "[1/$totalChecks] Android SDK" -ForegroundColor Yellow -NoNewline
$androidSdk = "C:\Users\Owner\AppData\Local\Android\Sdk"
if (Test-Path $androidSdk) {
    Write-Host " ✅" -ForegroundColor Green
    $successCount++
} else {
    Write-Host " ❌ Not found at: $androidSdk" -ForegroundColor Red
}

# ============================================================================
# CHECK 2: Java JDK
# ============================================================================
Write-Host "[2/$totalChecks] Java JDK (21+)" -ForegroundColor Yellow -NoNewline
$javaPath = "C:\Program Files\Android\Android Studio\jbr"
if (Test-Path $javaPath) {
    try {
        $javaVersion = & "$javaPath\bin\java.exe" -version 2>&1 | Select-String "version" | Select-Object -First 1
        Write-Host " ✅ $javaVersion" -ForegroundColor Green
        $successCount++
    } catch {
        Write-Host " ⚠️ Found but version check failed" -ForegroundColor Yellow
    }
} else {
    Write-Host " ❌ Not found at: $javaPath" -ForegroundColor Red
}

# ============================================================================
# CHECK 3: Rust Toolchain
# ============================================================================
Write-Host "[3/$totalChecks] Rust Toolchain" -ForegroundColor Yellow -NoNewline
try {
    $rustVersion = cargo --version 2>&1
    Write-Host " ✅ $rustVersion" -ForegroundColor Green
    $successCount++
} catch {
    Write-Host " ❌ cargo not found in PATH" -ForegroundColor Red
}

# ============================================================================
# CHECK 4: cargo-ndk
# ============================================================================
Write-Host "[4/$totalChecks] cargo-ndk" -ForegroundColor Yellow -NoNewline
try {
    $cargoNdkVersion = cargo ndk --version 2>&1 | Select-Object -First 1
    Write-Host " ✅ $cargoNdkVersion" -ForegroundColor Green
    $successCount++
} catch {
    Write-Host " ❌ Not installed (run: cargo install cargo-ndk)" -ForegroundColor Red
}

# ============================================================================
# CHECK 5: Android Rust Targets
# ============================================================================
Write-Host "[5/$totalChecks] Android Rust Targets" -ForegroundColor Yellow -NoNewline
$targets = rustup target list | Select-String "android.*installed"
$armv7 = $targets | Select-String "armv7-linux-androideabi"
$arm64 = $targets | Select-String "aarch64-linux-android"
if ($armv7 -and $arm64) {
    Write-Host " ✅ ARMv7 + ARM64" -ForegroundColor Green
    $successCount++
} else {
    Write-Host " ❌ Missing targets" -ForegroundColor Red
    if (-not $armv7) { Write-Host "     Missing: armv7-linux-androideabi" -ForegroundColor Gray }
    if (-not $arm64) { Write-Host "     Missing: aarch64-linux-android" -ForegroundColor Gray }
}

# ============================================================================
# CHECK 6: ATAK SDK
# ============================================================================
Write-Host "[6/$totalChecks] ATAK SDK (main.jar)" -ForegroundColor Yellow -NoNewline
$atakSdk = "$PSScriptRoot\libs\main.jar"
if (Test-Path $atakSdk) {
    $size = [math]::Round((Get-Item $atakSdk).Length / 1MB, 2)
    Write-Host " ✅ $size MB" -ForegroundColor Green
    $successCount++
} else {
    Write-Host " ❌ Not found in libs/" -ForegroundColor Red
}

# ============================================================================
# CHECK 7: Native Libraries Built
# ============================================================================
Write-Host "[7/$totalChecks] Native Libraries" -ForegroundColor Yellow -NoNewline
$jniLibs = "$PSScriptRoot\src\main\jniLibs"
if (Test-Path $jniLibs) {
    $arm64Lib = Get-Item "$jniLibs\arm64-v8a\libaethercore_jni.so" -ErrorAction SilentlyContinue
    $armv7Lib = Get-Item "$jniLibs\armeabi-v7a\libaethercore_jni.so" -ErrorAction SilentlyContinue
    if ($arm64Lib -and $armv7Lib) {
        $totalSize = [math]::Round(($arm64Lib.Length + $armv7Lib.Length) / 1MB, 2)
        Write-Host " ✅ $totalSize MB (both architectures)" -ForegroundColor Green
        $successCount++
    } else {
        Write-Host " ⚠️ Missing one or both architectures" -ForegroundColor Yellow
    }
} else {
    Write-Host " ❌ jniLibs directory not found" -ForegroundColor Red
}

# ============================================================================
# CHECK 8: APK Built
# ============================================================================
Write-Host "[8/$totalChecks] Debug APK" -ForegroundColor Yellow -NoNewline
$apk = "$PSScriptRoot\build\outputs\apk\debug\atak-trust-overlay-debug.apk"
if (Test-Path $apk) {
    $apkSize = [math]::Round((Get-Item $apk).Length / 1MB, 2)
    $buildTime = (Get-Item $apk).LastWriteTime.ToString("yyyy-MM-dd HH:mm")
    Write-Host " ✅ $apkSize MB (built: $buildTime)" -ForegroundColor Green
    $successCount++
} else {
    Write-Host " ❌ Not found (run: .\gradlew.bat assembleDebug)" -ForegroundColor Red
}

# ============================================================================
# CHECK 9: ADB Available
# ============================================================================
Write-Host "[9/$totalChecks] ADB (Android Debug Bridge)" -ForegroundColor Yellow -NoNewline
$env:PATH += ";$androidSdk\platform-tools"
try {
    $adbVersion = adb version 2>&1 | Select-String "version" | Select-Object -First 1
    Write-Host " ✅" -ForegroundColor Green
    $successCount++
} catch {
    Write-Host " ❌ Not found in PATH" -ForegroundColor Red
}

# ============================================================================
# CHECK 10: Emulator Availability
# ============================================================================
Write-Host "[10/$totalChecks] Android Emulator" -ForegroundColor Yellow -NoNewline
$env:PATH += ";$androidSdk\emulator"
try {
    $avds = emulator -list-avds 2>&1
    if ($avds) {
        Write-Host " ✅ AVD: $($avds[0])" -ForegroundColor Green
        $successCount++
    } else {
        Write-Host " ⚠️ No AVDs configured" -ForegroundColor Yellow
    }
} catch {
    Write-Host " ❌ Emulator not found" -ForegroundColor Red
}

# ============================================================================
# CHECK 11: Device Connectivity
# ============================================================================
Write-Host "[11/$totalChecks] Connected Devices" -ForegroundColor Yellow -NoNewline
try {
    $devices = adb devices 2>&1 | Select-String "device$"
    if ($devices.Count -gt 0) {
        Write-Host " ✅ $($devices.Count) device(s)" -ForegroundColor Green
        $successCount++
    } else {
        Write-Host " ⚠️ No devices connected (start emulator first)" -ForegroundColor Yellow
    }
} catch {
    Write-Host " ⚠️ ADB not responding" -ForegroundColor Yellow
}

# ============================================================================
# CHECK 12: Deployment Scripts
# ============================================================================
Write-Host "[12/$totalChecks] Deployment Scripts" -ForegroundColor Yellow -NoNewline
$quickDeploy = Test-Path "$PSScriptRoot\quick-deploy.ps1"
$injectCot = Test-Path "$PSScriptRoot\inject-cot-test.ps1"
if ($quickDeploy -and $injectCot) {
    Write-Host " ✅ All scripts present" -ForegroundColor Green
    $successCount++
} else {
    Write-Host " ❌ Missing scripts" -ForegroundColor Red
}

# ============================================================================
# SUMMARY
# ============================================================================
Write-Host ""
Write-Host "═══════════════════════════════════════════════════════════" -ForegroundColor Cyan

$percentage = [math]::Round(($successCount / $totalChecks) * 100, 0)

if ($percentage -eq 100) {
    Write-Host "✅ SYSTEM READY: $successCount/$totalChecks checks passed ($percentage%)" -ForegroundColor Green
    Write-Host ""
    Write-Host "You can now deploy with:" -ForegroundColor Cyan
    Write-Host "  .\quick-deploy.ps1 -StartEmulator -RunTests" -ForegroundColor White
} elseif ($percentage -ge 75) {
    Write-Host "⚠️  MOSTLY READY: $successCount/$totalChecks checks passed ($percentage%)" -ForegroundColor Yellow
    Write-Host ""
    Write-Host "Review failed checks above. You may be able to proceed with:" -ForegroundColor Cyan
    Write-Host "  .\quick-deploy.ps1 -DeployOnly" -ForegroundColor White
} else {
    Write-Host "❌ NOT READY: $successCount/$totalChecks checks passed ($percentage%)" -ForegroundColor Red
    Write-Host ""
    Write-Host "Please resolve the failed checks before deployment." -ForegroundColor Yellow
}

Write-Host ""
Write-Host "═══════════════════════════════════════════════════════════" -ForegroundColor Cyan
Write-Host ""

# Return exit code based on success
if ($percentage -eq 100) {
    exit 0
} else {
    exit 1
}

