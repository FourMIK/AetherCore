//! Distributed Ledger Module
//!
//! Manages the replicated ledger of signed checkpoints across the mesh.
//! Includes Operation Legal Shield compliance proof recording.

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

/// License compliance verification event for The Great Gospel ledger
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ComplianceProof {
    /// Timestamp of compliance verification (UNIX epoch milliseconds)
    pub timestamp: u64,

    /// Node or build identifier performing the verification
    pub verifier_id: String,

    /// Compliance status: "COMPLIANT", "NON_COMPLIANT", "UNVERIFIED"
    pub status: String,

    /// Total dependencies audited
    pub total_dependencies: u64,

    /// Dependencies with approved licenses
    pub approved_licenses: u64,

    /// Dependencies requiring manual review
    pub flagged_dependencies: Vec<String>,

    /// BLAKE3 hash of LICENSE_MANIFEST.txt
    pub manifest_hash: String,

    /// Optional notes or violation details
    pub notes: Option<String>,
}

impl ComplianceProof {
    /// Create a new compliant proof
    pub fn compliant(
        verifier_id: String,
        total_deps: u64,
        approved: u64,
        manifest_hash: String,
    ) -> Self {
        Self {
            timestamp: std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_millis() as u64,
            verifier_id,
            status: "COMPLIANT".to_string(),
            total_dependencies: total_deps,
            approved_licenses: approved,
            flagged_dependencies: Vec::new(),
            manifest_hash,
            notes: None,
        }
    }

    /// Create a non-compliant proof with violations
    pub fn non_compliant(
        verifier_id: String,
        total_deps: u64,
        approved: u64,
        violations: Vec<String>,
        manifest_hash: String,
        notes: Option<String>,
    ) -> Self {
        Self {
            timestamp: std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_millis() as u64,
            verifier_id,
            status: "NON_COMPLIANT".to_string(),
            total_dependencies: total_deps,
            approved_licenses: approved,
            flagged_dependencies: violations,
            manifest_hash,
            notes,
        }
    }
}

/// State of the distributed ledger
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LedgerState {
    /// Checkpoints indexed by (node_id, seq_no)
    pub checkpoints: HashMap<(String, u64), LedgerCheckpoint>,

    /// Latest sequence number per node
    pub latest_seq: HashMap<String, u64>,

    /// Operation Legal Shield: Compliance proof history
    pub compliance_proofs: Vec<ComplianceProof>,
}

impl LedgerState {
    pub fn new() -> Self {
        Self {
            checkpoints: HashMap::new(),
            latest_seq: HashMap::new(),
            compliance_proofs: Vec::new(),
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

    /// Record a compliance proof in The Great Gospel
    pub fn record_compliance_proof(&mut self, proof: ComplianceProof) {
        self.compliance_proofs.push(proof);
    }

    /// Get all compliance proofs
    pub fn get_compliance_proofs(&self) -> &[ComplianceProof] {
        &self.compliance_proofs
    }

    /// Get the latest compliance proof for a given verifier
    pub fn get_latest_compliance_proof(&self, verifier_id: &str) -> Option<&ComplianceProof> {
        self.compliance_proofs
            .iter()
            .filter(|p| p.verifier_id == verifier_id)
            .max_by_key(|p| p.timestamp)
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

    /// Record a license compliance verification event
    pub fn record_compliance_proof(&mut self, proof: ComplianceProof) {
        self.state.record_compliance_proof(proof);
    }

    /// Query compliance proofs
    pub fn get_compliance_proofs(&self) -> &[ComplianceProof] {
        self.state.get_compliance_proofs()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_compliance_proof_creation() {
        let proof = ComplianceProof::compliant(
            "build-001".to_string(),
            100,
            100,
            "blake3:abc123".to_string(),
        );

        assert_eq!(proof.status, "COMPLIANT");
        assert_eq!(proof.total_dependencies, 100);
        assert_eq!(proof.approved_licenses, 100);
        assert!(proof.flagged_dependencies.is_empty());
    }

    #[test]
    fn test_non_compliant_proof() {
        let violations = vec!["gpl-crate".to_string(), "agpl-package".to_string()];
        let proof = ComplianceProof::non_compliant(
            "build-002".to_string(),
            100,
            98,
            violations.clone(),
            "blake3:def456".to_string(),
            Some("GPL violations detected".to_string()),
        );

        assert_eq!(proof.status, "NON_COMPLIANT");
        assert_eq!(proof.flagged_dependencies.len(), 2);
        assert!(proof.notes.is_some());
    }

    #[test]
    fn test_ledger_compliance_recording() {
        let mut ledger = DistributedLedger::new("test-node".to_string());

        let proof1 =
            ComplianceProof::compliant("build-001".to_string(), 50, 50, "blake3:hash1".to_string());

        ledger.record_compliance_proof(proof1);

        let proofs = ledger.get_compliance_proofs();
        assert_eq!(proofs.len(), 1);
        assert_eq!(proofs[0].verifier_id, "build-001");
    }
}
