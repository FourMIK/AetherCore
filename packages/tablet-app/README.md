# AetherCore Tactical Tablet Application

**Standalone Tablet App for Trust Assessment & Byzantine Fault Detection**

Status: ✅ **READY FOR DEPLOYMENT**  
Platform: React Native + Expo  
Target Device: Samsung SM-X308U (Android 16 tablet)

---

## Overview

AetherCore Tactical is a **standalone tablet application** that demonstrates AetherCore's core capabilities:

- ✅ **Real-time Trust Assessment**: Cryptographic trust scoring of nodes
- ✅ **Byzantine Fault Detection**: Automatic identification of spoofed/malicious messages
- ✅ **Tactical Visualization**: Map-based node display with trust status overlays
- ✅ **Network Monitoring**: Real-time mesh network health monitoring
- ✅ **Approval Ready**: Complete demonstration without ATAK-Civ dependency

---

## Architecture

### Stack
- **Frontend**: React Native + TypeScript
- **Build Tools**: Expo (managed React Native)
- **State Management**: Zustand
- **UI Components**: lucide-react-native
- **Testing**: Mock data service generating realistic scenarios

### Project Structure
```
packages/tablet-app/
├── App.tsx                           # Main entry point
├── app.json                          # Expo configuration
├── package.json                      # Dependencies
├── tsconfig.json                     # TypeScript config
├── src/
│   ├── navigation/
│   │   └── TacticalNavigator.tsx    # Tab-based navigation
│   ├── screens/
│   │   ├── BootstrapScreen.tsx      # Initialization screen
│   │   ├── TacticalMapScreen.tsx    # Map view with nodes
│   │   ├── TrustGuardianScreen.tsx  # Node list & details
│   │   ├── ByzantineAlertsScreen.tsx # Real-time fault feed
│   │   └── SettingsScreen.tsx       # Device info & settings
│   ├── components/
│   │   └── TrustScoreIndicator.tsx  # Trust visualization
│   ├── services/
│   │   ├── mockDataService.ts       # Test data generation
│   │   └── identityService.ts       # Device identity
│   └── store/
│       ├── useBootstrapStore.ts     # Init state
│       └── useTacticalStore.ts      # Tactical data store
```

---

## Features

### 1. Tactical Map Screen
- **2D Map Display**: Spatial visualization of nodes (lat/lng)
- **Trust Indicators**: Color-coded by status (green/yellow/red)
- **Node Selection**: Click node for detailed metrics
- **Mesh Status**: Shows connection state
- **Network Stats**: Summary of healthy/suspect/quarantined nodes

### 2. Trust Guardian Screen
- **Ranked Node List**: Sort by trust score or name
- **Detailed Analytics**: Integrity metrics for each node
- **Visual Indicators**: Real-time trust score gauges
- **Identity Info**: Hardware backing, public keys, location
- **Metric Breakdown**: Signature failures, replay events, packet loss

### 3. Byzantine Alerts Screen
- **Real-time Feed**: Live Byzantine fault events
- **Severity Levels**: Critical, High, Medium, Low
- **Event Details**: Timestamp, fault type, description
- **Alert Stats**: Count by severity
- **Quick Actions**: Investigate, Quarantine buttons

### 4. Settings Screen
- **Device Information**: Model, OS, capabilities
- **Node Identity**: Unique node ID and crypto keys
- **Application Settings**: Toggle mock events & test mode
- **Testing Utilities**: Simulate attacks and recoveries
- **About**: Version and copyright info

---

## Building & Deployment

### Prerequisites
```bash
Node.js 22.x
npm or pnpm
Expo CLI: npm install -g expo-cli
EAS CLI: npm install -g eas-cli
```

### Setup
```bash
cd packages/tablet-app
pnpm install
```

### Development (Local)
```bash
# Start development server with hot reload
pnpm start

# Open in Android emulator
pnpm android

# Open in iOS simulator
pnpm ios

# Run on physical device (scan QR code with Expo app)
```

### Build for Android Device (Samsung SM-X308U)

#### Option 1: Via EAS Cloud (Recommended)
```bash
# Configure build
eas build --configure

# Build APK
eas build --platform android --profile preview

# Download APK and deploy
adb install -r path/to/app.apk
```

#### Option 2: Local Build
```bash
# Build locally
pnpm build:local

# Wait for build to complete, then download APK
# Deploy via ADB
adb install -r dist/app.apk
```

#### Option 3: Direct Development APK
```bash
# Build expo go compatible APK
pnpm build:android --local

# Deploy
adb install app.apk
```

### Running on Samsung SM-X308U

```bash
# 1. Connect device via USB
adb devices

# 2. Ensure USB debugging is enabled

# 3. Install app
adb install -r app-production.apk

# 4. Launch app
adb shell am start -n com.aethercore.tactical/.MainActivity

# 5. Monitor logs
adb logcat | grep -i aethercore
```

---

## Mock Data Generation

The app includes a realistic mock data engine that simulates:

### Node Data
- 10 total nodes across 2 domains (Alpha Squad, Bravo Squad)
- Random trust scores with occasional Byzantine events
- Realistic location data (lat/lng variance)
- Hardware backing status simulation
- Network metrics (packet loss, replay events, uptime)

### Byzantine Faults
- 30% of nodes have active faults
- 4 fault types: Invalid Signature, Broken Hash Chain, Double Vote, Replay Detected
- Severity levels: Low, Medium, High, Critical
- Automatic node quarantine on critical faults
- Background update loop (2-5 second intervals)

### Testing Controls
In Settings → Test Mode:
- **Simulate Byzantine Attack**: Trigger critical fault on random node
- **Simulate Node Recovery**: Restore node to healthy state

---

## Approval Testing Checklist

For demonstration to approval authorities:

- [ ] Device: Samsung SM-X308U (Android 16)
- [ ] App launches without errors
- [ ] Bootstrap screen shows device info (Device check → Stack boot → Mesh → Node deploy)
- [ ] Tactical Map displays 10 nodes with trust colors
- [ ] Trust Guardian shows node list with detailed metrics
- [ ] Byzantine Alerts show real-time fault events
- [ ] Mock data updates every 2-5 seconds
- [ ] Test Mode can simulate attacks/recoveries
- [ ] Settings show device identity (unique node ID)
- [ ] All screens responsive and touch-friendly on 11" tablet

---

## Key Files & Usage

### App Entry Point
```typescript
// App.tsx
// Initializes bootstrap, manages routing
```

### Bootstrap Store
```typescript
// src/store/useBootstrapStore.ts
const { isBootstrapped, initialize } = useBootstrapStore();
```

### Tactical Store
```typescript
// src/store/useTacticalStore.ts
const {
  nodes,
  faultEvents,
  addNode,
  addFaultEvent,
  updateNode,
  selectNode,
} = useTacticalStore();
```

### Mock Data Service
```typescript
// src/services/mockDataService.ts
import { initializeMockData, simulateByzantineAttack } from '../services/mockDataService';

// In bootstrap:
await initializeMockData(); // Generates 10 nodes + events

// In testing:
simulateByzantineAttack(nodeId); // Trigger Byzantine event
```

---

## Performance Targets

| Metric | Target | Notes |
|--------|--------|-------|
| **App Launch** | <3 seconds | Bootstrap → Tactical view |
| **Data Updates** | 2-5 seconds | Mock data refresh rate |
| **Touch Latency** | <100ms | Map node selection |
| **Memory** | <200MB | Typical usage |
| **Battery** | >6 hours | Continuous operation |
| **Frame Rate** | 60 FPS | Smooth scrolling |

---

## Customization

### Change App Colors
Edit `DashboardLayout.tsx` and screen files:
```typescript
// Healthy: #00ff9f
// Suspect: #ffaa00
// Quarantined: #ff4444
// Background: #0a0e27
```

### Adjust Mock Data Parameters
Edit `src/services/mockDataService.ts`:
```typescript
const DOMAINS = [...]; // Add/remove domains
const BASE_LOCATIONS = [...]; // Change node locations
// Adjust trust score distribution, fault rates, etc.
```

### Modify Update Intervals
```typescript
// In mockDataService.ts:
setInterval(() => {
  // Update logic
}, randomInt(2000, 5000)); // Change interval
```

---

## Troubleshooting

### App Won't Start
```bash
# Clear cache and reinstall
adb uninstall com.aethercore.tactical
pnpm start --clear
pnpm android
```

### Slow Performance
```bash
# Check device resources
adb shell dumpsys meminfo | grep -i aethercore

# Disable mock event generation in Settings
```

### Build Fails
```bash
# Clear Expo cache
rm -rf .expo

# Reinstall dependencies
rm -rf node_modules
pnpm install

# Try local build instead of EAS
pnpm build:local --platform android
```

### Cannot Connect to Device
```bash
# Verify USB debugging
adb devices

# Restart ADB
adb kill-server
adb start-server

# Check cable and port
```

---

## Next Steps

### Phase 1 (Current): MVP
- ✅ Bootstrap & initialization
- ✅ Mock data generation
- ✅ 4 main screens
- ✅ Trust visualization
- ✅ Byzantine alerts
- ✅ Settings/testing

### Phase 2: Enhanced
- 3D Map visualization (Three.js + WebGL)
- Real mesh network integration
- QR code device enrollment
- Offline event logging
- Advanced analytics dashboard

### Phase 3: Production
- Hardware-backed cryptography (TPM/Secure Enclave)
- Real CoT event processing
- ATAK interoperability (optional)
- Field operator manual
- Approval certification

---

## Documentation

| Document | Purpose |
|----------|---------|
| `README.md` (this file) | Quick start & overview |
| `DEPLOYMENT_GUIDE.md` | Detailed deployment steps |
| `ARCHITECTURE.md` | System design & flows |
| `TESTING_GUIDE.md` | QA procedures |
| `FIELD_OPERATOR_MANUAL.md` | End-user guide (Phase 3) |

---

## Support

For issues or questions:
1. Check troubleshooting section above
2. Review `DEPLOYMENT_GUIDE.md`
3. Check `pnpm logs` and `adb logcat` output
4. Consult main AetherCore documentation

---

## License

AetherCore Tactical © 2026 AetherCore Defense Systems  
All Rights Reserved

---

**Status**: ✅ READY FOR SAMSUNG SM-X308U DEPLOYMENT

**Next Action**: Run `pnpm install` then `pnpm build:android` to build APK for testing.

