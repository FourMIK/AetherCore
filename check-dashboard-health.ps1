# AetherCore Dashboard Health Check Script
# Verifies all services are running and dashboard is connected

Write-Host "`n=== AetherCore Dashboard Health Check ===" -ForegroundColor Cyan
Write-Host "Date: $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')`n" -ForegroundColor Gray

Write-Host "`n--- Backend Services ---" -ForegroundColor Cyan

Write-Host "Testing Gateway API..." -NoNewline
try {
    $gateway = Invoke-WebRequest -Uri "http://localhost:3000/health" -UseBasicParsing -TimeoutSec 5
    if ($gateway.StatusCode -eq 200) {
        Write-Host " [OK]" -ForegroundColor Green
    }
} catch {
    Write-Host " [FAIL]" -ForegroundColor Red
    Write-Host "  Error: $($_.Exception.Message)" -ForegroundColor Yellow
}

Write-Host "Testing Collaboration Service..." -NoNewline
try {
    $collab = Invoke-WebRequest -Uri "http://localhost:8080/health" -UseBasicParsing -TimeoutSec 5
    if ($collab.StatusCode -eq 200) {
        Write-Host " [OK]" -ForegroundColor Green
    }
} catch {
    Write-Host " [FAIL]" -ForegroundColor Red
    Write-Host "  Error: $($_.Exception.Message)" -ForegroundColor Yellow
}

Write-Host "`n--- Port Status ---" -ForegroundColor Cyan

$ports = @{
    "Vite Dev Server" = 1420
    "Gateway" = 3000
    "Collaboration" = 8080
}

foreach ($name in $ports.Keys) {
    $port = $ports[$name]
    $listening = netstat -ano | Select-String -Pattern ":$port " -Quiet
    if ($listening) {
        Write-Host "[OK] $name listening on port $port" -ForegroundColor Green
    } else {
        Write-Host "[FAIL] $name NOT listening on port $port" -ForegroundColor Red
    }
}

Write-Host "`n--- Dashboard Status ---" -ForegroundColor Cyan

$chromeProcess = Get-Process chrome -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowTitle -like "*AetherCore*" }
if ($chromeProcess) {
    Write-Host "[OK] Dashboard running in Chrome" -ForegroundColor Green
    Write-Host "  Window: $($chromeProcess.MainWindowTitle)" -ForegroundColor Gray
} else {
    Write-Host "[WARN] Dashboard not detected in Chrome" -ForegroundColor Yellow
}

Write-Host "`n--- Summary ---" -ForegroundColor Cyan
Write-Host "`nDashboard URL: http://localhost:1420" -ForegroundColor Cyan
Write-Host "Gateway API: http://localhost:3000" -ForegroundColor Cyan
Write-Host "Collaboration: http://localhost:8080" -ForegroundColor Cyan

Write-Host "`n=================================`n" -ForegroundColor Cyan

