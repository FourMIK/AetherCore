//! AetherCore H2-Domain
//! 
//! H2OS domain integration layer with PowerMIK industrial standardization.
//! 
//! This crate provides:
//! - Hardware-rooted sensor schemas (Materia Slots)
//! - Byzantine-resilient actuation (quorum-based commands)
//! - Safety systems (heartbeat monitoring, dead man's switch)
//! - Alarm aggregation with attestation binding
//! 
//! **Note**: This crate is allowed to reference `/legacy` according to monorepo rules.

#![warn(missing_docs)]

pub mod materia;
pub mod actuation;
pub mod safety;
pub mod alarms;
pub mod bridge;
pub mod fleet;

// Re-export key types for convenience
pub use materia::{MateriaSlot, MerkleVineLink, TpmAttestation};
pub use actuation::{QuorumProof, ValveCommand, SafetyReason};
pub use safety::{Heartbeat, DeadManSwitch, SystemMode};
pub use alarms::{AlarmCode, AttestedAlarm};
pub use bridge::{EventMapper, H2OSTelemetryAdapter};
pub use fleet::{FleetRegistry, MobileAsset, TowableAsset, FixedInstallation, SensorNode};
