//! Command type definitions for unit and swarm operations
//!
//! This module defines the command structures for controlling individual units
//! and coordinated swarm operations. All commands are cryptographically signed
//! and audited in the Truth-Chain Ledger.

#![warn(missing_docs)]

use serde::{Deserialize, Serialize};

/// Geographic coordinate (latitude, longitude, altitude)
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Coordinate {
    /// Latitude in decimal degrees
    pub lat: f64,
    /// Longitude in decimal degrees
    pub lon: f64,
    /// Altitude in meters (optional)
    pub alt: Option<f32>,
}

/// Scan type enumeration
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum ScanType {
    /// Visual spectrum scan
    Visual,
    /// Infrared scan
    Infrared,
    /// Radio frequency scan
    RadioFrequency,
    /// Combined multi-spectrum scan
    MultiSpectrum,
}

/// Scan parameters
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ScanParameters {
    /// Resolution in meters per pixel
    pub resolution_m: Option<f32>,
    /// Scan duration in seconds
    pub duration_secs: Option<u32>,
    /// Additional scan-specific parameters
    pub custom: Option<serde_json::Value>,
}

/// Configuration update
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ConfigUpdate {
    /// Configuration key
    pub key: String,
    /// Configuration value as JSON
    pub value: serde_json::Value,
}

/// Formation type for swarm operations
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum FormationType {
    /// Line formation
    Line,
    /// V formation
    VFormation,
    /// Column formation
    Column,
    /// Spread formation
    Spread,
    /// Custom formation with relative positions
    Custom {
        /// Relative positions for each unit
        positions: Vec<(f32, f32)>,
    },
}

/// Geographic boundary definition
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct GeoBoundary {
    /// List of coordinates defining the boundary polygon
    pub vertices: Vec<Coordinate>,
}

/// Mesh topology configuration
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum MeshTopology {
    /// Fully connected mesh
    FullMesh,
    /// Star topology with hub
    Star {
        /// Hub unit identifier
        hub_unit_id: String,
    },
    /// Ring topology
    Ring,
    /// Custom topology with explicit connections
    Custom {
        /// Explicit unit-to-unit connections
        connections: Vec<(String, String)>,
    },
}

/// Single unit command enumeration
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum UnitCommand {
    /// Navigate to waypoint
    Navigate {
        /// Target waypoint coordinate
        waypoint: Coordinate,
        /// Speed in m/s (optional)
        speed: Option<f32>,
        /// Altitude in meters (optional)
        altitude: Option<f32>,
    },
    /// Loiter at current or specified location
    Loiter {
        /// Loiter duration in seconds (optional, infinite if None)
        duration_secs: Option<u32>,
        /// Loiter radius in meters (optional)
        radius_m: Option<f32>,
    },
    /// Return to base
    ReturnToBase {
        /// Base identifier
        base_id: String,
    },
    /// Execute scan operation
    Scan {
        /// Type of scan to perform
        scan_type: ScanType,
        /// Scan parameters
        parameters: ScanParameters,
    },
    /// Relay message to another unit
    Relay {
        /// Target unit identifier
        target_unit_id: String,
        /// Message payload
        payload: Vec<u8>,
    },
    /// Update unit configuration
    Configure {
        /// Configuration delta to apply
        config_delta: ConfigUpdate,
    },
    /// Reboot unit
    Reboot {
        /// Delay before reboot in seconds
        delay_secs: u32,
    },
    /// Execute self-test sequence
    SelfTest,
    /// Emergency stop all operations
    EmergencyStop {
        /// Reason for emergency stop
        reason: String,
    },
}

/// Multi-unit swarm command enumeration
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum SwarmCommand {
    /// Move formation to destination
    FormationMove {
        /// Formation type
        formation: FormationType,
        /// Destination coordinate
        destination: Coordinate,
        /// Formation speed in m/s
        speed: f32,
    },
    /// Scan area with coordinated coverage
    AreaScan {
        /// Boundary of scan area
        boundary: GeoBoundary,
        /// Type of scan
        scan_type: ScanType,
        /// Overlap percentage between unit coverage
        overlap_percent: u8,
    },
    /// Reconfigure mesh topology
    ReconfMesh {
        /// New mesh topology
        topology: MeshTopology,
    },
    /// Execute synchronized action across units
    SyncExecute {
        /// Action to execute on all units
        action: UnitCommand,
        /// Synchronization time in nanoseconds since epoch
        sync_time_ns: u64,
    },
    /// Abort all pending operations
    AbortAll {
        /// Reason for abort
        reason: String,
    },
    /// Recall all units to base
    RecallAll {
        /// Base identifier
        base_id: String,
    },
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_unit_command_serialization() {
        let cmd = UnitCommand::Navigate {
            waypoint: Coordinate {
                lat: 45.0,
                lon: -122.0,
                alt: Some(100.0),
            },
            speed: Some(10.0),
            altitude: Some(100.0),
        };

        let json = serde_json::to_string(&cmd).unwrap();
        let deserialized: UnitCommand = serde_json::from_str(&json).unwrap();
        assert_eq!(cmd, deserialized);
    }

    #[test]
    fn test_swarm_command_serialization() {
        let cmd = SwarmCommand::RecallAll {
            base_id: "BASE-001".to_string(),
        };

        let json = serde_json::to_string(&cmd).unwrap();
        let deserialized: SwarmCommand = serde_json::from_str(&json).unwrap();
        assert_eq!(cmd, deserialized);
    }
}
