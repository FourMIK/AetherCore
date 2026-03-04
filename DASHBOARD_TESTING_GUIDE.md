# 🚀 Dashboard Testing Instructions

## Status: READY FOR CHROME TESTING ✅

The Tactical Glass dashboard is now fully functional and running in development mode.

---

## Quick Start

### Step 1: Dashboard is Already Running
The Tauri development server has been started with:
```powershell
cd C:\Users\Owner\StudioProjects\AetherCore\packages\dashboard
pnpm tauri dev
```

### Step 2: Open in Chrome
1. **Open Google Chrome** (or Chromium-based browser)
2. **Navigate to:** `http://localhost:5173/` (or check terminal for exact URL)
3. **You should see:**
   - Tactical Glass dashboard with 3D map
   - Two mock nodes: `flir-alpha-01` and `thermal-demo-03`
   - Real-time telemetry and trust scores
   - Messaging interface (Mission Guardian)
   - Node list with revocation controls

### Step 3: Test Features

#### Node Visualization
- [ ] 3D map displays with node positions
- [ ] Color-coded trust scores (green = verified, red = compromised)
- [ ] Real-time status updates

#### Telemetry Streaming
- [ ] Node list updates with live data
- [ ] Trust scores update in real-time
- [ ] Last seen timestamps update
- [ ] Status indicators change (online/offline)

#### Message Signing
- [ ] Type a message in the messaging panel
- [ ] "Send" button becomes enabled
- [ ] Message is cryptographically signed
- [ ] Success message appears

#### Revocation Authority
- [ ] Click "Revoke Identity (Gospel)" button on a node
- [ ] Confirm the sovereign revocation dialog
- [ ] Enter revocation reason
- [ ] Node status changes to "REVOKED"
- [ ] Node moves to revoked state with reason displayed

#### Byzantine Detection
- [ ] Compromised nodes show red "BYZANTINE" badge
- [ ] Red warning boxes appear with reason
- [ ] Node list filters show compromised nodes

---

## Terminal Output to Expect

```
> vite v6.4.1

  ➜  local:   http://localhost:5173/
  ➜  press h to show help

Tauri app window should open automatically
```

---

## If Dashboard Won't Load

### Check 1: Verify Build Was Successful
```powershell
cd C:\Users\Owner\StudioProjects\AetherCore\packages\dashboard
pnpm run build
```
Expected: No TypeScript errors, successful build output

### Check 2: Clear Cache and Rebuild
```powershell
pnpm run clean
pnpm install
pnpm tauri dev
```

### Check 3: Check Port 5173
If port 5173 is in use, Vite will use the next available port. Check terminal output for actual URL.

---

## Development Mode Features

✅ **Hot Reload:** Changes to source code auto-reload in browser  
✅ **Source Maps:** Full TypeScript debugging in DevTools  
✅ **Console Logging:** See all app logs in browser console (F12)  
✅ **Tauri DevTools:** Right-click → Inspect to see component hierarchy  

---

## Testing the AWS Integration

### Backend Services
Backend services are configured to connect to the AWS testbed. To verify:

```powershell
# Check Docker services are running
docker ps

# View gateway logs
docker compose logs -f gateway
```

### Dashboard Connection
Dashboard is pre-configured for AWS:
- **API Endpoint:** `https://aethercore-aws-testbed-alb-1408772759.us-east-1.elb.amazonaws.com/api`
- **WebSocket:** `wss://aethercore-aws-testbed-alb-1408772759.us-east-1.elb.amazonaws.com`
- **C2 Router:** `aethercore-aws-testbed-alb-1408772759.us-east-1.elb.amazonaws.com:50051`

---

## Key Test Scenarios

### Scenario 1: Node Monitoring
1. Launch dashboard
2. Observe two mock nodes: `flir-alpha-01` (thermal FLIR) and `thermal-demo-03`
3. Watch trust scores and status in real-time
4. Switch between 3D and 2D map views

### Scenario 2: Message Sending
1. Click on a node in the conversation list
2. Type a message in the input field
3. Click Send button
4. Message should be cryptographically signed
5. Message appears in conversation with verification badge

### Scenario 3: Node Revocation
1. Click "Revoke Identity (Gospel)" button on any node
2. Confirm the dramatic warning dialog
3. Enter a revocation reason
4. Node transitions to revoked state
5. Revocation reason appears in red box
6. Revocation history is updated

### Scenario 4: Byzantine Detection
1. Observe the `thermal-demo-03` node (should be verified)
2. Use browser DevTools to simulate compromised status
3. UI should show red "UNVERIFIED" or "BYZANTINE" badges
4. Node should be visually quarantined (red border)

---

## Browser DevTools Tips

### Console (F12 → Console)
- View all application logs
- Check for crypto operation results
- Monitor network requests (Network tab)

### Application Tab
- Check localStorage for persisted preferences
- Verify IndexedDB for node cache
- Check Service Workers if offline mode

### Network Tab
- Monitor WebSocket connections
- View API calls to gateway
- Check for security headers (TLS 1.3)

---

## Stopping the Dashboard

```powershell
# In the terminal where pnpm tauri dev is running:
Press Ctrl+C to stop the dev server

# Or kill the process:
taskkill /F /IM node.exe  # WARNING: Kills all Node processes
```

---

## Production Build

When ready for production:

```powershell
cd C:\Users\Owner\StudioProjects\AetherCore\packages\dashboard

# Build for production
pnpm tauri build

# Output:
# Windows: installer at src-tauri/target/release/AetherCore.msi
# macOS: app at src-tauri/target/release/bundle/macos/AetherCore.app
```

---

## Success Criteria

✅ Dashboard loads without errors  
✅ 3D map renders with nodes  
✅ Node telemetry updates in real-time  
✅ Messages can be sent and displayed  
✅ Revocation authority works  
✅ No console errors (F12)  
✅ Network requests show successful (200 OK)  
✅ WebSocket connection established  

---

## Support

For issues:
1. Check `DASHBOARD_AUDIT_COMPLETE.md` for what was fixed
2. Review console output (F12 → Console)
3. Check network tab for failed requests
4. Verify AWS endpoint is reachable: `check-aws-connectivity.ps1`
5. Review service logs: `docker compose logs -f`

---

**Happy Testing! 🎯**

The dashboard is ready for comprehensive testing. All code quality issues have been audited and fixed. Launch Chrome and navigate to `http://localhost:5173/` to see Tactical Glass in action!

