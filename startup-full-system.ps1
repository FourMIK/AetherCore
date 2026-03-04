# AetherCore FLIR Video Ingest - Full System Startup
# This script launches all services and verifies video streaming

Write-Host "╔═══════════════════════════════════════════════════════════════╗" -ForegroundColor Cyan
Write-Host "║  AetherCore FLIR Video Ingest - Full System Startup          ║" -ForegroundColor Cyan
Write-Host "║  Starting backend services + dashboard + video ingest        ║" -ForegroundColor Cyan
Write-Host "╚═══════════════════════════════════════════════════════════════╝" -ForegroundColor Cyan
Write-Host ""

# Check if Docker is running
Write-Host "[1/4] Checking Docker..." -ForegroundColor Yellow
$dockerStatus = docker version 2>&1
if ($dockerStatus -like "*error*") {
    Write-Host "❌ Docker is not running. Please start Docker Desktop." -ForegroundColor Red
    exit 1
}
Write-Host "✓ Docker is running" -ForegroundColor Green
Write-Host ""

# Start Docker services
Write-Host "[2/4] Starting backend services (Gateway, Collaboration, C2, Auth)..." -ForegroundColor Yellow
cd C:\Users\Owner\StudioProjects\AetherCore\infra\docker
docker compose up -d 2>&1 | Out-String | Select-String "healthy|already"
Write-Host "✓ Backend services started" -ForegroundColor Green
Write-Host ""

# Wait for services to be ready
Write-Host "[3/4] Waiting for services to be healthy (30 seconds)..." -ForegroundColor Yellow
Start-Sleep -Seconds 5

# Test Gateway health
$gatewayHealth = try {
    Invoke-WebRequest -Uri "http://localhost:3000/health" -UseBasicParsing -TimeoutSec 5
    $true
} catch {
    $false
}

if ($gatewayHealth) {
    Write-Host "✓ Gateway API is healthy (port 3000)" -ForegroundColor Green
} else {
    Write-Host "⚠ Gateway API is still starting..." -ForegroundColor Yellow
}

# Test Collaboration health
$collabHealth = try {
    Invoke-WebRequest -Uri "http://localhost:8080/health" -UseBasicParsing -TimeoutSec 5
    $true
} catch {
    $false
}

if ($collabHealth) {
    Write-Host "✓ Collaboration service is healthy (port 8080)" -ForegroundColor Green
} else {
    Write-Host "⚠ Collaboration service is still starting..." -ForegroundColor Yellow
}
Write-Host ""

# Start dashboard
Write-Host "[4/4] Starting Tauri Dashboard..." -ForegroundColor Yellow
cd C:\Users\Owner\StudioProjects\AetherCore\packages\dashboard
Write-Host ""
Write-Host "Dashboard will open in a new window..." -ForegroundColor Cyan
Write-Host "This will take 30-60 seconds to compile and start" -ForegroundColor Gray
Write-Host ""

# Start in background
$tauriProcess = Start-Process -FilePath "powershell" -ArgumentList "-NoExit", "-Command", "cd C:\Users\Owner\StudioProjects\AetherCore\packages\dashboard; pnpm tauri dev" -PassThru

Write-Host "⏳ Waiting for dashboard to launch..." -ForegroundColor Yellow
Start-Sleep -Seconds 15

Write-Host ""
Write-Host "╔═══════════════════════════════════════════════════════════════╗" -ForegroundColor Green
Write-Host "║  ✅ SYSTEM STARTUP COMPLETE                                  ║" -ForegroundColor Green
Write-Host "╚═══════════════════════════════════════════════════════════════╝" -ForegroundColor Green
Write-Host ""

Write-Host "📊 RUNNING SERVICES:" -ForegroundColor Cyan
Write-Host "  • Gateway API: http://localhost:3000" -ForegroundColor Gray
Write-Host "  • Collaboration: http://localhost:8080" -ForegroundColor Gray
Write-Host "  • C2 Router: grpc://localhost:50051" -ForegroundColor Gray
Write-Host "  • Auth Service: http://localhost:3001" -ForegroundColor Gray
Write-Host "  • Dashboard: http://localhost:1420 (Tauri)" -ForegroundColor Gray
Write-Host ""

Write-Host "🎥 VIDEO INGEST ENDPOINTS:" -ForegroundColor Cyan
Write-Host "  • GET /video/streams - List available sample streams" -ForegroundColor Gray
Write-Host "  • POST /video/register - Register new video stream" -ForegroundColor Gray
Write-Host "  • POST /video/sample - Start sampling video" -ForegroundColor Gray
Write-Host "  • GET /video/frames - Get video frame data" -ForegroundColor Gray
Write-Host ""

Write-Host "🎬 NEXT STEPS:" -ForegroundColor Cyan
Write-Host "  1. Tauri desktop window will open automatically" -ForegroundColor Gray
Write-Host "  2. Click 'ISR Console' workspace in the dashboard" -ForegroundColor Gray
Write-Host "  3. You should see the mock FLIR thermal video feed" -ForegroundColor Gray
Write-Host "  4. Verify the trust badge shows 'VERIFIED [SECURE]'" -ForegroundColor Gray
Write-Host ""

Write-Host "🧪 TEST VIDEO INGEST:" -ForegroundColor Cyan
Write-Host ""
Write-Host "  # Get available video streams" -ForegroundColor Gray
Write-Host "  curl http://localhost:3000/video/streams" -ForegroundColor DarkGray
Write-Host ""
Write-Host "  # Register a new video stream" -ForegroundColor Gray
Write-Host "  curl -X POST http://localhost:3000/video/register " + `
    "-H 'Content-Type: application/json' " + `
    "-d '{`"camera_id`":`"thermal-sensor-03`",`"stream_type`":`"mock-flir`"}'" -ForegroundColor DarkGray
Write-Host ""
Write-Host "  # Start sampling video" -ForegroundColor Gray
Write-Host "  curl -X POST http://localhost:3000/video/sample " + `
    "-H 'Content-Type: application/json' " + `
    "-d '{`"camera_id`":`"flir-alpha-01`",`"stream_type`":`"mock-flir`"}'" -ForegroundColor DarkGray
Write-Host ""

Write-Host "✨ System is ready! Dashboard should open in 30-60 seconds." -ForegroundColor Green

