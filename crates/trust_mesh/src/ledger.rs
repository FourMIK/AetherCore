//! Distributed Ledger Module
//!
//! Manages the replicated ledger of signed checkpoints across the mesh.

use crate::merkle::LedgerCheckpoint;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use thiserror::Error;

#[derive(Debug, Error)]
pub enum LedgerError {
    #[error("Checkpoint not found: {0}")]
    CheckpointNotFound(String),

    #[error("Invalid checkpoint: {0}")]
    InvalidCheckpoint(String),
}

pub type Result<T> = std::result::Result<T, LedgerError>;

/// State of the distributed ledger
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LedgerState {
    /// Checkpoints indexed by (node_id, seq_no)
    pub checkpoints: HashMap<(String, u64), LedgerCheckpoint>,

    /// Latest sequence number per node
    pub latest_seq: HashMap<String, u64>,
}

impl LedgerState {
    pub fn new() -> Self {
        Self {
            checkpoints: HashMap::new(),
            latest_seq: HashMap::new(),
        }
    }

    /// Add a checkpoint to the ledger
    pub fn add_checkpoint(&mut self, checkpoint: LedgerCheckpoint) {
        let node_id = checkpoint.node_id.clone();
        let seq_no = checkpoint.seq_no;

        self.checkpoints
            .insert((node_id.clone(), seq_no), checkpoint);

        // Update latest sequence
        let current_latest = self.latest_seq.get(&node_id).copied().unwrap_or(0);
        if seq_no > current_latest {
            self.latest_seq.insert(node_id, seq_no);
        }
    }

    /// Get the latest checkpoint for a node
    pub fn get_latest(&self, node_id: &str) -> Option<&LedgerCheckpoint> {
        let seq_no = self.latest_seq.get(node_id)?;
        self.checkpoints.get(&(node_id.to_string(), *seq_no))
    }
}

impl Default for LedgerState {
    fn default() -> Self {
        Self::new()
    }
}

/// Distributed ledger manager
pub struct DistributedLedger {
    /// Local node ID
    #[allow(dead_code)]
    node_id: String,

    /// Current ledger state
    state: LedgerState,
}

impl DistributedLedger {
    pub fn new(node_id: String) -> Self {
        Self {
            node_id,
            state: LedgerState::new(),
        }
    }

    pub fn state(&self) -> &LedgerState {
        &self.state
    }

    pub fn add_checkpoint(&mut self, checkpoint: LedgerCheckpoint) {
        self.state.add_checkpoint(checkpoint);
    }
}
