# 🚀 FLIR TRUST BRIDGE - QUICK START GUIDE

**Last Updated:** March 2, 2026

---

## 5-Minute Setup

### 1. Start Backend Services
```powershell
cd C:\Users\Owner\StudioProjects\AetherCore\infra\docker
docker compose up -d
```

Wait for all services to show "healthy":
```
✓ gateway (port 3000) - Healthy
✓ collaboration (port 8080) - Healthy
✓ auth (port 3001) - Healthy
✓ c2-router (port 50051) - Healthy
✓ postgres (port 5432) - Healthy
✓ redis (port 6379) - Healthy
```

### 2. Build and Run Dashboard
```powershell
cd C:\Users\Owner\StudioProjects\AetherCore\packages\dashboard
pnpm tauri dev
```

Wait for Vite dev server (port 1420) and open browser window automatically.

### 3. View ISR Console with FLIR Feed
1. In Tactical Glass dashboard, find the **workspace selector** (top or sidebar)
2. Click **ISR Console**
3. You should see:
   - **Left:** Mock FLIR thermal video feed with crosshairs
   - **Right:** Camera selection panel showing "flir-alpha-01 - Teledyne Ranger HD"

---

## 🎯 What You'll See

### Video Feed Display
- **Thermal scanline effect** (animated)
- **Tactical crosshair** (SVG overlay)
- **Live indicator** - Red pulsing dot in top-right
- **Trust badge** - Green "AETHERCORE TRUST MESH VERIFIED [SECURE]"
- **Camera info** - Resolution, codec, timestamp overlay

### Status Panels
| Panel | Shows |
|-------|-------|
| **Cameras** | List of connected sensors (click to view) |
| **Intelligence** | Recording status, storage |
| **SIGINT** | Signal count, coverage |
| **Details** | Trust score (95%), verification status, hash |

---

## 🔌 Real FLIR Camera Integration

To connect a real Teledyne Ranger HD camera:

### Step 1: Configure Environment
Edit `services/h2-ingest/.env`:
```env
FLIR_CAMERA_IP=192.168.1.100        # Your camera IP
EDGE_NODE_IP=10.0.0.22              # H2-ingest server IP
FLIR_USERNAME=admin                 # Camera username
FLIR_PASSWORD=your_password         # Camera password
FLIR_UDP_PORT=5900                  # UDP port for tracks
```

### Step 2: Start FLIR Bridge
```powershell
# Via HTTP endpoint
curl -X POST http://localhost:3000/flir/start `
  -H "Content-Type: application/json" `
  -d '{
    "flir_ip": "192.168.1.100",
    "edge_node_ip": "10.0.0.22",
    "udp_port": 5900
  }'

# Response:
{
  "status": "started",
  "flir_ip": "192.168.1.100",
  "timestamp": "2026-03-02T17:40:00Z"
}
```

### Step 3: Monitor Backend Logs
```powershell
cd C:\Users\Owner\StudioProjects\AetherCore\infra\docker
docker compose logs -f h2-ingest
```

Expected output:
```
[FLIR] Authenticating to 192.168.1.100 as user 'admin'
[FLIR] Session established: ABC123XYZ...
[FLIR] Registering UDP telemetry stream to 10.0.0.22:5900
[FLIR] UDP listener bound to 0.0.0.0:5900
[FLIR] Ingesting Track ID: 1 at (53.7520, -2.2390)
[TRUST MESH] Cryptographic Seal Applied (Ed25519) for Track ID: 1
[TRUST MESH] Merkle Vine updated. Hash: blake3(track_1)
[ROUTING] Dispatching verified FLIR feed to C2 Router & ATAK Bridge
```

### Step 4: View Real Feed in ISR Console
The dashboard will automatically:
1. Receive track updates via HTTP from h2-ingest
2. Update node positions on tactical map
3. Display video stream URL in AgnosticVideoPlayer
4. Render MJPEG or HLS feed (based on format)

---

## 🧪 Testing Scenarios

### Test 1: Mock FLIR Feed (Default)
**Status:** ✅ Pre-configured

1. Open ISR Console
2. Verify mock thermal video displays
3. Check trust badge: "AETHERCORE TRUST MESH VERIFIED [SECURE]"
4. Confirm active feeds counter shows "1"

**Expected:** Pure tactical UI demo, no network calls to camera

---

### Test 2: MJPEG Stream
**Setup:**
1. Change node videoStream in `useTacticalStore.ts`:
   ```typescript
   videoStream: {
     url: 'http://192.168.1.100:8080/stream.mjpeg',
     format: 'mjpeg',  // Motion JPEG
     status: 'live',
     resolution: '1080p',
   }
   ```
2. Save and rebuild dashboard
3. Open ISR Console
4. Verify live MJPEG stream displays

**Expected:** Live camera feed from HTTP MJPEG endpoint

---

### Test 3: NMEA Track Parser
**Unit Tests:**
```powershell
cd C:\Users\Owner\StudioProjects\AetherCore\services\h2-ingest
cargo test parser -- --nocapture
```

**Test Data:**
```
$TRACK,1,05345.12,N,00214.34,W,0,0,12.5,45.0,20260302,150600*FF
↓
FlirTrack {
  target_id: 1,
  lat: 53.752,
  lon: -2.239,
  speed: 12.5,
  heading: 45.0,
}
```

---

### Test 4: UDP Listener
**Manual Test:**
```powershell
# Terminal 1: Start h2-ingest
cd services/h2-ingest
cargo run

# Terminal 2: Send test NMEA sentence
$sock = New-Object System.Net.Sockets.UdpClient
$sock.Send([System.Text.Encoding]::ASCII.GetBytes("$TRACK,1,05345.12,N,00214.34,W,0,0,12.5,45.0,20260302,150600*FF"), 
           [System.Text.Encoding]::ASCII.GetBytes("$TRACK,1,05345.12,N,00214.34,W,0,0,12.5,45.0,20260302,150600*FF").Length, 
           "127.0.0.1", 5900)
```

**Expected Logs:**
```
[FLIR] Ingesting Track ID: 1 at (53.7520, -2.2390)
[TRUST MESH] Cryptographic Seal Applied (Ed25519)
```

---

## 🐛 Troubleshooting

### ISR Console Shows "No ISR Feeds Available"

**Cause:** Mock FLIR node not injected
**Fix:**
1. Check `useTacticalStore.ts` has `initialNodes` with FLIR node
2. Check `selectedNodeId` is set to `'flir-alpha-01'`
3. Rebuild dashboard: `pnpm tauri dev`

---

### Video Player Shows Black Screen

**Cause:** VideoStream format mismatch
**Fix:**
1. Verify `format: 'mock-flir'` for mock demo
2. For MJPEG: Ensure `format: 'mjpeg'` and `url: 'http://...'`
3. Check browser console for errors

---

### FLIR Camera Not Authenticating

**Cause:** Wrong IP, credentials, or network
**Fix:**
```powershell
# Test camera connectivity
Test-Connection -ComputerName 192.168.1.100 -Count 2

# Test HTTP endpoint
Invoke-WebRequest -Uri "http://192.168.1.100/Nexus.cgi?action=SERVERAuthInitialize&username=admin&password=password"
```

---

### UDP Port Already in Use

**Cause:** Process already bound to port 5900
**Fix:**
```powershell
# Find process using port
netstat -ano | Select-String ":5900"

# Kill process (example: PID 1234)
Stop-Process -Id 1234 -Force

# Or use different port in .env
FLIR_UDP_PORT=5901
```

---

## 📊 Performance Metrics

### Expected Latency
- **Authentication:** 100-500ms
- **UDP Binding:** 50-100ms
- **Track Parse:** <1ms per frame
- **Dashboard Update:** 16ms (60 FPS)

### Resource Usage
- **h2-ingest:** 50-100 MB RAM
- **Dashboard:** 200-400 MB RAM
- **UDP Socket:** ~100KB/s per camera

### Track Throughput
- **Typical:** 1-10 tracks/second
- **Peak:** 100+ tracks/second (multiple cameras)
- **Queue:** 100 tracks (mpsc channel depth)

---

## 🔐 Security Verification

### Trust Mesh Validation

1. **Check Cryptographic Logs:**
   ```powershell
   docker compose logs h2-ingest | Select-String "TRUST MESH"
   ```

2. **Expected Output:**
   ```
   [TRUST MESH] Cryptographic Seal Applied (Ed25519) for Track ID: 1
   [TRUST MESH] Merkle Vine updated. Hash: blake3(track_1)
   ```

3. **Verify Badge in UI:**
   - Green border: ✓ Verified
   - Red border: ✗ Failed
   - Shows trust score (95%)

---

## 📚 API Reference

### HTTP Endpoints

#### POST /flir/start
**Start FLIR bridge background task**

```bash
curl -X POST http://localhost:3000/flir/start \
  -H "Content-Type: application/json" \
  -d '{
    "flir_ip": "192.168.1.100",
    "edge_node_ip": "0.0.0.0",
    "udp_port": 5900
  }'
```

#### GET /health
**Service health check**

```bash
curl http://localhost:3000/health
# {"status":"healthy","service":"h2-ingest","timestamp":"..."}
```

---

## 📞 Support

For issues or questions, refer to:
- **TELEDYNE_FLIR_INTEGRATION_COMPLETE.md** - Full technical specification
- **AGENTS.md** - Coding standards and patterns
- **SECURITY.md** - Cryptographic requirements

---

**Status:** Ready for field demonstration  
**Version:** 0.2.0 (Alpha)

Deploy and demonstrate!

