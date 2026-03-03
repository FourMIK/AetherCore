# How to Access AetherCore Trust Overlay on Your Device

**Device:** Pixel 9 Pro XL  
**Installed Package:** `com.aethercore.atak.trustoverlay`

---

## Step 1: Launch ATAK-Civ

### On Your Pixel 9 Pro XL:

1. **Open App Drawer** (swipe up from home screen)
2. **Find ATAK-Civ** app icon
3. **Tap to launch**

ATAK-Civ will start loading and the Trust Overlay plugin will auto-register during startup.

---

## Step 2: Verify Plugin is Loaded

### Method A: Check Plugin List

1. Open ATAK-Civ
2. Tap **☰ Menu** (hamburger icon, top-left or side menu)
3. Go to **Settings** → **Tool Preferences**
4. Look for **"Plugins"** or **"Plugin Management"**
5. You should see: **"AetherCore Trust Overlay"** with status **"Loaded"** or **"Active"**

### Method B: Check Logs from Development Machine

```powershell
# From your PC, run:
adb logcat -s "TrustOverlay:*" "ATAK:*" | Select-String -Pattern "TrustOverlay|Plugin"
```

Look for entries like:
```
TrustOverlay: Plugin initialized
TrustOverlay: Registering with ATAK MapComponent
ATAK: Plugin loaded: com.aethercore.atak.trustoverlay
```

---

## Step 3: Access Trust Overlay Features

The Trust Overlay integrates into ATAK's UI in several locations:

### A. Map Overlays (Primary Interface)

**Location:** On the ATAK map view

**What to Look For:**
- **Trust Score Indicators** on unit icons
  - 🟢 Green = Verified/Trusted
  - 🟡 Yellow = Unconfirmed
  - 🔴 Red = Byzantine/Untrusted
- **Merkle Vine Chain Status** (top status bar)
- **Node Identity Badge** (your device's hardware-backed identity)

### B. Trust Detail Panel

**How to Access:**
1. In ATAK map view, **long-press** on any unit/marker
2. Select **"Trust Details"** from context menu
3. Panel shows:
   - Signature verification status
   - Trust score history
   - Merkle Vine chain integrity
   - Hardware attestation status

### C. Settings Menu

**Location:** ATAK Settings → AetherCore Trust Overlay

**Options:**
- **Hardware Identity Status** (Titan M2 keystore info)
- **Mesh Network Configuration**
- **Byzantine Detection Settings**
- **Merkle Vine Sync Status**
- **Enable/Disable Trust Visualization**

### D. Side Panel Widget (if configured)

**Location:** ATAK side toolbar

**Icon:** Look for AetherCore logo or trust shield icon

**Shows:**
- Current trust mesh status
- Connected peers
- Recent Byzantine alerts
- Identity attestation status

---

## Step 4: Verify Hardware Identity Initialized

### On Device (via ATAK UI):

1. Go to **Settings** → **AetherCore Trust Overlay**
2. Check **"Identity Status"** section
3. Should show:
   ```
   ✅ Hardware Keystore: Titan M2
   ✅ Node Identity: [32-byte hex ID]
   ✅ Ed25519 Key: Hardware-backed
   ✅ Attestation: Valid
   ```

### From Development Machine:

```powershell
# Monitor initialization logs
adb logcat -s "TrustOverlay:V" | Select-String "identity|keystore|Titan"
```

Expected output:
```
TrustOverlay: Initializing hardware-rooted identity...
TrustOverlay: Android Keystore: AVAILABLE
TrustOverlay: StrongBox backing: YES (Titan M2)
TrustOverlay: Ed25519 key generated: aethercore_node_key_001
TrustOverlay: Node identity: a7f3e2c1b9d8...
TrustOverlay: Hardware attestation: VERIFIED
TrustOverlay: Ready for mesh operations
```

---

## Step 5: Test Trust Overlay Functionality

### Test 1: Send a CoT Message

1. In ATAK, create a marker or send a position update
2. The Trust Overlay will automatically:
   - Sign the CoT message with Ed25519 (Titan M2)
   - Add Merkle Vine proof
   - Include hardware attestation
3. Check logs for:
   ```
   TrustOverlay: Signing CoT event [event-id]
   TrustOverlay: Merkle proof attached
   TrustOverlay: Signature verified
   ```

### Test 2: View Trust Scores

1. If other ATAK users are on your network
2. Their markers should show trust indicators
3. Tap any marker → **Trust Details** to see:
   - Signature validation
   - Trust score (0-100)
   - Merkle chain status

### Test 3: Check Byzantine Detection

1. Go to **Settings** → **AetherCore Trust Overlay** → **Byzantine Detection**
2. Should show:
   - Number of mesh peers detected
   - Quarantined nodes (if any)
   - Recent validation attempts

---

## Common UI Elements

### Status Indicators on Map

| Symbol | Meaning |
|--------|---------|
| 🟢 Shield | Cryptographically verified, trusted |
| 🟡 Shield | Unverified, awaiting attestation |
| 🔴 Shield | Byzantine fault detected, quarantined |
| 🔒 Lock | Hardware-backed identity confirmed |
| ⛓️ Chain | Merkle Vine chain intact |
| ⚠️ Warning | Signature verification failed |

### Trust Score Colors

- **Green (90-100):** Fully trusted, hardware-attested
- **Yellow (50-89):** Partially trusted, software-attested
- **Orange (20-49):** Questionable, verification issues
- **Red (0-19):** Untrusted, Byzantine behavior detected

---

## Troubleshooting Access Issues

### Issue: Can't Find Trust Overlay in Plugins

**Solution:**
1. Restart ATAK-Civ completely (force stop from Android Settings)
2. Check if plugin is installed:
   ```powershell
   adb shell pm list packages | Select-String "trustoverlay"
   ```
3. Check ATAK logs for plugin loading errors:
   ```powershell
   adb logcat -s "ATAK:E" "PluginService:*"
   ```

### Issue: No Trust Indicators on Map

**Possible Causes:**
1. Trust visualization disabled in settings
2. No other mesh peers detected yet
3. Plugin still initializing

**Solution:**
1. Go to **Settings** → **AetherCore Trust Overlay**
2. Enable **"Show Trust Overlays"**
3. Wait 30 seconds for initialization
4. Check logs: `adb logcat -s "TrustOverlay:*"`

### Issue: Hardware Identity Shows "Not Initialized"

**Solution:**
1. Grant keystore permissions when prompted
2. Restart ATAK to re-trigger initialization
3. Check Android Settings → Apps → ATAK-Civ → Permissions
4. Ensure "Secure Keystore Access" is granted

### Issue: Can't See Side Panel Widget

**Solution:**
1. The widget may not be enabled by default
2. In ATAK, go to **Tools** → **Manage Tools**
3. Enable **"AetherCore Trust Panel"**
4. Drag widget to desired location in toolbar

---

## Quick Reference: Where to Find Features

| Feature | Location |
|---------|----------|
| Plugin Status | Settings → Tool Preferences → Plugins |
| Trust Overlay Settings | Settings → AetherCore Trust Overlay |
| Trust Detail Panel | Long-press unit → "Trust Details" |
| Hardware Identity | Settings → AetherCore → Identity Status |
| Byzantine Detection | Settings → AetherCore → Security |
| Mesh Peer List | Side panel widget (if enabled) |
| Trust Indicators | On map markers (colored shields) |
| Merkle Vine Status | Top status bar or side widget |
| Signature Logs | Settings → AetherCore → Diagnostics |

---

## Advanced: Direct Package Access

### Via Android Settings

1. **Settings** → **Apps**
2. Find **"AetherCore Trust Overlay"** in app list
3. View:
   - Storage usage
   - Permissions
   - Notifications
   - Battery usage

### Via ADB (Development)

```powershell
# Launch the app directly (though it's a plugin, not standalone)
adb shell am start -n com.aethercore.atak.trustoverlay/.TrustOverlayLifecycle

# View app info
adb shell dumpsys package com.aethercore.atak.trustoverlay

# Check running services
adb shell dumpsys activity services | Select-String "aethercore"

# Monitor in real-time
adb logcat -s "TrustOverlay:*" "AetherCore:*" "RalphieNode:*"
```

---

## Integration Points in ATAK

The Trust Overlay hooks into these ATAK components:

1. **MapComponent** - Adds trust overlays to map
2. **DropDownReceiver** - Handles trust detail panel
3. **CotService** - Intercepts and signs CoT messages
4. **PluginLifecycle** - Manages startup/shutdown
5. **PreferenceFragment** - Settings UI
6. **LayoutWidget** - Side panel (if enabled)

---

## First-Time User Flow

1. **Open ATAK-Civ** on Pixel 9 Pro XL
2. **Grant permissions** when prompted (keystore access)
3. **Wait for initialization** (~5 seconds)
4. **Check notification area** for "AetherCore Trust Overlay: Active"
5. **Open map view** - you should see your own identity badge
6. **Go to Settings** → **AetherCore Trust Overlay** to verify Titan M2 status
7. **Send a test marker** - it will be automatically signed
8. **Check logs** from PC to confirm signing operations

---

## Visual Indicators You'll See

### On Startup
- ATAK splash screen → "Loading plugins..."
- Notification: "AetherCore Trust Overlay initializing..."
- Status bar icon: 🔐 (lock with checkmark)

### During Operation
- Your position marker: 🟢 shield (hardware-backed)
- Other users: Trust-colored shields based on verification
- Top bar: "Mesh: X peers | Vine: ✓ synced"

### In Settings
- "Hardware Root: Titan M2 ✓"
- "Node ID: a7f3e2c1..." (first 8 hex chars)
- "Trust Score: Self (100)"

---

## Support & Monitoring

### Live Monitoring (Recommended)
Keep this running on your PC while testing on device:
```powershell
cd C:\Users\Owner\StudioProjects\AetherCore\plugins\atak-trust-overlay
.\verify-deployment.ps1 -Continuous
```

### Screenshot Test Markers
When first using the overlay:
1. Take screenshots of ATAK with trust indicators visible
2. Save to verify correct UI integration
3. Use for field operator training

### Report Issues
If something doesn't work as expected:
1. Run: `.\verify-deployment.ps1 -ShowAllLogs > device-logs.txt`
2. Save logs for analysis
3. Check against expected behavior in this guide

---

**Remember:** The Trust Overlay runs **inside ATAK-Civ** as a plugin, not as a standalone app. You won't find it in your app drawer separately - it only exists within ATAK's context.

**Primary Access Point:** Open ATAK-Civ → Plugin features are automatically integrated into the map view and settings.

