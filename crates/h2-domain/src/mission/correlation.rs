//! Asset-to-mission correlation
//!
//! Provides cross-referencing between dispatches/missions and fleet assets.

use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};

/// Asset-mission correlation entry
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AssetMissionCorrelation {
    /// Asset ID
    pub asset_id: String,

    /// Mission ID
    pub mission_id: String,

    /// Role in mission (e.g., "primary", "support")
    pub role: String,

    /// Assignment timestamp
    pub assigned_at: u64,

    /// Completion timestamp (optional)
    pub completed_at: Option<u64>,
}

impl AssetMissionCorrelation {
    /// Create a new correlation
    pub fn new(asset_id: String, mission_id: String, role: String, timestamp: u64) -> Self {
        Self {
            asset_id,
            mission_id,
            role,
            assigned_at: timestamp,
            completed_at: None,
        }
    }

    /// Mark correlation as complete
    pub fn complete(&mut self, timestamp: u64) {
        self.completed_at = Some(timestamp);
    }

    /// Check if correlation is active
    pub fn is_active(&self) -> bool {
        self.completed_at.is_none()
    }
}

/// Mission correlator for tracking asset-mission relationships
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MissionCorrelator {
    /// Map from asset ID to set of mission IDs
    asset_to_missions: HashMap<String, HashSet<String>>,

    /// Map from mission ID to set of asset IDs
    mission_to_assets: HashMap<String, HashSet<String>>,

    /// Detailed correlations
    correlations: Vec<AssetMissionCorrelation>,
}

impl MissionCorrelator {
    /// Create a new mission correlator
    pub fn new() -> Self {
        Self {
            asset_to_missions: HashMap::new(),
            mission_to_assets: HashMap::new(),
            correlations: Vec::new(),
        }
    }

    /// Correlate an asset with a mission
    pub fn correlate(
        &mut self,
        asset_id: String,
        mission_id: String,
        role: String,
        timestamp: u64,
    ) {
        // Add to mappings
        self.asset_to_missions
            .entry(asset_id.clone())
            .or_insert_with(HashSet::new)
            .insert(mission_id.clone());

        self.mission_to_assets
            .entry(mission_id.clone())
            .or_insert_with(HashSet::new)
            .insert(asset_id.clone());

        // Add detailed correlation
        let correlation = AssetMissionCorrelation::new(asset_id, mission_id, role, timestamp);
        self.correlations.push(correlation);
    }

    /// Remove correlation between asset and mission
    pub fn remove_correlation(&mut self, asset_id: &str, mission_id: &str) {
        // Remove from mappings
        if let Some(missions) = self.asset_to_missions.get_mut(asset_id) {
            missions.remove(mission_id);
        }

        if let Some(assets) = self.mission_to_assets.get_mut(mission_id) {
            assets.remove(asset_id);
        }

        // Remove detailed correlation
        self.correlations
            .retain(|c| !(c.asset_id == asset_id && c.mission_id == mission_id));
    }

    /// Get all missions for an asset
    pub fn missions_for_asset(&self, asset_id: &str) -> Vec<String> {
        self.asset_to_missions
            .get(asset_id)
            .map(|missions| missions.iter().cloned().collect())
            .unwrap_or_default()
    }

    /// Get all assets for a mission
    pub fn assets_for_mission(&self, mission_id: &str) -> Vec<String> {
        self.mission_to_assets
            .get(mission_id)
            .map(|assets| assets.iter().cloned().collect())
            .unwrap_or_default()
    }

    /// Get active correlations for an asset
    pub fn active_correlations_for_asset(&self, asset_id: &str) -> Vec<&AssetMissionCorrelation> {
        self.correlations
            .iter()
            .filter(|c| c.asset_id == asset_id && c.is_active())
            .collect()
    }

    /// Get active correlations for a mission
    pub fn active_correlations_for_mission(
        &self,
        mission_id: &str,
    ) -> Vec<&AssetMissionCorrelation> {
        self.correlations
            .iter()
            .filter(|c| c.mission_id == mission_id && c.is_active())
            .collect()
    }

    /// Complete all correlations for a mission
    pub fn complete_mission(&mut self, mission_id: &str, timestamp: u64) {
        for correlation in &mut self.correlations {
            if correlation.mission_id == mission_id && correlation.is_active() {
                correlation.complete(timestamp);
            }
        }
    }

    /// Get all correlations
    pub fn all_correlations(&self) -> &[AssetMissionCorrelation] {
        &self.correlations
    }

    /// Get total correlation count
    pub fn total_count(&self) -> usize {
        self.correlations.len()
    }

    /// Check if asset is assigned to any active mission
    pub fn is_asset_assigned(&self, asset_id: &str) -> bool {
        !self.active_correlations_for_asset(asset_id).is_empty()
    }
}

impl Default for MissionCorrelator {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_asset_mission_correlation_creation() {
        let correlation = AssetMissionCorrelation::new(
            "asset-001".to_string(),
            "mission-001".to_string(),
            "primary".to_string(),
            1000,
        );

        assert_eq!(correlation.asset_id, "asset-001");
        assert_eq!(correlation.mission_id, "mission-001");
        assert!(correlation.is_active());
    }

    #[test]
    fn test_asset_mission_correlation_complete() {
        let mut correlation = AssetMissionCorrelation::new(
            "asset-001".to_string(),
            "mission-001".to_string(),
            "primary".to_string(),
            1000,
        );

        correlation.complete(2000);
        assert!(!correlation.is_active());
        assert_eq!(correlation.completed_at, Some(2000));
    }

    #[test]
    fn test_mission_correlator_creation() {
        let correlator = MissionCorrelator::new();
        assert_eq!(correlator.total_count(), 0);
    }

    #[test]
    fn test_mission_correlator_correlate() {
        let mut correlator = MissionCorrelator::new();

        correlator.correlate(
            "asset-001".to_string(),
            "mission-001".to_string(),
            "primary".to_string(),
            1000,
        );

        assert_eq!(correlator.total_count(), 1);
        assert!(correlator.is_asset_assigned("asset-001"));
    }

    #[test]
    fn test_mission_correlator_missions_for_asset() {
        let mut correlator = MissionCorrelator::new();

        correlator.correlate(
            "asset-001".to_string(),
            "mission-001".to_string(),
            "primary".to_string(),
            1000,
        );

        correlator.correlate(
            "asset-001".to_string(),
            "mission-002".to_string(),
            "support".to_string(),
            1000,
        );

        let missions = correlator.missions_for_asset("asset-001");
        assert_eq!(missions.len(), 2);
        assert!(missions.contains(&"mission-001".to_string()));
        assert!(missions.contains(&"mission-002".to_string()));
    }

    #[test]
    fn test_mission_correlator_assets_for_mission() {
        let mut correlator = MissionCorrelator::new();

        correlator.correlate(
            "asset-001".to_string(),
            "mission-001".to_string(),
            "primary".to_string(),
            1000,
        );

        correlator.correlate(
            "asset-002".to_string(),
            "mission-001".to_string(),
            "support".to_string(),
            1000,
        );

        let assets = correlator.assets_for_mission("mission-001");
        assert_eq!(assets.len(), 2);
        assert!(assets.contains(&"asset-001".to_string()));
        assert!(assets.contains(&"asset-002".to_string()));
    }

    #[test]
    fn test_mission_correlator_remove_correlation() {
        let mut correlator = MissionCorrelator::new();

        correlator.correlate(
            "asset-001".to_string(),
            "mission-001".to_string(),
            "primary".to_string(),
            1000,
        );

        assert_eq!(correlator.total_count(), 1);

        correlator.remove_correlation("asset-001", "mission-001");
        assert_eq!(correlator.total_count(), 0);
    }

    #[test]
    fn test_mission_correlator_active_correlations() {
        let mut correlator = MissionCorrelator::new();

        correlator.correlate(
            "asset-001".to_string(),
            "mission-001".to_string(),
            "primary".to_string(),
            1000,
        );

        correlator.correlate(
            "asset-001".to_string(),
            "mission-002".to_string(),
            "support".to_string(),
            1000,
        );

        // Complete one mission
        correlator.complete_mission("mission-001", 2000);

        let active = correlator.active_correlations_for_asset("asset-001");
        assert_eq!(active.len(), 1);
        assert_eq!(active[0].mission_id, "mission-002");
    }

    #[test]
    fn test_mission_correlator_complete_mission() {
        let mut correlator = MissionCorrelator::new();

        correlator.correlate(
            "asset-001".to_string(),
            "mission-001".to_string(),
            "primary".to_string(),
            1000,
        );

        correlator.correlate(
            "asset-002".to_string(),
            "mission-001".to_string(),
            "support".to_string(),
            1000,
        );

        correlator.complete_mission("mission-001", 2000);

        let active = correlator.active_correlations_for_mission("mission-001");
        assert_eq!(active.len(), 0);
    }

    #[test]
    fn test_mission_correlator_is_asset_assigned() {
        let mut correlator = MissionCorrelator::new();

        assert!(!correlator.is_asset_assigned("asset-001"));

        correlator.correlate(
            "asset-001".to_string(),
            "mission-001".to_string(),
            "primary".to_string(),
            1000,
        );

        assert!(correlator.is_asset_assigned("asset-001"));

        correlator.complete_mission("mission-001", 2000);
        assert!(!correlator.is_asset_assigned("asset-001"));
    }
}
