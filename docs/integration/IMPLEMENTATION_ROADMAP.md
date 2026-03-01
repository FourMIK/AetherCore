# Dashboard-ATAK Integration Implementation Roadmap

**Status**: Planning  
**Current Phase**: Phase 2B/3 Complete (ATAK-side only)  
**Next Phase**: Dashboard Integration (Phases A-F)  
**Date**: 2026-03-01

---

## Current State (Completed)

### Phase 1 & 2: ATAK-Side RalphieNode Integration ✅
- Hardware-rooted identity registration
- Trust scoring via Rust backend
- JNI bridge for daemon capabilities
- Automated trust delta updates on CoT ingestion
- Thread-safe Rust state management

### Phase 2B: Identity Auto-Registration ✅
- `TrustIdentityExtractor` pure function module
- `IdentityManager::register_with_guards()` with Byzantine detection
- JNI methods: `nativeGetIdentityStatus()`, `nativeGetComputedTrustScore()`
- Auto-registration from CoT events with key mismatch warnings

### Phase 3 Preparation: Merkle Vine Foundation ✅
- `EventCanonicalizer` module (deterministic serialization)
- `IntegrityEvent` trait (chain-linked events interface)
- Hash continuity slot in `DaemonState`
- Chain verification functions

**Files**: ~1,100 lines across 11 files (Rust + Kotlin)

---

## Dashboard Integration Phases (Not Yet Started)

### Phase A: Contract Definition 🔄 IN PROGRESS

**Status**: Specification document created

**Deliverables**:
- [x] Integration specification v1.0
- [ ] Shared TypeScript types (`packages/shared/src/types/integration.ts`)
- [ ] Shared Rust types (`crates/integration/src/types.rs`)
- [ ] Message serialization/deserialization utilities

**Estimated Effort**: 2-3 days

---

### Phase B: Transport Layer 📋 PLANNED

**Objective**: Establish WebSocket-based communication between dashboard and ATAK nodes

**Components**:

#### B.1 Dashboard WebSocket Server
- **Location**: New service `services/integration-gateway/`
- **Tech Stack**: Node.js + TypeScript + ws library
- **Responsibilities**:
  - Accept WebSocket connections
  - Enrollment handshake
  - Session management
  - Message routing to dashboard backend
  - Heartbeat monitoring

**Files**:
- `services/integration-gateway/src/server.ts` - WebSocket server
- `services/integration-gateway/src/enrollment.ts` - Enrollment handler
- `services/integration-gateway/src/session.ts` - Session management
- `services/integration-gateway/src/state-machine.ts` - Connection state
- `services/integration-gateway/package.json` - Dependencies

#### B.2 ATAK Daemon WebSocket Client
- **Location**: `external/aethercore-jni/src/websocket_client.rs`
- **Responsibilities**:
  - Connect to dashboard on startup
  - Enrollment handshake
  - Reconnect with exponential backoff
  - Message serialization
  - Heartbeat sending

**Files**:
- `external/aethercore-jni/src/websocket_client.rs` - WebSocket client
- `external/aethercore-jni/src/message_builder.rs` - Message construction
- `external/aethercore-jni/Cargo.toml` - Add tokio-tungstenite dependency

#### B.3 Authentication
- **Approach**: Session-based (Phase 1), mTLS (Phase 2)
- **Files**:
  - `services/integration-gateway/src/auth.ts` - Auth logic
  - `services/integration-gateway/src/allowlist.ts` - Node allowlist

**Estimated Effort**: 4-5 days

---

### Phase C: Telemetry Pipeline 📋 PLANNED

**Objective**: ATAK daemon publishes trust telemetry, dashboard receives and displays

#### C.1 ATAK Telemetry Publisher
- **Location**: `external/aethercore-jni/src/telemetry_publisher.rs`
- **Responsibilities**:
  - Periodically collect trust state from `TrustScorer`
  - Collect identity status from `IdentityManager`
  - Collect stream integrity status (using `last_event_hash`)
  - Serialize to JSON
  - Sign messages with node key
  - Send to dashboard via WebSocket

**Files**:
- `external/aethercore-jni/src/telemetry_publisher.rs` - Telemetry collection
- Update `external/aethercore-jni/src/lib.rs` - Spawn telemetry task

#### C.2 Dashboard Ingestion Layer
- **Location**: `services/integration-gateway/src/ingestion/`
- **Responsibilities**:
  - Receive telemetry messages
  - Verify signatures
  - Validate schema
  - Store time-series data (PostgreSQL or InfluxDB)
  - Update current state snapshot (Redis or in-memory)

**Files**:
- `services/integration-gateway/src/ingestion/verifier.ts` - Signature verification
- `services/integration-gateway/src/ingestion/storage.ts` - Time-series storage
- `services/integration-gateway/src/ingestion/snapshot.ts` - State snapshot

#### C.3 Dashboard API Layer
- **Location**: `services/integration-gateway/src/api/`
- **Responsibilities**:
  - REST API for dashboard UI queries
  - WebSocket stream for real-time updates to UI
  - Authorization for dashboard operators

**Files**:
- `services/integration-gateway/src/api/routes.ts` - REST routes
- `services/integration-gateway/src/api/websocket-ui.ts` - UI WebSocket stream

#### C.4 Dashboard UI Components
- **Location**: `packages/dashboard/src/components/atak/`
- **Responsibilities**:
  - Node list with connection status
  - Trust overlay view
  - Identity status display
  - Fail-visible error badges

**Files**:
- `packages/dashboard/src/components/atak/AtakNodeList.tsx` - Node list
- `packages/dashboard/src/components/atak/AtakNodeDetail.tsx` - Node detail
- `packages/dashboard/src/components/atak/TrustOverlay.tsx` - Trust visualization
- `packages/dashboard/src/services/atak-integration.ts` - API client

**Estimated Effort**: 5-7 days

---

### Phase D: Command Path 📋 PLANNED

**Objective**: Dashboard operators can issue signed commands to ATAK nodes

#### D.1 Command Envelope
- Define `OperatorCommand` schema
- Operator key management
- Command signing

#### D.2 Command Dispatch
- Dashboard command builder
- Authorization checks
- Command routing via WebSocket

#### D.3 Command Handling (ATAK)
- Signature verification
- Policy enforcement
- Execution against daemon
- Receipt generation

#### D.4 Audit Panel
- Dashboard audit log display
- Receipt tracking

**Files**:
- `packages/dashboard/src/components/atak/CommandPanel.tsx`
- `services/integration-gateway/src/commands/`
- `external/aethercore-jni/src/command_handler.rs`

**Estimated Effort**: 4-5 days

---

### Phase E: Resilience & Security Hardening 📋 PLANNED

**Objective**: Production-ready transport with comprehensive error handling

#### E.1 Reconnect Logic
- Exponential backoff with jitter
- Connection state persistence
- Message buffering during disconnect

#### E.2 Rate Limiting
- Per-node message rate limits
- Burst handling
- Backpressure

#### E.3 Security Enhancements
- Replay detection (message ID tracking)
- Timestamp bounds enforcement
- mTLS migration

**Estimated Effort**: 3-4 days

---

### Phase F: Testing & Observability 📋 PLANNED

**Objective**: Comprehensive testing and production monitoring

#### F.1 Integration Tests
- Simulated ATAK node
- End-to-end message flow
- Failure injection tests
- Security tests

#### F.2 Observability
- Structured logging (Winston/Bunyan)
- Metrics (Prometheus)
- Distributed tracing (OpenTelemetry)
- Dashboards (Grafana)

#### F.3 Deployment
- Docker Compose for local dev
- Kubernetes manifests for production
- Deployment playbooks

**Estimated Effort**: 5-6 days

---

## Total Estimated Effort

**Phase A**: 2-3 days  
**Phase B**: 4-5 days  
**Phase C**: 5-7 days  
**Phase D**: 4-5 days  
**Phase E**: 3-4 days  
**Phase F**: 5-6 days  

**Total**: 23-30 days (4-6 weeks for a single developer)

---

## Implementation Strategy

### Incremental Approach

1. **Week 1-2**: Phases A + B (Contract + Transport)
   - Establish connection
   - Basic enrollment handshake
   - Heartbeat flow

2. **Week 3-4**: Phase C (Telemetry Pipeline)
   - ATAK publishes trust state
   - Dashboard receives and stores
   - Basic UI display

3. **Week 5**: Phase D (Command Path)
   - Operator commands
   - Receipt tracking

4. **Week 6**: Phases E + F (Hardening + Testing)
   - Security enhancements
   - Comprehensive tests
   - Production deployment

### Milestones

- **M1** (Week 2): Dashboard can connect to ATAK node and complete enrollment
- **M2** (Week 4): Dashboard displays real-time trust state from ATAK
- **M3** (Week 5): Operator can issue force sweep command from dashboard
- **M4** (Week 6): Production-ready deployment with full test suite

---

## Dependencies

### New Packages

**Rust (ATAK Daemon)**:
- `tokio-tungstenite` - WebSocket client
- `serde_json` - JSON serialization
- `uuid` - Message IDs

**Node.js (Dashboard Gateway)**:
- `ws` - WebSocket server
- `express` - REST API
- `ioredis` - State snapshot cache
- `pg` or `influxdb-client` - Time-series storage
- `winston` - Structured logging
- `jsonwebtoken` - Session tokens

**TypeScript (Dashboard UI)**:
- Existing Tauri stack
- No new dependencies

### Infrastructure

- PostgreSQL or InfluxDB for time-series storage
- Redis for state snapshot cache (optional)
- Reverse proxy (Nginx) for WebSocket termination

---

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                     TACTICAL GLASS (Dashboard)                  │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌──────────────┐        ┌──────────────┐                      │
│  │ UI (React)   │◄───────┤ API Client   │                      │
│  │ Components   │        │ (Tauri Cmds) │                      │
│  └──────────────┘        └──────┬───────┘                      │
│                                 │                               │
│                                 │ REST + WS                     │
│                                 ▼                               │
│  ┌─────────────────────────────────────────────────────┐       │
│  │     Integration Gateway Service (Node.js)           │       │
│  │                                                      │       │
│  │  ┌──────────────┐  ┌──────────────┐  ┌──────────┐ │       │
│  │  │ WS Server    │  │ Ingestion    │  │ Storage  │ │       │
│  │  │ (Nodes)      │─▶│ & Verifier   │─▶│ Layer    │ │       │
│  │  └──────────────┘  └──────────────┘  └──────────┘ │       │
│  │                                                      │       │
│  │  ┌──────────────┐  ┌──────────────┐                │       │
│  │  │ Auth &       │  │ Command      │                │       │
│  │  │ Enrollment   │  │ Dispatcher   │                │       │
│  │  └──────────────┘  └──────────────┘                │       │
│  └─────────────────────────────────────────────────────┘       │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
                                │
                                │ WebSocket (wss://)
                                │ + Heartbeat
                                │ + Signed Messages
                                ▼
┌─────────────────────────────────────────────────────────────────┐
│                    ATAK UNIT (RalphieNode)                      │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │     external/aethercore-jni (Rust Daemon)                │  │
│  │                                                           │  │
│  │  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  │  │
│  │  │ WS Client    │◄─┤ Telemetry    │◄─┤ TrustScorer  │  │  │
│  │  │              │  │ Publisher    │  │ IdentityMgr  │  │  │
│  │  └──────────────┘  └──────────────┘  └──────────────┘  │  │
│  │         │                                                │  │
│  │         │ Reconnect + Enrollment                        │  │
│  │         │                                                │  │
│  │  ┌──────────────┐  ┌──────────────┐                    │  │
│  │  │ Command      │  │ Message      │                    │  │
│  │  │ Handler      │  │ Signer       │                    │  │
│  │  └──────────────┘  └──────────────┘                    │  │
│  └──────────────────────────────────────────────────────────┘  │
│                                                                 │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │     ATAK Plugin (Kotlin)                                 │  │
│  │  - CoT parsing & ATAK UI                                 │  │
│  │  - Feeds trust events to daemon via JNI                 │  │
│  └──────────────────────────────────────────────────────────┘  │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## Risk Assessment

### High Priority Risks

1. **Scope Creep**: Full integration is 20-30 days of work
   - **Mitigation**: Strict incremental approach, defer non-critical features

2. **ATAK Deployment Constraints**: ATAK runs on Android, limited resources
   - **Mitigation**: Keep daemon lightweight, efficient message batching

3. **DDIL Reconnect Storms**: Many nodes reconnecting simultaneously
   - **Mitigation**: Exponential backoff with jitter, connection rate limiting

### Medium Priority Risks

1. **Clock Skew**: Field devices may have inaccurate clocks
   - **Mitigation**: Bounded timestamp windows (±5 min), NTP recommendations

2. **Message Ordering**: WebSocket doesn't guarantee ordering across connections
   - **Mitigation**: Monotonic sequence numbers, idempotent updates

3. **Storage Scaling**: Time-series data growth
   - **Mitigation**: Retention policies, downsampling older data

---

## Decision Log

### Decision 1: WebSocket vs gRPC

**Chosen**: WebSocket  
**Rationale**:
- Browser-native (no additional tooling)
- Simpler authentication integration
- Better for intermittent connections
- Tauri has built-in WebSocket support

**Alternative**: gRPC would provide stronger typing and better performance but requires code generation and more complex browser setup.

### Decision 2: Session-Based Auth (Phase 1) vs mTLS

**Chosen**: Session-based for Phase 1, migrate to mTLS in Phase 2  
**Rationale**:
- Session-based is faster to implement
- mTLS requires certificate management infrastructure
- Can migrate incrementally without breaking existing deployments

### Decision 3: Time-Series Storage

**Options**: PostgreSQL with TimescaleDB, InfluxDB, Prometheus  
**Recommendation**: PostgreSQL + TimescaleDB extension  
**Rationale**:
- PostgreSQL already used in AetherCore
- TimescaleDB provides time-series optimization
- Simpler deployment than separate InfluxDB
- SQL queries more familiar to team

---

## Next Steps

1. **Review** this roadmap with stakeholders
2. **Prioritize** phases based on operational needs
3. **Allocate** development resources (1-2 developers recommended)
4. **Start** Phase A: Implement shared types
5. **Iterate** weekly with demos and feedback

---

**Status**: Roadmap Complete, Awaiting Go/No-Go Decision  
**Owner**: AetherCore Integration Team  
**Last Updated**: 2026-03-01
