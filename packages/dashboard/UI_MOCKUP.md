# ISR Console UI Mockup

## Before Implementation (Original State)

```
┌─────────────────────────────────────────────────────────────────┐
│ ISR Console                                                      │
└─────────────────────────────────────────────────────────────────┘

┌──────────────────────────────┬──────────────────────────────────┐
│ 📷 Visual Intelligence       │ 🛰️  Signal Intelligence         │
│                               │                                  │
│ Active Feeds: 0               │ RF Channels: 0                   │
│ Recording: Inactive           │ Intercepts: None                 │
│ Storage Used: 0 GB            │ Classification: N/A              │
└──────────────────────────────┴──────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│ 👁️  Reconnaissance Feed                                         │
│                                                                  │
│                        ⚠️                                        │
│                 No ISR Materia Slots                            │
│                      Configured                                  │
│                                                                  │
│         Deploy ISR-capable units to                             │
│              enable reconnaissance                               │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

---

## After Implementation - With Mock FLIR Stream

```
┌─────────────────────────────────────────────────────────────────┐
│ ISR Console                                                      │
└─────────────────────────────────────────────────────────────────┘

┌──────────────────────────────┬──────────────────────────────────┐
│ 📷 Visual Intelligence       │ 🛰️  Signal Intelligence         │
│                               │                                  │
│ Active Feeds: 2 ◄────────────┼─ NOW SHOWS COUNT                │
│ Recording: Active             │ RF Channels: 0                   │
│ Storage Used: 0 GB            │ Intercepts: None                 │
└──────────────────────────────┴──────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│ 👁️  Reconnaissance Feed                    Node: flir-drone-001 │◄─ SHOWS NODE ID
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │ ╔══════════════════════════════════════════════════════╗ │  │
│  │ ║ FLIR NEXUS                                  25.3°C   ║ │  │◄─ FLIR HUD
│  │ ║ THERMAL                                        REC   ║ │  │
│  │ ║                                                      ║ │  │
│  │ ║         ░░░▒▒▒▓▓▓███████▓▓▓▒▒▒░░░                  ║ │  │
│  │ ║       ▒▒▒▓▓▓█████████████████▓▓▓▒▒▒                ║ │  │◄─ ANIMATED
│  │ ║      ▓▓▓██████████████████████████▓▓▓              ║ │  │   THERMAL
│  │ ║     ▓▓▓████████████⊕█████████████▓▓▓               ║ │  │   GRADIENT
│  │ ║      ▓▓▓██████████████████████████▓▓▓              ║ │  │
│  │ ║       ▒▒▒▓▓▓█████████████████▓▓▓▒▒▒                ║ │  │
│  │ ║         ░░░▒▒▒▓▓▓███████▓▓▓▒▒▒░░░                  ║ │  │
│  │ ║                                                      ║ │  │
│  │ ║ 640x480                           12:34:56 PM       ║ │  │
│  │ ╚══════════════════════════════════════════════════════╝ │  │
│  └──────────────────────────────────────────────────────────┘  │
│                                                                  │
│  📡 MOCK-FLIR • 640x480 • 30fps                                │◄─ STREAM INFO
│                                                                  │
├─────────────────────────────────────────────────────────────────┤
│ 📹 Stream Information                                           │
│                                                                  │
│ Format: MOCK-FLIR          Status: live                        │◄─ METADATA
│ Resolution: 640x480        Frame Rate: 30 fps                  │   PANEL
│ Codec: H264                Bitrate: 5000 kbps                  │
└─────────────────────────────────────────────────────────────────┘
```

---

## After Implementation - With HLS Stream

```
┌─────────────────────────────────────────────────────────────────┐
│ ISR Console                                                      │
└─────────────────────────────────────────────────────────────────┘

┌──────────────────────────────┬──────────────────────────────────┐
│ 📷 Visual Intelligence       │ 🛰️  Signal Intelligence         │
│                               │                                  │
│ Active Feeds: 1               │ RF Channels: 0                   │
│ Recording: Active             │ Intercepts: None                 │
│ Storage Used: 0 GB            │ Intercepts: None                 │
└──────────────────────────────┴──────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│ 👁️  Reconnaissance Feed                 Node: surveillance-001  │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │                                                           │  │
│  │                  ┌─────────────────┐                     │  │
│  │                  │                  │                     │  │
│  │                  │                  │                     │  │
│  │                  │   VIDEO PLAYER   │                     │  │◄─ STANDARD
│  │                  │   WITH CONTROLS  │                     │  │   HTML5
│  │                  │                  │                     │  │   VIDEO
│  │                  │  ▶ ═════════──  │                     │  │
│  │                  │    00:15 / 02:34 │                     │  │
│  │                  │                  │                     │  │
│  │                  └─────────────────┘                     │  │
│  │                                                           │  │
│  └──────────────────────────────────────────────────────────┘  │
│                                                                  │
│  📡 HLS • 1920x1080 • 30fps                                    │
│                                                                  │
├─────────────────────────────────────────────────────────────────┤
│ 📹 Stream Information                                           │
│                                                                  │
│ Format: HLS                Status: live                        │
│ Resolution: 1920x1080      Frame Rate: 30 fps                  │
│ Codec: H264                Bitrate: 5000 kbps                  │
└─────────────────────────────────────────────────────────────────┘
```

---

## After Implementation - Connecting State

```
┌─────────────────────────────────────────────────────────────────┐
│ ISR Console                                                      │
└─────────────────────────────────────────────────────────────────┘

┌──────────────────────────────┬──────────────────────────────────┐
│ 📷 Visual Intelligence       │ 🛰️  Signal Intelligence         │
│                               │                                  │
│ Active Feeds: 0               │ RF Channels: 0                   │
│ Recording: Inactive           │ Intercepts: None                 │
│ Storage Used: 0 GB            │ Classification: N/A              │
└──────────────────────────────┴──────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│ 👁️  Reconnaissance Feed                        Node: cam-002    │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │                                                           │  │
│  │                                                           │  │
│  │                          ⟳                                │  │◄─ LOADING
│  │                     Connecting...                         │  │   OVERLAY
│  │                                                           │  │
│  │                                                           │  │
│  └──────────────────────────────────────────────────────────┘  │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

---

## After Implementation - Offline State

```
┌─────────────────────────────────────────────────────────────────┐
│ ISR Console                                                      │
└─────────────────────────────────────────────────────────────────┘

┌──────────────────────────────┬──────────────────────────────────┐
│ 📷 Visual Intelligence       │ 🛰️  Signal Intelligence         │
│                               │                                  │
│ Active Feeds: 0               │ RF Channels: 0                   │
│ Recording: Inactive           │ Intercepts: None                 │
│ Storage Used: 0 GB            │ Classification: N/A              │
└──────────────────────────────┴──────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│ 👁️  Reconnaissance Feed                        Node: cam-003    │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │                                                           │  │
│  │                                                           │  │
│  │                          ⊗                                │  │◄─ OFFLINE
│  │                    Stream Offline                         │  │   OVERLAY
│  │                                                           │  │
│  │                                                           │  │
│  └──────────────────────────────────────────────────────────┘  │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

---

## After Implementation - No Video Node Selected

```
┌─────────────────────────────────────────────────────────────────┐
│ ISR Console                                                      │
└─────────────────────────────────────────────────────────────────┘

┌──────────────────────────────┬──────────────────────────────────┐
│ 📷 Visual Intelligence       │ 🛰️  Signal Intelligence         │
│                               │                                  │
│ Active Feeds: 2               │ RF Channels: 0                   │
│ Recording: Active             │ Intercepts: None                 │
│ Storage Used: 0 GB            │ Classification: N/A              │
└──────────────────────────────┴──────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│ 👁️  Reconnaissance Feed                   Node: standard-node-1 │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│                        ⚠️                                        │
│          No video stream available for selected node            │◄─ HELPFUL
│                                                                  │   MESSAGE
│              This node does not have ISR capabilities           │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

---

## Component Breakdown

### Visual Intelligence Panel
- **Active Feeds Counter**: Dynamically counts nodes with live videoStream
- **Recording Status**: Updates based on active feeds
- **Storage**: Placeholder for future video recording feature

### Signal Intelligence Panel
- **Unchanged**: Existing functionality preserved
- **No Breaking Changes**: Original design maintained

### Reconnaissance Feed Panel
- **Header**: Shows selected node ID
- **Video Player Area**: 
  - Full-width responsive container
  - Minimum height for comfortable viewing
  - Maintains aspect ratio
- **Stream Info Badge**: Format, resolution, FPS overlay
- **Metadata Panel**: Detailed stream information

---

## Responsive Behavior

### Desktop (Wide Screen)
```
┌─────────────────────────────────────────────────────┐
│  Visual Intel Panel  │  Signal Intel Panel          │
└─────────────────────────────────────────────────────┘
┌─────────────────────────────────────────────────────┐
│              Reconnaissance Feed                     │
│  ┌────────────────────────────────────────────────┐ │
│  │         [ LARGE VIDEO PLAYER ]                 │ │
│  └────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────┘
```

### Mobile/Narrow (Future Enhancement)
```
┌────────────────────┐
│ Visual Intel Panel │
└────────────────────┘
┌────────────────────┐
│ Signal Intel Panel │
└────────────────────┘
┌────────────────────┐
│ Recon Feed         │
│  ┌──────────────┐  │
│  │ VIDEO PLAYER │  │
│  └──────────────┘  │
└────────────────────┘
```

---

## Color Scheme (Tactical Glass Theme)

```
Background Colors:
- Panel: carbon (#0a0a0a with opacity)
- Video BG: carbon/50
- Overlays: carbon/80 with backdrop-blur

Text Colors:
- Primary: tungsten (light gray)
- Secondary: tungsten/70 (dimmed)
- Accent: overmatch (orange/red)
- Inactive: tungsten/50

Border Colors:
- Light: tungsten/10
- Medium: overmatch/50
- Error: red-500

Status Indicators:
- Live: overmatch (orange)
- Offline: red-500
- Connecting: tungsten/70
```

---

## Interactive Elements

### Video Player Controls
- **HLS/Video**: Native HTML5 controls (play, pause, seek, volume, fullscreen)
- **MJPEG**: No controls (continuous stream)
- **Mock FLIR**: No controls (animated visualization)

### Stream Badge
- **Format**: Uppercase format type
- **Resolution**: Pixel dimensions
- **FPS**: Frame rate
- **Always visible** when stream is live

### Metadata Panel
- **Grid Layout**: 2 columns
- **Dynamic Fields**: Only shows available metadata
- **Monospace Font**: For technical values
- **Color Coded**: Status uses color indicators

---

## Animation & Transitions

### Mock FLIR Thermal
- **Gradient Animation**: Pulsing thermal gradient
- **HUD Overlay**: Scanlines and crosshair
- **Live Clock**: Real-time timestamp updates
- **Smooth**: 60fps animations

### Loading States
- **Spinner**: Rotating loader icon
- **Fade In**: Smooth opacity transition
- **Backdrop Blur**: Glassmorphism effect

### Error States
- **Fade In**: Error message appears smoothly
- **Icon**: Clear visual indicator
- **Message**: Helpful troubleshooting text

---

## Accessibility

- **Alt Text**: Descriptive alt text for images
- **ARIA Labels**: Screen reader support
- **Keyboard Navigation**: Full keyboard support for video controls
- **High Contrast**: Readable text on all backgrounds
- **Focus Indicators**: Clear focus outlines

---

## Performance

- **Lazy Loading**: Video only loads when visible
- **Memory Management**: Proper cleanup on unmount
- **Conditional Rendering**: Only renders active format
- **Optimized Updates**: useMemo for expensive calculations
- **Hardware Acceleration**: Leverages GPU for video

