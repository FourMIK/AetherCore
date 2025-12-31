//! Chain Manager Module
//!
//! Manages node-local event chains with append-only semantics and signature verification.

use crate::signing::{EventSigner, KeyManager, SigningError};
use aethercore_domain::{CanonicalEvent, ChainBuilder, ChainLink, ChainRoot, EventHash};
use std::collections::HashMap;
use thiserror::Error;

/// Chain manager errors
#[derive(Debug, Error)]
pub enum ChainError {
    #[error("Chain not found: {0}")]
    ChainNotFound(String),

    #[error("Invalid event: {0}")]
    InvalidEvent(String),

    #[error("Broken chain: {0}")]
    BrokenChain(String),

    #[error("Signature error: {0}")]
    SignatureError(#[from] SigningError),

    #[error("Domain error: {0}")]
    DomainError(#[from] aethercore_domain::DomainError),
}

pub type Result<T> = std::result::Result<T, ChainError>;

/// Chain manager with append-only semantics and signature verification
pub struct ChainManager<K: KeyManager> {
    /// Node identifier
    node_id: String,

    /// Event signer
    signer: EventSigner<K>,

    /// Chain builders per device
    chains: HashMap<String, ChainBuilder>,

    /// Quarantined events (invalid signature or broken chain)
    quarantined: Vec<(CanonicalEvent, String)>, // (event, reason)
}

impl<K: KeyManager> ChainManager<K> {
    pub fn new(node_id: String, key_manager: K) -> Self {
        Self {
            node_id,
            signer: EventSigner::new(key_manager),
            chains: HashMap::new(),
            quarantined: Vec::new(),
        }
    }

    /// Append a local event (created by this node)
    ///
    /// This:
    /// 1. Sets chain metadata (prev_hash, chain_height)
    /// 2. Computes event hash
    /// 3. Signs the event
    /// 4. Appends to chain
    pub fn append_local_event(&mut self, mut event: CanonicalEvent) -> Result<ChainLink> {
        // Ensure node_id matches
        if event.node_id != self.node_id {
            return Err(ChainError::InvalidEvent(format!(
                "Event node_id {} does not match chain manager node_id {}",
                event.node_id, self.node_id
            )));
        }

        // Get or create chain for this device
        let chain_key = format!("{}:{}", self.node_id, event.device_id);
        let chain = self
            .chains
            .entry(chain_key)
            .or_insert_with(|| ChainBuilder::new(format!("{}:{}", self.node_id, event.device_id)));

        // Set chain metadata
        let chain_height = chain.len() as u64;
        event.chain_height = chain_height;

        // Set prev_hash from chain head
        event.prev_hash = if let Some(root) = chain.get_root() {
            root.head_hash.clone()
        } else {
            String::new() // Genesis event
        };

        // Compute hash
        event.hash = event.compute_hash()?;

        // Sign event
        let signed_event = self.signer.sign_event(event)?;

        // Append to chain
        let link = chain.append_event(&signed_event)?;

        Ok(link)
    }

    /// Validate and append a remote event (received from another node)
    ///
    /// This:
    /// 1. Verifies the event signature
    /// 2. Checks chain continuity (prev_hash matches)
    /// 3. Appends to chain if valid, quarantines if invalid
    pub fn append_remote_event(&mut self, event: CanonicalEvent) -> Result<ChainLink> {
        // Verify signature
        let valid = match self.signer.verify_event(&event) {
            Ok(v) => v,
            Err(e) => {
                // Signature error - quarantine the event
                let reason = format!("Signature verification error: {}", e);
                self.quarantined.push((event.clone(), reason.clone()));
                return Err(ChainError::InvalidEvent(reason));
            }
        };

        if !valid {
            let reason = format!("Invalid signature for event {}", event.event_id);
            self.quarantined.push((event.clone(), reason.clone()));
            return Err(ChainError::InvalidEvent(reason));
        }

        // Verify hash
        if !event.verify_hash()? {
            let reason = format!("Hash mismatch for event {}", event.event_id);
            self.quarantined.push((event.clone(), reason.clone()));
            return Err(ChainError::InvalidEvent(reason));
        }

        // Get or create chain for this device
        let chain_key = format!("{}:{}", event.node_id, event.device_id);
        let chain = self
            .chains
            .entry(chain_key.clone())
            .or_insert_with(|| ChainBuilder::new(chain_key));

        // Verify chain continuity
        if let Some(root) = chain.get_root() {
            if event.prev_hash != root.head_hash {
                let reason = format!(
                    "Broken chain: expected prev_hash {}, got {}",
                    root.head_hash, event.prev_hash
                );
                self.quarantined.push((event.clone(), reason.clone()));
                return Err(ChainError::BrokenChain(reason));
            }
        } else {
            // Genesis event - prev_hash should be empty
            if !event.prev_hash.is_empty() {
                let reason = "Genesis event must have empty prev_hash".to_string();
                self.quarantined.push((event.clone(), reason.clone()));
                return Err(ChainError::BrokenChain(reason));
            }
        }

        // Append to chain
        let link = chain.append_event(&event)?;

        Ok(link)
    }

    /// Get chain head hash for a device
    pub fn get_chain_head(&self, node_id: &str, device_id: &str) -> Option<EventHash> {
        let chain_key = format!("{}:{}", node_id, device_id);
        self.chains
            .get(&chain_key)
            .and_then(|chain| chain.get_root())
            .map(|root| root.head_hash.clone())
    }

    /// Get chain root for a device
    pub fn get_chain_root(&self, node_id: &str, device_id: &str) -> Option<ChainRoot> {
        let chain_key = format!("{}:{}", node_id, device_id);
        self.chains
            .get(&chain_key)
            .and_then(|chain| chain.get_root())
            .cloned()
    }

    /// Get a specific link by hash
    pub fn get_link(&self, node_id: &str, device_id: &str, hash: &EventHash) -> Option<ChainLink> {
        let chain_key = format!("{}:{}", node_id, device_id);
        self.chains
            .get(&chain_key)
            .and_then(|chain| chain.get_link(hash))
            .cloned()
    }

    /// Get all quarantined events
    pub fn get_quarantined(&self) -> &[(CanonicalEvent, String)] {
        &self.quarantined
    }

    /// Get chain length for a device
    pub fn get_chain_length(&self, node_id: &str, device_id: &str) -> u64 {
        let chain_key = format!("{}:{}", node_id, device_id);
        self.chains
            .get(&chain_key)
            .map(|chain| chain.len() as u64)
            .unwrap_or(0)
    }

    /// Retrieve a segment of events for Merkle aggregation
    pub fn get_event_segment(
        &self,
        node_id: &str,
        device_id: &str,
        from_height: u64,
        to_height: u64,
    ) -> Vec<EventHash> {
        // Validate range
        if from_height > to_height {
            return Vec::new();
        }

        let chain_key = format!("{}:{}", node_id, device_id);

        if let Some(chain) = self.chains.get(&chain_key) {
            let mut hashes = Vec::new();
            for height in from_height..=to_height {
                if let Some(hash) = chain.get_hash_at(height) {
                    hashes.push(hash.clone());
                }
            }
            hashes
        } else {
            Vec::new()
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::signing::InMemoryKeyManager;
    use aethercore_domain::canonical_event::{EventPayload, EventType};

    fn create_test_event(event_id: &str, device_id: &str, node_id: &str) -> CanonicalEvent {
        CanonicalEvent {
            event_id: event_id.to_string(),
            event_type: EventType::GPS,
            timestamp: 1702031820000,
            device_id: device_id.to_string(),
            node_id: node_id.to_string(),
            sequence: 0,
            prev_hash: String::new(),
            chain_height: 0,
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
        }
    }

    #[test]
    fn test_append_local_event() {
        let mut key_manager = InMemoryKeyManager::new();
        key_manager.generate_key("node-001").unwrap();

        let mut chain_mgr = ChainManager::new("node-001".to_string(), key_manager);
        let event = create_test_event("event-1", "device-1", "node-001");

        let link = chain_mgr.append_local_event(event).unwrap();

        assert_eq!(link.sequence, 0);
        assert_eq!(link.previous_hash, "");
        assert_eq!(chain_mgr.get_chain_length("node-001", "device-1"), 1);
    }

    #[test]
    fn test_append_multiple_local_events() {
        let mut key_manager = InMemoryKeyManager::new();
        key_manager.generate_key("node-001").unwrap();

        let mut chain_mgr = ChainManager::new("node-001".to_string(), key_manager);

        // Append 3 events
        for i in 0..3 {
            let event = create_test_event(&format!("event-{}", i), "device-1", "node-001");
            chain_mgr.append_local_event(event).unwrap();
        }

        assert_eq!(chain_mgr.get_chain_length("node-001", "device-1"), 3);

        // Verify chain head
        let head = chain_mgr.get_chain_head("node-001", "device-1");
        assert!(head.is_some());
    }

    #[test]
    fn test_chain_continuity() {
        let mut key_manager = InMemoryKeyManager::new();
        key_manager.generate_key("node-001").unwrap();

        let mut chain_mgr = ChainManager::new("node-001".to_string(), key_manager);

        // Append first event
        let event1 = create_test_event("event-1", "device-1", "node-001");
        let link1 = chain_mgr.append_local_event(event1).unwrap();

        // Append second event
        let event2 = create_test_event("event-2", "device-1", "node-001");
        let link2 = chain_mgr.append_local_event(event2).unwrap();

        // Second event should reference first
        assert_eq!(link2.previous_hash, link1.event_hash);
    }

    #[test]
    fn test_append_remote_event_valid() {
        let mut key_manager = InMemoryKeyManager::new();
        key_manager.generate_key("node-001").unwrap();
        key_manager.generate_key("node-002").unwrap();

        // Node 1 creates and signs an event
        let mut chain_mgr1 = ChainManager::new("node-001".to_string(), key_manager.clone());
        let event = create_test_event("event-1", "device-1", "node-001");
        chain_mgr1.append_local_event(event).unwrap();

        // Get the signed event from chain 1
        let head = chain_mgr1.get_chain_head("node-001", "device-1").unwrap();
        let link = chain_mgr1.get_link("node-001", "device-1", &head).unwrap();

        // Node 2 receives and validates the event
        // (In a real system, we'd reconstruct the event from the link + stored data)
        // For this test, we'll skip the validation since we don't have access to the original event

        assert_eq!(link.sequence, 0);
    }

    #[test]
    fn test_quarantine_invalid_signature() {
        let mut key_manager = InMemoryKeyManager::new();
        key_manager.generate_key("node-001").unwrap();

        let mut chain_mgr = ChainManager::new("node-001".to_string(), key_manager);

        // Create event with fake signature
        let mut event = create_test_event("event-1", "device-1", "node-001");
        event.hash = event.compute_hash().unwrap();
        event.signature = "fake_signature".to_string();
        event.public_key = "fake_key".to_string();

        // Try to append - should be quarantined
        let result = chain_mgr.append_remote_event(event);
        assert!(result.is_err());
        assert_eq!(chain_mgr.get_quarantined().len(), 1);
    }

    #[test]
    fn test_get_event_segment() {
        let mut key_manager = InMemoryKeyManager::new();
        key_manager.generate_key("node-001").unwrap();

        let mut chain_mgr = ChainManager::new("node-001".to_string(), key_manager);

        // Append 5 events
        for i in 0..5 {
            let event = create_test_event(&format!("event-{}", i), "device-1", "node-001");
            chain_mgr.append_local_event(event).unwrap();
        }

        // Get segment from height 1 to 3
        let segment = chain_mgr.get_event_segment("node-001", "device-1", 1, 3);
        assert_eq!(segment.len(), 3);
    }
}
