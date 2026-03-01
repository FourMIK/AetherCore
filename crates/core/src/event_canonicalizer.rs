//! Event canonicalization for deterministic integrity verification.
//!
//! This module provides pure functions for converting events into canonical
//! byte representations suitable for hashing and chain continuity verification.
//!
//! # Design Principles
//! - Deterministic: Same input always produces same output
//! - Pure: No side effects, no external state
//! - Independent: No JNI or Android dependencies
//! - Verifiable: Output can be independently reproduced
//!
//! # Canonical Form
//! Events are serialized with:
//! - Fields sorted alphabetically
//! - Consistent encoding (UTF-8 strings, big-endian numbers)
//! - No whitespace in JSON
//! - Deterministic floating-point representation

use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

/// Canonical event representation suitable for hashing.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CanonicalEvent {
    /// Event fields in sorted order
    pub fields: BTreeMap<String, CanonicalValue>,
    /// Canonical byte representation (serialized form)
    pub canonical_bytes: Vec<u8>,
    /// BLAKE3 hash of canonical bytes
    pub hash: [u8; 32],
}

/// Value types in canonical events.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub enum CanonicalValue {
    String(String),
    Number(i64),
    Float(OrderedFloat),
    Boolean(bool),
    Null,
}

/// Wrapper for f64 that implements Ord for deterministic sorting.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct OrderedFloat(pub f64);

impl Eq for OrderedFloat {}

impl PartialOrd for OrderedFloat {
    fn partial_cmp(&self, other: &Self) -> Option<std::cmp::Ordering> {
        Some(self.cmp(other))
    }
}

impl Ord for OrderedFloat {
    fn cmp(&self, other: &Self) -> std::cmp::Ordering {
        self.0.total_cmp(&other.0)
    }
}

/// Canonicalizer for events.
pub struct EventCanonicalizer;

impl EventCanonicalizer {
    /// Canonicalize a key-value map into deterministic byte representation.
    ///
    /// # Arguments
    /// * `fields` - Event fields as key-value pairs
    ///
    /// # Returns
    /// CanonicalEvent with sorted fields, canonical bytes, and hash
    ///
    /// # Example
    /// ```ignore
    /// let mut fields = BTreeMap::new();
    /// fields.insert("uid".to_string(), CanonicalValue::String("alpha".to_string()));
    /// fields.insert("score".to_string(), CanonicalValue::Float(OrderedFloat(0.95)));
    ///
    /// let canonical = EventCanonicalizer::canonicalize(fields)?;
    /// ```
    pub fn canonicalize(
        fields: BTreeMap<String, CanonicalValue>,
    ) -> Result<CanonicalEvent, CanonicalizeError> {
        // Serialize to JSON with alphabetical keys (BTreeMap provides this)
        let json_bytes = serde_json::to_vec(&fields)
            .map_err(|e| CanonicalizeError::SerializationFailed(e.to_string()))?;

        // Compute BLAKE3 hash
        let hash_output = blake3::hash(&json_bytes);
        let hash: [u8; 32] = *hash_output.as_bytes();

        Ok(CanonicalEvent {
            fields,
            canonical_bytes: json_bytes,
            hash,
        })
    }

    /// Canonicalize from a generic string map.
    ///
    /// Attempts to parse values as numbers/booleans, falls back to strings.
    pub fn canonicalize_from_map(
        map: &std::collections::HashMap<String, String>,
    ) -> Result<CanonicalEvent, CanonicalizeError> {
        let mut fields = BTreeMap::new();

        for (key, value) in map {
            let canonical_value = if value == "true" {
                CanonicalValue::Boolean(true)
            } else if value == "false" {
                CanonicalValue::Boolean(false)
            } else if let Ok(num) = value.parse::<i64>() {
                CanonicalValue::Number(num)
            } else if let Ok(float) = value.parse::<f64>() {
                CanonicalValue::Float(OrderedFloat(float))
            } else {
                CanonicalValue::String(value.clone())
            };

            fields.insert(key.clone(), canonical_value);
        }

        Self::canonicalize(fields)
    }

    /// Verify that a hash matches the canonical form.
    pub fn verify_hash(canonical: &CanonicalEvent) -> bool {
        let computed_hash = blake3::hash(&canonical.canonical_bytes);
        computed_hash.as_bytes() == &canonical.hash
    }
}

/// Errors that can occur during canonicalization.
#[derive(Debug, thiserror::Error)]
pub enum CanonicalizeError {
    #[error("Serialization failed: {0}")]
    SerializationFailed(String),
    
    #[error("Invalid field value: {0}")]
    InvalidField(String),
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_canonicalize_determinism() {
        let mut fields1 = BTreeMap::new();
        fields1.insert("z".to_string(), CanonicalValue::String("last".to_string()));
        fields1.insert("a".to_string(), CanonicalValue::String("first".to_string()));
        fields1.insert("m".to_string(), CanonicalValue::Number(42));

        let mut fields2 = BTreeMap::new();
        fields2.insert("m".to_string(), CanonicalValue::Number(42));
        fields2.insert("a".to_string(), CanonicalValue::String("first".to_string()));
        fields2.insert("z".to_string(), CanonicalValue::String("last".to_string()));

        let canon1 = EventCanonicalizer::canonicalize(fields1).unwrap();
        let canon2 = EventCanonicalizer::canonicalize(fields2).unwrap();

        // Same fields in different order should produce identical canonical form
        assert_eq!(canon1.hash, canon2.hash);
        assert_eq!(canon1.canonical_bytes, canon2.canonical_bytes);
    }

    #[test]
    fn test_hash_stability() {
        let mut fields = BTreeMap::new();
        fields.insert("uid".to_string(), CanonicalValue::String("alpha".to_string()));
        fields.insert("score".to_string(), CanonicalValue::Float(OrderedFloat(0.95)));

        let canon = EventCanonicalizer::canonicalize(fields).unwrap();

        // Hash should be verifiable
        assert!(EventCanonicalizer::verify_hash(&canon));
    }

    #[test]
    fn test_float_determinism() {
        let mut fields1 = BTreeMap::new();
        fields1.insert("value".to_string(), CanonicalValue::Float(OrderedFloat(0.1 + 0.2)));

        let mut fields2 = BTreeMap::new();
        fields2.insert("value".to_string(), CanonicalValue::Float(OrderedFloat(0.3)));

        let canon1 = EventCanonicalizer::canonicalize(fields1).unwrap();
        let canon2 = EventCanonicalizer::canonicalize(fields2).unwrap();

        // Floating point arithmetic may not be exactly equal
        // But canonical form should be deterministic for same input
        assert_ne!(canon1.hash, canon2.hash); // Different values = different hashes
    }
}
