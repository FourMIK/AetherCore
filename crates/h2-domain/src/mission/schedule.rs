//! Mission scheduling and waypoint management
//!
//! Provides temporal mission planning with waypoints and ETA tracking.

use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

/// Waypoint for mission routing
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Waypoint {
    /// Waypoint identifier
    pub waypoint_id: String,

    /// Latitude
    pub latitude: f64,

    /// Longitude
    pub longitude: f64,

    /// Altitude in meters (optional)
    pub altitude: Option<f64>,

    /// Sequence number in route
    pub sequence: u32,

    /// Estimated time of arrival (Unix epoch milliseconds)
    pub eta: Option<u64>,

    /// Actual arrival time (Unix epoch milliseconds)
    pub arrived_at: Option<u64>,

    /// Additional metadata
    pub metadata: BTreeMap<String, serde_json::Value>,
}

impl Waypoint {
    /// Create a new waypoint
    pub fn new(waypoint_id: String, latitude: f64, longitude: f64, sequence: u32) -> Self {
        Self {
            waypoint_id,
            latitude,
            longitude,
            altitude: None,
            sequence,
            eta: None,
            arrived_at: None,
            metadata: BTreeMap::new(),
        }
    }

    /// Mark waypoint as arrived
    pub fn mark_arrived(&mut self, timestamp: u64) {
        self.arrived_at = Some(timestamp);
    }

    /// Check if waypoint has been reached
    pub fn is_reached(&self) -> bool {
        self.arrived_at.is_some()
    }

    /// Check if waypoint is overdue
    pub fn is_overdue(&self, current_time: u64) -> bool {
        if let Some(eta) = self.eta {
            current_time > eta && self.arrived_at.is_none()
        } else {
            false
        }
    }
}

/// Scheduled mission with waypoints
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScheduledMission {
    /// Unique mission identifier
    pub mission_id: String,

    /// Mission type/category
    pub mission_type: String,

    /// Assigned dispatch (if any)
    pub dispatch_id: Option<String>,

    /// Ordered list of waypoints
    pub waypoints: Vec<Waypoint>,

    /// Current waypoint index
    pub current_waypoint: usize,

    /// Mission start time (Unix epoch milliseconds)
    pub start_time: u64,

    /// Estimated completion time (Unix epoch milliseconds)
    pub estimated_completion: Option<u64>,

    /// Actual completion time (Unix epoch milliseconds)
    pub completed_at: Option<u64>,

    /// Additional metadata
    pub metadata: BTreeMap<String, serde_json::Value>,
}

impl ScheduledMission {
    /// Create a new scheduled mission
    pub fn new(mission_id: String, mission_type: String, start_time: u64) -> Self {
        Self {
            mission_id,
            mission_type,
            dispatch_id: None,
            waypoints: Vec::new(),
            current_waypoint: 0,
            start_time,
            estimated_completion: None,
            completed_at: None,
            metadata: BTreeMap::new(),
        }
    }

    /// Add a waypoint to the mission
    pub fn add_waypoint(&mut self, waypoint: Waypoint) {
        self.waypoints.push(waypoint);
        // Sort by sequence
        self.waypoints.sort_by_key(|w| w.sequence);
    }

    /// Get the current waypoint
    pub fn current(&self) -> Option<&Waypoint> {
        self.waypoints.get(self.current_waypoint)
    }

    /// Advance to the next waypoint
    pub fn advance_waypoint(&mut self, timestamp: u64) -> Option<&Waypoint> {
        if let Some(current) = self.waypoints.get_mut(self.current_waypoint) {
            current.mark_arrived(timestamp);
        }

        self.current_waypoint += 1;

        if self.current_waypoint >= self.waypoints.len() {
            self.completed_at = Some(timestamp);
            None
        } else {
            self.waypoints.get(self.current_waypoint)
        }
    }

    /// Check if mission is complete
    pub fn is_complete(&self) -> bool {
        self.completed_at.is_some()
    }

    /// Get progress percentage
    pub fn progress_percent(&self) -> f32 {
        if self.waypoints.is_empty() {
            return 0.0;
        }

        let reached = self.waypoints.iter().filter(|w| w.is_reached()).count();
        (reached as f32 / self.waypoints.len() as f32) * 100.0
    }

    /// Get overdue waypoints
    pub fn overdue_waypoints(&self, current_time: u64) -> Vec<&Waypoint> {
        self.waypoints
            .iter()
            .filter(|w| w.is_overdue(current_time))
            .collect()
    }

    /// Associate with a dispatch
    pub fn associate_dispatch(&mut self, dispatch_id: String) {
        self.dispatch_id = Some(dispatch_id);
    }
}

/// Schedule container for managing multiple missions
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Schedule {
    /// Map of mission ID to scheduled mission
    missions: BTreeMap<String, ScheduledMission>,
}

impl Schedule {
    /// Create a new schedule
    pub fn new() -> Self {
        Self {
            missions: BTreeMap::new(),
        }
    }

    /// Add a mission to the schedule
    pub fn add_mission(&mut self, mission: ScheduledMission) {
        let mission_id = mission.mission_id.clone();
        self.missions.insert(mission_id, mission);
    }

    /// Get a mission by ID
    pub fn get(&self, mission_id: &str) -> Option<&ScheduledMission> {
        self.missions.get(mission_id)
    }

    /// Get a mutable reference to a mission
    pub fn get_mut(&mut self, mission_id: &str) -> Option<&mut ScheduledMission> {
        self.missions.get_mut(mission_id)
    }

    /// Remove a mission from the schedule
    pub fn remove(&mut self, mission_id: &str) -> Option<ScheduledMission> {
        self.missions.remove(mission_id)
    }

    /// Get all active (incomplete) missions
    pub fn active_missions(&self) -> impl Iterator<Item = &ScheduledMission> {
        self.missions.values().filter(|m| !m.is_complete())
    }

    /// Get all completed missions
    pub fn completed_missions(&self) -> impl Iterator<Item = &ScheduledMission> {
        self.missions.values().filter(|m| m.is_complete())
    }

    /// Get total mission count
    pub fn total_count(&self) -> usize {
        self.missions.len()
    }
}

impl Default for Schedule {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_waypoint_creation() {
        let waypoint = Waypoint::new("wp-001".to_string(), 45.0, -122.0, 1);

        assert_eq!(waypoint.waypoint_id, "wp-001");
        assert_eq!(waypoint.sequence, 1);
        assert!(!waypoint.is_reached());
    }

    #[test]
    fn test_waypoint_mark_arrived() {
        let mut waypoint = Waypoint::new("wp-001".to_string(), 45.0, -122.0, 1);

        waypoint.mark_arrived(1000);
        assert!(waypoint.is_reached());
        assert_eq!(waypoint.arrived_at, Some(1000));
    }

    #[test]
    fn test_waypoint_overdue() {
        let mut waypoint = Waypoint::new("wp-001".to_string(), 45.0, -122.0, 1);

        waypoint.eta = Some(1000);

        assert!(!waypoint.is_overdue(500));
        assert!(waypoint.is_overdue(1500));

        waypoint.mark_arrived(1500);
        assert!(!waypoint.is_overdue(2000));
    }

    #[test]
    fn test_scheduled_mission_creation() {
        let mission =
            ScheduledMission::new("mission-001".to_string(), "delivery".to_string(), 1000);

        assert_eq!(mission.mission_id, "mission-001");
        assert_eq!(mission.current_waypoint, 0);
        assert!(!mission.is_complete());
    }

    #[test]
    fn test_scheduled_mission_add_waypoint() {
        let mut mission =
            ScheduledMission::new("mission-001".to_string(), "delivery".to_string(), 1000);

        let wp1 = Waypoint::new("wp-001".to_string(), 45.0, -122.0, 1);
        let wp2 = Waypoint::new("wp-002".to_string(), 46.0, -123.0, 2);

        mission.add_waypoint(wp1);
        mission.add_waypoint(wp2);

        assert_eq!(mission.waypoints.len(), 2);
    }

    #[test]
    fn test_scheduled_mission_advance_waypoint() {
        let mut mission =
            ScheduledMission::new("mission-001".to_string(), "delivery".to_string(), 1000);

        mission.add_waypoint(Waypoint::new("wp-001".to_string(), 45.0, -122.0, 1));
        mission.add_waypoint(Waypoint::new("wp-002".to_string(), 46.0, -123.0, 2));

        let next = mission.advance_waypoint(2000);
        assert!(next.is_some());
        assert_eq!(mission.current_waypoint, 1);

        let final_wp = mission.advance_waypoint(3000);
        assert!(final_wp.is_none());
        assert!(mission.is_complete());
    }

    #[test]
    fn test_scheduled_mission_progress() {
        let mut mission =
            ScheduledMission::new("mission-001".to_string(), "delivery".to_string(), 1000);

        mission.add_waypoint(Waypoint::new("wp-001".to_string(), 45.0, -122.0, 1));
        mission.add_waypoint(Waypoint::new("wp-002".to_string(), 46.0, -123.0, 2));
        mission.add_waypoint(Waypoint::new("wp-003".to_string(), 47.0, -124.0, 3));

        assert_eq!(mission.progress_percent(), 0.0);

        mission.advance_waypoint(2000);
        assert!((mission.progress_percent() - 33.33).abs() < 0.1);

        mission.advance_waypoint(3000);
        assert!((mission.progress_percent() - 66.66).abs() < 0.1);

        mission.advance_waypoint(4000);
        assert_eq!(mission.progress_percent(), 100.0);
    }

    #[test]
    fn test_scheduled_mission_overdue_waypoints() {
        let mut mission =
            ScheduledMission::new("mission-001".to_string(), "delivery".to_string(), 1000);

        let mut wp1 = Waypoint::new("wp-001".to_string(), 45.0, -122.0, 1);
        wp1.eta = Some(2000);

        let mut wp2 = Waypoint::new("wp-002".to_string(), 46.0, -123.0, 2);
        wp2.eta = Some(5000);

        mission.add_waypoint(wp1);
        mission.add_waypoint(wp2);

        let overdue = mission.overdue_waypoints(3000);
        assert_eq!(overdue.len(), 1);
        assert_eq!(overdue[0].waypoint_id, "wp-001");
    }

    #[test]
    fn test_schedule_creation() {
        let schedule = Schedule::new();
        assert_eq!(schedule.total_count(), 0);
    }

    #[test]
    fn test_schedule_add_mission() {
        let mut schedule = Schedule::new();
        let mission =
            ScheduledMission::new("mission-001".to_string(), "delivery".to_string(), 1000);

        schedule.add_mission(mission);
        assert_eq!(schedule.total_count(), 1);
    }

    #[test]
    fn test_schedule_active_completed() {
        let mut schedule = Schedule::new();

        let mut mission1 =
            ScheduledMission::new("mission-001".to_string(), "delivery".to_string(), 1000);
        mission1.completed_at = Some(2000);

        let mission2 =
            ScheduledMission::new("mission-002".to_string(), "delivery".to_string(), 1000);

        schedule.add_mission(mission1);
        schedule.add_mission(mission2);

        assert_eq!(schedule.active_missions().count(), 1);
        assert_eq!(schedule.completed_missions().count(), 1);
    }

    #[test]
    fn test_schedule_remove_mission() {
        let mut schedule = Schedule::new();
        let mission =
            ScheduledMission::new("mission-001".to_string(), "delivery".to_string(), 1000);

        schedule.add_mission(mission);
        assert_eq!(schedule.total_count(), 1);

        schedule.remove("mission-001");
        assert_eq!(schedule.total_count(), 0);
    }

    #[test]
    fn test_mission_associate_dispatch() {
        let mut mission =
            ScheduledMission::new("mission-001".to_string(), "delivery".to_string(), 1000);

        mission.associate_dispatch("dispatch-001".to_string());
        assert_eq!(mission.dispatch_id, Some("dispatch-001".to_string()));
    }
}
