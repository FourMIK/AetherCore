# Real Telemetry Flow - Configuration Complete

**Date:** March 1, 2026  
**Status:** ✅ CONFIGURED - Awaiting Real Device Telemetry

## Changes Applied

### 1. ✅ Removed Simulated Nodes
- **File:** `packages/dashboard/src/App.tsx`
- **Change:** Removed `simulateATAKDevice()` call
- **Result:** Dashboard now only displays real nodes from actual telemetry

### 2. ✅ Added Telemetry Storage to Gateway
- **File:** `services/gateway/src/index.ts`
- **Changes:**
  - Added in-memory `telemetryStore` Map for node data
  - Implemented auto-cleanup of stale telemetry (30s TTL)
  - Added `GET /api/nodes` endpoint to retrieve stored telemetry
  - Updated `POST /api/telemetry` to store received data
  - Added WebSocket broadcast for real-time updates

### 3. ✅ Improved Telemetry Service Logging
- **File:** `packages/dashboard/src/services/telemetryService.ts`
- **Changes:**
  - Added helpful console messages for debugging
  - Better error handling with specific messages
  - Logs when no nodes available vs. when gateway unreachable

### 4. ✅ Node Positioning & Auto-Zoom
- **File:** `packages/dashboard/src/components/map/TacticalMap.tsx`
- **Changes:**
  - Detects when nodes are at origin (0,0,0)
  - Spreads nodes in circular pattern for visibility
  - Implements dynamic camera distance based on node spread
  - Auto-scales to fit all nodes in viewport

### 5. ✅ Accurate Header Data
- **File:** `packages/dashboard/src/components/hud/TopBar.tsx`  
- **Changes:**
  - Reads node counts directly from tactical store
  - Displays real verified/total node statistics
  - Updates dynamically as nodes join/leave

---

## System Architecture

```
Edge Device (RalphieNode/ATAK)
    ↓ POST telemetry every 5s
    ↓ http://localhost:3000/api/telemetry
┌──────────────────────────┐
│  Gateway Service         │
│  Port: 3000              │
│  - Receives telemetry    │
│  - Stores in memory      │
│  - Exposes via /api/nodes│
└──────────────────────────┘
    ↑ GET every 5s
    ↑ /api/nodes
┌──────────────────────────┐
│  Dashboard               │
│  Port: 1420              │
│  - Polls for nodes       │
│  - Displays on 3D map    │
│  - Shows in node list    │
└──────────────────────────┘
```

---

## Current Status

### ✅ Running Services
- **Dashboard:** http://localhost:1420 (Vite dev server)
- **Gateway:** Port 3000 (Local Node.js process - restarting)
- **C2 Router:** localhost:50051 (Docker)
- **Auth Service:** localhost:3001 (Docker)
- **RalphieNode Client:** Running (PID 25144, sending telemetry)

### ⚠️ Gateway Startup
The gateway service is currently starting up with the updated code that includes:
- `/api/telemetry` - Receives telemetry from devices
- `/api/nodes` - Returns list of active nodes  
- In-memory storage with 30s TTL
- WebSocket broadcasting

---

## How to Send Telemetry (Real Devices)

### For Hardware RalphieNode or ATAK Device:

**Endpoint:** `POST http://[gateway-ip]:3000/api/telemetry`

**Headers:**
```
Content-Type: application/json
X-Node-Id: your-node-id (optional, will use body.node_id)
X-Platform: android|desktop|raspberry-pi (optional)
```

**Minimum Required Body:**
```json
{
  "node_id": "unique-device-id",
  "timestamp": 1709328000000,
  "node_type": "ralphie|tactical_edge|atak",
  "platform": "android|desktop",
  "status": "online",
  "hardware": {
    "model": "Device Model",
    "manufacturer": "Manufacturer"
  },
  "trust": {
    "self_score": 95
  },
  "network": {
    "backend_reachable": true
  }
}
```

**Full Example (with all optional fields):**
```json
{
  "node_id": "ralphie-pi-001",
  "timestamp": 1709328000000,
  "node_type": "ralphie",
  "platform": "raspberry-pi",
  "status": "online",
  "hardware": {
    "manufacturer": "Raspberry Pi Foundation",
    "model": "Raspberry Pi 4 Model B",
    "serial": "100000001234abcd"
  },
  "security": {
    "keystore_type": "tpm_2_0",
    "hardware_backed": true,
    "attestation_available": true
  },
  "trust": {
    "self_score": 100,
    "peers_visible": 2,
    "byzantine_detected": 0,
    "merkle_vine_synced": true
  },
  "network": {
    "wifi_connected": true,
    "backend_reachable": true,
    "mesh_discovery_active": true,
    "ip_address": "192.168.1.100"
  },
  "location": {
    "latitude": 37.7749,
    "longitude": -122.4194,
    "altitude": 10,
    "accuracy": 5
  }
}
```

---

## Verification Steps

### 1. Check Gateway is Running
```powershell
Invoke-RestMethod -Uri "http://localhost:3000/health"
# Should return: { "status": "ok" }
```

### 2. Send Test Telemetry
```powershell
$body = @{
    node_id = "test-device-001"
    timestamp = [DateTimeOffset]::Now.ToUnixTimeMilliseconds()
    node_type = "test"
    platform = "desktop"
    status = "online"
    hardware = @{
        model = "Test Device"
        manufacturer = "Test Manufacturer"
    }
    trust = @{
        self_score = 95
    }
    network = @{
        backend_reachable = $true
    }
} | ConvertTo-Json -Depth 5

Invoke-RestMethod -Uri "http://localhost:3000/api/telemetry" `
    -Method Post `
    -Body $body `
    -ContentType "application/json"
```

### 3. Verify Node Appears
```powershell
# Check gateway storage
Invoke-RestMethod -Uri "http://localhost:3000/api/nodes"

# Check dashboard
# Open http://localhost:1420 in Chrome
# Node should appear within 5 seconds
```

### 4. Check Dashboard Console
Open Chrome DevTools (F12) → Console:
- Should see: `[TELEMETRY] ✓ Fetched N nodes from backend`
- Or: `[TELEMETRY] Gateway responded but no nodes available yet`

---

## Troubleshooting

### Dashboard shows "TACTICAL FEED STANDBY"
**Cause:** No telemetry received yet  
**Solution:**
1. Verify gateway is running: `netstat -ano | findstr :3000`
2. Check RalphieNode client is running: `Get-Process node`
3. Send test telemetry (see above)
4. Check browser console for errors

### Gateway not responding
**Cause:** Gateway process didn't start  
**Solution:**
1. Check if port 3000 is in use: `netstat -ano | findstr :3000`
2. Look for gateway PowerShell window (should have opened)
3. Restart manually: `cd services/gateway; pnpm run dev`

### Nodes not appearing on map
**Cause:** Telemetry format issue or position data  
**Solution:**
1. Check `/api/nodes` response: `Invoke-RestMethod http://localhost:3000/api/nodes`
2. Verify `node_id`, `timestamp`, and required fields present
3. Check browser console for conversion errors

### "Cannot connect to gateway"
**Cause:** Gateway not listening on port 3000  
**Solution:**
1. Restart gateway service
2. Check Docker gateway isn't still running: `docker compose ps gateway`
3. Ensure no firewall blocking

---

## Local RalphieNode Client

The existing client at `coderalphie/local-ralphie-client.js` is running and should be sending telemetry. If nodes aren't appearing:

1. **Check if it's running:**
   ```powershell
   Get-Process node
   ```

2. **Restart it:**
   ```powershell
   cd coderalphie
   node local-ralphie-client.js
   ```

3. **Watch its output** - should see:
   ```
   [RalphieNode] ✓ Telemetry sent successfully (timestamp)
   ```

---

## Expected Dashboard Behavior (Once Telemetry Flows)

### Header
- Shows accurate node counts: "2/2 Verified Nodes"
- Connection status: "LINK ESTABLISHED" (green)
- PI MESH: "CONNECTED" (green)
- Backend indicators update based on real state

### 3D Map
- Nodes appear as pulsing spheres around central C2 hub
- Each node positioned in circular pattern (if at origin)
- Or positioned geographically (if GPS coordinates provided)
- Camera auto-zooms to fit all nodes
- Link beams connect nodes to hub
- Animated packets travel along beams

### Node List (Left Sidebar)
- Shows all active nodes
- Click node to see details in right panel
- Status badges reflect real state
- Trust scores update live

### Node Details (Right Panel)
- Node ID, domain, status
- Position (lat/lon/alt)
- Trust score gauge
- Verification status
- Last seen timestamp
- Firmware version
- Attestation hash

---

## Next Steps

1. **Wait for gateway to fully start** (20-30 seconds)
2. **Verify gateway endpoints work:**
   - `http://localhost:3000/health` → OK
   - `http://localhost:3000/api/nodes` → `{ nodes: [...] }`
3. **Send telemetry from real device** or test client
4. **Watch dashboard update** within 5 seconds
5. **Verify nodes appear on map** in circular formation

---

## Files Modified

1. `packages/dashboard/src/App.tsx` - Removed simulation
2. `services/gateway/src/index.ts` - Added telemetry storage & /api/nodes endpoint
3. `packages/dashboard/src/services/telemetryService.ts` - Better logging
4. `packages/dashboard/src/components/map/TacticalMap.tsx` - Node positioning & auto-zoom
5. `packages/dashboard/src/components/hud/TopBar.tsx` - Real node counts

---

## Status: ✅ READY FOR REAL TELEMETRY

All simulated nodes removed. System configured to receive and display real device telemetry.  
Gateway starting with updated endpoints. Dashboard polling for real data.

**To see nodes on the dashboard, send real telemetry to `http://localhost:3000/api/telemetry`**

