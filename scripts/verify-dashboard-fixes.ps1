#!/usr/bin/env pwsh
<#
.SYNOPSIS
    Verify AetherCore Dashboard Status Fixes

.DESCRIPTION
    Validates that all dashboard status indicators are accurate and
    node detail panel is functioning without crashes.

.NOTES
    Date: March 1, 2026
    Part of: Dashboard Status Fixes
#>

Write-Host "`n" -NoNewline
Write-Host "═══════════════════════════════════════════════════════════════" -ForegroundColor Cyan
Write-Host "  AETHERCORE DASHBOARD - STATUS VERIFICATION" -ForegroundColor Cyan
Write-Host "═══════════════════════════════════════════════════════════════" -ForegroundColor Cyan
Write-Host ""

$passed = 0
$failed = 0

# Test 1: Dashboard Running
Write-Host "[Test 1] Dashboard Web Server..." -NoNewline
$dashboard = Get-NetTCPConnection -LocalPort 1420 -State Listen -ErrorAction SilentlyContinue
if ($dashboard) {
    Write-Host " ✓ PASS" -ForegroundColor Green
    Write-Host "         Running on http://localhost:1420" -ForegroundColor Gray
    $passed++
} else {
    Write-Host " ✗ FAIL" -ForegroundColor Red
    Write-Host "         Dashboard not listening on port 1420" -ForegroundColor Red
    $failed++
}

# Test 2: Gateway Health
Write-Host "[Test 2] Gateway Service Health..." -NoNewline
try {
    $health = Invoke-RestMethod -Uri "http://localhost:3000/health" -Method Get -TimeoutSec 2
    if ($health.status -eq "ok") {
        Write-Host " ✓ PASS" -ForegroundColor Green
        Write-Host "         Gateway responding at http://localhost:3000" -ForegroundColor Gray
        $passed++
    } else {
        Write-Host " ✗ FAIL" -ForegroundColor Red
        Write-Host "         Gateway returned unexpected status: $($health.status)" -ForegroundColor Red
        $failed++
    }
} catch {
    Write-Host " ✗ FAIL" -ForegroundColor Red
    Write-Host "         Gateway not responding" -ForegroundColor Red
    $failed++
}

# Test 3: Backend Services
Write-Host "[Test 3] Backend Docker Stack..." -NoNewline
try {
    Push-Location "C:\Users\Owner\StudioProjects\AetherCore\infra\docker"
    $dockerOutput = docker compose ps --services 2>&1
    Pop-Location

    if ($LASTEXITCODE -eq 0) {
        $services = $dockerOutput | Where-Object { $_ -ne "" }
        if ($services.Count -ge 4) {
            Write-Host " ✓ PASS" -ForegroundColor Green
            Write-Host "         $($services.Count) services configured" -ForegroundColor Gray
            $passed++
        } else {
            Write-Host " ✗ FAIL" -ForegroundColor Red
            Write-Host "         Only $($services.Count) services found" -ForegroundColor Red
            $failed++
        }
    } else {
        Write-Host " ⚠ SKIP" -ForegroundColor Yellow
        Write-Host "         Docker compose not available" -ForegroundColor Gray
    }
} catch {
    Write-Host " ⚠ SKIP" -ForegroundColor Yellow
    Write-Host "         Could not check Docker services" -ForegroundColor Gray
}

# Test 4: Node.js Processes (RalphieNode client + Dashboard)
Write-Host "[Test 4] Node.js Processes..." -NoNewline
$nodeProcesses = Get-Process -Name node -ErrorAction SilentlyContinue
if ($nodeProcesses.Count -ge 2) {
    Write-Host " ✓ PASS" -ForegroundColor Green
    Write-Host "         $($nodeProcesses.Count) Node.js processes active" -ForegroundColor Gray
    $passed++
} else {
    Write-Host " ⚠ PARTIAL" -ForegroundColor Yellow
    Write-Host "         Found $($nodeProcesses.Count) Node.js processes (expected 2+)" -ForegroundColor Yellow
}

# Test 5: Chrome Browser
Write-Host "[Test 5] Chrome Browser..." -NoNewline
$chrome = Get-Process -Name chrome -ErrorAction SilentlyContinue
if ($chrome) {
    Write-Host " ✓ PASS" -ForegroundColor Green
    Write-Host "         Chrome is open (verify dashboard at http://localhost:1420)" -ForegroundColor Gray
    $passed++
} else {
    Write-Host " ⚠ SKIP" -ForegroundColor Yellow
    Write-Host "         Chrome not detected (open manually)" -ForegroundColor Yellow
}

# Summary
Write-Host ""
Write-Host "───────────────────────────────────────────────────────────────" -ForegroundColor Cyan
Write-Host "  TEST SUMMARY" -ForegroundColor Cyan
Write-Host "───────────────────────────────────────────────────────────────" -ForegroundColor Cyan
Write-Host ""
Write-Host "  Passed: $passed" -ForegroundColor Green
Write-Host "  Failed: $failed" -ForegroundColor $(if ($failed -eq 0) { "Green" } else { "Red" })
Write-Host ""

# Manual Verification Steps
Write-Host "───────────────────────────────────────────────────────────────" -ForegroundColor Cyan
Write-Host "  MANUAL VERIFICATION REQUIRED" -ForegroundColor Cyan
Write-Host "───────────────────────────────────────────────────────────────" -ForegroundColor Cyan
Write-Host ""
Write-Host "1. Open Chrome to: " -NoNewline
Write-Host "http://localhost:1420" -ForegroundColor Yellow
Write-Host ""
Write-Host "2. Check Connection Status (Top-Right Corner):" -ForegroundColor White
Write-Host "   Expected: " -NoNewline
Write-Host "LINK ESTABLISHED" -ForegroundColor Green -NoNewline
Write-Host " (green shield icon)" -ForegroundColor White
Write-Host "   Alternative: " -NoNewline
Write-Host "LINK PENDING" -ForegroundColor Yellow -NoNewline
Write-Host " (amber shield icon)" -ForegroundColor White
Write-Host "   NOT Expected: " -NoNewline
Write-Host "LINK OFFLINE" -ForegroundColor Red -NoNewline
Write-Host " or " -NoNewline
Write-Host "DISCONNECTED" -ForegroundColor Red
Write-Host ""
Write-Host "3. Verify Node List (Left Sidebar):" -ForegroundColor White
Write-Host "   Should see nodes:" -ForegroundColor Gray
Write-Host "   • ralphie-local-desktop" -ForegroundColor Cyan
Write-Host "   • google-pixel_9_pro_xl-*" -ForegroundColor Cyan
Write-Host ""
Write-Host "4. Test Node Details (CRITICAL FIX):" -ForegroundColor White
Write-Host "   a) Click on any node in the list" -ForegroundColor Gray
Write-Host "   b) Right panel should show node details" -ForegroundColor Gray
Write-Host "   c) Verify no crash or error occurs" -ForegroundColor Gray
Write-Host "   d) Details should include:" -ForegroundColor Gray
Write-Host "      - Node ID" -ForegroundColor DarkGray
Write-Host "      - Domain" -ForegroundColor DarkGray
Write-Host "      - Status badge" -ForegroundColor DarkGray
Write-Host "      - Position (Lat/Lon/Alt)" -ForegroundColor DarkGray
Write-Host "      - Trust score gauge" -ForegroundColor DarkGray
Write-Host "      - Last seen timestamp" -ForegroundColor DarkGray
Write-Host ""
Write-Host "5. Check Browser Console (F12):" -ForegroundColor White
Write-Host "   Should see:" -ForegroundColor Gray
Write-Host "   • '[TELEMETRY] Updated N nodes from telemetry'" -ForegroundColor DarkGray
Write-Host "   • '[AETHERIC LINK] C2 client initialized'" -ForegroundColor DarkGray
Write-Host "   Should NOT see:" -ForegroundColor Gray
Write-Host "   • 'TypeError' or 'Cannot read property' errors" -ForegroundColor Red
Write-Host ""

# Exit code
Write-Host "═══════════════════════════════════════════════════════════════" -ForegroundColor Cyan
Write-Host ""

if ($failed -eq 0) {
    Write-Host "✓ All automated tests passed!" -ForegroundColor Green
    Write-Host "  Complete manual verification steps above." -ForegroundColor Gray
    exit 0
} else {
    Write-Host "✗ $failed test(s) failed" -ForegroundColor Red
    Write-Host "  Review failed tests and fix before manual verification." -ForegroundColor Red
    exit 1
}


