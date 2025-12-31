//! Fleet domain models for H2OS assets
//!
//! Provides Rust domain models for H2OS fleet assets (Trucks, Trailers, Stations, Devices)
//! as Federated Materia Slots with cryptographic attestation.

pub mod assets;
pub mod registry;
pub mod telemetry;

pub use assets::{FixedInstallation, FleetAsset, MobileAsset, SensorNode, TowableAsset};
pub use registry::FleetRegistry;
pub use telemetry::{
    AttestedGPSReading, AttestedH2DetectReading, AttestedPT100Reading, AttestedPressureReading,
};
