//! Unit Status - Telemetry and trust scoring for AetherCore units
//!
//! This crate provides unit status management for the H2OS C2 Bridge.
//! It handles:
//! - Unit status types mapped from H2OS Device entity (excluding H2 fields)
//! - Telemetry data structures (pressure, temperature, GPS, battery, connectivity)
//! - Trust scoring for telemetry (stale detection, attestation verification)
//! - CosmosDB change feed subscription (placeholder)
//! - WebSocket server for real-time mesh health telemetry (Tactical Glass)
//! - Great Gospel revocation ledger (Aetheric Sweep protocol)
//!
//! # Exclusions
//!
//! This crate **explicitly excludes** all H2/fill/purge operations:
//! - H2PurgeSetup
//! - FillSession
//! - DeviceControls.H2Detect
//! - DeviceControls.CGFLT
//! - CustomerSetPoint
//! - ComFillEnabled
//!
//! These fields are permanently sequestered and not applicable to FTCase units.
//!
//! # Trust Scoring
//!
//! Telemetry trust is scored based on:
//! - **Staleness**: Telemetry > 30s old is degraded
//! - **Attestation**: Unverifiable telemetry is marked as SPOOFED
//! - **Connectivity**: Connection state impacts trust score
//! - **Completeness**: Missing optional fields reduce trust score
//!
//! # Examples
//!
//! ```no_run
//! use aethercore_unit_status::{
//!     types::{UnitStatus, UnitTelemetry, ConnectivityState},
//!     trust::TelemetryTrustScorer,
//! };
//!
//! let telemetry = UnitTelemetry {
//!     pressure_psi: Some(14.7),
//!     temperature_c: Some(20.0),
//!     battery_percent: Some(80),
//!     gps: None,
//!     connectivity: ConnectivityState::Connected,
//!     attestation_hash: [0u8; 32],
//!     timestamp_ns: 1000,
//! };
//!
//! let scorer = TelemetryTrustScorer::new();
//! let trust_score = scorer.score_telemetry(&telemetry, 1000, true);
//! ```

#![warn(missing_docs)]

pub mod feed;
pub mod gospel;
pub mod schema;
pub mod trust;
pub mod types;
pub mod websocket;

// Re-export commonly used types
pub use feed::{ChangeFeedEvent, CosmosDbFeedSubscriber, FeedError};
pub use gospel::{GospelError, GospelLedger, GospelState, RevocationCertificate, RevocationReason};
pub use schema::{
    HealthMetrics, MeshEvent, MeshHealthPayload, RevocationPayload,
    RevocationReason as SchemaRevocationReason,
};
pub use trust::{TelemetryTrustScorer, TrustLevel};
pub use types::{
    ConnectivityState, Coordinate, OperationalState, PlatformType, UnitStatus, UnitTelemetry,
};
pub use websocket::{
    MeshHealthMessage, RevocationCertificate as WsRevocationCertificate,
    RevocationReason as WsRevocationReason, WsMessage, WsServer,
};
