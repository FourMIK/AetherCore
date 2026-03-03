# AetherCore Dashboard & Telemetry Status Check

Write-Host "`n╔═══════════════════════════════════════════════════════════╗" -ForegroundColor Cyan
Write-Host "║  🎯 AETHERCORE DASHBOARD & TELEMETRY STATUS 🎯            ║" -ForegroundColor Cyan
Write-Host "╚═══════════════════════════════════════════════════════════╝`n" -ForegroundColor Cyan

$env:PATH += ";C:\Users\Owner\AppData\Local\Android\Sdk\platform-tools"

# Check 1: Dashboard running in browser
Write-Host "[1/5] Checking Dashboard (Chrome)..." -ForegroundColor Yellow
$chromeProcess = Get-Process -Name "chrome" -ErrorAction SilentlyContinue
if ($chromeProcess) {
    Write-Host "   ✅ Chrome is running (Dashboard should be at http://localhost:5173)" -ForegroundColor Green
} else {
    Write-Host "   ⚠️  Chrome not detected" -ForegroundColor Yellow
}

# Check 2: Backend services
Write-Host "`n[2/5] Checking Backend Services..." -ForegroundColor Yellow
cd C:\Users\Owner\StudioProjects\AetherCore\infra\docker
$services = docker compose ps --format json 2>$null | ConvertFrom-Json
if ($services) {
    $healthy = ($services | Where-Object { $_.Health -eq "healthy" }).Count
    Write-Host "   ✅ $healthy/$($services.Count) services healthy" -ForegroundColor Green
} else {
    Write-Host "   ❌ Services not running" -ForegroundColor Red
}

# Check 3: Device connection
Write-Host "`n[3/5] Checking ATAK Device..." -ForegroundColor Yellow
$device = adb devices -l 2>$null | Select-String "device product"
if ($device) {
    Write-Host "   ✅ Device connected" -ForegroundColor Green

    # Check if app is running
    $appRunning = adb shell "ps -A | grep aethercore" 2>$null
    if ($appRunning) {
        Write-Host "   ✅ Trust Monitor running on device" -ForegroundColor Green
    } else {
        Write-Host "   ⚠️  Trust Monitor not running - launch it on device" -ForegroundColor Yellow
    }
} else {
    Write-Host "   ❌ No device connected" -ForegroundColor Red
}

# Check 4: Gateway telemetry endpoint
Write-Host "`n[4/5] Testing Gateway Telemetry Endpoint..." -ForegroundColor Yellow
try {
    $response = Invoke-WebRequest -Uri "http://localhost:3000/health" -TimeoutSec 2
    if ($response.StatusCode -eq 200) {
        Write-Host "   ✅ Gateway responding (HTTP 200)" -ForegroundColor Green
    }
} catch {
    Write-Host "   ❌ Gateway not accessible" -ForegroundColor Red
}

# Check 5: Recent telemetry
Write-Host "`n[5/5] Checking for Telemetry Data..." -ForegroundColor Yellow
$telemetryLogs = docker compose logs gateway --tail 50 2>$null | Select-String -Pattern "Telemetry received|node_id"
if ($telemetryLogs) {
    $count = ($telemetryLogs | Measure-Object).Count
    Write-Host "   ✅ Found $count telemetry log entries" -ForegroundColor Green
    Write-Host "`n   Recent telemetry:" -ForegroundColor Cyan
    $telemetryLogs | Select-Object -Last 3 | ForEach-Object {
        Write-Host "      $_" -ForegroundColor Gray
    }
} else {
    Write-Host "   ⚠️  No telemetry logs yet (device may still be connecting)" -ForegroundColor Yellow
    Write-Host "      Wait 10-15 seconds and run this script again" -ForegroundColor Gray
}

# Summary
Write-Host "`n═══════════════════════════════════════════════════════════" -ForegroundColor Cyan
Write-Host "NEXT STEPS:" -ForegroundColor Yellow
Write-Host "═══════════════════════════════════════════════════════════" -ForegroundColor Cyan

Write-Host "`n1. Open Chrome: http://localhost:5173 (Tactical Glass dashboard)" -ForegroundColor White

Write-Host "`n2. On Pixel: Open AetherCore Trust Monitor app" -ForegroundColor White

Write-Host "`n3. Monitor telemetry: docker compose logs -f gateway" -ForegroundColor White

Write-Host "`n4. Dashboard should show your device in Nodes section" -ForegroundColor White

Write-Host ""

