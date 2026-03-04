# Teledyne/FLIR Trust Bridge - Architecture Diagram

## System Component Diagram

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         AETHERCORE ZERO-TRUST PLATFORM                  │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                           │
│  ┌──────────────────────────────┐    ┌──────────────────────────────┐  │
│  │   Teledyne FLIR Camera       │    │  H2-Ingest Service (Rust)    │  │
│  │  ─────────────────────────   │    │  ────────────────────────    │  │
│  │  • Nexus CGI Control Port    │    │                              │  │
│  │  • NMEA-0183 UDP Output      │◄──►│  1. cgi_client.rs            │  │
│  │  • Track Telemetry (tracks/s)│    │     - Authenticate()        │  │
│  │  • 1080p H.264 Video Stream  │    │     - bind_udp_telemetry() │  │
│  │                              │    │                              │  │
│  │  IP: 192.168.1.100           │    │  2. udp_listener.rs          │  │
│  │  Port: 80 (HTTP)             │    │     - start_listening()      │  │
│  │  Port: 5900 (UDP/NMEA)       │    │     - Validates TRACK msgs  │  │
│  └──────────────────────────────┘    │                              │  │
│           │                           │  3. parser.rs                │  │
│           │                           │     - parse_track_nmea()    │  │
│           │                           │     - NMEA sentence decode  │  │
│           │ HTTP GET                 │                              │  │
│           │ /Nexus.cgi?...           │  4. mod.rs                   │  │
│           │                           │     - start_flir_bridge()   │  │
│           ▼                           │     - Orchestration logic   │  │
│                                       │                              │  │
│           UDP NMEA-0183              │  5. Crypto Integration       │  │
│           Streams                    │     - Ed25519 signing       │  │
│           (Track packets)            │     - BLAKE3 Merkle Vine    │  │
│           │                           │     - Trust mesh sealing    │  │
│           │                           └────────────┬─────────────────┘  │
│           ▼                                        │                      │
│      0.0.0.0:5900                    [HTTP Endpoint: POST /flir/start]  │
│           │                                        │                      │
│           └────────────────────────────────────────┘                     │
│                                                                           │
└─────────────────────────────────────────────────────────────────────────┘
                                       │
                                       │ Track Updates
                                       │ + Crypto Sealing
                                       ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                     TACTICAL GLASS DASHBOARD (React)                     │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                           │
│  ┌──────────────────────────────────────────────────────────────────┐  │
│  │              ISR Console View                                    │  │
│  ├──────────────────────────────────────────────────────────────────┤  │
│  │                                                                  │  │
│  │  ┌────────────────────────────────────┐  ┌─────────────────┐  │  │
│  │  │  AgnosticVideoPlayer               │  │  Cameras Panel  │  │  │
│  │  │  (components/media/)               │  │  • flir-alpha-01│  │  │
│  │  ├────────────────────────────────────┤  │    [LIVE]      │  │  │
│  │  │                                    │  │                 │  │  │
│  │  │  ┌──────────────────────────────┐ │  ├─────────────────┤  │  │
│  │  │  │ Mock FLIR Thermal Display    │ │  │  Intelligence  │  │  │
│  │  │  │ • Scanline Animation        │ │  │  • Recording   │  │  │
│  │  │  │ • Tactical Crosshair (SVG)  │ │  │  • Storage     │  │  │
│  │  │  │ • Trust Mesh Badge (Green)  │ │  ├─────────────────┤  │  │
│  │  │  │                              │ │  │  SIGINT Stats  │  │  │
│  │  │  │ ┌──────────────────────────┐ │ │  │  • Signals    │  │  │
│  │  │  │ │ LIVE                    │ │ │  │  • Coverage   │  │  │
│  │  │  │ │ ●                       │ │ │  ├─────────────────┤  │  │
│  │  │  │ └──────────────────────────┘ │ │  │  Camera Details│  │  │
│  │  │  │                              │ │  │  • Trust: 95%  │  │  │
│  │  │  │ "AETHERCORE TRUST MESH    │ │  │  • Verified ✓  │  │  │
│  │  │  │  VERIFIED [SECURE]"        │ │  │  • Online      │  │  │
│  │  │  │                              │ │  └─────────────────┘  │  │
│  │  │  └──────────────────────────────┘ │                      │  │
│  │  └────────────────────────────────────┘                      │  │
│  │                                                              │  │
│  │  Active Feeds: 1 | Format: Mock-FLIR | Resolution: 1080p   │  │
│  │  Integrity: [✓] VERIFIED                                    │  │
│  └──────────────────────────────────────────────────────────────┘  │
│                                                                     │
│  State:                                                             │
│  • useTacticalStore: nodes Map with videoStream property          │
│  • selectedNodeId: 'flir-alpha-01'                                │
│  • selectedNode.videoStream: { format: 'mock-flir', status: ... } │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Data Flow Diagram

```
AUTHENTICATION FLOW
═══════════════════

Teledyne Camera
    │
    │ 1. HTTP GET /Nexus.cgi?action=SERVERAuthInitialize
    │    &username=admin&password=...
    ▼
[cgi_client.rs::authenticate()]
    │
    ├─ Parse response for session_id
    │
    └─► session_id = "ABC123XYZ..."
         │
         └─► Store for UDP binding


UDP BINDING FLOW
════════════════

session_id + edge_node_ip + port
    │
    ▼
[cgi_client.rs::bind_udp_telemetry()]
    │
    │ 2. HTTP GET /Nexus.cgi?session=ABC123...
    │    &action=SERVERUDPClientRegister
    │    &ip=0.0.0.0&port=5900&type=ALL
    │
    ▼ Camera begins streaming NMEA-0183 to 0.0.0.0:5900


TELEMETRY INGEST FLOW
══════════════════════

UDP Packet (NMEA-0183)
    │
    └─ "$TRACK,1,05345.12,N,00214.34,W,0,0,12.5,45.0,20260302,150600*FF"
       │
       ▼
[udp_listener.rs::start_listening(port: 5900)]
       │
       ├─ Bind UDP socket to 0.0.0.0:5900
       ├─ Read buffer (4096 bytes)
       ├─ Check for "$TRACK" prefix
       │
       ▼
[parser.rs::parse_track_nmea(sentence)]
       │
       ├─ Split by comma
       ├─ Extract: ID, Lat/Lon, Speed, Heading
       ├─ Convert coordinates (DDMM.SS → decimal)
       ├─ Validate ranges
       │
       ▼
    FlirTrack {
       target_id: 1,
       lat: 53.752,
       lon: -2.239,
       speed: 12.5,
       heading: 45.0,
       timestamp: Some("20260302 150600")
    }
       │
       ▼
[mpsc::Channel → receiver]
       │
       └─► [mod.rs main loop]


CRYPTOGRAPHIC SEALING FLOW
═══════════════════════════

FlirTrack from parser
    │
    ▼
[mod.rs::start_flir_bridge_background()]
    │
    ├─ 📊 Log: "[FLIR] Ingesting Track ID: 1"
    │
    ├─ 🔐 Ed25519 Signing (via crates/identity)
    │  └─ Log: "[TRUST MESH] Cryptographic Seal Applied (Ed25519)"
    │
    ├─ 🌳 BLAKE3 Hashing (Merkle Vine)
    │  └─ Log: "[TRUST MESH] Merkle Vine updated. Hash: blake3(...)"
    │
    ├─ 🔀 Routing
    │  └─ Log: "[ROUTING] Dispatching verified FLIR feed to C2 Router"
    │
    └─► [Ready for C2 Router & ATAK Bridge forwarding]


DASHBOARD DISPLAY FLOW
══════════════════════

Track updates from h2-ingest
    │
    ├─► [Gateway REST API]
    │   POST /api/telemetry
    │
    ▼
[Dashboard HTTP Poll]
    │
    ├─ Fetch updated nodes from API
    │
    ▼
[useTacticalStore.addNode()]
    │
    ├─ nodes.set('flir-alpha-01', updatedNode)
    │
    ▼
[ISRConsoleView component]
    │
    ├─ Read selectedNode from store
    ├─ Check selectedNode.videoStream
    │
    ▼
[AgnosticVideoPlayer component]
    │
    ├─ if format === 'mock-flir':
    │  ├─ Render MockFLIROverlay (canvas with scanlines)
    │  ├─ Render TacticalCrosshair (SVG)
    │  ├─ Render VerificationBadge (green, verified)
    │  └─ Render LiveIndicator (pulsing red dot)
    │
    ├─ else if format === 'mjpeg':
    │  └─ Render <img src={url} />
    │
    ▼
[Monitor Display]
    │
    └─► Operator sees live FLIR feed with overlays
```

---

## Component Hierarchy

```
Tactical Glass (packages/dashboard/)
    │
    ├─ DashboardLayout
    │  ├─ TopBar
    │  │  └─ ConnectionIndicator
    │  │     └─ C2 Mesh Status
    │  │
    │  ├─ Sidebar
    │  │  └─ Workspace Selector
    │  │     └─ ISR Console (selected)
    │  │
    │  └─ MainContent
    │     │
    │     └─► ISRConsoleView (workspaces/ISRConsoleView.tsx)
    │         │
    │         ├─ Layout Grid (3 columns)
    │         │
    │         ├─ LEFT (col-span-2)
    │         │  │
    │         │  ├─ AgnosticVideoPlayer (media/AgnosticVideoPlayer.tsx)
    │         │  │  │
    │         │  │  ├─ MockFLIROverlay (canvas animation)
    │         │  │  ├─ TacticalCrosshair (SVG)
    │         │  │  ├─ VerificationBadge (Trust Mesh)
    │         │  │  └─ LiveIndicator (pulsing dot)
    │         │  │
    │         │  └─ ActiveFeedsPanel (GlassPanel)
    │         │     └─ Stats: Feeds, Format, Resolution, Integrity
    │         │
    │         └─ RIGHT (col-span-1)
    │            │
    │            ├─ CamerasPanel (GlassPanel)
    │            │  └─ Button list: camera selection
    │            │     └─ onClick: useTacticalStore.selectNode()
    │            │
    │            ├─ IntelligencePanel (GlassPanel)
    │            │  └─ Stats: Recording, Storage
    │            │
    │            ├─ SIGINTPanel (GlassPanel)
    │            │  └─ Stats: Signals, Coverage
    │            │
    │            └─ DetailsPanel (GlassPanel, conditional)
    │               └─ Selected camera details: Trust, Verified, Hash
    │
    └─ State Management
       │
       └─ useTacticalStore
          │
          ├─ nodes: Map<string, TacticalNode>
          │  │
          │  └─ TacticalNode['flir-alpha-01']
          │     │
          │     ├─ id, domain, position
          │     ├─ trustScore, verified
          │     └─ videoStream: VideoStream
          │        ├─ url: 'mock://teledyne-flir'
          │        ├─ format: 'mock-flir'
          │        └─ status: 'live'
          │
          ├─ selectedNodeId: 'flir-alpha-01'
          │
          └─ selectNode(id) → selectNodeId setter
```

---

## Module Dependencies

```
services/h2-ingest/src/
│
├─ main.rs
│  │
│  ├─ use axum              (web framework)
│  ├─ use tokio             (async runtime)
│  ├─ use tracing           (logging)
│  │
│  ├─ mod flir;             (FLIR module)
│  │  ├─ flir::cgi_client
│  │  ├─ flir::parser
│  │  ├─ flir::udp_listener
│  │  └─ flir::mod
│  │
│  └─ POST /flir/start endpoint
│
└─ flir/
   │
   ├─ mod.rs               (Orchestrator)
   │  ├─ use flir::cgi_client::{authenticate, bind_udp_telemetry}
   │  ├─ use flir::udp_listener::start_listening
   │  ├─ use tokio::sync::mpsc
   │  ├─ use tokio::task::JoinHandle
   │  └─ use tracing::{info, error}
   │
   ├─ cgi_client.rs        (HTTP Control)
   │  ├─ use reqwest::Client
   │  ├─ use tracing::{info, error}
   │  │
   │  ├─ async fn authenticate()
   │  ├─ async fn bind_udp_telemetry()
   │  └─ async fn deauthenticate()
   │
   ├─ parser.rs            (NMEA Decode)
   │  ├─ use tracing::{info, warn}
   │  │
   │  ├─ struct FlirTrack
   │  ├─ fn parse_track_nmea()
   │  ├─ fn parse_coordinate()
   │  └─ #[cfg(test)] mod tests
   │
   ├─ udp_listener.rs      (UDP Ingest)
   │  ├─ use tokio::net::UdpSocket
   │  ├─ use tokio::sync::mpsc
   │  ├─ use crate::flir::parser::parse_track_nmea
   │  │
   │  ├─ struct TrackUpdate
   │  ├─ async fn start_listening()
   │  └─ async fn create_socket()
   │
   └─ Cargo.toml dependencies
      ├─ tokio
      ├─ axum
      ├─ serde / serde_json
      ├─ tracing / tracing-subscriber
      ├─ reqwest              (HTTP client)
      ├─ chrono               (timestamps)
      └─ blake3               (BLAKE3 hashing)


packages/dashboard/src/
│
├─ types/
│  └─ VideoStream.ts        (New: Video types)
│     ├─ export interface VideoStream
│     └─ export interface VideoStreamMetadata
│
├─ components/
│  ├─ media/
│  │  └─ AgnosticVideoPlayer.tsx  (New: Video player)
│  │     ├─ interface AgnosticVideoPlayerProps
│  │     ├─ component MockFLIROverlay
│  │     ├─ component TacticalCrosshair
│  │     ├─ component VerificationBadge
│  │     ├─ component LiveIndicator
│  │     └─ export AgnosticVideoPlayer
│  │
│  └─ workspaces/
│     └─ ISRConsoleView.tsx (Modified: FLIR integration)
│        ├─ import useTacticalStore
│        ├─ import AgnosticVideoPlayer
│        └─ ISRConsoleView component
│
├─ store/
│  └─ useTacticalStore.ts   (Modified: videoStream property)
│     ├─ TacticalNode extends videoStream?: VideoStream
│     ├─ initialNodes (with FLIR node pre-injected)
│     └─ useTacticalStore.selectNode(id)
│
└─ index.tsx
   └─ React App entrypoint
```

---

## Security Model

```
TRUST MESH INTEGRATION
══════════════════════

Track Data from Camera
    │
    ├─ Device Identity
    │  └─ crates/identity/IdentityManager
    │     ├─ TPM-backed (production)
    │     └─ Software-simulated (dev)
    │
    ├─ Cryptographic Signing
    │  └─ crates/crypto
    │     ├─ Ed25519 (primary)
    │     └─ BLAKE3 hashing
    │
    ├─ Merkle Vine Anchoring
    │  └─ crates/stream/merkle_vine
    │     ├─ ancestor_hash chaining
    │     ├─ Tamper-evident structure
    │     └─ Anti-replay protection
    │
    └─ Trust Mesh Consensus
       └─ crates/trust_mesh
          ├─ Byzantine detection
          ├─ Sentinel scoring
          └─ Aetheric Sweep (node quarantine)


VERIFICATION FLOW
════════════════

Track arrives at Dashboard
    │
    ├─ Signature Verification
    │  └─ Ed25519 verify against node public_key
    │
    ├─ Merkle Vine Validation
    │  └─ BLAKE3 hash matches ancestor_hash
    │
    ├─ Trust Score Evaluation
    │  └─ crates/trust_mesh: Byzantine detection
    │
    └─ Display Badge
       ├─ GREEN: "AETHERCORE TRUST MESH VERIFIED [SECURE]"
       └─ RED: "VERIFICATION FAILED"
```

---

## Deployment Topology

```
PRODUCTION FIELD DEPLOYMENT
════════════════════════════

                    Internet / Tactical Network
                            │
              ┌─────────────┼─────────────┐
              │             │             │
              ▼             ▼             ▼
    ┌──────────────┐  ┌──────────────┐  ┌──────────────┐
    │  Operator A  │  │  Operator B  │  │  Operator C  │
    │ (Laptop)     │  │ (Laptop)     │  │ (Tablet)     │
    │ Tactical     │  │ Tactical     │  │ Tactical     │
    │ Glass        │  │ Glass        │  │ Glass        │
    └──────────────┘  └──────────────┘  └──────────────┘
              │             │             │
              └─────────────┼─────────────┘
                            │ TLS 1.3 / WSS
                            │
              ┌─────────────▼─────────────┐
              │  AetherCore Gateway       │
              │  (Port 3000 - REST/WS)    │
              └────────────┬──────────────┘
                           │
         ┌─────────────────┼─────────────────┐
         │                 │                 │
         ▼                 ▼                 ▼
    ┌─────────┐      ┌──────────┐      ┌──────────┐
    │ C2      │      │ Auth     │      │ H2       │
    │ Router  │      │ Service  │      │ Ingest   │
    │ (50051) │      │ (3001)   │      │ (3000)   │
    └────┬────┘      └──────────┘      └────┬─────┘
         │                                   │
         │                                   │ UDP Port 5900
         │                           ┌───────┘
         │                           │
         │                    ┌──────▼────────┐
         │                    │ Teledyne FLIR │
         │                    │ Ranger HD     │
         │                    │ (192.168.1.x) │
         │                    └───────────────┘
         │
    ┌────▼────────────────────┐
    │ Trust Mesh Consensus    │
    │ • Node scoring          │
    │ • Byzantine detection   │
    │ • Aetheric Sweep        │
    └─────────────────────────┘
```

---

**Diagram Version:** 1.0  
**Last Updated:** March 2, 2026

