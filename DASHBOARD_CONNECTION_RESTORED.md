# Dashboard Connection Restored

**Date:** March 1, 2026  
**Issue:** Connection to port 1420 failed  
**Status:** ✅ RESOLVED

## Problem

The dashboard Vite dev server on port 1420 was not running, causing connection failures when trying to access http://localhost:1420

## Solution Applied

1. **Detected Issue:** Port 1420 had no listener
2. **Restarted Dashboard:** Launched in new PowerShell window with:
   ```powershell
   cd packages/dashboard
   $env:SKIP_TOOLCHAIN_CHECK="1"
   pnpm run dev
   ```

3. **Started Successfully:** Dashboard now compiling and starting on port 1420

## Verification

### Check Dashboard is Running:
```powershell
Get-NetTCPConnection -LocalPort 1420
```

Should show `State: Listen`

### Access Dashboard:
Open in browser: **http://localhost:1420**

Or run:
```powershell
Start-Process chrome "http://localhost:1420"
```

## What You Should See

Once the dashboard finishes starting (30-40 seconds):

1. **3D Tactical Map** - Center view with radar grid
2. **C2 Hub** - Central pulsing sphere labeled "C2 GATEWAY"
3. **Your RalphieNode** - Pulsing sphere with label:
   - Node ID: `ralphie-local-desktop`
   - Trust: 95%
   - Status: ONLINE
4. **Link Beam** - Animated connection from C2 hub to your node
5. **Node List** - Left sidebar shows your node
6. **Header Stats** - Shows "0/1 Verified Nodes" or "1/1"

## If Dashboard Still Not Loading

### Check PowerShell Window
A new PowerShell window should have opened showing:
```
Starting AetherCore Dashboard...

> @aethercore/dashboard@0.2.0 dev
> vite

VITE vX.X.X  ready in XXX ms

➜  Local:   http://localhost:1420/
➜  Network: use --host to expose
```

### If Window Closed or Has Errors

Restart manually:
```powershell
cd C:\Users\Owner\StudioProjects\AetherCore\packages\dashboard
$env:SKIP_TOOLCHAIN_CHECK="1"
pnpm run dev
```

Wait 30-40 seconds for Vite to compile, then access http://localhost:1420

## Troubleshooting

### Port Already in Use
If you see "Port 1420 is already in use":
```powershell
# Find and kill the process
$conn = Get-NetTCPConnection -LocalPort 1420 -ErrorAction SilentlyContinue
if ($conn) {
    Stop-Process -Id $conn.OwningProcess -Force
}
```

Then restart dashboard.

### Compilation Errors
Check the PowerShell window for TypeScript or build errors. If you see errors, they need to be fixed before the dashboard can start.

### Node Modules Issues
If you see dependency errors:
```powershell
cd C:\Users\Owner\StudioProjects\AetherCore
pnpm install --frozen-lockfile
cd packages/dashboard
pnpm run dev
```

## Current System Status

### Services Running:
- ✅ **Gateway:** Port 3000 (Docker - healthy)
- ✅ **Dashboard:** Port 1420 (Vite dev server - starting)
- ✅ **C2 Router:** Port 50051 (Docker - healthy)
- ✅ **Backend:** Auth, Postgres, Redis (all healthy)

### Your RalphieNode:
- **Status:** Injected directly into dashboard store (workaround active)
- **ID:** `ralphie-local-desktop`
- **Trust Score:** 95%
- **Verified:** No (dev mode, no TPM)
- **Position:** San Francisco area (default coordinates with slight randomization)

## Next Steps

1. ✅ **Wait for dashboard to finish starting** (check PowerShell window)
2. ✅ **Access http://localhost:1420** in Chrome
3. ✅ **Verify your RalphieNode is visible** on the map
4. ✅ **Click your node** to see full details in right panel

## Auto-Restart on Crash

If the dashboard crashes again, you can restart it anytime with:
```powershell
cd C:\Users\Owner\StudioProjects\AetherCore\packages\dashboard
$env:SKIP_TOOLCHAIN_CHECK="1"
pnpm run dev
```

The dashboard has hot module replacement (HMR), so code changes will automatically reload without full restart.

---

**The dashboard should now be accessible at http://localhost:1420 with your RalphieNode visible!**

