#!/usr/bin/env pwsh
# AetherCore Ecosystem Status Check
# Run this to verify the full deployment

$ErrorActionPreference = "Continue"

Write-Host "`n╔═══════════════════════════════════════════════════════════╗" -ForegroundColor Cyan
Write-Host "║                                                           ║" -ForegroundColor Cyan
Write-Host "║   🔍 AETHERCORE ECOSYSTEM STATUS CHECK 🔍                ║" -ForegroundColor Cyan
Write-Host "║                                                           ║" -ForegroundColor Cyan
Write-Host "╚═══════════════════════════════════════════════════════════╝`n" -ForegroundColor Cyan

# Check 1: Docker Services
Write-Host "[1/6] Checking Backend Services (Docker)..." -ForegroundColor Yellow
cd C:\Users\Owner\StudioProjects\AetherCore\infra\docker
$services = docker compose ps --format json 2>$null | ConvertFrom-Json
if ($services) {
    $healthy = ($services | Where-Object { $_.Health -eq "healthy" }).Count
    $total = $services.Count
    Write-Host "   ✅ $healthy/$total services healthy" -ForegroundColor Green
    $services | ForEach-Object {
        $status = if ($_.Health -eq "healthy") { "✅" } else { "⚠️" }
        Write-Host "      $status $($_.Service) - $($_.Status)" -ForegroundColor Gray
    }
} else {
    Write-Host "   ❌ Docker services not running" -ForegroundColor Red
}

# Check 2: Desktop IP
Write-Host "`n[2/6] Checking Desktop Network..." -ForegroundColor Yellow
$desktopIP = (Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.IPAddress -match '^10\.' -or $_.IPAddress -match '^192\.168\.' } | Select-Object -First 1).IPAddress
if ($desktopIP) {
    Write-Host "   ✅ Desktop IP: $desktopIP" -ForegroundColor Green
} else {
    Write-Host "   ⚠️  Could not detect desktop IP" -ForegroundColor Yellow
}

# Check 3: ATAK Device
Write-Host "`n[3/6] Checking ATAK Device Connection..." -ForegroundColor Yellow
$env:PATH += ";C:\Users\Owner\AppData\Local\Android\Sdk\platform-tools"
$device = adb devices -l 2>$null | Select-String "device product"
if ($device) {
    Write-Host "   ✅ Device connected: $($device.ToString().Split()[0])" -ForegroundColor Green

    # Check device IP
    $deviceIP = adb shell "ip addr show wlan0 2>/dev/null | grep 'inet '" 2>$null | ForEach-Object {
        if ($_ -match 'inet\s+(\d+\.\d+\.\d+\.\d+)') { $matches[1] }
    }
    if ($deviceIP) {
        Write-Host "   ✅ Device IP: $deviceIP" -ForegroundColor Green
    }
} else {
    Write-Host "   ❌ No device connected" -ForegroundColor Red
}

# Check 4: Trust Monitor App
Write-Host "`n[4/6] Checking Trust Monitor App..." -ForegroundColor Yellow
$app = adb shell pm list packages 2>$null | Select-String "com.aethercore.atak.trustoverlay"
if ($app) {
    Write-Host "   ✅ Trust Monitor installed" -ForegroundColor Green
    $running = adb shell "ps -A | grep aethercore" 2>$null
    if ($running) {
        Write-Host "   ✅ App is running" -ForegroundColor Green
    } else {
        Write-Host "   ⚠️  App installed but not running" -ForegroundColor Yellow
    }
} else {
    Write-Host "   ❌ Trust Monitor not installed" -ForegroundColor Red
}

# Check 5: Configuration
Write-Host "`n[5/6] Checking Device Configuration..." -ForegroundColor Yellow
$config = adb shell "test -f /sdcard/aethercore-config.json && echo exists" 2>$null
if ($config -match "exists") {
    Write-Host "   ✅ Configuration file present on device" -ForegroundColor Green
} else {
    Write-Host "   ⚠️  Configuration file not found" -ForegroundColor Yellow
}

# Check 6: Tactical Glass
Write-Host "`n[6/6] Checking Tactical Glass Dashboard..." -ForegroundColor Yellow
$tauriProcess = Get-Process -Name "aethercore*" -ErrorAction SilentlyContinue
if ($tauriProcess) {
    Write-Host "   ✅ Tactical Glass is running" -ForegroundColor Green
} else {
    Write-Host "   ⚠️  Tactical Glass not detected (may be starting)" -ForegroundColor Yellow
    Write-Host "      Start with: cd packages/dashboard; `$env:SKIP_TOOLCHAIN_CHECK='1'; pnpm run tauri:dev" -ForegroundColor Gray
}

# Summary
Write-Host "`n" -NoNewline
Write-Host "═══════════════════════════════════════════════════════════" -ForegroundColor Cyan
Write-Host "SUMMARY" -ForegroundColor Cyan
Write-Host "═══════════════════════════════════════════════════════════" -ForegroundColor Cyan

if ($services -and $device -and $app) {
    Write-Host "✅ Core components operational" -ForegroundColor Green
    Write-Host "`nNext steps:" -ForegroundColor Yellow
    Write-Host "1. Open 'AetherCore Trust Monitor' on your Pixel 9 Pro XL" -ForegroundColor White
    Write-Host "2. Check the Tactical Glass window on your desktop" -ForegroundColor White
    Write-Host "3. Verify connectivity in both interfaces" -ForegroundColor White
} else {
    Write-Host "⚠️  Some components need attention" -ForegroundColor Yellow
    Write-Host "`nRefer to: FULL_ECOSYSTEM_DEPLOYMENT.md for troubleshooting" -ForegroundColor Gray
}

Write-Host ""

