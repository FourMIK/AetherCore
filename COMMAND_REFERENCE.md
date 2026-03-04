# 🚀 AetherCore FLIR Video Ingest - Quick Command Reference

## ✅ SERVICES RUNNING

All backend services are currently running and healthy:

```powershell
# Check all services
cd C:\Users\Owner\StudioProjects\AetherCore\infra\docker
docker compose ps
```

## 🧪 TEST API ENDPOINTS

### Check Gateway Health
```powershell
Invoke-WebRequest -Uri "http://localhost:3000/health" -UseBasicParsing | Select-Object -ExpandProperty Content
# Expected: {"status":"ok"}
```

### Check Collaboration Health
```powershell
Invoke-WebRequest -Uri "http://localhost:8080/health" -UseBasicParsing | Select-Object -ExpandProperty Content
# Expected: {"status":"ok"}
```

## 📡 VIDEO INGEST (After h2-ingest rebuild)

### List Available Video Streams
```powershell
Invoke-RestMethod -Uri "http://localhost:3000/video/streams" -Method Get
```

### Register New Video Stream
```powershell
$body = @{
    camera_id = "thermal-demo-03"
    stream_type = "mock-flir"
    resolution = "1080p"
} | ConvertTo-Json

Invoke-RestMethod -Uri "http://localhost:3000/video/register" `
  -Method Post `
  -Body $body `
  -ContentType "application/json"
```

### Start Video Sampling
```powershell
$body = @{
    camera_id = "flir-alpha-01"
    stream_type = "mock-flir"
} | ConvertTo-Json

Invoke-RestMethod -Uri "http://localhost:3000/video/sample" `
  -Method Post `
  -Body $body `
  -ContentType "application/json"
```

### Get Video Frames
```powershell
Invoke-RestMethod -Uri "http://localhost:3000/video/frames?stream_id=flir-alpha-01" -Method Get
```

## 🐳 DOCKER MANAGEMENT

### Start All Services
```powershell
cd C:\Users\Owner\StudioProjects\AetherCore\infra\docker
docker compose up -d
```

### Stop All Services
```powershell
cd C:\Users\Owner\StudioProjects\AetherCore\infra\docker
docker compose down
```

### View Service Logs
```powershell
# All services
docker compose logs -f

# Specific service
docker compose logs -f gateway
docker compose logs -f collaboration
docker compose logs -f c2-router
```

### Rebuild h2-ingest (to enable video endpoints)
```powershell
cd C:\Users\Owner\StudioProjects\AetherCore\infra\docker
docker compose build h2-ingest
docker compose up -d h2-ingest
```

## 💻 DASHBOARD

### Start Dashboard (React + Tauri)
```powershell
cd C:\Users\Owner\StudioProjects\AetherCore\packages\dashboard
pnpm tauri dev
```

### Build Dashboard for Production
```powershell
cd C:\Users\Owner\StudioProjects\AetherCore\packages\dashboard
pnpm tauri build
```

## 📊 MONITORING

### Check All Port Status
```powershell
netstat -ano | Select-String -Pattern ":3000|:3001|:8080|:50051|:5432|:6379" | Format-Table
```

### Monitor in Real-time
```powershell
# Terminal 1: Watch services
cd C:\Users\Owner\StudioProjects\AetherCore\infra\docker
docker compose logs -f

# Terminal 2: Monitor ports
while($true) {
    Clear-Host
    Write-Host "Active Ports:" -ForegroundColor Cyan
    netstat -ano | Select-String -Pattern ":3000|:3001|:8080|:50051" | Select-Object -First 5
    Start-Sleep -Seconds 2
}
```

## 🔧 CONFIGURATION

### Set Environment Variables (Windows)
```powershell
# Enable OpenSSL for Tauri builds
$env:OPENSSL_NO_VENDOR = 1

# Enable production mode
$env:AETHERCORE_PRODUCTION = "true"

# Enable TPM
$env:TPM_ENABLED = "true"
```

### Configure FLIR Camera
Edit `.env` in `services/h2-ingest/`:
```env
FLIR_CAMERA_IP=192.168.1.100
EDGE_NODE_IP=0.0.0.0
FLIR_USERNAME=admin
FLIR_PASSWORD=password
FLIR_UDP_PORT=5900
```

## 📋 SERVICE STATUS REFERENCE

```
Gateway (3000)          ← REST API + WebSocket
Collaboration (8080)    ← WebSocket signaling
C2 Router (50051)       ← gRPC command routing
Auth (3001)             ← Authentication
PostgreSQL (5432)       ← Database
Redis (6379)            ← Cache/Pub-Sub
```

## ✨ KEY PATHS

```
Backend Code:        services/h2-ingest/src/
Frontend Code:       packages/dashboard/src/
Docker Compose:      infra/docker/
Configuration:       config/
Documentation:       docs/ and root *.md files
```

## 🎯 QUICK STATUS CHECK

```powershell
# One-line status check
@(3000, 3001, 8080, 50051, 5432, 6379) | ForEach-Object { 
    $port = $_
    $status = if (netstat -ano | Select-String ":$port ") { "✓" } else { "✗" }
    Write-Host "$status Port $port"
}
```

## 📞 HELP

For more information, see:
- `FLIR_QUICK_START.md` - Getting started guide
- `SYSTEM_RUNNING_STATUS.md` - Current system status
- `TELEDYNE_FLIR_INTEGRATION_COMPLETE.md` - Full technical documentation
- `FLIR_ARCHITECTURE_DIAGRAMS.md` - System architecture

---

**Last Updated:** March 2, 2026 | 18:16 EST  
**Status:** All services operational ✅

