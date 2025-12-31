//! Fleet registry for managing federated fleet assets
//!
//! Provides centralized management of fleet assets with real-time state
//! synchronization and geospatial query capabilities.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;

use crate::fleet::assets::{FixedInstallation, FleetAsset, MobileAsset, SensorNode, TowableAsset};

/// Fleet asset container
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum FleetAssetType {
    /// Mobile asset (truck)
    Mobile(MobileAsset),
    /// Towable asset (trailer)
    Towable(TowableAsset),
    /// Fixed installation (station)
    Fixed(FixedInstallation),
    /// Sensor node (device)
    Sensor(SensorNode),
}

impl FleetAssetType {
    /// Get reference to the fleet asset
    pub fn as_fleet_asset(&self) -> &dyn FleetAsset {
        match self {
            FleetAssetType::Mobile(a) => a as &dyn FleetAsset,
            FleetAssetType::Towable(a) => a as &dyn FleetAsset,
            FleetAssetType::Fixed(a) => a as &dyn FleetAsset,
            FleetAssetType::Sensor(a) => a as &dyn FleetAsset,
        }
    }

    /// Get position (lat, lon)
    pub fn position(&self) -> (f64, f64) {
        match self {
            FleetAssetType::Mobile(a) => (a.latitude, a.longitude),
            FleetAssetType::Towable(a) => (a.latitude, a.longitude),
            FleetAssetType::Fixed(a) => (a.latitude, a.longitude),
            FleetAssetType::Sensor(a) => (a.latitude, a.longitude),
        }
    }
}

/// Fleet registry for managing all fleet assets
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FleetRegistry {
    /// Map of asset ID to asset
    assets: HashMap<String, FleetAssetType>,

    /// Last synchronization timestamp
    last_sync: u64,
}

impl FleetRegistry {
    /// Create a new fleet registry
    pub fn new() -> Self {
        Self {
            assets: HashMap::new(),
            last_sync: 0,
        }
    }

    /// Register a mobile asset
    pub fn register_mobile(&mut self, asset: MobileAsset) {
        let asset_id = asset.asset_id.clone();
        self.assets
            .insert(asset_id, FleetAssetType::Mobile(asset));
    }

    /// Register a towable asset
    pub fn register_towable(&mut self, asset: TowableAsset) {
        let asset_id = asset.asset_id.clone();
        self.assets
            .insert(asset_id, FleetAssetType::Towable(asset));
    }

    /// Register a fixed installation
    pub fn register_fixed(&mut self, asset: FixedInstallation) {
        let asset_id = asset.asset_id.clone();
        self.assets
            .insert(asset_id, FleetAssetType::Fixed(asset));
    }

    /// Register a sensor node
    pub fn register_sensor(&mut self, asset: SensorNode) {
        let asset_id = asset.asset_id.clone();
        self.assets
            .insert(asset_id, FleetAssetType::Sensor(asset));
    }

    /// Get an asset by ID
    pub fn get(&self, asset_id: &str) -> Option<&FleetAssetType> {
        self.assets.get(asset_id)
    }

    /// Get a mutable reference to an asset
    pub fn get_mut(&mut self, asset_id: &str) -> Option<&mut FleetAssetType> {
        self.assets.get_mut(asset_id)
    }

    /// Remove an asset from the registry
    pub fn remove(&mut self, asset_id: &str) -> Option<FleetAssetType> {
        self.assets.remove(asset_id)
    }

    /// Get all assets
    pub fn all_assets(&self) -> impl Iterator<Item = &FleetAssetType> {
        self.assets.values()
    }

    /// Get count of assets by type
    pub fn count_by_type(&self, asset_type: &str) -> usize {
        self.assets
            .values()
            .filter(|a| a.as_fleet_asset().asset_type() == asset_type)
            .count()
    }

    /// Get all operational assets
    pub fn operational_assets(&self) -> impl Iterator<Item = &FleetAssetType> {
        self.assets
            .values()
            .filter(|a| a.as_fleet_asset().is_operational())
    }

    /// Geospatial query: find assets within a bounding box
    pub fn query_bounds(
        &self,
        min_lat: f64,
        max_lat: f64,
        min_lon: f64,
        max_lon: f64,
    ) -> Vec<&FleetAssetType> {
        self.assets
            .values()
            .filter(|asset| {
                let (lat, lon) = asset.position();
                lat >= min_lat && lat <= max_lat && lon >= min_lon && lon <= max_lon
            })
            .collect()
    }

    /// Geospatial query: find assets near a point (simple distance check)
    pub fn query_near(
        &self,
        center_lat: f64,
        center_lon: f64,
        radius_degrees: f64,
    ) -> Vec<&FleetAssetType> {
        self.assets
            .values()
            .filter(|asset| {
                let (lat, lon) = asset.position();
                let dlat = lat - center_lat;
                let dlon = lon - center_lon;
                let distance = (dlat * dlat + dlon * dlon).sqrt();
                distance <= radius_degrees
            })
            .collect()
    }

    /// Update synchronization timestamp
    pub fn update_sync(&mut self, timestamp: u64) {
        self.last_sync = timestamp;
    }

    /// Get last synchronization timestamp
    pub fn last_sync(&self) -> u64 {
        self.last_sync
    }

    /// Get total asset count
    pub fn total_count(&self) -> usize {
        self.assets.len()
    }

    /// Clear all assets
    pub fn clear(&mut self) {
        self.assets.clear();
    }
}

impl Default for FleetRegistry {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_fleet_registry_creation() {
        let registry = FleetRegistry::new();
        assert_eq!(registry.total_count(), 0);
        assert_eq!(registry.last_sync(), 0);
    }

    #[test]
    fn test_register_mobile_asset() {
        let mut registry = FleetRegistry::new();
        let asset = MobileAsset::new(
            "truck-001".to_string(),
            "VIN123456".to_string(),
            45.0,
            -122.0,
            "operational".to_string(),
            1000,
        );

        registry.register_mobile(asset);
        assert_eq!(registry.total_count(), 1);
        assert!(registry.get("truck-001").is_some());
    }

    #[test]
    fn test_register_multiple_asset_types() {
        let mut registry = FleetRegistry::new();

        let mobile = MobileAsset::new(
            "truck-001".to_string(),
            "VIN123456".to_string(),
            45.0,
            -122.0,
            "operational".to_string(),
            1000,
        );

        let towable = TowableAsset::new(
            "trailer-001".to_string(),
            "TRAILER123".to_string(),
            45.0,
            -122.0,
            "operational".to_string(),
            1000,
        );

        let fixed = FixedInstallation::new(
            "station-001".to_string(),
            "Depot Alpha".to_string(),
            45.0,
            -122.0,
            100.0,
            "refueling".to_string(),
            "operational".to_string(),
            1000,
        );

        registry.register_mobile(mobile);
        registry.register_towable(towable);
        registry.register_fixed(fixed);

        assert_eq!(registry.total_count(), 3);
        assert_eq!(registry.count_by_type("mobile"), 1);
        assert_eq!(registry.count_by_type("towable"), 1);
        assert_eq!(registry.count_by_type("fixed"), 1);
    }

    #[test]
    fn test_get_asset() {
        let mut registry = FleetRegistry::new();
        let asset = MobileAsset::new(
            "truck-001".to_string(),
            "VIN123456".to_string(),
            45.0,
            -122.0,
            "operational".to_string(),
            1000,
        );

        registry.register_mobile(asset);

        let retrieved = registry.get("truck-001");
        assert!(retrieved.is_some());
        assert_eq!(
            retrieved.unwrap().as_fleet_asset().asset_id(),
            "truck-001"
        );
    }

    #[test]
    fn test_remove_asset() {
        let mut registry = FleetRegistry::new();
        let asset = MobileAsset::new(
            "truck-001".to_string(),
            "VIN123456".to_string(),
            45.0,
            -122.0,
            "operational".to_string(),
            1000,
        );

        registry.register_mobile(asset);
        assert_eq!(registry.total_count(), 1);

        registry.remove("truck-001");
        assert_eq!(registry.total_count(), 0);
    }

    #[test]
    fn test_operational_assets() {
        let mut registry = FleetRegistry::new();

        let operational = MobileAsset::new(
            "truck-001".to_string(),
            "VIN123456".to_string(),
            45.0,
            -122.0,
            "operational".to_string(),
            1000,
        );

        let maintenance = MobileAsset::new(
            "truck-002".to_string(),
            "VIN789012".to_string(),
            45.0,
            -122.0,
            "maintenance".to_string(),
            1000,
        );

        registry.register_mobile(operational);
        registry.register_mobile(maintenance);

        let op_count = registry.operational_assets().count();
        assert_eq!(op_count, 1);
    }

    #[test]
    fn test_query_bounds() {
        let mut registry = FleetRegistry::new();

        let asset1 = MobileAsset::new(
            "truck-001".to_string(),
            "VIN123456".to_string(),
            45.0,
            -122.0,
            "operational".to_string(),
            1000,
        );

        let asset2 = MobileAsset::new(
            "truck-002".to_string(),
            "VIN789012".to_string(),
            50.0,
            -100.0,
            "operational".to_string(),
            1000,
        );

        registry.register_mobile(asset1);
        registry.register_mobile(asset2);

        // Query should find asset1 but not asset2
        let results = registry.query_bounds(44.0, 46.0, -123.0, -121.0);
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].as_fleet_asset().asset_id(), "truck-001");
    }

    #[test]
    fn test_query_near() {
        let mut registry = FleetRegistry::new();

        let asset1 = MobileAsset::new(
            "truck-001".to_string(),
            "VIN123456".to_string(),
            45.0,
            -122.0,
            "operational".to_string(),
            1000,
        );

        let asset2 = MobileAsset::new(
            "truck-002".to_string(),
            "VIN789012".to_string(),
            45.1,
            -122.1,
            "operational".to_string(),
            1000,
        );

        let asset3 = MobileAsset::new(
            "truck-003".to_string(),
            "VIN345678".to_string(),
            50.0,
            -100.0,
            "operational".to_string(),
            1000,
        );

        registry.register_mobile(asset1);
        registry.register_mobile(asset2);
        registry.register_mobile(asset3);

        // Query near asset1 with small radius
        let results = registry.query_near(45.0, -122.0, 0.2);
        assert_eq!(results.len(), 2); // Should find asset1 and asset2
    }

    #[test]
    fn test_update_sync() {
        let mut registry = FleetRegistry::new();
        registry.update_sync(12345);
        assert_eq!(registry.last_sync(), 12345);
    }

    #[test]
    fn test_clear() {
        let mut registry = FleetRegistry::new();
        let asset = MobileAsset::new(
            "truck-001".to_string(),
            "VIN123456".to_string(),
            45.0,
            -122.0,
            "operational".to_string(),
            1000,
        );

        registry.register_mobile(asset);
        assert_eq!(registry.total_count(), 1);

        registry.clear();
        assert_eq!(registry.total_count(), 0);
    }
}
