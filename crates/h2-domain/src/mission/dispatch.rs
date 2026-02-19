//! Dispatch lifecycle management
//!
//! Provides cryptographically attested dispatch lifecycle tracking
//! with Merkle-chained state transitions.

use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

/// Dispatch lifecycle states
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum DispatchState {
    /// Dispatch created but not yet assigned
    Created,
    /// Dispatch assigned to asset(s)
    Assigned,
    /// Dispatch in progress
    InProgress,
    /// Dispatch completed successfully
    Completed,
    /// Dispatch cancelled
    Cancelled,
}

impl DispatchState {
    /// Check if state is terminal (completed or cancelled)
    pub fn is_terminal(&self) -> bool {
        matches!(self, DispatchState::Completed | DispatchState::Cancelled)
    }

    /// Check if transition to new state is valid
    pub fn can_transition_to(&self, new_state: DispatchState) -> bool {
        match (self, new_state) {
            // From Created
            (DispatchState::Created, DispatchState::Assigned) => true,
            (DispatchState::Created, DispatchState::Cancelled) => true,
            // From Assigned
            (DispatchState::Assigned, DispatchState::InProgress) => true,
            (DispatchState::Assigned, DispatchState::Cancelled) => true,
            // From InProgress
            (DispatchState::InProgress, DispatchState::Completed) => true,
            (DispatchState::InProgress, DispatchState::Cancelled) => true,
            // Terminal states cannot transition
            (DispatchState::Completed, _) => false,
            (DispatchState::Cancelled, _) => false,
            // Invalid transitions
            _ => false,
        }
    }
}

/// Dispatch with attested lifecycle
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Dispatch {
    /// Unique dispatch identifier
    pub dispatch_id: String,

    /// Current state
    pub state: DispatchState,

    /// Dispatch type/category
    pub dispatch_type: String,

    /// Assigned asset IDs
    pub assigned_assets: Vec<String>,

    /// Origin location (optional)
    pub origin: Option<(f64, f64)>,

    /// Destination location (optional)
    pub destination: Option<(f64, f64)>,

    /// Creation timestamp (Unix epoch milliseconds)
    pub created_at: u64,

    /// Last update timestamp
    pub updated_at: u64,

    /// Completion timestamp (if completed)
    pub completed_at: Option<u64>,

    /// State transition history
    pub transitions: Vec<DispatchTransition>,

    /// Additional metadata
    pub metadata: BTreeMap<String, serde_json::Value>,
}

impl Dispatch {
    /// Create a new dispatch
    pub fn new(dispatch_id: String, dispatch_type: String, timestamp: u64) -> Self {
        Self {
            dispatch_id,
            state: DispatchState::Created,
            dispatch_type,
            assigned_assets: Vec::new(),
            origin: None,
            destination: None,
            created_at: timestamp,
            updated_at: timestamp,
            completed_at: None,
            transitions: Vec::new(),
            metadata: BTreeMap::new(),
        }
    }

    /// Transition to a new state
    pub fn transition(
        &mut self,
        new_state: DispatchState,
        timestamp: u64,
        prev_hash: Vec<u8>,
    ) -> Result<(), String> {
        if !self.state.can_transition_to(new_state) {
            return Err(format!(
                "Invalid transition from {:?} to {:?}",
                self.state, new_state
            ));
        }

        let transition = DispatchTransition::new(
            self.dispatch_id.clone(),
            self.state,
            new_state,
            timestamp,
            prev_hash,
        );

        self.state = new_state;
        self.updated_at = timestamp;
        self.transitions.push(transition);

        if new_state.is_terminal() {
            self.completed_at = Some(timestamp);
        }

        Ok(())
    }

    /// Assign assets to this dispatch
    pub fn assign_assets(&mut self, asset_ids: Vec<String>, timestamp: u64) {
        self.assigned_assets = asset_ids;
        self.updated_at = timestamp;
    }

    /// Set origin location
    pub fn set_origin(&mut self, lat: f64, lon: f64) {
        self.origin = Some((lat, lon));
    }

    /// Set destination location
    pub fn set_destination(&mut self, lat: f64, lon: f64) {
        self.destination = Some((lat, lon));
    }

    /// Check if dispatch is complete
    pub fn is_complete(&self) -> bool {
        self.state.is_terminal()
    }

    /// Get the last transition
    pub fn last_transition(&self) -> Option<&DispatchTransition> {
        self.transitions.last()
    }
}

/// Dispatch state transition with Merkle proof
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DispatchTransition {
    /// Dispatch ID this transition belongs to
    pub dispatch_id: String,

    /// Previous state
    pub from_state: DispatchState,

    /// New state
    pub to_state: DispatchState,

    /// Transition timestamp (Unix epoch milliseconds)
    pub timestamp: u64,

    /// BLAKE3 hash of previous transition
    pub prev_hash: Vec<u8>,

    /// BLAKE3 hash of this transition
    pub hash: Vec<u8>,

    /// Ed25519 signature over transition
    pub signature: Vec<u8>,
}

impl DispatchTransition {
    /// Create a new dispatch transition
    pub fn new(
        dispatch_id: String,
        from_state: DispatchState,
        to_state: DispatchState,
        timestamp: u64,
        prev_hash: Vec<u8>,
    ) -> Self {
        let mut transition = Self {
            dispatch_id,
            from_state,
            to_state,
            timestamp,
            prev_hash,
            hash: Vec::new(),
            signature: Vec::new(),
        };

        // Compute hash
        transition.hash = transition.compute_hash();
        transition
    }

    /// Compute BLAKE3 hash of this transition
    pub fn compute_hash(&self) -> Vec<u8> {
        let mut hasher = blake3::Hasher::new();
        hasher.update(self.dispatch_id.as_bytes());
        hasher.update(&[self.from_state as u8]);
        hasher.update(&[self.to_state as u8]);
        hasher.update(&self.timestamp.to_le_bytes());
        hasher.update(&self.prev_hash);
        hasher.finalize().as_bytes().to_vec()
    }

    /// Attest the transition with a signature
    pub fn attest(&mut self, signature: Vec<u8>) {
        self.signature = signature;
    }

    /// Check if transition is attested
    pub fn is_attested(&self) -> bool {
        !self.signature.is_empty()
    }

    /// Verify hash matches computed hash
    pub fn verify_hash(&self) -> bool {
        let computed = self.compute_hash();
        computed == self.hash
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_dispatch_state_terminal() {
        assert!(!DispatchState::Created.is_terminal());
        assert!(!DispatchState::Assigned.is_terminal());
        assert!(!DispatchState::InProgress.is_terminal());
        assert!(DispatchState::Completed.is_terminal());
        assert!(DispatchState::Cancelled.is_terminal());
    }

    #[test]
    fn test_dispatch_state_transitions() {
        // Valid transitions
        assert!(DispatchState::Created.can_transition_to(DispatchState::Assigned));
        assert!(DispatchState::Assigned.can_transition_to(DispatchState::InProgress));
        assert!(DispatchState::InProgress.can_transition_to(DispatchState::Completed));

        // Invalid transitions
        assert!(!DispatchState::Created.can_transition_to(DispatchState::InProgress));
        assert!(!DispatchState::Completed.can_transition_to(DispatchState::InProgress));
        assert!(!DispatchState::Cancelled.can_transition_to(DispatchState::Completed));
    }

    #[test]
    fn test_dispatch_creation() {
        let dispatch = Dispatch::new("dispatch-001".to_string(), "delivery".to_string(), 1000);

        assert_eq!(dispatch.dispatch_id, "dispatch-001");
        assert_eq!(dispatch.state, DispatchState::Created);
        assert_eq!(dispatch.created_at, 1000);
        assert!(dispatch.transitions.is_empty());
    }

    #[test]
    fn test_dispatch_valid_transition() {
        let mut dispatch = Dispatch::new("dispatch-001".to_string(), "delivery".to_string(), 1000);

        let result = dispatch.transition(DispatchState::Assigned, 2000, vec![0u8; 32]);

        assert!(result.is_ok());
        assert_eq!(dispatch.state, DispatchState::Assigned);
        assert_eq!(dispatch.updated_at, 2000);
        assert_eq!(dispatch.transitions.len(), 1);
    }

    #[test]
    fn test_dispatch_invalid_transition() {
        let mut dispatch = Dispatch::new("dispatch-001".to_string(), "delivery".to_string(), 1000);

        let result = dispatch.transition(DispatchState::InProgress, 2000, vec![0u8; 32]);

        assert!(result.is_err());
        assert_eq!(dispatch.state, DispatchState::Created);
    }

    #[test]
    fn test_dispatch_terminal_state() {
        let mut dispatch = Dispatch::new("dispatch-001".to_string(), "delivery".to_string(), 1000);

        dispatch
            .transition(DispatchState::Assigned, 2000, vec![0u8; 32])
            .unwrap();
        dispatch
            .transition(DispatchState::InProgress, 3000, vec![1u8; 32])
            .unwrap();
        dispatch
            .transition(DispatchState::Completed, 4000, vec![2u8; 32])
            .unwrap();

        assert!(dispatch.is_complete());
        assert_eq!(dispatch.completed_at, Some(4000));

        // Cannot transition from terminal state
        let result = dispatch.transition(DispatchState::InProgress, 5000, vec![3u8; 32]);
        assert!(result.is_err());
    }

    #[test]
    fn test_dispatch_assign_assets() {
        let mut dispatch = Dispatch::new("dispatch-001".to_string(), "delivery".to_string(), 1000);

        dispatch.assign_assets(
            vec!["truck-001".to_string(), "trailer-001".to_string()],
            2000,
        );

        assert_eq!(dispatch.assigned_assets.len(), 2);
        assert_eq!(dispatch.updated_at, 2000);
    }

    #[test]
    fn test_dispatch_locations() {
        let mut dispatch = Dispatch::new("dispatch-001".to_string(), "delivery".to_string(), 1000);

        dispatch.set_origin(45.0, -122.0);
        dispatch.set_destination(46.0, -123.0);

        assert_eq!(dispatch.origin, Some((45.0, -122.0)));
        assert_eq!(dispatch.destination, Some((46.0, -123.0)));
    }

    #[test]
    fn test_dispatch_transition_creation() {
        let transition = DispatchTransition::new(
            "dispatch-001".to_string(),
            DispatchState::Created,
            DispatchState::Assigned,
            1000,
            vec![0u8; 32],
        );

        assert_eq!(transition.from_state, DispatchState::Created);
        assert_eq!(transition.to_state, DispatchState::Assigned);
        assert_eq!(transition.hash.len(), 32);
        assert!(!transition.is_attested());
    }

    #[test]
    fn test_dispatch_transition_attest() {
        let mut transition = DispatchTransition::new(
            "dispatch-001".to_string(),
            DispatchState::Created,
            DispatchState::Assigned,
            1000,
            vec![0u8; 32],
        );

        transition.attest(vec![1u8; 64]);
        assert!(transition.is_attested());
    }

    #[test]
    fn test_dispatch_transition_verify_hash() {
        let transition = DispatchTransition::new(
            "dispatch-001".to_string(),
            DispatchState::Created,
            DispatchState::Assigned,
            1000,
            vec![0u8; 32],
        );

        assert!(transition.verify_hash());
    }

    #[test]
    fn test_dispatch_last_transition() {
        let mut dispatch = Dispatch::new("dispatch-001".to_string(), "delivery".to_string(), 1000);

        dispatch
            .transition(DispatchState::Assigned, 2000, vec![0u8; 32])
            .unwrap();
        dispatch
            .transition(DispatchState::InProgress, 3000, vec![1u8; 32])
            .unwrap();

        let last = dispatch.last_transition().unwrap();
        assert_eq!(last.to_state, DispatchState::InProgress);
    }
}
