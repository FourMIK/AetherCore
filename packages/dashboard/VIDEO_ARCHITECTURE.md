# Video Streaming Architecture

## System Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         AETHERCORE PLATFORM                              │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                  ┌─────────────────┴─────────────────┐
                  │                                   │
         ┌────────▼────────┐                 ┌───────▼────────┐
         │  FLIR Trust     │                 │   Tactical     │
         │    Bridge       │                 │     Store      │
         │  (Backend)      │                 │  (Frontend)    │
         └────────┬────────┘                 └───────┬────────┘
                  │                                  │
                  │ Creates TacticalNode             │
                  │ with videoStream                 │
                  │                                  │
                  └──────────────┬───────────────────┘
                                 │
                    ┌────────────▼────────────┐
                    │   TacticalNode          │
                    │   ┌─────────────────┐   │
                    │   │ videoStream?    │   │
                    │   │ ├─ url          │   │
                    │   │ ├─ format       │   │
                    │   │ ├─ status       │   │
                    │   │ └─ metadata     │   │
                    │   └─────────────────┘   │
                    └────────────┬────────────┘
                                 │
                    ┌────────────▼────────────┐
                    │    ISRConsoleView       │
                    │  (Workspace Component)  │
                    └────────────┬────────────┘
                                 │
                                 │ Detects videoStream
                                 │
                    ┌────────────▼─────────────┐
                    │  AgnosticVideoPlayer     │
                    │  (Format Detection)      │
                    └────────────┬─────────────┘
                                 │
              ┌──────────────────┼──────────────────┐
              │                  │                  │
    ┌─────────▼────────┐ ┌──────▼──────┐ ┌────────▼────────┐
    │   HLS Player     │ │MJPEG Player │ │  Mock FLIR      │
    │  ┌───────────┐   │ │ ┌─────────┐ │ │  ┌──────────┐  │
    │  │<video>    │   │ │ │ <img>   │ │ │  │ Animated │  │
    │  │+ HLS.js   │   │ │ │         │ │ │  │ Thermal  │  │
    │  └───────────┘   │ │ └─────────┘ │ │  └──────────┘  │
    └──────────────────┘ └─────────────┘ └─────────────────┘
```

## Data Flow

```
┌──────────────────────────────────────────────────────────────────┐
│ 1. FLIR Device Streams Data                                      │
│    └─> UDP Telemetry + Video Stream                              │
└──────────────────┬───────────────────────────────────────────────┘
                   │
┌──────────────────▼───────────────────────────────────────────────┐
│ 2. FLIR Trust Bridge (Backend Service)                           │
│    ├─> Parses NMEA-0183 track data                               │
│    ├─> Creates TacticalNode with position                        │
│    └─> Adds videoStream metadata                                 │
└──────────────────┬───────────────────────────────────────────────┘
                   │
┌──────────────────▼───────────────────────────────────────────────┐
│ 3. TacticalStore (Zustand State)                                 │
│    └─> nodes: Map<string, TacticalNode>                          │
│        └─> Each node may have videoStream property               │
└──────────────────┬───────────────────────────────────────────────┘
                   │
┌──────────────────▼───────────────────────────────────────────────┐
│ 4. User Interaction                                               │
│    ├─> Selects node in Tactical Map                              │
│    └─> selectedNodeId updated in store                           │
└──────────────────┬───────────────────────────────────────────────┘
                   │
┌──────────────────▼───────────────────────────────────────────────┐
│ 5. ISRConsoleView Reacts                                          │
│    ├─> Reads selectedNodeId from store                           │
│    ├─> Gets node: nodes.get(selectedNodeId)                      │
│    ├─> Checks if node.videoStream exists                         │
│    └─> Renders AgnosticVideoPlayer if present                    │
└──────────────────┬───────────────────────────────────────────────┘
                   │
┌──────────────────▼───────────────────────────────────────────────┐
│ 6. AgnosticVideoPlayer Renders                                    │
│    ├─> Detects stream.format                                     │
│    ├─> Selects appropriate player component                      │
│    ├─> Displays status overlays                                  │
│    └─> Shows stream metadata                                     │
└───────────────────────────────────────────────────────────────────┘
```

## Component Hierarchy

```
App
└── TacticalGlass
    └── Workspace (ISR Console selected)
        └── ISRConsoleView
            ├── GlassPanel (Visual Intelligence)
            │   └── Active Feeds: {count}
            ├── GlassPanel (Signal Intelligence)
            └── GlassPanel (Reconnaissance Feed)
                ├── Header (with node ID)
                ├── AgnosticVideoPlayer
                │   ├── [Format-specific player]
                │   ├── Status Overlay (if needed)
                │   └── Stream Info Badge
                └── Stream Information Panel
                    └── Metadata Grid
```

## Type Relationships

```typescript
// Type hierarchy
VideoStream
  ├─ url: string
  ├─ format: 'hls' | 'webrtc' | 'mjpeg' | 'mock-flir'
  ├─ status: 'live' | 'offline' | 'connecting'
  ├─ resolution?: string
  └─ metadata?
      ├─ fps?: number
      ├─ bitrate?: number
      └─ codec?: string

TacticalNode
  ├─ id: string
  ├─ domain: string
  ├─ position: GeoPosition
  ├─ ... (existing properties)
  └─ videoStream?: VideoStream  // Optional!

TacticalStore
  ├─ nodes: Map<string, TacticalNode>
  ├─ selectedNodeId: string | null
  └─ ... (existing state)
```

## Format Detection Logic

```
AgnosticVideoPlayer.tsx
     │
     ├─ stream.format === 'hls'
     │   └─> renderHLS()
     │       ├─ Check native support
     │       ├─ Fallback to HLS.js
     │       └─ Return <video> element
     │
     ├─ stream.format === 'mjpeg'
     │   └─> renderMJPEG()
     │       └─ Return <img> element
     │
     ├─ stream.format === 'webrtc'
     │   └─> renderWebRTC()
     │       ├─ Future: Signaling server
     │       └─ Return <video> element
     │
     └─ stream.format === 'mock-flir'
         └─> renderMockFLIR()
             ├─ Animated gradient
             ├─ FLIR HUD overlay
             └─ Thermal visualization
```

## State Management Flow

```
User Action: Select Node
     │
     ├─> useTacticalStore.selectNode(nodeId)
     │
     ├─> selectedNodeId = nodeId
     │
     └─> ISRConsoleView re-renders
          │
          ├─> const selectedNode = nodes.get(selectedNodeId)
          │
          ├─> const videoStream = selectedNode?.videoStream
          │
          └─> if (videoStream)
               └─> <AgnosticVideoPlayer stream={videoStream} />
              else
               └─> <NoVideoPlaceholder />
```

## Error Handling Flow

```
AgnosticVideoPlayer
     │
     ├─ Stream Loading
     │   ├─ isLoading = true
     │   └─> Show "Connecting..." overlay
     │
     ├─ Stream Success
     │   ├─ isLoading = false
     │   ├─ error = null
     │   └─> Display video + metadata
     │
     └─ Stream Error
         ├─ isLoading = false
         ├─ error = errorMessage
         ├─> Call onError callback
         └─> Show "Offline" overlay
```

## Integration Points

```
┌─────────────────────────────────────────────────────────────┐
│                    External Systems                          │
└─────────────────────────────────────────────────────────────┘
        │                    │                    │
   ┌────▼────┐          ┌───▼────┐          ┌───▼────┐
   │  FLIR   │          │  HLS   │          │ WebRTC │
   │ Nexus   │          │ Server │          │ Server │
   │ Camera  │          └────────┘          └────────┘
   └────┬────┘
        │
┌───────▼──────────────────────────────────────────────────────┐
│              FLIR Trust Bridge (Backend)                      │
│  ├─> CGI Client (Authentication)                             │
│  ├─> UDP Listener (Telemetry)                                │
│  └─> Node Creation with videoStream                          │
└───────┬──────────────────────────────────────────────────────┘
        │
┌───────▼──────────────────────────────────────────────────────┐
│           AetherCore Trust Mesh & C2 Router                   │
└───────┬──────────────────────────────────────────────────────┘
        │
┌───────▼──────────────────────────────────────────────────────┐
│          Tactical Glass Dashboard (Frontend)                  │
│  ├─> TacticalStore (nodes with videoStream)                  │
│  ├─> ISRConsoleView (display)                                │
│  └─> AgnosticVideoPlayer (rendering)                         │
└───────────────────────────────────────────────────────────────┘
```

## Security Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Security Layers                           │
└─────────────────────────────────────────────────────────────┘
        │
   ┌────▼────────────────────────────────────────────────┐
   │  Transport Security (TLS 1.3)                       │
   │  ├─> HTTPS for HLS/MJPEG                            │
   │  └─> DTLS for WebRTC                                │
   └────┬────────────────────────────────────────────────┘
        │
   ┌────▼────────────────────────────────────────────────┐
   │  Authentication & Authorization                      │
   │  ├─> FLIR device credentials                        │
   │  ├─> Node trust scores                              │
   │  └─> User permissions                               │
   └────┬────────────────────────────────────────────────┘
        │
   ┌────▼────────────────────────────────────────────────┐
   │  Input Validation                                    │
   │  ├─> URL sanitization                               │
   │  ├─> Format validation                              │
   │  └─> Metadata verification                          │
   └─────────────────────────────────────────────────────┘
```

## Performance Optimization

```
┌─────────────────────────────────────────────────────────────┐
│              Performance Considerations                      │
└─────────────────────────────────────────────────────────────┘
        │
   ┌────▼────────────────────────────────────────────────┐
   │  React Optimization                                  │
   │  ├─> useMemo for node lookups                       │
   │  ├─> Conditional rendering                          │
   │  └─> Lazy loading for heavy components              │
   └────┬────────────────────────────────────────────────┘
        │
   ┌────▼────────────────────────────────────────────────┐
   │  Video Optimization                                  │
   │  ├─> Hardware acceleration                          │
   │  ├─> Adaptive bitrate (HLS)                         │
   │  └─> Buffer management                              │
   └────┬────────────────────────────────────────────────┘
        │
   ┌────▼────────────────────────────────────────────────┐
   │  Network Optimization                                │
   │  ├─> Connection pooling                             │
   │  ├─> Bandwidth monitoring                           │
   │  └─> Graceful degradation                           │
   └─────────────────────────────────────────────────────┘
```

## Deployment Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                   Production Deployment                      │
└─────────────────────────────────────────────────────────────┘
        │
   ┌────▼────────────────────────────────────────────────┐
   │  Edge Nodes (FLIR devices)                          │
   │  ├─> UDP telemetry stream                           │
   │  ├─> MJPEG/HLS video stream                         │
   │  └─> Local network (192.168.x.x)                    │
   └────┬────────────────────────────────────────────────┘
        │
   ┌────▼────────────────────────────────────────────────┐
   │  Backend Services (Docker/K8s)                      │
   │  ├─> h2-ingest (FLIR Trust Bridge)                  │
   │  ├─> Trust Mesh validators                          │
   │  └─> C2 Router                                       │
   └────┬────────────────────────────────────────────────┘
        │
   ┌────▼────────────────────────────────────────────────┐
   │  Tactical Glass (Desktop/Web)                       │
   │  ├─> React SPA (Vite build)                         │
   │  ├─> Tauri wrapper (desktop)                        │
   │  └─> Real-time updates (WebSocket)                  │
   └─────────────────────────────────────────────────────┘
```

---

**Legend:**
- `│`, `├─>`, `└─>`: Flow direction
- `┌─┐`, `└─┘`: Component boundaries
- `▼`: Data flow downward
- `?`: Optional property
