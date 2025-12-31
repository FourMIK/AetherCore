//! Event schema for system-wide events in the 4MIK system.
//!
//! Provides standardized event types for identity operations, trust decisions,
//! security events, and operational state changes. All events are timestamped
//! and include identity attribution where applicable.

use serde::{Deserialize, Serialize};

/// Severity level for events.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum EventSeverity {
    /// Informational event
    Info,
    /// Warning condition
    Warning,
    /// Error condition
    Error,
    /// Critical security event
    Critical,
}

/// Category of event.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum EventCategory {
    /// Identity lifecycle events
    Identity,
    /// Trust and verification events
    Trust,
    /// Security-related events
    Security,
    /// Network and communication events
    Network,
    /// Operational state changes
    Operational,
    /// System configuration events
    Configuration,
}

/// Core event structure for all 4MIK system events.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Event {
    /// Unique event identifier
    pub event_id: String,
    /// Timestamp (Unix epoch milliseconds)
    pub timestamp: u64,
    /// Event severity
    pub severity: EventSeverity,
    /// Event category
    pub category: EventCategory,
    /// Event type (specific action or state)
    pub event_type: String,
    /// Identity that triggered the event (if applicable)
    pub identity_id: Option<String>,
    /// Source component or module
    pub source: String,
    /// Human-readable message
    pub message: String,
    /// Structured metadata
    pub metadata: EventMetadata,
}

/// Structured metadata for events.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct EventMetadata {
    /// Key-value pairs for additional context
    #[serde(flatten)]
    pub data: std::collections::HashMap<String, serde_json::Value>,
}

impl EventMetadata {
    /// Create empty metadata.
    pub fn new() -> Self {
        Self::default()
    }

    /// Add a key-value pair.
    pub fn insert(&mut self, key: impl Into<String>, value: impl Into<serde_json::Value>) {
        self.data.insert(key.into(), value.into());
    }

    /// Get a value by key.
    pub fn get(&self, key: &str) -> Option<&serde_json::Value> {
        self.data.get(key)
    }
}

/// Builder for creating events.
pub struct EventBuilder {
    event: Event,
}

impl EventBuilder {
    /// Create a new event builder.
    pub fn new(event_type: impl Into<String>, source: impl Into<String>) -> Self {
        Self {
            event: Event {
                event_id: uuid_v4(),
                timestamp: current_timestamp(),
                severity: EventSeverity::Info,
                category: EventCategory::Operational,
                event_type: event_type.into(),
                identity_id: None,
                source: source.into(),
                message: String::new(),
                metadata: EventMetadata::new(),
            },
        }
    }

    /// Set the severity.
    pub fn severity(mut self, severity: EventSeverity) -> Self {
        self.event.severity = severity;
        self
    }

    /// Set the category.
    pub fn category(mut self, category: EventCategory) -> Self {
        self.event.category = category;
        self
    }

    /// Set the identity ID.
    pub fn identity(mut self, identity_id: impl Into<String>) -> Self {
        self.event.identity_id = Some(identity_id.into());
        self
    }

    /// Set the message.
    pub fn message(mut self, message: impl Into<String>) -> Self {
        self.event.message = message.into();
        self
    }

    /// Add metadata.
    pub fn metadata(mut self, key: impl Into<String>, value: impl Into<serde_json::Value>) -> Self {
        self.event.metadata.insert(key, value);
        self
    }

    /// Build the event.
    pub fn build(self) -> Event {
        self.event
    }
}

/// Standard event types for common operations.
pub mod event_types {
    // Identity events
    pub const IDENTITY_CREATED: &str = "identity.created";
    pub const IDENTITY_VERIFIED: &str = "identity.verified";
    pub const IDENTITY_REVOKED: &str = "identity.revoked";
    pub const IDENTITY_RENEWED: &str = "identity.renewed";

    // Trust events
    pub const TRUST_GRANTED: &str = "trust.granted";
    pub const TRUST_DENIED: &str = "trust.denied";
    pub const TRUST_DEGRADED: &str = "trust.degraded";
    pub const SIGNATURE_VERIFIED: &str = "trust.signature_verified";
    pub const SIGNATURE_FAILED: &str = "trust.signature_failed";

    // Security events
    pub const SECURITY_ALERT: &str = "security.alert";
    pub const REPLAY_DETECTED: &str = "security.replay_detected";
    pub const TAMPERING_DETECTED: &str = "security.tampering_detected";
    pub const UNAUTHORIZED_ACCESS: &str = "security.unauthorized_access";

    // Network events
    pub const NODE_JOINED: &str = "network.node_joined";
    pub const NODE_LEFT: &str = "network.node_left";
    pub const MESSAGE_RECEIVED: &str = "network.message_received";
    pub const MESSAGE_SENT: &str = "network.message_sent";

    // Operational events
    pub const SYSTEM_STARTED: &str = "operational.system_started";
    pub const SYSTEM_STOPPED: &str = "operational.system_stopped";
    pub const COMPONENT_INITIALIZED: &str = "operational.component_initialized";
    pub const COMPONENT_FAILED: &str = "operational.component_failed";
}

/// Generate a simple UUID v4 (simplified for demonstration).
fn uuid_v4() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    format!("{:x}", nanos)
}

/// Get current timestamp in milliseconds.
fn current_timestamp() -> u64 {
    use std::time::{SystemTime, UNIX_EPOCH};
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_millis() as u64
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_event_builder() {
        let event = EventBuilder::new("test.event", "test-module")
            .severity(EventSeverity::Warning)
            .category(EventCategory::Security)
            .identity("test-identity")
            .message("Test message")
            .metadata("key1", "value1")
            .build();

        assert_eq!(event.event_type, "test.event");
        assert_eq!(event.source, "test-module");
        assert_eq!(event.severity, EventSeverity::Warning);
        assert_eq!(event.category, EventCategory::Security);
        assert_eq!(event.identity_id, Some("test-identity".to_string()));
        assert_eq!(event.message, "Test message");
        assert!(event.metadata.get("key1").is_some());
    }

    #[test]
    fn test_event_metadata() {
        let mut metadata = EventMetadata::new();
        metadata.insert("count", 42);
        metadata.insert("name", "test");

        assert_eq!(metadata.get("count").and_then(|v| v.as_i64()), Some(42));
        assert_eq!(metadata.get("name").and_then(|v| v.as_str()), Some("test"));
    }

    #[test]
    fn test_event_serialization() {
        let event = EventBuilder::new(event_types::IDENTITY_CREATED, "identity-module")
            .severity(EventSeverity::Info)
            .category(EventCategory::Identity)
            .message("Identity created successfully")
            .build();

        let json = serde_json::to_string(&event).unwrap();
        let deserialized: Event = serde_json::from_str(&json).unwrap();

        assert_eq!(deserialized.event_type, event_types::IDENTITY_CREATED);
        assert_eq!(deserialized.severity, EventSeverity::Info);
    }

    #[test]
    fn test_severity_levels() {
        assert_eq!(EventSeverity::Info as i32, 0);
        assert!(EventSeverity::Critical as i32 > EventSeverity::Info as i32);
    }

    #[test]
    fn test_event_categories() {
        let categories = vec![
            EventCategory::Identity,
            EventCategory::Trust,
            EventCategory::Security,
            EventCategory::Network,
            EventCategory::Operational,
            EventCategory::Configuration,
        ];

        for category in categories {
            let event = EventBuilder::new("test", "test")
                .category(category.clone())
                .build();
            assert_eq!(event.category, category);
        }
    }
}
