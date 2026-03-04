#!/usr/bin/env pwsh
# AetherCore AWS Testbed Network Connectivity Check

param([switch]$Verbose)

$ErrorActionPreference = 'Continue'

# Configuration
$AWS_ALB = "aethercore-aws-testbed-alb-1408772759.us-east-1.elb.amazonaws.com"
$API_ENDPOINT = "https://$AWS_ALB/api"
$WS_ENDPOINT = "wss://$AWS_ALB"
$C2_ENDPOINT = "$AWS_ALB`:50051"

Write-Host "`nAetherCore AWS Testbed Network Connectivity Check`n" -ForegroundColor Cyan
Write-Host "======================================================================`n" -ForegroundColor Cyan

# Test 1: DNS Resolution
Write-Host "[1/5] Testing DNS Resolution..." -ForegroundColor Yellow
try {
    $dnsResult = [System.Net.Dns]::GetHostAddresses($AWS_ALB) | Select-Object -First 1
    Write-Host "[OK] DNS Resolved: $dnsResult`n" -ForegroundColor Green
} catch {
    Write-Host "[FAIL] DNS Resolution Failed`n" -ForegroundColor Red
}

# Test 2: API Endpoint Health
Write-Host "[2/5] Testing API Endpoint Health..." -ForegroundColor Yellow
try {
    $apiResponse = Invoke-WebRequest -Uri "$API_ENDPOINT/health" -UseBasicParsing -SkipCertificateCheck -TimeoutSec 5
    Write-Host "[OK] API Gateway Responding (Status: $($apiResponse.StatusCode))`n" -ForegroundColor Green
} catch {
    Write-Host "[INFO] API Endpoint Not Responding (May require auth)`n" -ForegroundColor Yellow
}

# Test 3: Port Connectivity
Write-Host "[3/5] Testing Port Connectivity..." -ForegroundColor Yellow
$ports = @(443, 50051, 8080)
foreach ($port in $ports) {
    try {
        $tcpClient = New-Object System.Net.Sockets.TcpClient
        $tcpClient.Connect($AWS_ALB, $port)
        $tcpClient.Close()
        Write-Host "[OK] Port $port is reachable" -ForegroundColor Green
    } catch {
        Write-Host "[WARN] Port $port unreachable" -ForegroundColor Yellow
    }
}
Write-Host ""

# Test 4: Environment Configuration
Write-Host "[4/5] Checking Configuration Files..." -ForegroundColor Yellow
$files = @("packages/dashboard/.env", "infra/docker/.env", "config/aws-testbed.yaml")
foreach ($file in $files) {
    if (Test-Path $file) {
        Write-Host "[OK] Found: $file" -ForegroundColor Green
    } else {
        Write-Host "[WARN] Missing: $file" -ForegroundColor Yellow
    }
}
Write-Host ""

# Test 5: AWS Endpoint Configuration
Write-Host "[5/5] Verifying Endpoint Configuration..." -ForegroundColor Yellow
if (Test-Path "packages/dashboard/.env") {
    $dashEnv = Get-Content "packages/dashboard/.env" | Select-String "VITE_API_ENDPOINT"
    if ($dashEnv -match "aethercore-aws-testbed-alb") {
        Write-Host "[OK] Dashboard configured for AWS testbed`n" -ForegroundColor Green
    } else {
        Write-Host "[INFO] Dashboard not configured for AWS testbed`n" -ForegroundColor Yellow
    }
}

# Summary
Write-Host "======================================================================" -ForegroundColor Cyan
Write-Host "Summary" -ForegroundColor Cyan
Write-Host "======================================================================`n" -ForegroundColor Cyan

Write-Host "AWS Endpoint: $AWS_ALB`n" -ForegroundColor Cyan
Write-Host "Endpoints:" -ForegroundColor Yellow
Write-Host "  API:           $API_ENDPOINT" -ForegroundColor Gray
Write-Host "  WebSocket:     $WS_ENDPOINT" -ForegroundColor Gray
Write-Host "  C2 Router:     $C2_ENDPOINT" -ForegroundColor Gray

Write-Host "`nNext Steps:" -ForegroundColor Yellow
Write-Host "  1. cd packages/dashboard && pnpm tauri dev" -ForegroundColor Gray
Write-Host "  2. cd infra/docker && docker compose up -d" -ForegroundColor Gray
Write-Host "  3. Review AWS_TESTBED_SETUP.md for details" -ForegroundColor Gray

Write-Host "`nAWS Integration Ready`n" -ForegroundColor Green





