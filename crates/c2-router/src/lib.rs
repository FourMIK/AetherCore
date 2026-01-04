//! C2 Router - Command and Control routing for AetherCore
//!
//! This crate provides the command routing infrastructure for the H2OS C2 Bridge.
//! It handles:
//! - Command type definitions for unit and swarm operations
//! - Authority verification with Ed25519 signatures
//! - Quorum-gated actuation based on command scope
//! - Command dispatch with unit/swarm fan-out
//! - Truth-Chain Ledger integration for command audit
//! - gRPC service interface (placeholder)
//!
//! # Architecture
//!
//! Commands flow through the following pipeline:
//! 1. Command received via gRPC or REST API
//! 2. Authority signatures verified by `AuthorityVerifier`
//! 3. Quorum requirements checked by `QuorumGate`
//! 4. Command dispatched by `CommandDispatcher`
//! 5. Command recorded in Truth-Chain by `TruthChainRecorder`
//!
//! # Command Types
//!
//! - **UnitCommand**: Single unit operations (navigate, scan, reboot, etc.)
//! - **SwarmCommand**: Multi-unit coordinated operations (formation, area scan, etc.)
//!
//! # Authority Levels
//!
//! - Single unit, non-critical: Operator signature only
//! - Single unit, critical: Operator + 1 coalition member
//! - Swarm command, < 5 units: Operator + 1 coalition member
//! - Swarm command, ≥ 5 units: 2-of-3 coalition quorum
//! - Emergency stop: Operator signature only (immediate)
//!
//! # Examples
//!
//! ```no_run
//! use aethercore_c2_router::{
//!     command_types::{UnitCommand, Coordinate},
//!     authority::AuthorityVerifier,
//!     quorum::QuorumGate,
//!     dispatcher::CommandDispatcher,
//! };
//!
//! // Create command
//! let command = UnitCommand::Navigate {
//!     waypoint: Coordinate { lat: 45.0, lon: -122.0, alt: Some(100.0) },
//!     speed: Some(10.0),
//!     altitude: Some(100.0),
//! };
//!
//! // Set up verifier and gate
//! let verifier = AuthorityVerifier::new();
//! let gate = QuorumGate::new(verifier);
//!
//! // Dispatch command
//! let dispatcher = CommandDispatcher::new();
//! let result = dispatcher.dispatch_unit_command("unit-1", &command, 1000);
//! ```

#![warn(missing_docs)]

pub mod authority;
pub mod command_types;
pub mod dispatcher;
pub mod feeds;
pub mod grpc;
pub mod ledger;
pub mod offline;
pub mod quorum;

// Re-export commonly used types
pub use authority::{AuthorityError, AuthoritySignature, AuthorityVerifier};
pub use command_types::{
    ConfigUpdate, Coordinate, FormationType, GeoBoundary, MeshTopology, ScanParameters, ScanType,
    SwarmCommand, UnitCommand,
};
pub use dispatcher::{
    CommandDispatcher, DispatchError, SwarmDispatchStatus, UnitDispatchResult,
};
pub use feeds::{AlertFeed, FleetFeed, MissionFeed};
pub use grpc::{
    c2_proto, C2GrpcServer, C2Router, C2RouterServer, AbortRequest, AbortResponse,
    CommandStatusRequest, CommandStatusResponse, SwarmCommandRequest, SwarmCommandResponse,
    UnitCommandRequest, UnitCommandResponse,
};
pub use ledger::{CommandRecord, RecorderError, TruthChainRecorder};
pub use offline::{
    ConnectionState, EncryptedPacket, OfflineError, OfflineGapInfo, OfflineMateriaBuffer,
};
pub use quorum::{CommandScope, QuorumError, QuorumGate, QuorumProof};
