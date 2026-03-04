#!/usr/bin/env pwsh
# AetherCore Trust Overlay - Field Deployment Verification Script
# Use this after deploying to a real device to verify plugin status

param(
    [switch]$Continuous,
    [switch]$ShowAllLogs
)

$ErrorActionPreference = "Stop"

Write-Host @"
╔═══════════════════════════════════════════════════════════════╗
║                                                               ║
║   🔍 AETHERCORE TRUST OVERLAY - DEPLOYMENT VERIFICATION 🔍   ║
║                                                               ║
╚═══════════════════════════════════════════════════════════════╝
"@ -ForegroundColor Cyan

Write-Host ""

# Setup ADB path
$env:PATH += ";C:\Users\Owner\AppData\Local\Android\Sdk\platform-tools"

# ============================================================================
# CHECK 1: Device Connection
# ============================================================================
Write-Host "[1/7] Checking device connection..." -ForegroundColor Yellow
$devices = adb devices | Select-String "device$" | Where-Object { $_ -notmatch "List of devices" }
if ($devices.Count -eq 0) {
    Write-Host "   ❌ No device connected" -ForegroundColor Red
    Write-Host "   Connect device via USB or wireless ADB and try again" -ForegroundColor Gray
    exit 1
}
Write-Host "   ✅ Device connected" -ForegroundColor Green

# ============================================================================
# CHECK 2: Device Info
# ============================================================================
Write-Host "[2/7] Device information..." -ForegroundColor Yellow
$model = adb shell getprop ro.product.model
$androidVersion = adb shell getprop ro.build.version.release
$sdk = adb shell getprop ro.build.version.sdk
Write-Host "   Model: $model" -ForegroundColor Cyan
Write-Host "   Android: $androidVersion (API $sdk)" -ForegroundColor Cyan

# ============================================================================
# CHECK 3: Package Installation
# ============================================================================
Write-Host "[3/7] Verifying package installation..." -ForegroundColor Yellow
$package = adb shell pm list packages | Select-String "com.aethercore.atak.trustoverlay"
if (-not $package) {
    Write-Host "   ❌ Trust Overlay not installed" -ForegroundColor Red
    exit 1
}
Write-Host "   ✅ Package installed: com.aethercore.atak.trustoverlay" -ForegroundColor Green

# ============================================================================
# CHECK 4: APK Details
# ============================================================================
Write-Host "[4/7] APK details..." -ForegroundColor Yellow
$apkPath = adb shell pm path com.aethercore.atak.trustoverlay
if ($apkPath -match "package:(.+)") {
    $deviceApkPath = $matches[1]
    Write-Host "   Location: $deviceApkPath" -ForegroundColor Cyan

    # Get APK size
    $apkSize = adb shell "stat -c %s '$deviceApkPath'"
    $sizeMB = [math]::Round($apkSize / 1MB, 2)
    Write-Host "   Size: $sizeMB MB" -ForegroundColor Cyan
}

# ============================================================================
# CHECK 5: Native Library Architecture
# ============================================================================
Write-Host "[5/7] Native library architecture..." -ForegroundColor Yellow
$cpuAbi = adb shell pm dump com.aethercore.atak.trustoverlay | Select-String "primaryCpuAbi"
if ($cpuAbi) {
    Write-Host "   $cpuAbi" -ForegroundColor Cyan
    if ($cpuAbi -match "arm64-v8a") {
        Write-Host "   ✅ Using ARM64 native libraries (optimal)" -ForegroundColor Green
    } elseif ($cpuAbi -match "armeabi-v7a") {
        Write-Host "   ⚠️  Using ARMv7 libraries (32-bit compatibility mode)" -ForegroundColor Yellow
    }
}

# ============================================================================
# CHECK 6: ATAK-Civ Installation
# ============================================================================
Write-Host "[6/7] Checking for ATAK-Civ..." -ForegroundColor Yellow
$atakPackages = adb shell pm list packages | Select-String "atak"
if ($atakPackages) {
    Write-Host "   ✅ ATAK packages found:" -ForegroundColor Green
    foreach ($pkg in $atakPackages) {
        Write-Host "      $pkg" -ForegroundColor Gray
    }
} else {
    Write-Host "   ⚠️  No ATAK packages detected" -ForegroundColor Yellow
    Write-Host "   The Trust Overlay requires ATAK-Civ to be installed" -ForegroundColor Gray
}

# ============================================================================
# CHECK 7: Android Keystore Availability
# ============================================================================
Write-Host "[7/7] Hardware security features..." -ForegroundColor Yellow
$hasStrongBox = adb shell pm list features | Select-String "android.hardware.strongbox_keystore"
$hasKeystore = adb shell pm list features | Select-String "android.hardware.keystore"

if ($hasStrongBox) {
    Write-Host "   ✅ StrongBox Keystore available (hardware-backed)" -ForegroundColor Green
} elseif ($hasKeystore) {
    Write-Host "   ✅ Android Keystore available (TEE-backed)" -ForegroundColor Green
} else {
    Write-Host "   ⚠️  Hardware keystore not detected" -ForegroundColor Yellow
}

# ============================================================================
# LIVE LOG MONITORING
# ============================================================================
Write-Host ""
Write-Host "═══════════════════════════════════════════════════════════════" -ForegroundColor Cyan

if ($Continuous) {
    Write-Host "Starting continuous log monitoring (Ctrl+C to stop)..." -ForegroundColor Yellow
    Write-Host "═══════════════════════════════════════════════════════════════" -ForegroundColor Cyan
    Write-Host ""

    if ($ShowAllLogs) {
        adb logcat -s "TrustOverlay:*" "AetherCore:*" "RalphieNode:*" "AndroidRuntime:E"
    } else {
        adb logcat -s "TrustOverlay:V" "AetherCore:V"
    }
} else {
    Write-Host "Checking recent logs (last 50 lines)..." -ForegroundColor Yellow
    Write-Host "═══════════════════════════════════════════════════════════════" -ForegroundColor Cyan

    $logFilter = if ($ShowAllLogs) {
        "TrustOverlay:*|AetherCore:*|RalphieNode:*|AndroidRuntime:E"
    } else {
        "TrustOverlay:V|AetherCore:V"
    }

    adb logcat -d -s $logFilter | Select-Object -Last 50

    Write-Host ""
    Write-Host "═══════════════════════════════════════════════════════════════" -ForegroundColor Cyan
    Write-Host ""
    Write-Host "✅ Verification complete!" -ForegroundColor Green
    Write-Host ""
    Write-Host "To monitor logs continuously, run:" -ForegroundColor Yellow
    Write-Host "   .\verify-deployment.ps1 -Continuous" -ForegroundColor Cyan
    Write-Host ""
    Write-Host "To see all logs (including errors), run:" -ForegroundColor Yellow
    Write-Host "   .\verify-deployment.ps1 -Continuous -ShowAllLogs" -ForegroundColor Cyan
    Write-Host ""
    Write-Host "Next step: Launch ATAK-Civ on the device to activate the plugin" -ForegroundColor White
}

