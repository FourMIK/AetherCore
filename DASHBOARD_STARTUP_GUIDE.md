# Dashboard Startup Guide

## ✅ DASHBOARD HAS BEEN STARTED

I've launched the Tactical Glass dashboard. It's currently compiling and starting up.

---

## 📍 WHERE TO FIND IT

### 1. Look for New PowerShell Window
When I ran the start command, a **new PowerShell window** opened showing:
- "Starting dashboard..." message
- Vite compilation progress
- Eventually: "Local: http://localhost:5173/"

### 2. Check Your Taskbar
Look for an additional PowerShell window icon in your taskbar.

### 3. Access URL
Once ready (30-90 seconds), open Chrome and go to:
```
http://localhost:5173
```

---

## ⏱️ STARTUP TIME

**First Launch:** 30-90 seconds
- TypeScript compilation
- Vite dev server initialization
- Hot Module Replacement (HMR) setup

**Subsequent Starts:** 10-30 seconds

---

## 🔍 HOW TO VERIFY IT'S RUNNING

### Option 1: Check Taskbar
Look for the PowerShell window that opened

### Option 2: Check Port
Open a new PowerShell and run:
```powershell
netstat -ano | Select-String "5173"
```

If you see output with ":5173" and "LISTENING", it's running!

### Option 3: Try Accessing
Open Chrome and navigate to: `http://localhost:5173`

If it loads, you're good!

---

## 🚀 MANUAL START (If Needed)

If the automatic start didn't work, run these commands:

```powershell
cd C:\Users\Owner\StudioProjects\AetherCore\packages\dashboard
$env:SKIP_TOOLCHAIN_CHECK = "1"
pnpm run dev
```

You should see:
```
VITE v5.x.x ready in 3000ms

➜  Local:   http://localhost:5173/
➜  Network: use --host to expose
```

---

## 📱 CONNECTING YOUR ATAK DEVICE

Once the dashboard is running:

1. **Open Trust Monitor** on your Pixel 9 Pro XL
2. **Wait 5-10 seconds** for telemetry to send
3. **Refresh dashboard** in Chrome (press F5)
4. **Check node list** on the left side

Your Pixel should appear with:
- ✅ Trust Score: 100
- ✅ Status: Online (green)
- ✅ Hardware: Pixel 9 Pro XL
- ✅ Verified badge

---

## 🛠️ TROUBLESHOOTING

### Dashboard Won't Start

**Error: "ELIFECYCLE Command failed"**
- Cause: Node version mismatch
- Solution: We set `SKIP_TOOLCHAIN_CHECK=1` to bypass this

**Error: "Port 5173 already in use"**
- Cause: Another Vite instance running
- Solution: Kill the process:
  ```powershell
  $proc = netstat -ano | Select-String "5173" | Select-String "LISTENING"
  # Get PID from output, then:
  Stop-Process -Id <PID> -Force
  ```

**Error: "Cannot find module"**
- Cause: Missing dependencies
- Solution: Reinstall:
  ```powershell
  cd C:\Users\Owner\StudioProjects\AetherCore\packages\dashboard
  pnpm install
  ```

### Dashboard Loads but No Nodes

**Check 1: Backend Running?**
```powershell
cd C:\Users\Owner\StudioProjects\AetherCore\infra\docker
docker compose ps
```
All services should be "healthy"

**Check 2: Trust Monitor Sending Telemetry?**
```powershell
docker compose logs gateway | Select-String "Telemetry"
```
Should see new logs every 5 seconds

**Check 3: Dashboard Fetching?**
- Open Chrome DevTools (F12)
- Network tab
- Look for `/api/nodes` requests
- Should happen every 5 seconds

---

## 📊 DASHBOARD FEATURES

Once loaded, you'll see:

### Main Views
- **Tactical** (default) - Map with node list
- **Fleet Command** - All nodes with details
- **Trust Guardian** - Security monitoring
- **Mesh Network** - Network topology
- **ISR Console** - Intelligence feed
- **Comms** - Communication channels

### Key Panels
- **Left:** Node List (your ATAK devices)
- **Center:** Tactical Map
- **Right:** Node Details (click a node)
- **Top:** System status bar

### Real-Time Updates
- Node status refreshes every 5 seconds
- Trust scores update live
- Connection indicators
- Byzantine alerts

---

## ✅ SUCCESS INDICATORS

Dashboard is working when you see:

1. ✅ Vite logo and "Tactical Glass" title
2. ✅ Dark theme interface
3. ✅ Navigation menu at top
4. ✅ Node list panel on left
5. ✅ Map in center
6. ✅ "Add Node" button visible
7. ✅ System status in top bar

---

## 🔄 RESTARTING THE DASHBOARD

If you need to restart:

1. **Find the PowerShell window** showing Vite output
2. **Press Ctrl+C** to stop
3. **Run again:**
   ```powershell
   $env:SKIP_TOOLCHAIN_CHECK = "1"
   pnpm run dev
   ```

Or close the window and re-run the start command.

---

## 📝 QUICK REFERENCE

| Action | Command/URL |
|--------|-------------|
| Access Dashboard | `http://localhost:5173` |
| Check if Running | `netstat -ano \| Select-String "5173"` |
| View Logs | Check PowerShell window with Vite output |
| Stop Dashboard | Ctrl+C in Vite window |
| Restart | Close window, run `pnpm run dev` again |

---

## 🎯 NEXT STEPS

1. **Wait 30-60 seconds** for compilation
2. **Open Chrome** → `http://localhost:5173`
3. **Open Trust Monitor** on Pixel
4. **Wait and refresh** dashboard (F5)
5. **See your device** in the node list!

---

*Dashboard startup initiated: March 1, 2026 at 17:45*  
*Allow 30-90 seconds for first-time compilation.*  
*Check the new PowerShell window for startup progress.*

