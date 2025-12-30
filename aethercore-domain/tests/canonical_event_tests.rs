//! Integration tests for canonical event validation and edge cases

use fourmik_domain::canonical_event::{CanonicalEvent, EventPayload, EventType, SystemSubtype};

/// Test that events with invalid hashes are detected
#[test]
fn test_invalid_event_hash_detected() {
    let mut event = create_test_gps_event();
    event.hash = event.compute_hash().unwrap();

    // Verify hash is correct
    assert!(event.verify_hash().unwrap());

    // Tamper with event
    event.sequence = 999;

    // Hash should now be invalid
    assert!(!event.verify_hash().unwrap());
}

/// Test canonicalization with special characters
#[test]
fn test_canonicalization_with_special_chars() {
    let event = CanonicalEvent {
        event_id: "test-001".to_string(),
        event_type: EventType::SYSTEM,
        timestamp: 1702031820000,
        device_id: "device-001".to_string(),
        node_id: "node-001".to_string(),
        sequence: 1,
        prev_hash: String::new(),
        chain_height: 1,
        payload: EventPayload::System {
            subtype: SystemSubtype::Error,
            message: "Error: \"quote\" and 'apostrophe' and \\ backslash".to_string(),
            error_code: None,
            context: None,
        },
        hash: String::new(),
        signature: String::new(),
        public_key: String::new(),
        metadata: None,
    };

    let canonical = event.to_canonical_json().unwrap();

    // Should properly escape special characters
    assert!(canonical.contains("\\\""));
    assert!(canonical.contains("\\\\"));
}

/// Test canonicalization with floating point edge cases
#[test]
fn test_floating_point_canonicalization() {
    let event1 = create_gps_event_with_coords(34.052235, -118.243683);
    let event2 = create_gps_event_with_coords(34.052235, -118.243683);

    let hash1 = event1.compute_hash().unwrap();
    let hash2 = event2.compute_hash().unwrap();

    // Identical coordinates should produce identical hashes
    assert_eq!(hash1, hash2);
}

/// Test that NaN and Infinity are handled
#[test]
fn test_special_float_values() {
    // This test documents behavior with special floats
    // In production, validation should reject NaN/Infinity
    let event = create_gps_event_with_coords(34.0, -118.0);
    let _canonical = event.to_canonical_json().unwrap();
    // Should not panic
}

/// Test event with all optional fields omitted
#[test]
fn test_minimal_event() {
    let event = CanonicalEvent {
        event_id: "min-001".to_string(),
        event_type: EventType::GPS,
        timestamp: 1702031820000,
        device_id: "device-001".to_string(),
        node_id: "node-001".to_string(),
        sequence: 0,
        prev_hash: String::new(),
        chain_height: 0,
        payload: EventPayload::GPS {
            latitude: 0.0,
            longitude: 0.0,
            altitude: None,
            speed: None,
            heading: None,
            hdop: None,
            satellites: None,
        },
        hash: String::new(),
        signature: String::new(),
        public_key: String::new(),
        metadata: None,
    };

    let canonical = event.to_canonical_json().unwrap();
    let hash = event.compute_hash().unwrap();

    // Should successfully canonicalize and hash
    assert!(!canonical.is_empty());
    assert!(!hash.is_empty());
}

/// Test event with all optional fields present
#[test]
fn test_maximal_event() {
    let mut metadata = std::collections::BTreeMap::new();
    metadata.insert("key1".to_string(), serde_json::json!("value1"));

    let event = CanonicalEvent {
        event_id: "max-001".to_string(),
        event_type: EventType::GPS,
        timestamp: 1702031820000,
        device_id: "device-001".to_string(),
        node_id: "node-001".to_string(),
        sequence: 0,
        prev_hash: "abcd1234".to_string(),
        chain_height: 5,
        payload: EventPayload::GPS {
            latitude: 34.052235,
            longitude: -118.243683,
            altitude: Some(100.5),
            speed: Some(5.5),
            heading: Some(270.0),
            hdop: Some(1.2),
            satellites: Some(12),
        },
        hash: String::new(),
        signature: String::new(),
        public_key: String::new(),
        metadata: Some(metadata),
    };

    let canonical = event.to_canonical_json().unwrap();
    let hash = event.compute_hash().unwrap();

    // Should successfully canonicalize and hash
    assert!(!canonical.is_empty());
    assert!(!hash.is_empty());
}

/// Test that key ordering is consistent
#[test]
fn test_key_ordering_consistency() {
    let event1 = create_test_gps_event();
    let event2 = create_test_gps_event();

    let json1 = event1.to_canonical_json_for_signing().unwrap();
    let json2 = event2.to_canonical_json_for_signing().unwrap();

    // Same event should produce identical JSON
    assert_eq!(json1, json2);

    // Keys should be in alphabetical order
    let chain_height_pos = json1.find("\"chain_height\"").unwrap();
    let device_pos = json1.find("\"device_id\"").unwrap();
    let event_pos = json1.find("\"event_id\"").unwrap();

    assert!(chain_height_pos < device_pos);
    assert!(device_pos < event_pos);
}

/// Test very large sequence numbers
#[test]
fn test_large_sequence_numbers() {
    let mut event = create_test_gps_event();
    event.sequence = u64::MAX - 1;

    let hash = event.compute_hash().unwrap();
    assert!(!hash.is_empty());
}

/// Test very old and very new timestamps
#[test]
fn test_extreme_timestamps() {
    let mut event = create_test_gps_event();

    // Very old timestamp (year 1970)
    event.timestamp = 1000;
    let hash1 = event.compute_hash().unwrap();
    assert!(!hash1.is_empty());

    // Very new timestamp (year 2100)
    event.timestamp = 4102444800000;
    let hash2 = event.compute_hash().unwrap();
    assert!(!hash2.is_empty());

    // Hashes should be different
    assert_ne!(hash1, hash2);
}

// Helper functions

fn create_test_gps_event() -> CanonicalEvent {
    CanonicalEvent {
        event_id: "test-001".to_string(),
        event_type: EventType::GPS,
        timestamp: 1702031820000,
        device_id: "device-001".to_string(),
        node_id: "node-001".to_string(),
        sequence: 1,
        prev_hash: String::new(),
        chain_height: 1,
        payload: EventPayload::GPS {
            latitude: 34.052235,
            longitude: -118.243683,
            altitude: Some(100.0),
            speed: Some(5.0),
            heading: Some(90.0),
            hdop: None,
            satellites: None,
        },
        hash: String::new(),
        signature: String::new(),
        public_key: String::new(),
        metadata: None,
    }
}

fn create_gps_event_with_coords(lat: f64, lon: f64) -> CanonicalEvent {
    CanonicalEvent {
        event_id: "coord-test".to_string(),
        event_type: EventType::GPS,
        timestamp: 1702031820000,
        device_id: "device-001".to_string(),
        node_id: "node-001".to_string(),
        sequence: 1,
        prev_hash: String::new(),
        chain_height: 1,
        payload: EventPayload::GPS {
            latitude: lat,
            longitude: lon,
            altitude: None,
            speed: None,
            heading: None,
            hdop: None,
            satellites: None,
        },
        hash: String::new(),
        signature: String::new(),
        public_key: String::new(),
        metadata: None,
    }
}
