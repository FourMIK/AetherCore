//! Event feed definitions for Tactical Glass subscriptions
//!
//! Provides real-time event feeds for the Tactical Glass C2 surface,
//! enabling subscriptions to fleet, mission, and alert updates.

use serde::{Deserialize, Serialize};
use std::collections::VecDeque;

/// Fleet feed for real-time fleet asset updates
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FleetFeed {
    /// Feed identifier
    pub feed_id: String,

    /// Subscribed asset IDs (empty = all assets)
    pub subscribed_assets: Vec<String>,

    /// Recent events buffer
    events: VecDeque<FleetEvent>,

    /// Maximum buffer size
    max_buffer_size: usize,

    /// Last update timestamp
    pub last_updated: u64,
}

impl FleetFeed {
    /// Create a new fleet feed
    pub fn new(feed_id: String) -> Self {
        Self {
            feed_id,
            subscribed_assets: Vec::new(),
            events: VecDeque::new(),
            max_buffer_size: 100,
            last_updated: 0,
        }
    }

    /// Subscribe to specific assets
    pub fn subscribe_to(&mut self, asset_ids: Vec<String>) {
        self.subscribed_assets = asset_ids;
    }

    /// Subscribe to all assets
    pub fn subscribe_all(&mut self) {
        self.subscribed_assets.clear();
    }

    /// Push a new fleet event
    pub fn push_event(&mut self, event: FleetEvent) {
        self.last_updated = event.timestamp;
        self.events.push_back(event);

        // Trim buffer if needed
        while self.events.len() > self.max_buffer_size {
            self.events.pop_front();
        }
    }

    /// Get recent events
    pub fn recent_events(&self, count: usize) -> Vec<&FleetEvent> {
        self.events.iter().rev().take(count).collect()
    }

    /// Get all events
    pub fn all_events(&self) -> Vec<&FleetEvent> {
        self.events.iter().collect()
    }

    /// Clear event buffer
    pub fn clear(&mut self) {
        self.events.clear();
    }
}

/// Fleet event
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FleetEvent {
    /// Asset identifier
    pub asset_id: String,

    /// Event type
    pub event_type: FleetEventType,

    /// Timestamp (Unix epoch milliseconds)
    pub timestamp: u64,

    /// Latitude (optional)
    pub latitude: Option<f64>,

    /// Longitude (optional)
    pub longitude: Option<f64>,

    /// State (optional)
    pub state: Option<String>,
}

/// Fleet event types
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum FleetEventType {
    /// Position update
    PositionUpdate,
    /// State change
    StateChange,
    /// Asset registered
    AssetRegistered,
    /// Asset removed
    AssetRemoved,
}

/// Mission feed for real-time mission updates
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MissionFeed {
    /// Feed identifier
    pub feed_id: String,

    /// Subscribed mission IDs (empty = all missions)
    pub subscribed_missions: Vec<String>,

    /// Recent events buffer
    events: VecDeque<MissionEvent>,

    /// Maximum buffer size
    max_buffer_size: usize,

    /// Last update timestamp
    pub last_updated: u64,
}

impl MissionFeed {
    /// Create a new mission feed
    pub fn new(feed_id: String) -> Self {
        Self {
            feed_id,
            subscribed_missions: Vec::new(),
            events: VecDeque::new(),
            max_buffer_size: 100,
            last_updated: 0,
        }
    }

    /// Subscribe to specific missions
    pub fn subscribe_to(&mut self, mission_ids: Vec<String>) {
        self.subscribed_missions = mission_ids;
    }

    /// Subscribe to all missions
    pub fn subscribe_all(&mut self) {
        self.subscribed_missions.clear();
    }

    /// Push a new mission event
    pub fn push_event(&mut self, event: MissionEvent) {
        self.last_updated = event.timestamp;
        self.events.push_back(event);

        // Trim buffer if needed
        while self.events.len() > self.max_buffer_size {
            self.events.pop_front();
        }
    }

    /// Get recent events
    pub fn recent_events(&self, count: usize) -> Vec<&MissionEvent> {
        self.events.iter().rev().take(count).collect()
    }

    /// Get all events
    pub fn all_events(&self) -> Vec<&MissionEvent> {
        self.events.iter().collect()
    }

    /// Clear event buffer
    pub fn clear(&mut self) {
        self.events.clear();
    }
}

/// Mission event
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MissionEvent {
    /// Mission identifier
    pub mission_id: String,

    /// Event type
    pub event_type: MissionEventType,

    /// Timestamp (Unix epoch milliseconds)
    pub timestamp: u64,

    /// State (optional)
    pub state: Option<String>,

    /// Associated assets (optional)
    pub assets: Option<Vec<String>>,
}

/// Mission event types
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum MissionEventType {
    /// Mission created
    MissionCreated,
    /// Mission assigned
    MissionAssigned,
    /// Mission started
    MissionStarted,
    /// Mission completed
    MissionCompleted,
    /// Mission cancelled
    MissionCancelled,
    /// Waypoint reached
    WaypointReached,
}

/// Alert feed for real-time alert updates
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AlertFeed {
    /// Feed identifier
    pub feed_id: String,

    /// Minimum severity to include
    pub min_severity: AlertSeverityFilter,

    /// Recent events buffer
    events: VecDeque<AlertEvent>,

    /// Maximum buffer size
    max_buffer_size: usize,

    /// Last update timestamp
    pub last_updated: u64,
}

impl AlertFeed {
    /// Create a new alert feed
    pub fn new(feed_id: String) -> Self {
        Self {
            feed_id,
            min_severity: AlertSeverityFilter::Info,
            events: VecDeque::new(),
            max_buffer_size: 100,
            last_updated: 0,
        }
    }

    /// Set minimum severity filter
    pub fn set_min_severity(&mut self, severity: AlertSeverityFilter) {
        self.min_severity = severity;
    }

    /// Push a new alert event
    pub fn push_event(&mut self, event: AlertEvent) {
        // Filter by severity
        if event.severity as u8 >= self.min_severity as u8 {
            self.last_updated = event.timestamp;
            self.events.push_back(event);

            // Trim buffer if needed
            while self.events.len() > self.max_buffer_size {
                self.events.pop_front();
            }
        }
    }

    /// Get recent events
    pub fn recent_events(&self, count: usize) -> Vec<&AlertEvent> {
        self.events.iter().rev().take(count).collect()
    }

    /// Get all events
    pub fn all_events(&self) -> Vec<&AlertEvent> {
        self.events.iter().collect()
    }

    /// Clear event buffer
    pub fn clear(&mut self) {
        self.events.clear();
    }
}

/// Alert event
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AlertEvent {
    /// Alert identifier
    pub alert_id: String,

    /// Severity
    pub severity: AlertSeverityFilter,

    /// Category
    pub category: String,

    /// Message
    pub message: String,

    /// Timestamp (Unix epoch milliseconds)
    pub timestamp: u64,

    /// Source asset (optional)
    pub source_asset: Option<String>,
}

/// Alert severity filter
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[repr(u8)]
pub enum AlertSeverityFilter {
    /// Informational alerts
    Info = 0,
    /// Warning alerts
    Warning = 1,
    /// Critical alerts
    Critical = 2,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_fleet_feed_creation() {
        let feed = FleetFeed::new("feed-001".to_string());
        assert_eq!(feed.feed_id, "feed-001");
        assert!(feed.subscribed_assets.is_empty());
    }

    #[test]
    fn test_fleet_feed_subscribe() {
        let mut feed = FleetFeed::new("feed-001".to_string());
        feed.subscribe_to(vec!["asset-001".to_string(), "asset-002".to_string()]);
        assert_eq!(feed.subscribed_assets.len(), 2);

        feed.subscribe_all();
        assert!(feed.subscribed_assets.is_empty());
    }

    #[test]
    fn test_fleet_feed_push_event() {
        let mut feed = FleetFeed::new("feed-001".to_string());
        let event = FleetEvent {
            asset_id: "asset-001".to_string(),
            event_type: FleetEventType::PositionUpdate,
            timestamp: 1000,
            latitude: Some(45.0),
            longitude: Some(-122.0),
            state: None,
        };

        feed.push_event(event);
        assert_eq!(feed.all_events().len(), 1);
        assert_eq!(feed.last_updated, 1000);
    }

    #[test]
    fn test_fleet_feed_buffer_limit() {
        let mut feed = FleetFeed::new("feed-001".to_string());
        feed.max_buffer_size = 5;

        for i in 0..10 {
            let event = FleetEvent {
                asset_id: format!("asset-{}", i),
                event_type: FleetEventType::PositionUpdate,
                timestamp: i as u64,
                latitude: Some(45.0),
                longitude: Some(-122.0),
                state: None,
            };
            feed.push_event(event);
        }

        assert_eq!(feed.all_events().len(), 5);
    }

    #[test]
    fn test_mission_feed_creation() {
        let feed = MissionFeed::new("feed-001".to_string());
        assert_eq!(feed.feed_id, "feed-001");
    }

    #[test]
    fn test_mission_feed_push_event() {
        let mut feed = MissionFeed::new("feed-001".to_string());
        let event = MissionEvent {
            mission_id: "mission-001".to_string(),
            event_type: MissionEventType::MissionCreated,
            timestamp: 1000,
            state: Some("created".to_string()),
            assets: None,
        };

        feed.push_event(event);
        assert_eq!(feed.all_events().len(), 1);
    }

    #[test]
    fn test_alert_feed_creation() {
        let feed = AlertFeed::new("feed-001".to_string());
        assert_eq!(feed.feed_id, "feed-001");
        assert_eq!(feed.min_severity, AlertSeverityFilter::Info);
    }

    #[test]
    fn test_alert_feed_severity_filter() {
        let mut feed = AlertFeed::new("feed-001".to_string());
        feed.set_min_severity(AlertSeverityFilter::Warning);

        let info_event = AlertEvent {
            alert_id: "alert-001".to_string(),
            severity: AlertSeverityFilter::Info,
            category: "test".to_string(),
            message: "Info message".to_string(),
            timestamp: 1000,
            source_asset: None,
        };

        let warning_event = AlertEvent {
            alert_id: "alert-002".to_string(),
            severity: AlertSeverityFilter::Warning,
            category: "test".to_string(),
            message: "Warning message".to_string(),
            timestamp: 2000,
            source_asset: None,
        };

        feed.push_event(info_event);
        feed.push_event(warning_event);

        // Only warning should be in buffer
        assert_eq!(feed.all_events().len(), 1);
    }

    #[test]
    fn test_alert_feed_recent_events() {
        let mut feed = AlertFeed::new("feed-001".to_string());

        for i in 0..5 {
            let event = AlertEvent {
                alert_id: format!("alert-{}", i),
                severity: AlertSeverityFilter::Info,
                category: "test".to_string(),
                message: "Test".to_string(),
                timestamp: i as u64,
                source_asset: None,
            };
            feed.push_event(event);
        }

        let recent = feed.recent_events(3);
        assert_eq!(recent.len(), 3);
        // Should be in reverse order
        assert_eq!(recent[0].alert_id, "alert-4");
    }

    #[test]
    fn test_feed_clear() {
        let mut feed = FleetFeed::new("feed-001".to_string());
        let event = FleetEvent {
            asset_id: "asset-001".to_string(),
            event_type: FleetEventType::PositionUpdate,
            timestamp: 1000,
            latitude: Some(45.0),
            longitude: Some(-122.0),
            state: None,
        };

        feed.push_event(event);
        assert_eq!(feed.all_events().len(), 1);

        feed.clear();
        assert_eq!(feed.all_events().len(), 0);
    }
}
