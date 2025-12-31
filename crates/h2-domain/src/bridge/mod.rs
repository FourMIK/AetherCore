//! H2OS Bridge - Integration layer for H2OS fleet management system
//!
//! This module provides adapters and mappers for transforming H2OS telemetry
//! and fleet data into AetherCore's canonical event format with Merkle-chained
//! attestation.

pub mod event_mapper;
pub mod telemetry_adapter;

pub use event_mapper::{EventMapper, H2OSEventType};
pub use telemetry_adapter::{H2OSTelemetryAdapter, TelemetryTransform};
