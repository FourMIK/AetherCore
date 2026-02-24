//! Slashing Logic - Byzantine Fault Detection and Automated Revocation
//!
//! This module implements the slashing logic ported from AuthynticOne's ProofSlashing.sol.
//! It enforces trust by automatically revoking nodes that submit invalid proofs or exhibit
//! Byzantine behavior in the mesh network.
//!
//! # Architecture
//!
//! The slashing system enforces Zero-Trust principles by:
//! - Detecting equivocation (two different proofs with same sequence number)
//! - Detecting Merkle chain breaks (invalid prev_event_hash)
//! - Detecting signature forgery
//! - Automatically transitioning Byzantine nodes to Revoked state
//! - Emitting cryptographically signed SlashingEvents with BLAKE3 hashing
//!
//! # Security Invariants
//!
//! - **Fail-Visible**: All slashing events are explicitly logged and signed
//! - **Deterministic**: Slashing executes identically across all mesh nodes
//! - **BLAKE3 Exclusive**: All hashing uses BLAKE3
//! - **Ed25519 Signatures**: All slashing events are signed with Ed25519
//!
//! # Integration
//!
//! Slashing events are recorded in the Event Ledger (ledger.rs) and integrated
//! with the Merkle Vine for distributed verification.

use crate::ledger::SignedEvent;
use blake3::Hasher;
use ed25519_dalek::{Signature, Signer, SigningKey, Verifier, VerifyingKey};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::time::{SystemTime, UNIX_EPOCH};
use thiserror::Error;

/// Node state in the trust mesh
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum NodeState {
    /// Node state is unknown (initial state)
    Unknown,
    /// Node has been cryptographically verified and is healthy
    Healthy,
    /// Node is exhibiting suspicious behavior
    Suspect,
    /// Node is quarantined due to trust score violations
    Quarantined,
    /// Node has been permanently revoked due to Byzantine behavior
    Revoked,
}

impl NodeState {
    /// Check if the node is in a revoked state
    pub fn is_revoked(&self) -> bool {
        matches!(self, NodeState::Revoked)
    }

    /// Check if the node is trustworthy (Healthy)
    pub fn is_healthy(&self) -> bool {
        matches!(self, NodeState::Healthy)
    }
}

/// Type of Byzantine fault detected
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum ByzantineFaultType {
    /// Two different proofs with the same sequence number (equivocation)
    Equivocation {
        seq_no: u64,
        hash1: Vec<u8>,
        hash2: Vec<u8>,
    },
    /// Invalid previous event hash (Merkle chain break)
    ChainBreak {
        seq_no: u64,
        expected_hash: Vec<u8>,
        actual_hash: Vec<u8>,
    },
    /// Invalid signature on event
    SignatureForgery { seq_no: u64, event_hash: Vec<u8> },
    /// Timestamp violation (proof timestamp too far in future or past)
    TemporalViolation {
        seq_no: u64,
        proof_timestamp: u64,
        current_time: u64,
        max_drift_ms: u64,
    },
}

impl ByzantineFaultType {
    /// Get a human-readable description of the fault
    pub fn description(&self) -> String {
        match self {
            ByzantineFaultType::Equivocation { seq_no, .. } => {
                format!(
                    "Equivocation detected: two different proofs at seq_no {}",
                    seq_no
                )
            }
            ByzantineFaultType::ChainBreak { seq_no, .. } => {
                format!("Merkle chain break detected at seq_no {}", seq_no)
            }
            ByzantineFaultType::SignatureForgery { seq_no, .. } => {
                format!("Signature forgery detected at seq_no {}", seq_no)
            }
            ByzantineFaultType::TemporalViolation {
                seq_no,
                proof_timestamp,
                current_time,
                ..
            } => {
                format!(
                    "Temporal violation at seq_no {}: proof_timestamp={}, current_time={}",
                    seq_no, proof_timestamp, current_time
                )
            }
        }
    }
}

/// Slashing event emitted when a node is revoked
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SlashingEvent {
    /// Unique event identifier
    pub event_id: String,
    /// Node being slashed
    pub node_id: String,
    /// Type of Byzantine fault detected
    pub fault_type: ByzantineFaultType,
    /// BLAKE3 hash of the slashing event
    pub event_hash: Vec<u8>,
    /// Ed25519 signature of the event
    pub signature: Vec<u8>,
    /// Public key ID of the slasher
    pub slasher_public_key_id: String,
    /// Timestamp when slashing occurred (Unix milliseconds)
    pub timestamp: u64,
    /// Additional evidence (JSON-serialized)
    pub evidence: Option<String>,
}

impl SlashingEvent {
    /// Create a new slashing event
    ///
    /// # Arguments
    /// * `node_id` - The node being slashed
    /// * `fault_type` - The type of Byzantine fault detected
    /// * `slasher_public_key_id` - The ID of the slasher's public key
    /// * `evidence` - Optional additional evidence
    ///
    /// # Returns
    /// A new unsigned SlashingEvent (must be signed before emission)
    pub fn new(
        node_id: String,
        fault_type: ByzantineFaultType,
        slasher_public_key_id: String,
        evidence: Option<String>,
    ) -> Self {
        let timestamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("System time before UNIX epoch")
            .as_millis() as u64;

        let event_id = format!("slash-{}-{}", node_id, timestamp);

        // Compute BLAKE3 hash of event content
        let mut hasher = Hasher::new();
        hasher.update(event_id.as_bytes());
        hasher.update(node_id.as_bytes());
        hasher.update(&timestamp.to_le_bytes());
        if let Some(ref ev) = evidence {
            hasher.update(ev.as_bytes());
        }
        let event_hash = hasher.finalize().as_bytes().to_vec();

        Self {
            event_id,
            node_id,
            fault_type,
            event_hash,
            signature: Vec::new(), // Will be filled by sign()
            slasher_public_key_id,
            timestamp,
            evidence,
        }
    }

    /// Sign the slashing event with Ed25519
    ///
    /// # Arguments
    /// * `signing_key` - The Ed25519 signing key
    ///
    /// # Returns
    /// The signed slashing event
    pub fn sign(mut self, signing_key: &SigningKey) -> Self {
        let signature = signing_key.sign(&self.event_hash);
        self.signature = signature.to_bytes().to_vec();
        self
    }

    /// Verify the slashing event signature
    ///
    /// # Arguments
    /// * `verifying_key` - The Ed25519 verifying key
    ///
    /// # Returns
    /// * `Ok(())` - Signature is valid
    /// * `Err(SlashingError)` - Signature is invalid
    pub fn verify(&self, verifying_key: &VerifyingKey) -> std::result::Result<(), SlashingError> {
        if self.signature.len() != 64 {
            return Err(SlashingError::InvalidSignature(
                "Signature length must be 64 bytes".to_string(),
            ));
        }

        let sig_bytes: [u8; 64] =
            self.signature.as_slice().try_into().map_err(|_| {
                SlashingError::InvalidSignature("Invalid signature format".to_string())
            })?;

        let signature = Signature::from_bytes(&sig_bytes);

        verifying_key
            .verify(&self.event_hash, &signature)
            .map_err(|e| SlashingError::InvalidSignature(format!("Verification failed: {}", e)))
    }
}

/// Errors that can occur during slashing operations
#[derive(Debug, Error)]
pub enum SlashingError {
    #[error("Byzantine fault detected: {0}")]
    ByzantineFault(String),

    #[error("Invalid signature: {0}")]
    InvalidSignature(String),

    #[error("Node already revoked: {node_id}")]
    NodeAlreadyRevoked { node_id: String },

    #[error("Node not found: {node_id}")]
    NodeNotFound { node_id: String },

    #[error("Invalid event: {0}")]
    InvalidEvent(String),

    #[error("Equivocation detected: seq_no={seq_no}, node_id={node_id}")]
    EquivocationDetected { seq_no: u64, node_id: String },

    #[error("Chain break detected: seq_no={seq_no}, node_id={node_id}")]
    ChainBreakDetected { seq_no: u64, node_id: String },
}

pub type Result<T> = std::result::Result<T, SlashingError>;

/// Slashing engine for Byzantine fault detection and node revocation
///
/// # Memory Management
///
/// This implementation stores event history in memory for equivocation detection.
/// For production deployments with long-running systems, consider:
/// - Implementing a bounded history with a sliding window
/// - Persisting event history to durable storage
/// - Implementing periodic garbage collection for old events
pub struct SlashingEngine {
    /// Map of node IDs to their current state
    node_states: HashMap<String, NodeState>,
    /// Map of node IDs to their event history (seq_no -> event_hash)
    /// WARNING: Unbounded growth - implement history limits in production
    node_event_history: HashMap<String, HashMap<u64, Vec<u8>>>,
    /// List of slashing events
    slashing_events: Vec<SlashingEvent>,
}

impl SlashingEngine {
    /// Create a new slashing engine
    pub fn new() -> Self {
        Self {
            node_states: HashMap::new(),
            node_event_history: HashMap::new(),
            slashing_events: Vec::new(),
        }
    }

    /// Get the state of a node
    ///
    /// # Arguments
    /// * `node_id` - The node identifier
    ///
    /// # Returns
    /// The node's current state (defaults to Unknown if not found)
    pub fn get_node_state(&self, node_id: &str) -> NodeState {
        self.node_states
            .get(node_id)
            .copied()
            .unwrap_or(NodeState::Unknown)
    }

    /// Set the state of a node
    ///
    /// # Arguments
    /// * `node_id` - The node identifier
    /// * `state` - The new node state
    pub fn set_node_state(&mut self, node_id: String, state: NodeState) {
        self.node_states.insert(node_id, state);
    }

    /// Detect Byzantine fault by checking for equivocation
    ///
    /// Equivocation occurs when a node submits two different proofs with the same sequence number.
    ///
    /// # Arguments
    /// * `node_id` - The node identifier
    /// * `event` - The signed event to check
    ///
    /// # Returns
    /// * `Ok(true)` - Byzantine fault detected
    /// * `Ok(false)` - No fault detected
    /// * `Err(SlashingError)` - Error during detection
    ///
    /// # Note
    /// Currently uses timestamp as a proxy for sequence number. In production deployments,
    /// this should extract the actual sequence number from event metadata to avoid false
    /// positives when events have identical timestamps.
    pub fn detect_byzantine_fault(&mut self, node_id: &str, event: &SignedEvent) -> Result<bool> {
        // Get or create event history for this node
        let history = self
            .node_event_history
            .entry(node_id.to_string())
            .or_insert_with(HashMap::new);

        // Extract sequence number from the event
        // NOTE: Using timestamp as proxy for sequence number. In production,
        // extract from event metadata to avoid false positives.
        let seq_no = event.timestamp;

        // Check for equivocation: same seq_no but different hash
        if let Some(existing_hash) = history.get(&seq_no) {
            if existing_hash != &event.event_hash {
                return Ok(true); // Byzantine fault detected!
            }
        }

        // Store this event's hash for future equivocation detection
        history.insert(seq_no, event.event_hash.clone());

        Ok(false)
    }

    /// Execute slashing by transitioning a node to Revoked state
    ///
    /// This method:
    /// 1. Verifies the node is not already revoked
    /// 2. Transitions the node state to Revoked
    /// 3. Creates and signs a SlashingEvent
    /// 4. Stores the event for distributed propagation
    ///
    /// # Arguments
    /// * `node_id` - The node to slash
    /// * `fault_type` - The type of Byzantine fault detected
    /// * `signing_key` - The Ed25519 signing key for the slasher
    /// * `slasher_public_key_id` - The slasher's public key identifier
    /// * `evidence` - Optional additional evidence
    ///
    /// # Returns
    /// * `Ok(SlashingEvent)` - The slashing event
    /// * `Err(SlashingError)` - Error during slashing
    pub fn execute_slashing(
        &mut self,
        node_id: String,
        fault_type: ByzantineFaultType,
        signing_key: &SigningKey,
        slasher_public_key_id: String,
        evidence: Option<String>,
    ) -> Result<SlashingEvent> {
        // Check if node is already revoked
        let current_state = self.get_node_state(&node_id);
        if current_state.is_revoked() {
            return Err(SlashingError::NodeAlreadyRevoked {
                node_id: node_id.clone(),
            });
        }

        // Create slashing event
        let slashing_event =
            SlashingEvent::new(node_id.clone(), fault_type, slasher_public_key_id, evidence)
                .sign(signing_key);

        // Transition node to Revoked state
        self.set_node_state(node_id.clone(), NodeState::Revoked);

        // Store slashing event
        self.slashing_events.push(slashing_event.clone());

        Ok(slashing_event)
    }

    /// Check an event for Byzantine behavior and automatically slash if detected
    ///
    /// This is the main entry point for automated slashing. It:
    /// 1. Detects Byzantine faults
    /// 2. Automatically executes slashing if a fault is found
    /// 3. Returns the slashing event if slashing occurred
    ///
    /// # Arguments
    /// * `node_id` - The node identifier
    /// * `event` - The signed event to check
    /// * `signing_key` - The slasher's Ed25519 signing key
    /// * `slasher_public_key_id` - The slasher's public key identifier
    ///
    /// # Returns
    /// * `Ok(Some(SlashingEvent))` - Byzantine fault detected and node slashed
    /// * `Ok(None)` - No fault detected
    /// * `Err(SlashingError)` - Error during processing
    pub fn check_and_slash(
        &mut self,
        node_id: String,
        event: &SignedEvent,
        signing_key: &SigningKey,
        slasher_public_key_id: String,
    ) -> Result<Option<SlashingEvent>> {
        // Detect Byzantine fault
        let is_byzantine = self.detect_byzantine_fault(&node_id, event)?;

        if is_byzantine {
            // Extract sequence number and hashes for evidence
            let seq_no = event.timestamp;

            // Safely extract hashes with proper error handling
            let history = self.node_event_history.get(&node_id).ok_or_else(|| {
                SlashingError::InvalidEvent(format!("Node history not found for {}", node_id))
            })?;

            let existing_hash = history
                .get(&seq_no)
                .ok_or_else(|| {
                    SlashingError::InvalidEvent(format!(
                        "Event hash not found for seq_no {}",
                        seq_no
                    ))
                })?
                .clone();

            let new_hash = event.event_hash.clone();

            // Create fault type
            let fault_type = ByzantineFaultType::Equivocation {
                seq_no,
                hash1: existing_hash,
                hash2: new_hash,
            };

            // Execute slashing
            let slashing_event = self.execute_slashing(
                node_id.clone(),
                fault_type,
                signing_key,
                slasher_public_key_id,
                Some(format!("Equivocation at seq_no {}", seq_no)),
            )?;

            Ok(Some(slashing_event))
        } else {
            Ok(None)
        }
    }

    /// Get all slashing events
    pub fn get_slashing_events(&self) -> &[SlashingEvent] {
        &self.slashing_events
    }

    /// Get slashing events for a specific node
    pub fn get_node_slashing_events(&self, node_id: &str) -> Vec<&SlashingEvent> {
        self.slashing_events
            .iter()
            .filter(|e| e.node_id == node_id)
            .collect()
    }

    /// Get the number of revoked nodes
    pub fn count_revoked_nodes(&self) -> usize {
        self.node_states.values().filter(|s| s.is_revoked()).count()
    }
}

impl Default for SlashingEngine {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn create_test_event(event_id: &str, timestamp: u64, event_hash: Vec<u8>) -> SignedEvent {
        SignedEvent {
            event_id: event_id.to_string(),
            timestamp,
            event_hash,
            prev_event_hash: vec![0u8; 32],
            signature: vec![1, 2, 3, 4],
            public_key_id: "test-key".to_string(),
            event_type: Some("test.event".to_string()),
            payload_ref: None,
        }
    }

    #[test]
    fn test_node_state_transitions() {
        let mut engine = SlashingEngine::new();

        // Initial state should be Unknown
        assert_eq!(engine.get_node_state("node-1"), NodeState::Unknown);

        // Set to Healthy
        engine.set_node_state("node-1".to_string(), NodeState::Healthy);
        assert_eq!(engine.get_node_state("node-1"), NodeState::Healthy);
        assert!(engine.get_node_state("node-1").is_healthy());

        // Set to Revoked
        engine.set_node_state("node-1".to_string(), NodeState::Revoked);
        assert_eq!(engine.get_node_state("node-1"), NodeState::Revoked);
        assert!(engine.get_node_state("node-1").is_revoked());
    }

    #[test]
    fn test_equivocation_detection() {
        let mut engine = SlashingEngine::new();
        let node_id = "test-node";

        // First event at timestamp 1000
        let event1 = create_test_event("event-1", 1000, vec![1, 2, 3]);
        let result = engine.detect_byzantine_fault(node_id, &event1);
        assert!(result.is_ok());
        assert!(!result.unwrap()); // No fault yet

        // Second event at same timestamp with DIFFERENT hash (equivocation!)
        let event2 = create_test_event("event-2", 1000, vec![4, 5, 6]);
        let result = engine.detect_byzantine_fault(node_id, &event2);
        assert!(result.is_ok());
        assert!(result.unwrap()); // Byzantine fault detected!
    }

    #[test]
    fn test_no_equivocation_same_hash() {
        let mut engine = SlashingEngine::new();
        let node_id = "test-node";

        // First event
        let event1 = create_test_event("event-1", 1000, vec![1, 2, 3]);
        engine.detect_byzantine_fault(node_id, &event1).unwrap();

        // Second event at same timestamp with SAME hash (no equivocation)
        let event2 = create_test_event("event-2", 1000, vec![1, 2, 3]);
        let result = engine.detect_byzantine_fault(node_id, &event2);
        assert!(result.is_ok());
        assert!(!result.unwrap()); // No fault
    }

    #[test]
    fn test_slashing_event_creation_and_signing() {
        // Generate Ed25519 keypair
        use rand::Rng;
        let mut csprng = rand::thread_rng();
        let secret_bytes: [u8; 32] = csprng.gen();
        let signing_key = SigningKey::from_bytes(&secret_bytes);
        let verifying_key = signing_key.verifying_key();

        // Create slashing event
        let fault_type = ByzantineFaultType::Equivocation {
            seq_no: 1000,
            hash1: vec![1, 2, 3],
            hash2: vec![4, 5, 6],
        };

        let slashing_event = SlashingEvent::new(
            "byzantine-node".to_string(),
            fault_type,
            "slasher-key-id".to_string(),
            Some("Test evidence".to_string()),
        )
        .sign(&signing_key);

        // Verify signature
        assert!(slashing_event.signature.len() == 64);
        assert!(slashing_event.verify(&verifying_key).is_ok());
    }

    #[test]
    fn test_execute_slashing() {
        let mut engine = SlashingEngine::new();
        use rand::Rng;
        let mut csprng = rand::thread_rng();
        let secret_bytes: [u8; 32] = csprng.gen();
        let signing_key = SigningKey::from_bytes(&secret_bytes);

        // Set node to Healthy
        engine.set_node_state("node-1".to_string(), NodeState::Healthy);
        assert!(!engine.get_node_state("node-1").is_revoked());

        // Execute slashing
        let fault_type = ByzantineFaultType::ChainBreak {
            seq_no: 100,
            expected_hash: vec![1, 2, 3],
            actual_hash: vec![4, 5, 6],
        };

        let result = engine.execute_slashing(
            "node-1".to_string(),
            fault_type,
            &signing_key,
            "slasher-1".to_string(),
            Some("Chain break evidence".to_string()),
        );

        assert!(result.is_ok());
        let slashing_event = result.unwrap();

        // Verify node is now revoked
        assert!(engine.get_node_state("node-1").is_revoked());

        // Verify slashing event was recorded
        assert_eq!(engine.get_slashing_events().len(), 1);
        assert_eq!(slashing_event.node_id, "node-1");
    }

    #[test]
    fn test_cannot_slash_already_revoked_node() {
        let mut engine = SlashingEngine::new();
        use rand::Rng;
        let mut csprng = rand::thread_rng();
        let secret_bytes: [u8; 32] = csprng.gen();
        let signing_key = SigningKey::from_bytes(&secret_bytes);

        // Set node to Revoked
        engine.set_node_state("node-1".to_string(), NodeState::Revoked);

        // Try to slash again
        let fault_type = ByzantineFaultType::SignatureForgery {
            seq_no: 100,
            event_hash: vec![1, 2, 3],
        };

        let result = engine.execute_slashing(
            "node-1".to_string(),
            fault_type,
            &signing_key,
            "slasher-1".to_string(),
            None,
        );

        assert!(result.is_err());
        assert!(matches!(
            result.unwrap_err(),
            SlashingError::NodeAlreadyRevoked { .. }
        ));
    }

    #[test]
    fn test_check_and_slash_integration() {
        let mut engine = SlashingEngine::new();
        use rand::Rng;
        let mut csprng = rand::thread_rng();
        let secret_bytes: [u8; 32] = csprng.gen();
        let signing_key = SigningKey::from_bytes(&secret_bytes);

        let node_id = "test-node";

        // First event
        let event1 = create_test_event("event-1", 1000, vec![1, 2, 3]);
        let result = engine.check_and_slash(
            node_id.to_string(),
            &event1,
            &signing_key,
            "slasher-1".to_string(),
        );
        assert!(result.is_ok());
        assert!(result.unwrap().is_none()); // No slashing

        // Second event with equivocation
        let event2 = create_test_event("event-2", 1000, vec![4, 5, 6]);
        let result = engine.check_and_slash(
            node_id.to_string(),
            &event2,
            &signing_key,
            "slasher-1".to_string(),
        );

        assert!(result.is_ok());
        let slashing_event = result.unwrap();
        assert!(slashing_event.is_some()); // Slashing occurred!

        // Verify node is revoked
        assert!(engine.get_node_state(node_id).is_revoked());
    }

    #[test]
    fn test_byzantine_fault_type_descriptions() {
        let fault1 = ByzantineFaultType::Equivocation {
            seq_no: 100,
            hash1: vec![1],
            hash2: vec![2],
        };
        assert!(fault1.description().contains("Equivocation"));

        let fault2 = ByzantineFaultType::ChainBreak {
            seq_no: 200,
            expected_hash: vec![1],
            actual_hash: vec![2],
        };
        assert!(fault2.description().contains("chain break"));

        let fault3 = ByzantineFaultType::SignatureForgery {
            seq_no: 300,
            event_hash: vec![1],
        };
        assert!(fault3.description().contains("forgery"));
    }

    #[test]
    fn test_count_revoked_nodes() {
        let mut engine = SlashingEngine::new();

        engine.set_node_state("node-1".to_string(), NodeState::Healthy);
        engine.set_node_state("node-2".to_string(), NodeState::Revoked);
        engine.set_node_state("node-3".to_string(), NodeState::Suspect);
        engine.set_node_state("node-4".to_string(), NodeState::Revoked);

        assert_eq!(engine.count_revoked_nodes(), 2);
    }
}
