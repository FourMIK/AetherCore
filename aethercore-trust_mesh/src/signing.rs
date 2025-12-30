//! Event Signing Module
//!
//! Provides Ed25519 signing and verification for events in the trust mesh.
//! Implements key management with pluggable backends.

use ed25519_dalek::{Signature as Ed25519Signature, Signer, SigningKey, Verifier, VerifyingKey};
use fourmik_domain::{CanonicalEvent, PublicKey};
use std::collections::HashMap;
use thiserror::Error;

/// Signing errors
#[derive(Debug, Error)]
pub enum SigningError {
    #[error("Key not found: {0}")]
    KeyNotFound(String),

    #[error("Signature generation failed: {0}")]
    SignatureFailed(String),

    #[error("Signature verification failed: {0}")]
    VerificationFailed(String),

    #[error("Invalid key format: {0}")]
    InvalidKey(String),

    #[error("Key management error: {0}")]
    KeyManagement(String),
}

pub type Result<T> = std::result::Result<T, SigningError>;

/// Key management trait for pluggable backends
pub trait KeyManager: Send + Sync {
    /// Generate a new Ed25519 keypair for a node
    fn generate_key(&mut self, node_id: &str) -> Result<PublicKey>;

    /// Get the signing key for a node
    fn get_signing_key(&self, node_id: &str) -> Result<SigningKey>;

    /// Get the verifying key for a node
    fn get_verifying_key(&self, node_id: &str) -> Result<VerifyingKey>;

    /// Get the public key hex string for a node
    fn get_public_key(&self, node_id: &str) -> Result<PublicKey>;

    /// Rotate the key for a node (generate new keypair)
    fn rotate_key(&mut self, node_id: &str) -> Result<PublicKey>;
}

/// In-memory key manager for development and testing
#[derive(Clone)]
pub struct InMemoryKeyManager {
    keys: HashMap<String, SigningKey>,
}

impl InMemoryKeyManager {
    pub fn new() -> Self {
        Self {
            keys: HashMap::new(),
        }
    }
}

impl Default for InMemoryKeyManager {
    fn default() -> Self {
        Self::new()
    }
}

impl KeyManager for InMemoryKeyManager {
    fn generate_key(&mut self, node_id: &str) -> Result<PublicKey> {
        use rand::RngCore;
        let mut csprng = rand::rngs::OsRng;
        let mut bytes = [0u8; 32];
        csprng.fill_bytes(&mut bytes);

        let signing_key = SigningKey::from_bytes(&bytes);
        let verifying_key = signing_key.verifying_key();
        let public_key = hex::encode(verifying_key.as_bytes());

        self.keys.insert(node_id.to_string(), signing_key);

        Ok(public_key)
    }

    fn get_signing_key(&self, node_id: &str) -> Result<SigningKey> {
        self.keys
            .get(node_id)
            .cloned()
            .ok_or_else(|| SigningError::KeyNotFound(node_id.to_string()))
    }

    fn get_verifying_key(&self, node_id: &str) -> Result<VerifyingKey> {
        let signing_key = self.get_signing_key(node_id)?;
        Ok(signing_key.verifying_key())
    }

    fn get_public_key(&self, node_id: &str) -> Result<PublicKey> {
        let verifying_key = self.get_verifying_key(node_id)?;
        Ok(hex::encode(verifying_key.as_bytes()))
    }

    fn rotate_key(&mut self, node_id: &str) -> Result<PublicKey> {
        // Simply generate a new key (old key is dropped)
        self.generate_key(node_id)
    }
}

/// Event signer that signs canonical events with Ed25519
pub struct EventSigner<K: KeyManager> {
    key_manager: K,
}

impl<K: KeyManager> EventSigner<K> {
    pub fn new(key_manager: K) -> Self {
        Self { key_manager }
    }

    /// Sign an event and populate signature fields
    ///
    /// This is a pure function that:
    /// 1. Computes the event hash (BLAKE3)
    /// 2. Signs the hash with Ed25519
    /// 3. Returns a new event with signature populated
    pub fn sign_event(&self, mut event: CanonicalEvent) -> Result<CanonicalEvent> {
        // Ensure hash is computed
        if event.hash.is_empty() {
            event.hash = event
                .compute_hash()
                .map_err(|e| SigningError::SignatureFailed(e.to_string()))?;
        }

        // Get signing key
        let signing_key = self.key_manager.get_signing_key(&event.node_id)?;

        // Get public key
        let public_key = self.key_manager.get_public_key(&event.node_id)?;

        // Sign the event hash
        let hash_bytes =
            hex::decode(&event.hash).map_err(|e| SigningError::SignatureFailed(e.to_string()))?;

        let signature = signing_key.sign(&hash_bytes);
        let signature_hex = hex::encode(signature.to_bytes());

        // Populate signature fields
        event.signature = signature_hex;
        event.public_key = public_key;

        Ok(event)
    }

    /// Verify an event's signature
    pub fn verify_event(&self, event: &CanonicalEvent) -> Result<bool> {
        if !event.is_signed() {
            return Err(SigningError::VerificationFailed(
                "Event is not signed".to_string(),
            ));
        }

        // Decode public key
        let public_key_bytes =
            hex::decode(&event.public_key).map_err(|e| SigningError::InvalidKey(e.to_string()))?;

        let verifying_key = VerifyingKey::from_bytes(
            public_key_bytes
                .as_slice()
                .try_into()
                .map_err(|_| SigningError::InvalidKey("Invalid public key length".to_string()))?,
        )
        .map_err(|e| SigningError::InvalidKey(e.to_string()))?;

        // Decode signature
        let signature_bytes =
            hex::decode(&event.signature).map_err(|e| SigningError::InvalidKey(e.to_string()))?;

        let signature = Ed25519Signature::from_bytes(
            signature_bytes
                .as_slice()
                .try_into()
                .map_err(|_| SigningError::InvalidKey("Invalid signature length".to_string()))?,
        );

        // Verify hash is correct
        if !event
            .verify_hash()
            .map_err(|e| SigningError::VerificationFailed(e.to_string()))?
        {
            return Ok(false);
        }

        // Verify signature
        let hash_bytes = hex::decode(&event.hash)
            .map_err(|e| SigningError::VerificationFailed(e.to_string()))?;

        match verifying_key.verify(&hash_bytes, &signature) {
            Ok(_) => Ok(true),
            Err(e) => {
                // Signature verification failed - could be invalid signature or malformed data
                tracing::warn!("Signature verification failed: {}", e);
                Ok(false)
            }
        }
    }

    /// Verify signature using an externally provided public key
    pub fn verify_event_with_key(
        &self,
        event: &CanonicalEvent,
        public_key: &PublicKey,
    ) -> Result<bool> {
        if !event.is_signed() {
            return Err(SigningError::VerificationFailed(
                "Event is not signed".to_string(),
            ));
        }

        // Verify the event's public key matches the provided one
        if &event.public_key != public_key {
            return Ok(false);
        }

        self.verify_event(event)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use fourmik_domain::canonical_event::{EventPayload, EventType};

    fn create_test_event() -> CanonicalEvent {
        let mut event = CanonicalEvent {
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
        event.hash = event.compute_hash().unwrap();
        event
    }

    #[test]
    fn test_sign_and_verify_event() {
        let mut key_manager = InMemoryKeyManager::new();
        key_manager.generate_key("node-001").unwrap();

        let signer = EventSigner::new(key_manager);
        let event = create_test_event();

        // Sign event
        let signed_event = signer.sign_event(event).unwrap();

        assert!(signed_event.is_signed());
        assert!(!signed_event.signature.is_empty());
        assert!(!signed_event.public_key.is_empty());

        // Verify signature
        let valid = signer.verify_event(&signed_event).unwrap();
        assert!(valid);
    }

    #[test]
    fn test_verify_tampered_event() {
        let mut key_manager = InMemoryKeyManager::new();
        key_manager.generate_key("node-001").unwrap();

        let signer = EventSigner::new(key_manager);
        let event = create_test_event();

        // Sign event
        let mut signed_event = signer.sign_event(event).unwrap();

        // Tamper with event
        signed_event.sequence = 999;

        // Verification should fail (hash mismatch)
        let valid = signer.verify_event(&signed_event).unwrap();
        assert!(!valid);
    }

    #[test]
    fn test_verify_forged_signature() {
        let mut key_manager = InMemoryKeyManager::new();
        key_manager.generate_key("node-001").unwrap();
        key_manager.generate_key("node-002").unwrap();

        let signer = EventSigner::new(key_manager);
        let mut event = create_test_event();
        event.node_id = "node-001".to_string();

        // Sign with node-001's key
        let mut signed_event = signer.sign_event(event).unwrap();

        // Replace public key with node-002's key
        let node_002_key = signer.key_manager.get_public_key("node-002").unwrap();
        signed_event.public_key = node_002_key;

        // Verification should fail (wrong key)
        let valid = signer.verify_event(&signed_event).unwrap();
        assert!(!valid);
    }

    #[test]
    fn test_key_rotation() {
        let mut key_manager = InMemoryKeyManager::new();
        let key1 = key_manager.generate_key("node-001").unwrap();

        // Rotate key
        let key2 = key_manager.rotate_key("node-001").unwrap();

        // Keys should be different
        assert_ne!(key1, key2);

        // New key should be active
        let current_key = key_manager.get_public_key("node-001").unwrap();
        assert_eq!(current_key, key2);
    }
}
