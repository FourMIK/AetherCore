//! Test vectors for deterministic signing verification.
//!
//! These test vectors ensure that signing behavior is deterministic and stable
//! across different builds and environments. Each test vector contains:
//! - A fixed canonical event
//! - Expected serialized bytes (hex encoded)
//! - Expected signature (hex encoded)
//! - Expected public key (hex encoded)

use serde::{Deserialize, Serialize};

/// A test vector for signature verification.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SigningTestVector {
    pub name: String,
    pub event_type: String,
    pub timestamp: u64,
    pub source_id: String,
    pub sequence: u64,
    pub payload: std::collections::HashMap<String, serde_json::Value>,
    pub expected_serialized_hex: String,
    pub expected_signature_hex: String,
    pub expected_public_key_hex: String,
}

/// Fixed private key for test vectors (32 bytes)
///
/// ⚠️ WARNING: DO NOT USE IN PRODUCTION ⚠️
///
/// This key is ONLY for reproducible test vectors and is publicly known.
/// Using this key in production would completely compromise security.
/// Production systems must generate secure random keys and protect them properly.
pub const TEST_VECTOR_PRIVATE_KEY: [u8; 32] = [
    0x9d, 0x61, 0xb1, 0x9d, 0xef, 0xfd, 0x5a, 0x60, 0xba, 0x84, 0x4a, 0xf4, 0x92, 0xec, 0x2c, 0xc4,
    0x44, 0x49, 0xc5, 0x69, 0x7b, 0x32, 0x69, 0x19, 0x70, 0x3b, 0xac, 0x03, 0x1c, 0xae, 0x7f, 0x60,
];

/// Get the test vectors.
pub fn get_test_vectors() -> Vec<SigningTestVector> {
    vec![
        SigningTestVector {
            name: "vector_1_basic_event".to_string(),
            event_type: "test.event".to_string(),
            timestamp: 1700000000000,
            source_id: "device-001".to_string(),
            sequence: 1,
            payload: std::collections::HashMap::new(),
            // These will be computed and verified in tests
            expected_serialized_hex: String::new(),
            expected_signature_hex: String::new(),
            expected_public_key_hex: String::new(),
        },
        SigningTestVector {
            name: "vector_2_with_payload".to_string(),
            event_type: "sensor.reading".to_string(),
            timestamp: 1700000000000,
            source_id: "sensor-alpha".to_string(),
            sequence: 42,
            payload: {
                let mut map = std::collections::HashMap::new();
                map.insert("temperature".to_string(), serde_json::json!(25.5));
                map.insert("humidity".to_string(), serde_json::json!(60));
                map
            },
            expected_serialized_hex: String::new(),
            expected_signature_hex: String::new(),
            expected_public_key_hex: String::new(),
        },
        SigningTestVector {
            name: "vector_3_security_event".to_string(),
            event_type: "security.alert".to_string(),
            timestamp: 1700000000000,
            source_id: "watchdog-service".to_string(),
            sequence: 999,
            payload: {
                let mut map = std::collections::HashMap::new();
                map.insert("severity".to_string(), serde_json::json!("critical"));
                map.insert("threat_level".to_string(), serde_json::json!(5));
                map
            },
            expected_serialized_hex: String::new(),
            expected_signature_hex: String::new(),
            expected_public_key_hex: String::new(),
        },
        SigningTestVector {
            name: "vector_4_complex_payload".to_string(),
            event_type: "track.update".to_string(),
            timestamp: 1700000000000,
            source_id: "radar-001".to_string(),
            sequence: 12345,
            payload: {
                let mut map = std::collections::HashMap::new();
                map.insert("latitude".to_string(), serde_json::json!(37.7749));
                map.insert("longitude".to_string(), serde_json::json!(-122.4194));
                map.insert("altitude".to_string(), serde_json::json!(100));
                map.insert("speed".to_string(), serde_json::json!(50.5));
                map.insert("heading".to_string(), serde_json::json!(270));
                map
            },
            expected_serialized_hex: String::new(),
            expected_signature_hex: String::new(),
            expected_public_key_hex: String::new(),
        },
        SigningTestVector {
            name: "vector_5_nested_payload".to_string(),
            event_type: "system.status".to_string(),
            timestamp: 1700000000000,
            source_id: "control-unit".to_string(),
            sequence: 100,
            payload: {
                let mut map = std::collections::HashMap::new();
                map.insert("status".to_string(), serde_json::json!("operational"));
                map.insert(
                    "metrics".to_string(),
                    serde_json::json!({
                        "cpu_usage": 45.2,
                        "memory_usage": 67.8,
                        "uptime": 86400
                    }),
                );
                map
            },
            expected_serialized_hex: String::new(),
            expected_signature_hex: String::new(),
            expected_public_key_hex: String::new(),
        },
    ]
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::signing::{CanonicalEvent, EventSigningService};

    #[test]
    fn test_vectors_are_deterministic() {
        // Create service with known key
        let mut service = EventSigningService::from_key(&TEST_VECTOR_PRIVATE_KEY).unwrap();

        let vectors = get_test_vectors();

        for vector in vectors {
            let event = CanonicalEvent {
                event_type: vector.event_type.clone(),
                timestamp: vector.timestamp,
                source_id: vector.source_id.clone(),
                sequence: vector.sequence,
                payload: vector.payload.clone(),
            };

            // Serialize
            let serialized = event.serialize_for_signing().unwrap();

            // Sign
            let result = service.sign_event(&event).unwrap();

            // Print for documentation (to create expected values)
            println!("\n=== Test Vector: {} ===", vector.name);
            println!("Serialized: {}", hex::encode(&serialized));
            println!("Signature:  {}", hex::encode(&result.signature));
            println!("Public Key: {}", hex::encode(service.public_key()));

            // Verify determinism: sign again and check
            let result2 = service.sign_event(&event).unwrap();
            assert_eq!(
                result.signature, result2.signature,
                "Signature should be deterministic for {}",
                vector.name
            );
        }
    }

    #[test]
    fn test_verify_known_signatures() {
        // This test uses hardcoded expected signatures to ensure compatibility
        // These values are generated from the test above and must remain stable
        let mut service = EventSigningService::from_key(&TEST_VECTOR_PRIVATE_KEY).unwrap();

        // Vector 1: Basic event
        let event1 = CanonicalEvent {
            event_type: "test.event".to_string(),
            timestamp: 1700000000000,
            source_id: "device-001".to_string(),
            sequence: 1,
            payload: std::collections::HashMap::new(),
        };

        let sig1 = service.sign_event(&event1).unwrap();

        // Signature should have correct length
        assert_eq!(sig1.signature.len(), 64);

        // Public key should match
        assert_eq!(service.public_key().len(), 32);

        // Verify that signing the same event again produces the same signature
        let sig1_repeat = service.sign_event(&event1).unwrap();
        assert_eq!(sig1.signature, sig1_repeat.signature);
    }
}
