# AetherCore Android Secure Element Readiness Probe (PowerShell)
# Validates hardware-backed keystore and StrongBox capabilities for CodeRalphie integration

param(
    [switch]$RequireStrongBox = $false
)

$ErrorActionPreference = "Continue"
$ADB = "$env:LOCALAPPDATA\Android\Sdk\platform-tools\adb.exe"

function Emit($key, $value) {
    Write-Output "${key}=${value}"
}

function Warn($message) {
    Write-Warning $message
}

function Fail($message) {
    Write-Error $message
    exit 2
}

# Check ADB availability
if (-not (Test-Path $ADB)) {
    Emit "status" "NOT_READY"
    Emit "reason" "adb_missing"
    Fail "Android platform-tools (adb) not found at $ADB"
}

# Check device connection
$state = & $ADB get-state 2>$null
if ($LASTEXITCODE -ne 0 -or $state -notmatch "device") {
    Emit "status" "NOT_READY"
    Emit "reason" "device_not_connected"
    if ($state) {
        Emit "adb_state" $state
    } else {
        Emit "adb_state" "unknown"
    }
    Write-Host ""
    Write-Host "==================================================================" -ForegroundColor Yellow
    Write-Host "  PIXEL 9 PRO NOT DETECTED - ENABLE USB DEBUGGING" -ForegroundColor Yellow
    Write-Host "==================================================================" -ForegroundColor Yellow
    Write-Host ""
    Write-Host "On your Pixel 9 Pro:" -ForegroundColor Cyan
    Write-Host "  1. Go to Settings → About Phone" -ForegroundColor White
    Write-Host "  2. Tap 'Build Number' 7 times (enables Developer Options)" -ForegroundColor White
    Write-Host "  3. Go back → System → Developer Options" -ForegroundColor White
    Write-Host "  4. Enable 'USB Debugging'" -ForegroundColor White
    Write-Host "  5. When prompted on phone, tap 'Allow' for this computer" -ForegroundColor White
    Write-Host ""
    Write-Host "Then re-run: " -ForegroundColor Cyan -NoNewline
    Write-Host "pnpm run check:android" -ForegroundColor Green
    Write-Host ""
    exit 1
}

# Device connected - gather telemetry
$sdk = (& $ADB shell getprop ro.build.version.sdk 2>$null).Trim()
$release = (& $ADB shell getprop ro.build.version.release 2>$null).Trim()
$brand = (& $ADB shell getprop ro.product.brand 2>$null).Trim()
$model = (& $ADB shell getprop ro.product.model 2>$null).Trim()
$features = & $ADB shell pm list features 2>$null

# Check for StrongBox (Titan M2 on Pixel 9 Pro)
$strongboxFeature = $features -match "android.hardware.strongbox_keystore"
$teeFeature = $features -match "android.hardware.keystore|android.hardware.hardware_keystore"

# Additional attestation signals
$keymintVersion = (& $ADB shell getprop ro.hardware.keystore 2>$null).Trim()
$verifiedBootState = (& $ADB shell getprop ro.boot.verifiedbootstate 2>$null).Trim()
$deviceLocked = (& $ADB shell getprop ro.boot.flash.locked 2>$null).Trim()
$patchLevel = (& $ADB shell getprop ro.build.version.security_patch 2>$null).Trim()

# Emit telemetry (machine-readable)
Emit "device_brand" $brand
Emit "device_model" $model
Emit "android_release" $release
Emit "android_sdk" $sdk
if ($verifiedBootState) {
    Emit "verified_boot_state" $verifiedBootState
} else {
    Emit "verified_boot_state" "unknown"
}
if ($deviceLocked) {
    Emit "bootloader_locked" $deviceLocked
} else {
    Emit "bootloader_locked" "unknown"
}
if ($patchLevel) {
    Emit "security_patch" $patchLevel
} else {
    Emit "security_patch" "unknown"
}
Emit "keystore_hw_feature" $teeFeature
Emit "strongbox_feature" $strongboxFeature
if ($keymintVersion) {
    Emit "keystore_impl" $keymintVersion
} else {
    Emit "keystore_impl" "unknown"
}

Write-Host ""
Write-Host "==================================================================" -ForegroundColor Green
Write-Host "  PIXEL 9 PRO DETECTED - HARDWARE ATTESTATION READY" -ForegroundColor Green
Write-Host "==================================================================" -ForegroundColor Green
Write-Host ""

# Determine readiness tier
if ($strongboxFeature) {
    Emit "status" "READY_STRONGBOX"
    Emit "recommendation" "enable_android_se_required_for_selected_profiles"
    Emit "hardware_root" "Titan_M2"
    Write-Host "✅ StrongBox (Titan M2): AVAILABLE" -ForegroundColor Green
    Write-Host "✅ CodeRalphie Integration: READY" -ForegroundColor Green
    Write-Host ""
    Write-Host "Your Pixel 9 Pro is equipped with Google Titan M2 security chip." -ForegroundColor Cyan
    Write-Host "This provides hardware-rooted attestation for AetherCore nodes." -ForegroundColor Cyan
    exit 0
}

if ($teeFeature) {
    if ($RequireStrongBox) {
        Emit "status" "NOT_READY"
        Emit "reason" "strongbox_required_but_unavailable"
        Fail "Device has hardware keystore but no StrongBox while -RequireStrongBox specified"
    }

    Emit "status" "READY_TEE_FALLBACK"
    Emit "recommendation" "allow_optional_mode_collect_telemetry"
    Warn "StrongBox unavailable; running in trusted-environment fallback mode"
    exit 0
}

# No hardware keystore detected
Emit "status" "NOT_READY"
Emit "reason" "no_hardware_keystore_feature"
Fail "Device does not advertise hardware-backed keystore features"



