# Standalone Tablet App - Complete Deployment Guide

**Target Device**: Samsung Galaxy Tab S9 FE (SM-X308U)  
**Android Version**: 16  
**App**: AetherCore Tactical  
**Status**: Ready for Approval Testing

---

## Quick Start (5 minutes)

### 1. Install Dependencies
```bash
cd packages/tablet-app
pnpm install
```

### 2. Build APK
```bash
# Option A: Build with Expo (cloud)
pnpm build:android

# Option B: Build locally (faster)
pnpm build:local
```

### 3. Deploy to Samsung SM-X308U
```bash
# Connect device via USB
adb devices

# Install app
adb install -r dist/app.apk

# Launch app
adb shell am start -n com.aethercore.tactical/.MainActivity
```

### 4. Verify Installation
```bash
# Check app is running
adb shell pm list packages | grep aethercore

# View logs
adb logcat | grep AetherCore
```

**Expected Result**: App launches, shows bootstrap screen, loads 10 nodes, displays tactical map.

---

## Detailed Setup

### Prerequisites
- Node.js 22.x
- pnpm 9.15.0
- Android SDK (already installed for previous deployments)
- ADB (Android Debug Bridge)
- Samsung SM-X308U connected via USB with USB debugging enabled

### Verify Prerequisites
```bash
# Check Node
node --version  # Should be v22.x

# Check pnpm
pnpm --version  # Should be 9.15.0

# Check ADB
adb --version

# Check device connection
adb devices
# Output should show: R52X601NK7F device
```

---

## Build Process

### Option 1: Cloud Build (EAS Recommended)

**First Time Setup**:
```bash
cd packages/tablet-app

# Login to Expo (creates account if needed)
eas login

# Configure project for building
eas build --platform android --configure
```

**Build**:
```bash
# Build Android APK
pnpm build:android

# Or manually:
eas build --platform android --profile preview

# Output: EAS will provide download link after ~10-15 minutes
```

**Download**:
```bash
# Download to current directory
eas build:list

# Get the APK link and download, or check email for download link
```

### Option 2: Local Build (Faster)

```bash
cd packages/tablet-app

# Install Expo CLI locally if needed
npm install -g expo-cli eas-cli

# Build locally
pnpm build:local

# Wait 5-10 minutes for Gradle compilation
# Output APK at: dist/app.apk
```

### Option 3: Development APK (Instant)

For testing without full build:
```bash
cd packages/tablet-app

# Start Expo Go compatible APK
pnpm start

# Scan QR code with Expo Go app (on physical device)
# Or use: expo install:android
```

---

## Deployment Steps

### Step 1: Prepare Device
```bash
# Connect Samsung SM-X308U via USB
# On device: Settings → Developer Options → Enable USB Debugging

# Verify connection
adb devices
# Expected output:
# R52X601NK7F device
```

### Step 2: Clear Previous Installation (if exists)
```bash
# Uninstall old version
adb uninstall com.aethercore.tactical

# Clear app data
adb shell pm clear com.aethercore.tactical
```

### Step 3: Install App
```bash
# Navigate to where APK is located
cd packages/tablet-app

# Install APK
adb install -r app-production.apk
# or
adb install -r dist/app.apk

# Expected output:
# Success
```

### Step 4: Launch Application
```bash
# Method 1: Via command line
adb shell am start -n com.aethercore.tactical/.MainActivity

# Method 2: Manually on device
# Open app drawer, tap "AetherCore Tactical"
```

### Step 5: Monitor Startup
```bash
# View logs in real-time
adb logcat | grep -i "aethercore\|bootstrap\|tactical"

# Should see:
# Device identity initialized
# Loading mock data
# Initializing telemetry engine
# App ready
```

---

## Expected UI Sequence

### 1. Splash Screen
- Black screen with AetherCore logo
- Device model displayed
- Duration: 1-2 seconds

### 2. Bootstrap Screen
- Step 1: "Initializing device identity" ✓
- Step 2: "Loading mock data" ✓
- Step 3: "Starting telemetry engine" ✓
- Version info at bottom
- Duration: 3-5 seconds

### 3. Main Application

#### Tactical Map Tab (Default)
```
┌─ TACTICAL MAP ─────────────────┐
│ 10 nodes detected    [MESH:ON]  │
├─────────────────────────────────┤
│  2D TACTICAL DISPLAY            │
│  ┌─────────────────────────────┐│
│  │  ○ (green node)             ││
│  │    ○ (yellow node)          ││
│  │         ○ (red node)        ││
│  │  [Map with 10 nodes]        ││
│  └─────────────────────────────┘│
│                │ NETWORK STATUS │
│                │ HEALTHY: 7     │
│                │ SUSPECT: 2     │
│                │ QUARANTINE: 1  │
│                │ DEVICE: SM-X308│
└─────────────────────────────────┘
```

#### Trust Guardian Tab
```
┌─ TRUST GUARDIAN ───────────────┐
│ Nodes | By Trust | By Name     │
├─────────────────────────────────┤
│ Node 1     [██████████] 95%     │
│ Node 2     [████████░░] 82%     │
│ Node 3     [████░░░░░░] 45%     │
│ Node 4     [██████████] 91%     │
│ ...                             │
│                                 │
│ Select node for details →       │
└─────────────────────────────────┘
```

#### Byzantine Alerts Tab
```
┌─ BYZANTINE ALERTS ─────────────┐
│ [14] CRI[8] HI[4] MED[2]        │
├─────────────────────────────────┤
│ ⚡ BrokenHashChain              │
│    Node-5832 [CRITICAL]        │
│    15:21:00                    │
├─────────────────────────────────┤
│ ✕ InvalidSignature              │
│    Node-7291 [HIGH]             │
│    15:19:45                     │
├─────────────────────────────────┤
│ ... [8 more events]             │
└─────────────────────────────────┘
```

#### Settings Tab
```
┌─ SETTINGS ─────────────────────┐
│ DEVICE INFORMATION              │
│ Device Model    SM-X308U        │
│ Brand           Samsung         │
│ OS Version      16              │
│ Device Type     Tablet          │
│ NODE IDENTITY                   │
│ Node ID         node-xxxxx      │
│ Hardware-Backed Yes             │
│ APPLICATION SETTINGS            │
│ [✓] Mock Event Generation       │
│ [ ] Test Mode                   │
│ ABOUT                           │
│ AetherCore v0.1.0               │
│ © 2026 Defense Systems          │
└─────────────────────────────────┘
```

---

## Verification Checklist

After successful installation, verify each component:

### Application Launch
- [ ] App icon appears in app drawer
- [ ] Tapping icon launches app
- [ ] Bootstrap screen appears (3-5 seconds)
- [ ] All bootstrap steps complete successfully
- [ ] Main app loads without crashes

### Tactical Map Screen
- [ ] Map displays with grid background
- [ ] All 10 nodes visible with trust colors
- [ ] Nodes update position every 2-5 seconds
- [ ] Clicking node shows details panel
- [ ] "MESH: ON" indicator visible
- [ ] Network stats show: 7 healthy, 2 suspect, 1 quarantined

### Trust Guardian Screen
- [ ] Node list populated with 10 entries
- [ ] Sorting toggles work (By Trust / By Name)
- [ ] Clicking node shows detailed metrics
- [ ] Trust score gauges animate smoothly
- [ ] Metric bars display correctly

### Byzantine Alerts Screen
- [ ] Alert feed shows 5-10+ events
- [ ] Each event shows severity color
- [ ] Clicking event expands details
- [ ] Alert count matches total events
- [ ] Statistics updated in real-time

### Settings Screen
- [ ] Device info shows correct model (SM-X308U)
- [ ] Node ID visible and unique
- [ ] Test Mode toggle functional
- [ ] Test Mode enables attack/recovery buttons
- [ ] Simulate Byzantine Attack causes new alerts
- [ ] Simulate Recovery resets affected node

### Performance
- [ ] No lag when scrolling lists
- [ ] Map interactions responsive (< 100ms)
- [ ] Data updates smooth (2-5 second intervals)
- [ ] No crashes or error screens
- [ ] Memory usage stays < 200MB

---

## Testing Scenarios

### Scenario 1: Normal Operation
1. Launch app
2. View Tactical Map
3. Observe nodes updating
4. Switch between tabs
5. Select different nodes in Trust Guardian

**Expected**: Smooth operation, all data updating

### Scenario 2: Byzantine Event Detection
1. Open Settings
2. Enable Test Mode
3. Tap "Simulate Byzantine Attack"
4. Switch to Byzantine Alerts tab
5. Verify new critical events appear

**Expected**: 
- New events with type: InvalidSignature, BrokenHashChain, DoubleVote, ReplayDetected
- Affected node marked as QUARANTINED in other tabs
- Trust score drops to ~0.1-0.4

### Scenario 3: Node Recovery
1. In Settings, tap "Simulate Node Recovery"
2. Switch to Trust Guardian tab
3. Find recently attacked node
4. Verify trust score returned to healthy

**Expected**:
- Node trust score back to 0.8-1.0
- Status returns to "healthy"
- Alerts for that node cleared in Byzantine Alerts

### Scenario 4: Screen Rotation (if portrait mode supported)
1. Rotate device
2. App should adapt to landscape (or stay landscape)

**Expected**: No crashes, data persists, UI adapts

---

## Troubleshooting

### App Won't Install
```bash
# Check device compatibility
adb shell getprop ro.build.version.sdk
# Should be 33+ (API level 33+)

# Clear installation cache
adb shell pm clear com.aethercore.tactical
adb uninstall com.aethercore.tactical

# Retry install
adb install -r app.apk
```

### App Crashes on Launch
```bash
# View crash logs
adb logcat | grep -i "fatal\|exception\|aethercore"

# Check if device storage is full
adb shell df /data

# Uninstall and reinstall
adb uninstall com.aethercore.tactical
adb install -r app.apk
```

### No Data Appears
```bash
# Verify mock data loaded
adb logcat | grep "mock data"

# Check app permissions
adb shell pm list permissions | grep aethercore

# Restart app
adb shell am force-stop com.aethercore.tactical
adb shell am start -n com.aethercore.tactical/.MainActivity
```

### Slow Performance
```bash
# Check memory usage
adb shell dumpsys meminfo | grep -A 5 com.aethercore.tactical

# If >300MB, clear cache and restart
adb shell pm clear com.aethercore.tactical

# Check CPU usage
adb shell top -n 1 | grep aethercore
```

### Can't Connect Device via ADB
```bash
# Verify USB debugging enabled
# On device: Settings → System → Developer Options → USB Debugging [ON]

# Restart ADB server
adb kill-server
adb start-server

# Check cable (try different port)
adb devices -l

# If still not detected, unplug and replug USB cable
```

---

## File Structure After Build

```
packages/tablet-app/
├── app-production.apk           (Main deployable)
├── dist/
│   └── app.apk                  (Alternative APK location)
├── src/
│   ├── screens/                 (4 main screens)
│   ├── components/              (UI components)
│   ├── services/                (Mock data, identity)
│   ├── store/                   (Zustand state)
│   └── navigation/              (Tab navigation)
├── App.tsx                      (Entry point)
├── app.json                     (Expo config)
├── package.json                 (Dependencies)
└── README.md                    (Quick reference)
```

---

## Approver Testing Talking Points

When presenting to approvers:

1. **Independent Deployment**
   > "This app runs standalone - no ATAK dependency. Demonstrates AetherCore's core capabilities independently."

2. **Real-time Trust Assessment**
   > "Notice nodes update trust scores every 2-5 seconds. Color-coded: green for healthy (90%+), yellow for suspect (60-90%), red for quarantined (<60%)."

3. **Byzantine Fault Detection**
   > "Alerts tab shows automatic detection of cryptographic attacks. Click to see fault types: invalid signatures, chain breaks, double votes, replays."

4. **Hardware Identity**
   > "Settings tab shows unique device identity - in production, this would be backed by TPM 2.0 or Secure Enclave for tamper-proof operations."

5. **Testing Capabilities**
   > "Test Mode lets us simulate Byzantine attacks and node recovery - critical for approval validation."

6. **Fail-Visible Design**
   > "No silent failures. Every action logged with cryptographic certainty. Byzantine nodes are immediately quarantined, not hidden."

---

## Next Steps After Deployment

1. **Screenshots for Approval**
   - Capture each main screen
   - Show app icon and install size
   - Document version and build info

2. **Performance Report**
   - CPU, memory, battery usage metrics
   - Latency measurements (tap response, data update rate)
   - Field testing duration on SM-X308U

3. **Security Audit**
   - Cryptographic validation (mock keys)
   - Hardware backing verification
   - Network isolation (no external communication)

4. **Documentation**
   - Field Operator Manual (Phase 3)
   - Deployment checklist
   - Troubleshooting guide

---

## Support Resources

| Resource | Location |
|----------|----------|
| Quick Start | `README.md` in tablet-app |
| Full Architecture | `ARCHITECTURE.md` (root) |
| Mock Data Details | `src/services/mockDataService.ts` |
| Screen Code | `src/screens/*.tsx` |
| AetherCore Philosophy | `AGENTS.md` (root) |

---

## Contact & Issues

For issues during deployment:
1. Check troubleshooting section above
2. Review `adb logcat` output for errors
3. Verify device is supported (Android 16+)
4. Check disk space (min 500MB free)
5. Consult main AetherCore documentation

---

**Status**: ✅ Ready for Samsung SM-X308U Approval Testing

**Timeline**: 
- Setup: 5 minutes
- Build: 10-15 minutes  
- Deployment: 3 minutes
- Testing: 15-30 minutes

**Total**: ~40 minutes for complete approval demo

