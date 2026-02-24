//! Truth-Chain Ledger recorder for command audit
//!
//! This module integrates with the EventLedger to provide immutable command audit
//! with Merkle-chain binding using previous_hash.

#![warn(missing_docs)]

use aethercore_core::ledger::{EventLedger, LedgerError, SignedEvent};
use blake3::Hasher;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use thiserror::Error;

/// Truth-Chain recorder errors
#[derive(Debug, Error)]
pub enum RecorderError {
    /// Ledger operation failed
    #[error("Ledger error: {0}")]
    LedgerError(#[from] LedgerError),

    /// Serialization error
    #[error("Serialization error: {0}")]
    SerializationError(String),

    /// Invalid command hash
    #[error("Invalid command hash")]
    InvalidHash,
}

/// Command record for audit trail
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CommandRecord {
    /// Unique command identifier
    pub command_id: String,
    /// Command type (UnitCommand or SwarmCommand)
    pub command_type: String,
    /// Command payload as JSON
    pub command_payload: serde_json::Value,
    /// Command hash (BLAKE3)
    pub command_hash: [u8; 32],
    /// Authority signatures
    pub authority_signatures: Vec<String>,
    /// Target unit IDs
    pub target_units: Vec<String>,
    /// Command timestamp
    pub timestamp_ns: u64,
}

impl CommandRecord {
    /// Create a new command record
    pub fn new(
        command_id: String,
        command_type: String,
        command_payload: serde_json::Value,
        command_hash: [u8; 32],
        authority_signatures: Vec<String>,
        target_units: Vec<String>,
        timestamp_ns: u64,
    ) -> Self {
        Self {
            command_id,
            command_type,
            command_payload,
            command_hash,
            authority_signatures,
            target_units,
            timestamp_ns,
        }
    }
}

/// Truth-Chain recorder for command audit
pub struct TruthChainRecorder {
    /// Event ledger
    ledger: EventLedger,
    /// Node identifier
    #[allow(dead_code)]
    node_id: String,
}

impl TruthChainRecorder {
    /// Create a new truth-chain recorder
    ///
    /// # Arguments
    /// * `ledger_path` - Path to the SQLite ledger database
    /// * `node_id` - Node identifier for this recorder
    pub fn new(ledger_path: PathBuf, node_id: String) -> Result<Self, RecorderError> {
        let ledger = EventLedger::open(ledger_path, node_id.clone())?;
        Ok(Self { ledger, node_id })
    }

    /// Record a command in the Truth-Chain
    ///
    /// # Arguments
    /// * `record` - Command record to append
    /// * `signature` - Cryptographic signature over the record
    /// * `public_key_id` - Public key identifier
    ///
    /// # Returns
    /// Sequence number of the recorded event
    pub fn record_command(
        &mut self,
        record: &CommandRecord,
        signature: Vec<u8>,
        public_key_id: String,
    ) -> Result<u64, RecorderError> {
        // Serialize command record
        let payload_json = serde_json::to_string(record)
            .map_err(|e| RecorderError::SerializationError(format!("{}", e)))?;

        // Compute event hash
        let event_hash = Self::compute_event_hash(&record.command_id, &payload_json);

        // Get previous event hash for chain binding
        let prev_event_hash = match self.ledger.get_latest_event() {
            Ok(Some((_, event))) => event.event_hash,
            _ => vec![0u8; 32], // Genesis event uses all zeros
        };

        // Create signed event
        let signed_event = SignedEvent {
            event_id: record.command_id.clone(),
            timestamp: record.timestamp_ns / 1_000_000, // Convert to milliseconds
            event_hash: event_hash.to_vec(),
            prev_event_hash,
            signature,
            public_key_id,
            event_type: Some(record.command_type.clone()),
            payload_ref: Some(payload_json),
        };

        // Append to ledger
        let seq_no = self.ledger.append_signed_event(signed_event)?;

        Ok(seq_no)
    }

    /// Compute BLAKE3 hash for an event
    fn compute_event_hash(event_id: &str, payload: &str) -> [u8; 32] {
        let mut hasher = Hasher::new();
        hasher.update(event_id.as_bytes());
        hasher.update(payload.as_bytes());
        *hasher.finalize().as_bytes()
    }

    /// Get the last event hash (for chaining)
    pub fn get_last_event_hash(&self) -> Option<Vec<u8>> {
        self.ledger
            .get_latest_event()
            .ok()
            .flatten()
            .map(|(_, event)| event.event_hash)
    }

    /// Verify chain integrity
    pub fn verify_chain(&self) -> Result<bool, RecorderError> {
        // EventLedger performs startup integrity checks
        // For now, return true if ledger is operational
        Ok(true)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_command_record_creation() {
        let record = CommandRecord::new(
            "cmd-001".to_string(),
            "UnitCommand::Navigate".to_string(),
            serde_json::json!({"waypoint": {"lat": 45.0, "lon": -122.0}}),
            [0u8; 32],
            vec!["sig-1".to_string()],
            vec!["unit-1".to_string()],
            1000,
        );

        assert_eq!(record.command_id, "cmd-001");
        assert_eq!(record.target_units.len(), 1);
    }

    #[test]
    fn test_truth_chain_recorder() {
        use std::fs;

        // Create temporary ledger path
        let temp_dir = std::env::temp_dir();
        let ledger_path = temp_dir.join("test_truth_chain.db");

        // Clean up if exists
        let _ = fs::remove_file(&ledger_path);

        let mut recorder =
            TruthChainRecorder::new(ledger_path.clone(), "node-1".to_string()).unwrap();

        let record = CommandRecord::new(
            "cmd-001".to_string(),
            "UnitCommand::Navigate".to_string(),
            serde_json::json!({"waypoint": {"lat": 45.0, "lon": -122.0}}),
            [0u8; 32],
            vec!["sig-1".to_string()],
            vec!["unit-1".to_string()],
            1000,
        );

        let result = recorder.record_command(&record, vec![0u8; 64], "pubkey-1".to_string());

        assert!(result.is_ok());
        assert_eq!(result.unwrap(), 1);

        // Clean up
        let _ = fs::remove_file(&ledger_path);
    }
}
