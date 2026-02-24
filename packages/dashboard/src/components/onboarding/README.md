# One Interaction Add Node Wizard

## Design Philosophy

**"One Interaction"** - The user shouldn't care if it's a Pi or an Arduino. They just want the node online.

## Components

### 1. AddNodeWizard.tsx (Main Container)
The primary orchestrator for the node onboarding flow. Provides a clean, tactical glass interface with two main views:
- **Radar View**: Asset detection and selection
- **Activation View**: Device provisioning and trust verification

**Key Features:**
- Auto-scan on wizard open
- Seamless transition between views
- Automatic node registration on success
- "Link Established" audio feedback
- Progress indicators

### 2. AssetRadar.tsx (Sonar View)
A radar-like detection interface that discovers all provisionable hardware on USB and network.

**Features:**
- **Auto-scan**: Automatically scans for assets when component mounts
- **Visual Indicators**:
  - 🔌 USB Icon for Arduino/ESP32/Heltec devices
  - 📶 WiFi Icon for Raspberry Pi devices
- **Single Action**: One "ACTIVATE" button per detected asset
- **Sonar Animation**: Pulsing radar effect during scan
- **Real-time Detection**: Uses `scan_for_assets` Tauri command

**Supported Hardware:**
- **USB Devices**: Arduino, Heltec, ESP32, Silicon Labs, FTDI, CH340
- **Network Devices**: Raspberry Pi (via mDNS _aethercore._tcp.local)

### 3. ActivationTerminal.tsx (Progress View)
Terminal-style interface showing real-time provisioning progress with distinct flows for USB and Network devices.

**USB Flow:**
1. Firmware path input
2. "Flashing Silicon..." progress bar
3. Real-time flash events via `flash_progress` Tauri events
4. "Verifying Trust..." cryptographic validation
5. Success: Green shield with device callsign

**Network Flow:**
1. Password input (pre-filled with 'raspberry')
2. "Injecting Agent..." SSH connection
3. "Securing Keys..." TPM key generation
4. "Verifying Trust..." attestation
5. Success: Green shield with device callsign

**Features:**
- Real-time terminal log output
- Progress bar for USB devices
- Password prompt for network devices
- Color-coded log levels (info/success/error)
- Auto-scrolling log viewer
- Fail-visible error reporting

## Backend Integration

### Tauri Commands Used

#### `scan_for_assets()`
Returns a list of `CandidateNode` objects representing discoverable hardware.

```typescript
interface CandidateNode {
  type: string;  // "USB" or "NET"
  id: string;    // Port name or IP address
  label: string; // Human-readable description
}
```

#### `provision_target(target, credentials?, firmwarePath?)`
Unified provisioning command that handles both USB and Network flows.

**USB Parameters:**
- `target`: CandidateNode
- `firmwarePath`: Path to firmware binary
- `credentials`: null

**Network Parameters:**
- `target`: CandidateNode
- `credentials`: { username, password }
- `firmwarePath`: null

**Returns:**
```typescript
interface ProvisioningResult {
  identity: GenesisIdentity;
}

interface GenesisIdentity {
  public_key: string;
  root_hash: string;    // BLAKE3 hash (no SHA-256)
  callsign: string;     // Human-readable identifier
}
```

#### Window Events

**`flash_progress`** (USB only)
Emitted during firmware flashing with progress updates.

```typescript
{
  stage: string;     // "initializing", "connecting", "flashing", etc.
  message: string;   // Human-readable status
  progress: number;  // 0.0 to 1.0
}
```

## Styling

Uses the tactical Tailwind theme:
- **Colors**: carbon (background), tungsten (text), overmatch (accent), verified-green (success), jamming (error)
- **Fonts**: Rajdhani (display), Inter (sans), JetBrains Mono (code)
- **Animations**: fadeIn, slideInUp, pulse effects

## Security Considerations

### Fail-Visible Philosophy
All failures are explicit and reported immediately. No graceful degradation for security failures.

### Trust Verification
- Every provisioned device must provide a valid `GenesisIdentity`
- BLAKE3 hashing exclusively (no SHA-256)
- TPM-backed attestation for network devices
- Cryptographic verification before node registration

### Network Security
- SSH connections use standard port 22
- Password authentication (TPM key exchange in production)
- mDNS discovery limited to `_aethercore._tcp.local` service

## Usage

The wizard is accessible from the DashboardLayout via the "Add Node" button.

```typescript
import { AddNodeWizard } from './components/onboarding/AddNodeWizard';

// In your component:
const [showWizard, setShowWizard] = useState(false);

return (
  <>
    <button onClick={() => setShowWizard(true)}>Add Node</button>
    {showWizard && <AddNodeWizard onClose={() => setShowWizard(false)} />}
  </>
);
```

## Migration from Old Wizard

The previous multi-step wizard (`AddNodeWizard.old.tsx`) has been replaced with this streamlined version. The old wizard had:
- Platform selection step
- Identity configuration
- QR enrollment (satellite)
- Gateway script generation
- Deployment configuration

The new wizard consolidates this into:
1. Auto-detect all devices
2. Single activation button
3. Automatic provisioning

This reduces operator cognitive load from 7+ steps to 1 interaction.

## Testing

The components integrate with the existing Tauri backend commands. To test:

1. **USB Device Testing**:
   - Connect an ESP32/Arduino/Heltec device
   - Open the wizard
   - Verify device appears in asset list
   - Click ACTIVATE
   - Provide firmware path
   - Monitor flash progress

2. **Network Device Testing**:
   - Ensure Raspberry Pi is on network running aethercore service
   - Open the wizard
   - Verify Pi appears in asset list
   - Click ACTIVATE
   - Enter password
   - Monitor SSH injection logs

3. **Success Flow**:
   - Verify "Link Established" sound plays
   - Verify green shield appears with callsign
   - Verify node appears on tactical map
   - Verify node status shows as "online"
