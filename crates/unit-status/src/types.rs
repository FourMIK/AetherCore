//! Unit status types mapped from H2OS Device entity
//!
//! This module defines the types for unit status and telemetry, excluding
//! all H2/fill/purge operations which are permanently sequestered.

#![warn(missing_docs)]

use aethercore_identity::PlatformIdentity;
use serde::{Deserialize, Serialize};

/// Platform type enumeration
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum PlatformType {
    /// FTCase unit
    FTCase,
    /// Mobile platform
    Mobile,
    /// Fixed sensor station
    Fixed,
    /// Aerial platform
    Aerial,
    /// Unknown or unclassified
    Unknown,
}

/// Operational state of a unit
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum OperationalState {
    /// Unit is operational and ready
    Ready,
    /// Unit is active/in-mission
    Active,
    /// Unit is in standby mode
    Standby,
    /// Unit is offline or unreachable
    Offline,
    /// Unit requires maintenance
    Maintenance,
    /// Unit has fault condition
    Fault,
}

/// Connectivity state
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum ConnectivityState {
    /// Connected with good signal
    Connected,
    /// Connected with degraded signal
    Degraded,
    /// Disconnected
    Disconnected,
    /// Unknown connectivity state
    Unknown,
}

/// Unit telemetry data (excluding H2 fields)
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct UnitTelemetry {
    /// Pressure in PSI (optional)
    pub pressure_psi: Option<f32>,
    /// Temperature in Celsius (optional)
    pub temperature_c: Option<f32>,
    /// Battery percentage (0-100)
    pub battery_percent: Option<u8>,
    /// GPS coordinate (optional)
    pub gps: Option<Coordinate>,
    /// Connectivity state
    pub connectivity: ConnectivityState,
    /// Attestation hash (BLAKE3)
    pub attestation_hash: [u8; 32],
    /// Telemetry timestamp in nanoseconds since epoch
    pub timestamp_ns: u64,
}

/// Geographic coordinate
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Coordinate {
    /// Latitude in decimal degrees
    pub lat: f64,
    /// Longitude in decimal degrees
    pub lon: f64,
    /// Altitude in meters (optional)
    pub alt: Option<f32>,
}

/// Complete unit status
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct UnitStatus {
    /// Platform identity
    pub platform_id: PlatformIdentity,
    /// Serial number
    pub serial_number: String,
    /// Unit nickname (optional)
    pub nickname: Option<String>,
    /// Device type
    pub device_type: PlatformType,
    /// Operational state
    pub operational_state: OperationalState,
    /// Trust score (0.0 to 1.0)
    pub trust_score: f32,
    /// Last seen timestamp in nanoseconds since epoch
    pub last_seen_ns: u64,
    /// Telemetry data
    pub telemetry: UnitTelemetry,
}

impl UnitStatus {
    /// Check if unit is considered stale (> 30s since last seen)
    pub fn is_stale(&self, current_time_ns: u64) -> bool {
        const STALE_THRESHOLD_NS: u64 = 30_000_000_000; // 30 seconds
        
        if current_time_ns < self.last_seen_ns {
            return false; // Clock skew - don't mark as stale
        }
        
        (current_time_ns - self.last_seen_ns) > STALE_THRESHOLD_NS
    }
    
    /// Check if trust score is low (< 0.5)
    pub fn is_low_trust(&self) -> bool {
        self.trust_score < 0.5
    }
    
    /// Check if unit is operational
    pub fn is_operational(&self) -> bool {
        matches!(
            self.operational_state,
            OperationalState::Ready | OperationalState::Active | OperationalState::Standby
        )
    }
}

impl UnitTelemetry {
    /// Check if telemetry is stale (> 30s)
    pub fn is_stale(&self, current_time_ns: u64) -> bool {
        const STALE_THRESHOLD_NS: u64 = 30_000_000_000; // 30 seconds
        
        if current_time_ns < self.timestamp_ns {
            return false; // Clock skew
        }
        
        (current_time_ns - self.timestamp_ns) > STALE_THRESHOLD_NS
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;
    
    fn create_test_platform_id() -> PlatformIdentity {
        PlatformIdentity {
            id: "test-unit-1".to_string(),
            public_key: vec![0u8; 32],
            attestation: aethercore_identity::Attestation::None,
            created_at: 1000,
            metadata: HashMap::new(),
        }
    }
    
    #[test]
    fn test_unit_status_stale_detection() {
        let telemetry = UnitTelemetry {
            pressure_psi: Some(14.7),
            temperature_c: Some(20.0),
            battery_percent: Some(80),
            gps: None,
            connectivity: ConnectivityState::Connected,
            attestation_hash: [0u8; 32],
            timestamp_ns: 1000,
        };
        
        let status = UnitStatus {
            platform_id: create_test_platform_id(),
            serial_number: "SN-001".to_string(),
            nickname: Some("Test Unit".to_string()),
            device_type: PlatformType::FTCase,
            operational_state: OperationalState::Ready,
            trust_score: 0.9,
            last_seen_ns: 1000,
            telemetry,
        };
        
        // Not stale
        assert!(!status.is_stale(1000));
        assert!(!status.is_stale(10_000_000_000)); // 10 seconds later
        
        // Stale
        assert!(status.is_stale(31_000_000_001)); // 30+ seconds later
    }
    
    #[test]
    fn test_unit_status_trust_score() {
        let mut status = UnitStatus {
            platform_id: create_test_platform_id(),
            serial_number: "SN-001".to_string(),
            nickname: None,
            device_type: PlatformType::Mobile,
            operational_state: OperationalState::Active,
            trust_score: 0.8,
            last_seen_ns: 1000,
            telemetry: UnitTelemetry {
                pressure_psi: None,
                temperature_c: None,
                battery_percent: None,
                gps: None,
                connectivity: ConnectivityState::Connected,
                attestation_hash: [0u8; 32],
                timestamp_ns: 1000,
            },
        };
        
        assert!(!status.is_low_trust());
        
        status.trust_score = 0.3;
        assert!(status.is_low_trust());
    }
    
    #[test]
    fn test_operational_state_check() {
        let mut status = UnitStatus {
            platform_id: create_test_platform_id(),
            serial_number: "SN-001".to_string(),
            nickname: None,
            device_type: PlatformType::Fixed,
            operational_state: OperationalState::Ready,
            trust_score: 0.9,
            last_seen_ns: 1000,
            telemetry: UnitTelemetry {
                pressure_psi: None,
                temperature_c: None,
                battery_percent: None,
                gps: None,
                connectivity: ConnectivityState::Connected,
                attestation_hash: [0u8; 32],
                timestamp_ns: 1000,
            },
        };
        
        assert!(status.is_operational());
        
        status.operational_state = OperationalState::Fault;
        assert!(!status.is_operational());
    }
}
