#!/usr/bin/env powershell
# Deploy ATAK Trust Overlay to Running Emulator
# Usage: .\deploy-to-emulator.ps1

param(
    [string]$WaitSeconds = 60
)

$ADB = "C:\Users\Owner\AppData\Local\Android\Sdk\platform-tools\adb.exe"
$JAR = "C:\Users\Owner\source\repos\FourMIK\AetherCore\dist\atak\main.jar"
$REMOTE_PATH = "/sdcard/atak/plugins/main.jar"
$ATAK_PACKAGE = "com.atakmap.app.civ"

Write-Host "═══════════════════════════════════════════" -ForegroundColor Cyan
Write-Host "ATAK Trust Overlay Deployment" -ForegroundColor Cyan
Write-Host "═══════════════════════════════════════════" -ForegroundColor Cyan
Write-Host ""

# Step 1: Wait for device
Write-Host "Step 1: Waiting for device (max $WaitSeconds seconds)..." -ForegroundColor Yellow
$timeout = 0
while ($timeout -lt $WaitSeconds) {
    $devices = & $ADB devices -l 2>$null
    if ($devices -match "device\s+product") {
        Write-Host "✅ Device connected!" -ForegroundColor Green
        break
    }
    Write-Host "." -NoNewline
    Start-Sleep -Seconds 1
    $timeout++
}

if ($timeout -ge $WaitSeconds) {
    Write-Host ""
    Write-Host "❌ Device not found after $WaitSeconds seconds" -ForegroundColor Red
    Write-Host "Please authorize the RSA key on the emulator screen" -ForegroundColor Yellow
    exit 1
}

# Step 2: Wait for boot
Write-Host ""
Write-Host "Step 2: Waiting for device boot to complete..." -ForegroundColor Yellow
$timeout = 0
while ($timeout -lt 60) {
    $boot = & $ADB shell "getprop sys.boot_completed" 2>$null
    if ($boot -match "1") {
        Write-Host "✅ Device fully booted!" -ForegroundColor Green
        break
    }
    Write-Host "." -NoNewline
    Start-Sleep -Seconds 2
    $timeout += 2
}

# Step 3: Create plugin directory
Write-Host ""
Write-Host "Step 3: Creating plugin directory..." -ForegroundColor Yellow
& $ADB shell "mkdir -p /sdcard/atak/plugins"
Write-Host "✅ Directory created" -ForegroundColor Green

# Step 4: Deploy JAR
Write-Host ""
Write-Host "Step 4: Deploying main.jar..." -ForegroundColor Yellow
if (-not (Test-Path $JAR)) {
    Write-Host "❌ JAR not found at $JAR" -ForegroundColor Red
    exit 1
}

& $ADB push $JAR $REMOTE_PATH
if ($LASTEXITCODE -eq 0) {
    Write-Host "✅ JAR deployed successfully" -ForegroundColor Green
} else {
    Write-Host "❌ Deployment failed" -ForegroundColor Red
    exit 1
}

# Step 5: Verify deployment
Write-Host ""
Write-Host "Step 5: Verifying deployment..." -ForegroundColor Yellow
$remoteFile = & $ADB shell "ls -lh $REMOTE_PATH" 2>$null
if ($remoteFile) {
    Write-Host "✅ Plugin verified on device:" -ForegroundColor Green
    Write-Host "   $remoteFile"
} else {
    Write-Host "⚠️ Could not verify file" -ForegroundColor Yellow
}

# Step 6: Reload plugins (optional)
Write-Host ""
Write-Host "Step 6: Reloading ATAK plugins..." -ForegroundColor Yellow
& $ADB shell "am broadcast -a com.atakmap.app.RELOAD_PLUGINS" 2>$null
Write-Host "✅ Plugin reload broadcast sent" -ForegroundColor Green

# Step 7: Check ATAK installed
Write-Host ""
Write-Host "Step 7: Checking for ATAK app..." -ForegroundColor Yellow
$atakInstalled = & $ADB shell "pm list packages" 2>$null | Select-String "atak"
if ($atakInstalled) {
    Write-Host "✅ ATAK is installed" -ForegroundColor Green
    
    # Launch ATAK
    Write-Host ""
    Write-Host "Launching ATAK..." -ForegroundColor Cyan
    & $ADB shell "am start -n com.atakmap.app.civ/com.atakmap.app.MainActivity" 2>$null
    Start-Sleep -Seconds 3
    Write-Host "✅ ATAK launched" -ForegroundColor Green
} else {
    Write-Host "⚠️ ATAK not installed" -ForegroundColor Yellow
    Write-Host ""
    Write-Host "To install ATAK:" -ForegroundColor Yellow
    Write-Host "  1. Download ATAK-Civ APK from TAK.gov" -ForegroundColor Yellow
    Write-Host "  2. Run: adb install -r atak-civ.apk" -ForegroundColor Yellow
}

Write-Host ""
Write-Host "═══════════════════════════════════════════" -ForegroundColor Cyan
Write-Host "✅ Deployment Complete!" -ForegroundColor Green
Write-Host "═══════════════════════════════════════════" -ForegroundColor Cyan
Write-Host ""
Write-Host "Next steps:" -ForegroundColor Cyan
Write-Host "  1. Check emulator screen - ATAK should be starting" -ForegroundColor Cyan
Write-Host "  2. In ATAK: Settings → Plugins" -ForegroundColor Cyan
Write-Host "  3. Look for 'AetherCore Trust Overlay'" -ForegroundColor Cyan
Write-Host "  4. Status should show 'Loaded' ✅" -ForegroundColor Cyan
Write-Host ""
Write-Host "Monitor logs:" -ForegroundColor Cyan
Write-Host "  adb logcat | findstr AetherCore" -ForegroundColor Cyan
Write-Host ""
