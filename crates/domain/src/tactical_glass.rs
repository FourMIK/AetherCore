//! Tactical Glass domain models
//!
//! Provides foundational types for the Tactical Glass C2 surface,
//! including trust indicators, geospatial positioning, and tactical state.

use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

/// Trust indicator for tactical entities
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TrustIndicator {
    /// Trust level (0.0 to 1.0)
    pub level: f32,

    /// Timestamp of last verification (Unix epoch milliseconds)
    pub last_verified: u64,

    /// Length of attestation chain
    pub attestation_chain_length: u64,
}

impl TrustIndicator {
    /// Create a new trust indicator
    pub fn new(level: f32, last_verified: u64, attestation_chain_length: u64) -> Self {
        Self {
            level: level.clamp(0.0, 1.0),
            last_verified,
            attestation_chain_length,
        }
    }

    /// Check if trust level is acceptable (>= 0.5)
    pub fn is_acceptable(&self) -> bool {
        self.level >= 0.5
    }

    /// Check if trust is high (>= 0.8)
    pub fn is_high(&self) -> bool {
        self.level >= 0.8
    }

    /// Check if trust indicator is stale
    pub fn is_stale(&self, current_time_ms: u64, staleness_threshold_ms: u64) -> bool {
        current_time_ms.saturating_sub(self.last_verified) > staleness_threshold_ms
    }
}

/// Geospatial position with attestation
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GeospatialPosition {
    /// Latitude in degrees
    pub latitude: f64,

    /// Longitude in degrees
    pub longitude: f64,

    /// Altitude in meters (optional)
    pub altitude: Option<f64>,

    /// Heading in degrees (optional)
    pub heading: Option<f64>,

    /// Speed in km/h (optional)
    pub speed: Option<f64>,

    /// Timestamp of position fix (Unix epoch milliseconds)
    pub timestamp_ms: u64,

    /// Position accuracy in meters (optional)
    pub accuracy: Option<f32>,

    /// Trust indicator for this position
    pub trust: TrustIndicator,
}

impl GeospatialPosition {
    /// Create a new geospatial position
    pub fn new(
        latitude: f64,
        longitude: f64,
        timestamp_ms: u64,
        trust_level: f32,
        attestation_chain_length: u64,
    ) -> Self {
        Self {
            latitude,
            longitude,
            altitude: None,
            heading: None,
            speed: None,
            timestamp_ms,
            accuracy: None,
            trust: TrustIndicator::new(trust_level, timestamp_ms, attestation_chain_length),
        }
    }

    /// Calculate simple distance to another position (in degrees, approximation)
    pub fn distance_to(&self, other: &GeospatialPosition) -> f64 {
        let dlat = self.latitude - other.latitude;
        let dlon = self.longitude - other.longitude;
        (dlat * dlat + dlon * dlon).sqrt()
    }

    /// Check if position is within bounds
    pub fn is_within_bounds(&self, min_lat: f64, max_lat: f64, min_lon: f64, max_lon: f64) -> bool {
        self.latitude >= min_lat
            && self.latitude <= max_lat
            && self.longitude >= min_lon
            && self.longitude <= max_lon
    }
}

/// Tactical operational state for visualization
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum TacticalState {
    /// Operational and mission-ready
    Operational,
    /// Degraded but functional
    Degraded,
    /// In maintenance
    Maintenance,
    /// Offline or unreachable
    Offline,
    /// Critical failure
    Critical,
    /// Unknown state
    Unknown,
}

impl TacticalState {
    /// Check if state indicates operational capability
    pub fn is_operational(&self) -> bool {
        matches!(self, TacticalState::Operational | TacticalState::Degraded)
    }

    /// Check if state is critical
    pub fn is_critical(&self) -> bool {
        matches!(self, TacticalState::Critical)
    }

    /// Get severity level (0-3, higher is worse)
    pub fn severity_level(&self) -> u8 {
        match self {
            TacticalState::Operational => 0,
            TacticalState::Degraded => 1,
            TacticalState::Maintenance => 1,
            TacticalState::Unknown => 2,
            TacticalState::Offline => 2,
            TacticalState::Critical => 3,
        }
    }
}

/// Tactical entity trait for all displayable assets
pub trait TacticalEntity {
    /// Get unique entity identifier
    fn entity_id(&self) -> &str;

    /// Get entity type (e.g., "mobile", "fixed", "sensor")
    fn entity_type(&self) -> &str;

    /// Get current tactical state
    fn tactical_state(&self) -> TacticalState;

    /// Get current position
    fn position(&self) -> Option<&GeospatialPosition>;

    /// Get trust indicator
    fn trust_indicator(&self) -> &TrustIndicator;

    /// Get last update timestamp
    fn last_updated(&self) -> u64;

    /// Get display metadata
    fn display_metadata(&self) -> BTreeMap<String, String> {
        BTreeMap::new()
    }
}

/// Tactical entity wrapper for serialization
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TacticalEntityData {
    /// Entity identifier
    pub entity_id: String,

    /// Entity type
    pub entity_type: String,

    /// Tactical state
    pub state: TacticalState,

    /// Position (optional)
    pub position: Option<GeospatialPosition>,

    /// Trust indicator
    pub trust: TrustIndicator,

    /// Last update timestamp
    pub last_updated: u64,

    /// Display metadata
    pub metadata: BTreeMap<String, String>,
}

impl TacticalEntityData {
    /// Create from a tactical entity
    pub fn from_entity<T: TacticalEntity>(entity: &T) -> Self {
        Self {
            entity_id: entity.entity_id().to_string(),
            entity_type: entity.entity_type().to_string(),
            state: entity.tactical_state(),
            position: entity.position().cloned(),
            trust: entity.trust_indicator().clone(),
            last_updated: entity.last_updated(),
            metadata: entity.display_metadata(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_trust_indicator_creation() {
        let trust = TrustIndicator::new(0.8, 1000, 5);

        assert_eq!(trust.level, 0.8);
        assert_eq!(trust.last_verified, 1000);
        assert_eq!(trust.attestation_chain_length, 5);
    }

    #[test]
    fn test_trust_indicator_acceptable() {
        let high = TrustIndicator::new(0.8, 1000, 5);
        assert!(high.is_acceptable());
        assert!(high.is_high());

        let medium = TrustIndicator::new(0.6, 1000, 5);
        assert!(medium.is_acceptable());
        assert!(!medium.is_high());

        let low = TrustIndicator::new(0.3, 1000, 5);
        assert!(!low.is_acceptable());
    }

    #[test]
    fn test_trust_indicator_stale() {
        let trust = TrustIndicator::new(0.8, 1000, 5);

        assert!(!trust.is_stale(2000, 5000));
        assert!(trust.is_stale(10000, 5000));
    }

    #[test]
    fn test_trust_indicator_clamping() {
        let high = TrustIndicator::new(1.5, 1000, 5);
        assert_eq!(high.level, 1.0);

        let low = TrustIndicator::new(-0.5, 1000, 5);
        assert_eq!(low.level, 0.0);
    }

    #[test]
    fn test_geospatial_position_creation() {
        let pos = GeospatialPosition::new(45.0, -122.0, 1000, 0.8, 5);

        assert_eq!(pos.latitude, 45.0);
        assert_eq!(pos.longitude, -122.0);
        assert_eq!(pos.timestamp_ms, 1000);
        assert_eq!(pos.trust.level, 0.8);
    }

    #[test]
    fn test_geospatial_position_distance() {
        let pos1 = GeospatialPosition::new(45.0, -122.0, 1000, 0.8, 5);
        let pos2 = GeospatialPosition::new(46.0, -123.0, 1000, 0.8, 5);

        let distance = pos1.distance_to(&pos2);
        assert!(distance > 0.0);
        assert!((distance - 1.414).abs() < 0.01);
    }

    #[test]
    fn test_geospatial_position_bounds() {
        let pos = GeospatialPosition::new(45.0, -122.0, 1000, 0.8, 5);

        assert!(pos.is_within_bounds(44.0, 46.0, -123.0, -121.0));
        assert!(!pos.is_within_bounds(46.0, 47.0, -123.0, -121.0));
    }

    #[test]
    fn test_tactical_state_operational() {
        assert!(TacticalState::Operational.is_operational());
        assert!(TacticalState::Degraded.is_operational());
        assert!(!TacticalState::Offline.is_operational());
        assert!(!TacticalState::Critical.is_operational());
    }

    #[test]
    fn test_tactical_state_critical() {
        assert!(TacticalState::Critical.is_critical());
        assert!(!TacticalState::Operational.is_critical());
    }

    #[test]
    fn test_tactical_state_severity() {
        assert_eq!(TacticalState::Operational.severity_level(), 0);
        assert_eq!(TacticalState::Degraded.severity_level(), 1);
        assert_eq!(TacticalState::Offline.severity_level(), 2);
        assert_eq!(TacticalState::Critical.severity_level(), 3);
    }

    // Mock implementation for testing
    struct MockEntity {
        id: String,
        state: TacticalState,
        position: Option<GeospatialPosition>,
        trust: TrustIndicator,
        updated: u64,
    }

    impl TacticalEntity for MockEntity {
        fn entity_id(&self) -> &str {
            &self.id
        }

        fn entity_type(&self) -> &str {
            "mock"
        }

        fn tactical_state(&self) -> TacticalState {
            self.state
        }

        fn position(&self) -> Option<&GeospatialPosition> {
            self.position.as_ref()
        }

        fn trust_indicator(&self) -> &TrustIndicator {
            &self.trust
        }

        fn last_updated(&self) -> u64 {
            self.updated
        }
    }

    #[test]
    fn test_tactical_entity_data_from_entity() {
        let entity = MockEntity {
            id: "test-001".to_string(),
            state: TacticalState::Operational,
            position: Some(GeospatialPosition::new(45.0, -122.0, 1000, 0.8, 5)),
            trust: TrustIndicator::new(0.8, 1000, 5),
            updated: 1000,
        };

        let data = TacticalEntityData::from_entity(&entity);
        assert_eq!(data.entity_id, "test-001");
        assert_eq!(data.entity_type, "mock");
        assert_eq!(data.state, TacticalState::Operational);
        assert!(data.position.is_some());
    }
}
