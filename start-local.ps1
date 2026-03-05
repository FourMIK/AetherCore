# AetherCore Local Setup Script (TPM Disabled)
# This script sets up and runs AetherCore locally with TPM disabled

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "AetherCore Local Setup (TPM Disabled)" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# Check for required tools
Write-Host "Checking prerequisites..." -ForegroundColor Yellow

# Check Docker
if (!(Get-Command docker -ErrorAction SilentlyContinue)) {
    Write-Host "ERROR: Docker is not installed or not in PATH" -ForegroundColor Red
    Write-Host "Please install Docker Desktop from https://www.docker.com/products/docker-desktop" -ForegroundColor Red
    exit 1
}

# Check Docker Compose
if (!(docker compose version 2>$null)) {
    Write-Host "ERROR: Docker Compose is not available" -ForegroundColor Red
    Write-Host "Please install Docker Desktop which includes Docker Compose" -ForegroundColor Red
    exit 1
}

# Check Node.js
if (!(Get-Command node -ErrorAction SilentlyContinue)) {
    Write-Host "ERROR: Node.js is not installed or not in PATH" -ForegroundColor Red
    Write-Host "Please install Node.js 22.x from https://nodejs.org/" -ForegroundColor Red
    exit 1
}

# Check pnpm
if (!(Get-Command pnpm -ErrorAction SilentlyContinue)) {
    Write-Host "ERROR: pnpm is not installed or not in PATH" -ForegroundColor Red
    Write-Host "Please install pnpm: npm install -g pnpm" -ForegroundColor Red
    exit 1
}

Write-Host "✓ All prerequisites found" -ForegroundColor Green
Write-Host ""

# Navigate to infra/docker directory
Push-Location infra/docker

Write-Host "Starting Docker services..." -ForegroundColor Yellow
Write-Host "This may take a few minutes on first run as images are built..." -ForegroundColor Gray
Write-Host ""

# Start Docker Compose services
docker compose up -d

if ($LASTEXITCODE -ne 0) {
    Write-Host "ERROR: Failed to start Docker services" -ForegroundColor Red
    Pop-Location
    exit 1
}

Write-Host ""
Write-Host "✓ Docker services started successfully" -ForegroundColor Green
Write-Host ""

# Wait for services to be healthy
Write-Host "Waiting for services to be healthy..." -ForegroundColor Yellow
$maxWait = 60
$waited = 0
while ($waited -lt $maxWait) {
    $healthy = docker compose ps --format json | ConvertFrom-Json | Where-Object { $_.Health -eq "healthy" } | Measure-Object | Select-Object -ExpandProperty Count
    $total = docker compose ps --format json | ConvertFrom-Json | Measure-Object | Select-Object -ExpandProperty Count
    
    if ($healthy -eq $total) {
        Write-Host "✓ All services are healthy" -ForegroundColor Green
        break
    }
    
    Write-Host "Waiting... ($waited/$maxWait seconds)" -ForegroundColor Gray
    Start-Sleep -Seconds 5
    $waited += 5
}

Pop-Location

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Services Status" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan

# Display service URLs
Write-Host ""
Write-Host "Backend Services:" -ForegroundColor Yellow
Write-Host "  • C2 Router:       grpc://localhost:50051" -ForegroundColor White
Write-Host "  • PostgreSQL:      localhost:5432" -ForegroundColor White
Write-Host "  • Redis:           localhost:6379" -ForegroundColor White
Write-Host "  • Gateway:         http://localhost:3000" -ForegroundColor White
Write-Host "  • Auth:            http://localhost:3001" -ForegroundColor White
Write-Host "  • Collaboration:   http://localhost:8080" -ForegroundColor White
Write-Host ""
Write-Host "TPM Status:        DISABLED (Software mode)" -ForegroundColor Magenta
Write-Host ""

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Next Steps" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "Option 1: Run Dashboard (Tauri Desktop App)" -ForegroundColor Yellow
Write-Host "  cd packages/dashboard" -ForegroundColor White
Write-Host "  pnpm install" -ForegroundColor White
Write-Host "  pnpm tauri dev" -ForegroundColor White
Write-Host ""
Write-Host "Option 2: Run Dashboard (Web Dev Server)" -ForegroundColor Yellow
Write-Host "  cd packages/dashboard" -ForegroundColor White
Write-Host "  pnpm install" -ForegroundColor White
Write-Host "  pnpm dev" -ForegroundColor White
Write-Host ""
Write-Host "View Logs:" -ForegroundColor Yellow
Write-Host "  cd infra/docker" -ForegroundColor White
Write-Host "  docker compose logs -f" -ForegroundColor White
Write-Host ""
Write-Host "Stop Services:" -ForegroundColor Yellow
Write-Host "  cd infra/docker" -ForegroundColor White
Write-Host "  docker compose down" -ForegroundColor White
Write-Host ""
Write-Host "For more information, see docs/TPM_CONFIGURATION.md" -ForegroundColor Gray
Write-Host ""
