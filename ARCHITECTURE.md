# AetherCore Architecture

**Last Updated:** 2025-01-23  
**Purpose:** High-level system architecture overview for internal engineering use

---

## Overview

AetherCore is a distributed system designed for tamper-evident data streaming and mesh network coordination. The system consists of Rust core components for edge computing and trust mesh operations, and TypeScript components for operator interfaces and service orchestration.

## System Components

```
┌─────────────────────────────────────────────────────────┐
│                   Operator Interface                     │
│               (TypeScript - Tauri Desktop)               │
├─────────────────────────────────────────────────────────┤
│                   Service Layer                          │
│        (Node.js Services - Gateway, Fleet, Auth)        │
├─────────────────────────────────────────────────────────┤
│                   Core Engine                            │
│         (Rust Crates - Mesh, Trust, Crypto)            │
└─────────────────────────────────────────────────────────┘
```

## Rust Workspace (`/crates`)

The Rust workspace contains the core system implementation:

### Core Infrastructure

- **`core`** - Foundational types, traits, and shared utilities
- **`domain`** - Domain model, business logic, and error types
- **`crypto`** - Cryptographic primitives (Ed25519 signing, BLAKE3 hashing)
- **`identity`** - Identity management and registry

### Network and Communication

- **`mesh`** - Mesh networking protocol implementation
- **`trust_mesh`** - Trust scoring and Byzantine fault detection
- **`stream`** - Data streaming with Merkle Vine integrity chains
- **`c2-router`** - Command and control message routing

### Edge Computing

- **`edge`** - Edge node runtime and execution environment
- **`isr`** - Intelligence, Surveillance, Reconnaissance capabilities
- **`rf`** - Radio frequency functionality
- **`radio`** - Radio communication protocols

### Legacy Integration

- **`h2-domain`** - H2OS/4MIK integration layer (references `/legacy`)
- **`unit-status`** - Operational status tracking

## TypeScript Workspace

### Packages (`/packages`)

Reusable TypeScript libraries:

- **`dashboard`** - Tauri-based desktop application (Tactical Glass)
  - React UI with 3D visualization
  - Real-time telemetry display
  - Node management and monitoring
  - Embedded Rust runtime (via Tauri)

- **`shared`** - Common utilities and types
  - Telemetry schemas (Zod validation)
  - Type definitions shared across packages
  - Configuration utilities

- **`canonical-schema`** - Canonical data structure definitions
- **`h2-glass`** - H2OS Glass interface components (legacy integration)

### Services (`/services`)

Backend Node.js services:

- **`gateway`** - API Gateway for external requests
- **`auth`** - Authentication and authorization service
- **`fleet`** - Fleet management and orchestration
- **`operator`** - Operator command service

## Data Flow

### Telemetry Ingestion

```
Edge Node → Stream (Merkle Vine) → Trust Mesh (Verification) 
         → Services (Gateway) → Dashboard (Display)
```

1. **Edge nodes** generate telemetry events
2. **Stream crate** chains events into Merkle Vine structure
3. **Trust mesh** verifies integrity and assigns trust scores
4. **Services** route verified data to appropriate consumers
5. **Dashboard** displays real-time status and alerts

### Command Dispatch

```
Dashboard (Operator) → Services (Auth/Gateway) → C2 Router 
                    → Mesh Network → Target Node(s)
```

1. **Operator** issues command via Dashboard
2. **Services** authenticate and authorize request
3. **C2 Router** dispatches to mesh network
4. **Mesh** delivers to target node(s)
5. **Acknowledgement** flows back through same path

## Interaction Patterns

### Rust ↔ TypeScript Bridge

The **Tauri** framework bridges Rust and TypeScript:

- **TypeScript frontend** invokes Rust commands via Tauri IPC
- **Rust backend** exposes commands in `packages/dashboard/src-tauri/src/commands.rs`
- **Type safety** maintained through Tauri's type generation

Example flow:
```
React Component → Tauri API → Rust Command Handler → Core Crate Logic
```

### Service Communication

Services communicate via:

- **REST APIs** for synchronous operations
- **WebSockets** for real-time telemetry streaming
- **gRPC** (future) for performance-critical inter-service communication

### Trust Mesh Coordination

Trust mesh operates on gossip protocol:

- Nodes periodically exchange trust scores
- Byzantine behavior triggers **Aetheric Sweep** (quarantine protocol)
- Consensus achieved through weighted trust voting

## Security Architecture

### Layered Security Model

1. **Cryptographic Layer**
   - Ed25519 digital signatures
   - BLAKE3 content hashing
   - Merkle Vine integrity chains

2. **Trust Layer**
   - Peer trust scoring
   - Byzantine detection
   - Automatic node isolation

3. **Network Layer**
   - TLS 1.3 for all authenticated connections
   - WSS for WebSocket security
   - Certificate pinning (production)

4. **Application Layer**
   - Input validation (Zod schemas)
   - Least-privilege access control
   - Audit logging

### Dev Mode vs Production

**Dev Mode** (current deployment):
- Simulated identity registry
- Software-based signing
- Local-only operation
- No attestation

**Production** (future):
- TPM/Secure Enclave integration
- Hardware-backed signing
- Remote attestation
- Network-wide trust anchors

See [DEV_MODE.md](DEV_MODE.md) for detailed comparison.

## Build System

### Rust Build

```bash
# Build all Rust crates
cargo build --workspace --release

# Run Rust tests
cargo test --workspace
```

Dependencies managed in root `Cargo.toml` workspace configuration.

### TypeScript Build

```bash
# Install dependencies (all workspaces)
pnpm install --frozen-lockfile

# Build all packages and services
npm run build

# Build Tauri desktop application
cd packages/dashboard && npm run tauri:build
```

Dependencies managed via npm workspaces in root `package.json`.

## Configuration

### Environment Variables

- `RUST_LOG` - Rust logging level (debug, info, warn, error)
- `NODE_ENV` - Node.js environment (development, production)

### Configuration Files

- `tauri.conf.json` - Tauri application configuration
- `Cargo.toml` - Rust workspace and dependency configuration
- `package.json` - Node.js workspace configuration
- `tsconfig.json` - TypeScript compiler settings

## Development Workflow

1. **Local Development**
   ```bash
   # Start Tauri dev mode (hot reload)
   cd packages/dashboard
   npm run tauri:dev
   ```

2. **Testing**
   ```bash
   # Rust tests
   cargo test --workspace
   
   # TypeScript tests
   npm run test
   ```

3. **Building**
   ```bash
   # Windows MSI installer
   cd packages/dashboard
   npm run tauri:build
   ```

## Deployment Architecture

### Desktop Deployment (Current)

```
Windows PC → Tauri Application (MSI) → Embedded Rust Runtime 
          → Local Services (optional) → Mesh Network
```

### Production Deployment (Future)

```
Edge Nodes → Mesh Network → Service Cluster → Operator Consoles
```

See [RUNNING_ON_WINDOWS.md](RUNNING_ON_WINDOWS.md) for Windows-specific details.

---

## Further Reading

- [DEV_MODE.md](DEV_MODE.md) - Development mode capabilities and limitations
- [PROTOCOL_OVERVIEW.md](PROTOCOL_OVERVIEW.md) - Protocol concepts and design
- [SECURITY_SCOPE.md](SECURITY_SCOPE.md) - Security boundaries and threat model
- [CONTRIBUTING.md](CONTRIBUTING.md) - Contribution guidelines
