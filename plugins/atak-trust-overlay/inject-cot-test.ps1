#!/usr/bin/env pwsh
# AetherCore Tactical Glass - CoT Injection Test Script
# Injects verified and spoofed CoT messages to validate Fail-Visible visualization

param(
    [switch]$VerifiedOnly,
    [switch]$SpoofedOnly
)

Write-Host "=== AetherCore CoT Injection Test ===" -ForegroundColor Cyan
Write-Host "Mission: Validate Fail-Visible Aetheric Sweep visualization" -ForegroundColor Cyan
Write-Host ""

# Check ADB connectivity
Write-Host "[1/5] Checking ADB connectivity..." -ForegroundColor Yellow
try {
    $devices = adb devices | Select-String "device$"
    if ($devices.Count -eq 0) {
        throw "No Android devices connected"
    }
    Write-Host "✓ Device connected" -ForegroundColor Green
} catch {
    Write-Host "✗ ADB error: $_" -ForegroundColor Red
    exit 1
}

# Verified CoT Payload (Green Trust)
$verifiedCot = @'
<?xml version="1.0" encoding="UTF-8"?>
<event version="2.0" uid="AETHERCORE-VERIFIED-001" type="a-f-G-E-S" how="m-g" time="2026-02-19T23:45:00.000Z" start="2026-02-19T23:45:00.000Z" stale="2026-02-20T00:45:00.000Z">
  <point lat="38.889931" lon="-77.009003" hae="25.0" ce="10.0" le="15.0"/>
  <detail>
    <contact callsign="BLUE-ACTUAL"/>
    <aethercore trustLevel="Green" trustScore="0.95" genesisHash="abc123def456789" merkleVineDepth="42" lastVerifiedEpoch="1708388700" hardwareFingerprint="TPM-ATTESTED"/>
    <__group name="Blue Force" role="Team Lead"/>
  </detail>
</event>
'@

# Spoofed CoT Payload (Red Trust - Byzantine Violation)
$spoofedCot = @'
<?xml version="1.0" encoding="UTF-8"?>
<event version="2.0" uid="AETHERCORE-SPOOFED-666" type="a-h-G" how="m-g" time="2026-02-19T23:45:05.000Z" start="2026-02-19T23:45:05.000Z" stale="2026-02-20T00:45:05.000Z">
  <point lat="38.891234" lon="-77.010567" hae="25.0" ce="50.0" le="50.0"/>
  <detail>
    <contact callsign="UNKNOWN-HOSTILE"/>
    <aethercore trustLevel="Red" trustScore="0.05" spoofReason="INVALID_SIGNATURE" byzantineViolation="BROKEN_HASH_CHAIN" revokedBy="THE_GREAT_GOSPEL"/>
    <__group name="Unknown" role="Hostile"/>
  </detail>
</event>
'@

# Temporary files
$tempDir = [System.IO.Path]::GetTempPath()
$verifiedFile = Join-Path $tempDir "aethercore_verified.xml"
$spoofedFile = Join-Path $tempDir "aethercore_spoofed.xml"

Write-Host "[2/5] Writing CoT payloads to temp files..." -ForegroundColor Yellow
$verifiedCot | Out-File -FilePath $verifiedFile -Encoding UTF8 -NoNewline
$spoofedCot | Out-File -FilePath $spoofedFile -Encoding UTF8 -NoNewline
Write-Host "✓ Payloads written" -ForegroundColor Green

Write-Host "[3/5] Pushing CoT files to device..." -ForegroundColor Yellow
adb shell "mkdir -p /sdcard/atak/tools/cotdispatch" 2>$null
adb push $verifiedFile /sdcard/atak/tools/cotdispatch/verified.xml | Out-Null
adb push $spoofedFile /sdcard/atak/tools/cotdispatch/spoofed.xml | Out-Null
Write-Host "✓ Files pushed to device" -ForegroundColor Green

Write-Host "[4/5] Injecting CoT via ATAK broadcast..." -ForegroundColor Yellow

if (-not $SpoofedOnly) {
    Write-Host "  → Injecting VERIFIED track (BLUE-ACTUAL)..." -ForegroundColor Cyan
    adb shell "am broadcast -a com.atakmap.android.maps.COT_RECEIVED -n com.atakmap.app.civ/.CoTBroadcastReceiver --es cotXml `"`$(cat /sdcard/atak/tools/cotdispatch/verified.xml)`"" 2>$null
    Write-Host "    ✓ Green shield marker should appear on map" -ForegroundColor Green
    Start-Sleep -Seconds 2
}

if (-not $VerifiedOnly) {
    Write-Host "  → Injecting SPOOFED track (UNKNOWN-HOSTILE)..." -ForegroundColor Cyan
    adb shell "am broadcast -a com.atakmap.android.maps.COT_RECEIVED -n com.atakmap.app.civ/.CoTBroadcastReceiver --es cotXml `"`$(cat /sdcard/atak/tools/cotdispatch/spoofed.xml)`"" 2>$null
    Write-Host "    ✓ Red ghosted marker should appear on map" -ForegroundColor Red
}

Write-Host "[5/5] Monitoring AetherCore plugin logs..." -ForegroundColor Yellow
Write-Host ""
Write-Host "Press Ctrl+C to stop log monitoring" -ForegroundColor Gray
Write-Host "================================" -ForegroundColor Gray

# Monitor logs for trust processing
adb logcat -s "RalphieNodeDaemon:*" "TrustMarkerRenderer:*" "TrustCoTSubscriber:*" "AetherCore:*"

# Cleanup
Remove-Item $verifiedFile -ErrorAction SilentlyContinue
Remove-Item $spoofedFile -ErrorAction SilentlyContinue

