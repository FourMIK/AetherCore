//! Fleet asset domain models
//!
//! Maps H2OS fleet entities (Truck, Trailer, Station, Device) to
//! AetherCore federated materia slots.

use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

/// Fleet asset trait - all fleet assets implement this
pub trait FleetAsset {
    /// Get the unique asset identifier
    fn asset_id(&self) -> &str;

    /// Get the asset type name
    fn asset_type(&self) -> &str;

    /// Get current operational state
    fn operational_state(&self) -> &str;

    /// Get last update timestamp
    fn last_updated(&self) -> u64;

    /// Check if asset is operational
    fn is_operational(&self) -> bool {
        self.operational_state() == "operational"
    }
}

/// Mobile asset (maps from H2OS Truck)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MobileAsset {
    /// Unique asset identifier
    pub asset_id: String,

    /// Vehicle identification number or registration
    pub vin: String,

    /// Current latitude
    pub latitude: f64,

    /// Current longitude
    pub longitude: f64,

    /// Altitude in meters (optional)
    pub altitude: Option<f64>,

    /// Speed in km/h (optional)
    pub speed: Option<f64>,

    /// Heading in degrees (optional)
    pub heading: Option<f64>,

    /// Operational state
    pub state: String,

    /// Assigned driver/operator (optional)
    pub operator: Option<String>,

    /// Fuel level percentage (optional)
    pub fuel_level: Option<f32>,

    /// Timestamp of last update (Unix epoch milliseconds)
    pub last_updated: u64,

    /// Additional metadata
    pub metadata: BTreeMap<String, serde_json::Value>,
}

impl MobileAsset {
    /// Create a new mobile asset
    pub fn new(
        asset_id: String,
        vin: String,
        latitude: f64,
        longitude: f64,
        state: String,
        timestamp: u64,
    ) -> Self {
        Self {
            asset_id,
            vin,
            latitude,
            longitude,
            altitude: None,
            speed: None,
            heading: None,
            state,
            operator: None,
            fuel_level: None,
            last_updated: timestamp,
            metadata: BTreeMap::new(),
        }
    }

    /// Update position
    pub fn update_position(&mut self, lat: f64, lon: f64, timestamp: u64) {
        self.latitude = lat;
        self.longitude = lon;
        self.last_updated = timestamp;
    }
}

impl FleetAsset for MobileAsset {
    fn asset_id(&self) -> &str {
        &self.asset_id
    }

    fn asset_type(&self) -> &str {
        "mobile"
    }

    fn operational_state(&self) -> &str {
        &self.state
    }

    fn last_updated(&self) -> u64 {
        self.last_updated
    }
}

/// Towable asset (maps from H2OS Trailer)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TowableAsset {
    /// Unique asset identifier
    pub asset_id: String,

    /// Trailer identification number
    pub trailer_id: String,

    /// Current latitude
    pub latitude: f64,

    /// Current longitude
    pub longitude: f64,

    /// Operational state
    pub state: String,

    /// Attached to mobile asset (optional)
    pub attached_to: Option<String>,

    /// Cargo type/description (optional)
    pub cargo: Option<String>,

    /// Cargo weight in kg (optional)
    pub cargo_weight: Option<f32>,

    /// Timestamp of last update (Unix epoch milliseconds)
    pub last_updated: u64,

    /// Additional metadata
    pub metadata: BTreeMap<String, serde_json::Value>,
}

impl TowableAsset {
    /// Create a new towable asset
    pub fn new(
        asset_id: String,
        trailer_id: String,
        latitude: f64,
        longitude: f64,
        state: String,
        timestamp: u64,
    ) -> Self {
        Self {
            asset_id,
            trailer_id,
            latitude,
            longitude,
            state,
            attached_to: None,
            cargo: None,
            cargo_weight: None,
            last_updated: timestamp,
            metadata: BTreeMap::new(),
        }
    }

    /// Attach to a mobile asset
    pub fn attach_to(&mut self, mobile_asset_id: String, timestamp: u64) {
        self.attached_to = Some(mobile_asset_id);
        self.last_updated = timestamp;
    }

    /// Detach from mobile asset
    pub fn detach(&mut self, timestamp: u64) {
        self.attached_to = None;
        self.last_updated = timestamp;
    }
}

impl FleetAsset for TowableAsset {
    fn asset_id(&self) -> &str {
        &self.asset_id
    }

    fn asset_type(&self) -> &str {
        "towable"
    }

    fn operational_state(&self) -> &str {
        &self.state
    }

    fn last_updated(&self) -> u64 {
        self.last_updated
    }
}

/// Fixed installation (maps from H2OS Station)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FixedInstallation {
    /// Unique asset identifier
    pub asset_id: String,

    /// Station name
    pub station_name: String,

    /// Fixed latitude
    pub latitude: f64,

    /// Fixed longitude
    pub longitude: f64,

    /// Elevation in meters
    pub elevation: f64,

    /// Operational state
    pub state: String,

    /// Station type (e.g., "refueling", "maintenance", "depot")
    pub station_type: String,

    /// Capacity information (optional)
    pub capacity: Option<f32>,

    /// Current utilization percentage (optional)
    pub utilization: Option<f32>,

    /// Timestamp of last update (Unix epoch milliseconds)
    pub last_updated: u64,

    /// Additional metadata
    pub metadata: BTreeMap<String, serde_json::Value>,
}

impl FixedInstallation {
    /// Create a new fixed installation
    pub fn new(
        asset_id: String,
        station_name: String,
        latitude: f64,
        longitude: f64,
        elevation: f64,
        station_type: String,
        state: String,
        timestamp: u64,
    ) -> Self {
        Self {
            asset_id,
            station_name,
            latitude,
            longitude,
            elevation,
            state,
            station_type,
            capacity: None,
            utilization: None,
            last_updated: timestamp,
            metadata: BTreeMap::new(),
        }
    }

    /// Update utilization
    pub fn update_utilization(&mut self, utilization: f32, timestamp: u64) {
        self.utilization = Some(utilization.clamp(0.0, 100.0));
        self.last_updated = timestamp;
    }
}

impl FleetAsset for FixedInstallation {
    fn asset_id(&self) -> &str {
        &self.asset_id
    }

    fn asset_type(&self) -> &str {
        "fixed"
    }

    fn operational_state(&self) -> &str {
        &self.state
    }

    fn last_updated(&self) -> u64 {
        self.last_updated
    }
}

/// Sensor node (maps from H2OS Device with DeviceControls)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SensorNode {
    /// Unique asset identifier
    pub asset_id: String,

    /// Device serial number
    pub device_serial: String,

    /// Parent asset (mobile, towable, or fixed)
    pub parent_asset: String,

    /// Current latitude (from parent or GPS)
    pub latitude: f64,

    /// Current longitude (from parent or GPS)
    pub longitude: f64,

    /// Operational state
    pub state: String,

    /// Device type (e.g., "PT100", "PT110", "PS110", "H2Detect", "GPS")
    pub device_type: String,

    /// Last reading value (optional)
    pub last_reading: Option<f64>,

    /// Last reading unit (optional)
    pub reading_unit: Option<String>,

    /// Battery level percentage (optional)
    pub battery_level: Option<f32>,

    /// Timestamp of last update (Unix epoch milliseconds)
    pub last_updated: u64,

    /// Additional metadata
    pub metadata: BTreeMap<String, serde_json::Value>,
}

impl SensorNode {
    /// Create a new sensor node
    pub fn new(
        asset_id: String,
        device_serial: String,
        parent_asset: String,
        latitude: f64,
        longitude: f64,
        device_type: String,
        state: String,
        timestamp: u64,
    ) -> Self {
        Self {
            asset_id,
            device_serial,
            parent_asset,
            latitude,
            longitude,
            state,
            device_type,
            last_reading: None,
            reading_unit: None,
            battery_level: None,
            last_updated: timestamp,
            metadata: BTreeMap::new(),
        }
    }

    /// Update sensor reading
    pub fn update_reading(&mut self, value: f64, unit: String, timestamp: u64) {
        self.last_reading = Some(value);
        self.reading_unit = Some(unit);
        self.last_updated = timestamp;
    }

    /// Update position from parent asset
    pub fn update_position(&mut self, lat: f64, lon: f64, timestamp: u64) {
        self.latitude = lat;
        self.longitude = lon;
        self.last_updated = timestamp;
    }
}

impl FleetAsset for SensorNode {
    fn asset_id(&self) -> &str {
        &self.asset_id
    }

    fn asset_type(&self) -> &str {
        "sensor"
    }

    fn operational_state(&self) -> &str {
        &self.state
    }

    fn last_updated(&self) -> u64 {
        self.last_updated
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_mobile_asset_creation() {
        let asset = MobileAsset::new(
            "truck-001".to_string(),
            "VIN123456".to_string(),
            45.0,
            -122.0,
            "operational".to_string(),
            1000,
        );

        assert_eq!(asset.asset_id(), "truck-001");
        assert_eq!(asset.asset_type(), "mobile");
        assert!(asset.is_operational());
    }

    #[test]
    fn test_mobile_asset_update_position() {
        let mut asset = MobileAsset::new(
            "truck-001".to_string(),
            "VIN123456".to_string(),
            45.0,
            -122.0,
            "operational".to_string(),
            1000,
        );

        asset.update_position(46.0, -123.0, 2000);
        assert_eq!(asset.latitude, 46.0);
        assert_eq!(asset.longitude, -123.0);
        assert_eq!(asset.last_updated, 2000);
    }

    #[test]
    fn test_towable_asset_creation() {
        let asset = TowableAsset::new(
            "trailer-001".to_string(),
            "TRAILER123".to_string(),
            45.0,
            -122.0,
            "operational".to_string(),
            1000,
        );

        assert_eq!(asset.asset_id(), "trailer-001");
        assert_eq!(asset.asset_type(), "towable");
        assert!(asset.attached_to.is_none());
    }

    #[test]
    fn test_towable_asset_attach_detach() {
        let mut asset = TowableAsset::new(
            "trailer-001".to_string(),
            "TRAILER123".to_string(),
            45.0,
            -122.0,
            "operational".to_string(),
            1000,
        );

        asset.attach_to("truck-001".to_string(), 2000);
        assert_eq!(asset.attached_to, Some("truck-001".to_string()));
        assert_eq!(asset.last_updated, 2000);

        asset.detach(3000);
        assert!(asset.attached_to.is_none());
        assert_eq!(asset.last_updated, 3000);
    }

    #[test]
    fn test_fixed_installation_creation() {
        let asset = FixedInstallation::new(
            "station-001".to_string(),
            "Depot Alpha".to_string(),
            45.0,
            -122.0,
            100.0,
            "refueling".to_string(),
            "operational".to_string(),
            1000,
        );

        assert_eq!(asset.asset_id(), "station-001");
        assert_eq!(asset.asset_type(), "fixed");
        assert_eq!(asset.station_type, "refueling");
    }

    #[test]
    fn test_fixed_installation_update_utilization() {
        let mut asset = FixedInstallation::new(
            "station-001".to_string(),
            "Depot Alpha".to_string(),
            45.0,
            -122.0,
            100.0,
            "refueling".to_string(),
            "operational".to_string(),
            1000,
        );

        asset.update_utilization(75.5, 2000);
        assert_eq!(asset.utilization, Some(75.5));
        assert_eq!(asset.last_updated, 2000);

        // Test clamping
        asset.update_utilization(150.0, 3000);
        assert_eq!(asset.utilization, Some(100.0));
    }

    #[test]
    fn test_sensor_node_creation() {
        let sensor = SensorNode::new(
            "sensor-001".to_string(),
            "SN123456".to_string(),
            "truck-001".to_string(),
            45.0,
            -122.0,
            "PT100".to_string(),
            "operational".to_string(),
            1000,
        );

        assert_eq!(sensor.asset_id(), "sensor-001");
        assert_eq!(sensor.asset_type(), "sensor");
        assert_eq!(sensor.device_type, "PT100");
    }

    #[test]
    fn test_sensor_node_update_reading() {
        let mut sensor = SensorNode::new(
            "sensor-001".to_string(),
            "SN123456".to_string(),
            "truck-001".to_string(),
            45.0,
            -122.0,
            "PT100".to_string(),
            "operational".to_string(),
            1000,
        );

        sensor.update_reading(25.5, "celsius".to_string(), 2000);
        assert_eq!(sensor.last_reading, Some(25.5));
        assert_eq!(sensor.reading_unit, Some("celsius".to_string()));
        assert_eq!(sensor.last_updated, 2000);
    }

    #[test]
    fn test_fleet_asset_trait() {
        let mobile: Box<dyn FleetAsset> = Box::new(MobileAsset::new(
            "truck-001".to_string(),
            "VIN123456".to_string(),
            45.0,
            -122.0,
            "operational".to_string(),
            1000,
        ));

        assert_eq!(mobile.asset_type(), "mobile");
        assert!(mobile.is_operational());
    }
}
