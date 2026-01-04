//! Stream Audit Module
//!
//! Provides periodic self-audit functionality and cross-node chain proof exchange
//! for maintaining integrity across the trust mesh.

use aethercore_crypto::ChainProof;
use aethercore_stream::{IntegrityStatus, StreamIntegrityTracker, StreamProcessor};
use crate::gossip::GossipMessage;
use crate::trust::{TrustScorer, TrustScore};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::time::{Duration, Instant};
use tracing::{debug, warn, error};

/// Trust score delta for successful chain proof verification
pub const TRUST_DELTA_SUCCESS: f64 = 0.05;

/// Trust score threshold for quarantine
pub const QUARANTINE_THRESHOLD: f64 = 0.3;

/// Audit configuration
#[derive(Debug, Clone)]
pub struct AuditConfig {
    /// Interval between self-audits (default: 5 seconds)
    pub audit_interval: Duration,
    /// Whether to enable automatic quarantine
    pub auto_quarantine: bool,
}

impl Default for AuditConfig {
    fn default() -> Self {
        Self {
            audit_interval: Duration::from_secs(5),
            auto_quarantine: true,
        }
    }
}

/// Result of a chain proof verification
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum ProofVerificationResult {
    /// Proof matches local state
    Verified {
        node_id: String,
        chain_length: usize,
    },
    /// Proof does not match local state
    Mismatch {
        node_id: String,
        expected_hash: Vec<u8>,
        actual_hash: Vec<u8>,
    },
    /// Proof not available
    NotAvailable {
        node_id: String,
        reason: String,
    },
}

/// Audit result for a stream
#[derive(Debug, Clone)]
pub struct StreamAuditResult {
    /// Stream identifier
    pub stream_id: String,
    /// Whether audit passed
    pub passed: bool,
    /// Integrity status
    pub integrity_status: IntegrityStatus,
    /// Timestamp of audit
    pub timestamp: Instant,
}

/// Stream auditor for periodic integrity checks
pub struct StreamAuditor {
    /// Configuration
    config: AuditConfig,
    /// Last audit time per stream
    last_audit: HashMap<String, Instant>,
    /// Trust scorer for updating trust based on audits
    trust_scorer: TrustScorer,
    /// Audit results history
    audit_history: Vec<StreamAuditResult>,
}

impl StreamAuditor {
    /// Create a new stream auditor
    pub fn new(config: AuditConfig) -> Self {
        Self {
            config,
            last_audit: HashMap::new(),
            trust_scorer: TrustScorer::new(),
            audit_history: Vec::new(),
        }
    }
    
    /// Create with default configuration
    pub fn default() -> Self {
        Self::new(AuditConfig::default())
    }
    
    /// Perform self-audit on a stream processor
    ///
    /// Checks if sufficient time has passed since last audit, then verifies
    /// the integrity status of all tracked streams.
    pub fn perform_self_audit<P: StreamProcessor>(
        &mut self,
        _processor: &P,
        integrity_tracker: &StreamIntegrityTracker,
    ) -> Vec<StreamAuditResult> {
        let now = Instant::now();
        let mut results = Vec::new();
        
        for stream_id in integrity_tracker.stream_ids() {
            // Check if audit is due for this stream
            let should_audit = self
                .last_audit
                .get(&stream_id)
                .map(|last| now.duration_since(*last) >= self.config.audit_interval)
                .unwrap_or(true);
            
            if !should_audit {
                continue;
            }
            
            // Get integrity status
            let integrity_status = match integrity_tracker.get(&stream_id) {
                Some(status) => status.clone(),
                None => {
                    warn!(stream_id = %stream_id, "Stream not found in integrity tracker");
                    continue;
                }
            };
            
            // Determine if audit passed
            let passed = !integrity_status.is_compromised;
            
            let result = StreamAuditResult {
                stream_id: stream_id.clone(),
                passed,
                integrity_status,
                timestamp: now,
            };
            
            // Update trust score based on audit result
            if passed {
                self.trust_scorer.update_score(&stream_id, TRUST_DELTA_SUCCESS);
                debug!(stream_id = %stream_id, "Stream audit passed, trust increased");
            } else {
                let current_score = self.trust_scorer.get_score(&stream_id);
                if self.config.auto_quarantine && current_score.map(|s| s.score < QUARANTINE_THRESHOLD).unwrap_or(false) {
                    warn!(stream_id = %stream_id, "Stream audit failed, node quarantined");
                    // Set score to 0 to quarantine
                    self.trust_scorer.update_score(&stream_id, -1.0);
                } else {
                    error!(stream_id = %stream_id, "Stream audit failed");
                    // Reduce trust score
                    self.trust_scorer.update_score(&stream_id, -0.1);
                }
            }
            
            // Record audit
            self.last_audit.insert(stream_id.clone(), now);
            results.push(result.clone());
            self.audit_history.push(result);
        }
        
        results
    }
    
    /// Verify a chain proof from another node
    pub fn verify_chain_proof<P: StreamProcessor>(
        &mut self,
        processor: &P,
        proof: &ChainProof,
    ) -> ProofVerificationResult {
        // Get local chain head for this stream
        let local_head = match processor.get_chain_head(&proof.chain_id) {
            Some(head) => head,
            None => {
                return ProofVerificationResult::NotAvailable {
                    node_id: proof.chain_id.clone(),
                    reason: "Stream not found locally".to_string(),
                };
            }
        };
        
        // Compare hashes
        if local_head == proof.head_hash {
            // Proof matches - increase trust
            self.trust_scorer.update_score(&proof.chain_id, TRUST_DELTA_SUCCESS);
            
            debug!(
                node_id = %proof.chain_id,
                "Chain proof verified successfully"
            );
            
            ProofVerificationResult::Verified {
                node_id: proof.chain_id.clone(),
                chain_length: proof.chain_length,
            }
        } else {
            // Proof mismatch - potential Byzantine behavior
            warn!(
                node_id = %proof.chain_id,
                expected = ?local_head,
                actual = ?proof.head_hash,
                "Chain proof mismatch detected"
            );
            
            // Quarantine if enabled (set score to 0)
            if self.config.auto_quarantine {
                self.trust_scorer.update_score(&proof.chain_id, -1.0);
            } else {
                // Just reduce trust
                self.trust_scorer.update_score(&proof.chain_id, -0.2);
            }
            
            ProofVerificationResult::Mismatch {
                node_id: proof.chain_id.clone(),
                expected_hash: local_head.to_vec(),
                actual_hash: proof.head_hash.to_vec(),
            }
        }
    }
    
    /// Generate gossip messages for chain proofs
    pub fn generate_proof_gossip<P: StreamProcessor>(
        &self,
        processor: &P,
        stream_ids: &[String],
    ) -> Vec<GossipMessage> {
        stream_ids
            .iter()
            .filter_map(|stream_id| {
                processor.get_chain_head(stream_id).map(|head_hash| {
                    let proof = ChainProof::new(stream_id.clone(), head_hash, 0);
                    
                    GossipMessage::ChainProofAnnouncement {
                        node_id: stream_id.clone(),
                        proof,
                    }
                })
            })
            .collect()
    }
    
    /// Get trust score for a node
    pub fn get_trust_score(&self, node_id: &str) -> Option<TrustScore> {
        self.trust_scorer.get_score(node_id)
    }
    
    /// Get audit history
    pub fn audit_history(&self) -> &[StreamAuditResult] {
        &self.audit_history
    }
    
    /// Get number of audits performed
    pub fn audit_count(&self) -> usize {
        self.audit_history.len()
    }
    
    /// Get number of failed audits
    pub fn failed_audit_count(&self) -> usize {
        self.audit_history.iter().filter(|r| !r.passed).count()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use aethercore_stream::{MerkleEnforcer, processor::StreamEvent};
    use aethercore_crypto::signing::CanonicalEvent;
    use aethercore_crypto::chain::GENESIS_HASH;
    use std::collections::HashMap;

    fn create_test_event(stream_id: &str, sequence: u64) -> CanonicalEvent {
        CanonicalEvent {
            event_type: "test.event".to_string(),
            timestamp: 1700000000000 + sequence * 1000,
            source_id: stream_id.to_string(),
            sequence,
            payload: HashMap::new(),
        }
    }

    #[test]
    fn test_stream_auditor_creation() {
        let auditor = StreamAuditor::default();
        assert_eq!(auditor.audit_count(), 0);
    }

    #[test]
    fn test_perform_self_audit() {
        let mut auditor = StreamAuditor::default();
        let mut processor = MerkleEnforcer::new();
        let mut tracker = StreamIntegrityTracker::new();
        
        // Add a valid stream
        let event = create_test_event("stream-1", 0);
        let stream_event = StreamEvent::new(
            event,
            "stream-1".to_string(),
            GENESIS_HASH,
        );
        processor.process_event(stream_event).unwrap();
        
        // Update tracker
        let status = tracker.get_or_create("stream-1");
        status.record_valid_event();
        
        // Perform audit
        let results = auditor.perform_self_audit(&processor, &tracker);
        
        assert_eq!(results.len(), 1);
        assert!(results[0].passed);
        assert_eq!(auditor.audit_count(), 1);
    }

    #[test]
    fn test_verify_chain_proof() {
        let mut auditor = StreamAuditor::default();
        let mut processor = MerkleEnforcer::new();
        
        // Add event to processor
        let event = create_test_event("stream-1", 0);
        let stream_event = StreamEvent::new(
            event,
            "stream-1".to_string(),
            GENESIS_HASH,
        );
        let hash = processor.process_event(stream_event).unwrap();
        
        // Create matching proof
        let proof = ChainProof::new("stream-1".to_string(), hash, 1);
        
        // Verify proof
        let result = auditor.verify_chain_proof(&processor, &proof);
        
        assert!(matches!(result, ProofVerificationResult::Verified { .. }));
    }

    #[test]
    fn test_verify_chain_proof_mismatch() {
        let mut auditor = StreamAuditor::default();
        let mut processor = MerkleEnforcer::new();
        
        // Add event to processor
        let event = create_test_event("stream-1", 0);
        let stream_event = StreamEvent::new(
            event,
            "stream-1".to_string(),
            GENESIS_HASH,
        );
        processor.process_event(stream_event).unwrap();
        
        // Create mismatched proof
        let wrong_hash = [99u8; 32];
        let proof = ChainProof::new("stream-1".to_string(), wrong_hash, 1);
        
        // Verify proof
        let result = auditor.verify_chain_proof(&processor, &proof);
        
        assert!(matches!(result, ProofVerificationResult::Mismatch { .. }));
    }

    #[test]
    fn test_generate_proof_gossip() {
        let auditor = StreamAuditor::default();
        let mut processor = MerkleEnforcer::new();
        
        // Add events to processor
        for i in 0..3 {
            let event = create_test_event(&format!("stream-{}", i), 0);
            let stream_event = StreamEvent::new(
                event,
                format!("stream-{}", i),
                GENESIS_HASH,
            );
            processor.process_event(stream_event).unwrap();
        }
        
        // Generate gossip
        let stream_ids = vec![
            "stream-0".to_string(),
            "stream-1".to_string(),
            "stream-2".to_string(),
        ];
        let messages = auditor.generate_proof_gossip(&processor, &stream_ids);
        
        assert_eq!(messages.len(), 3);
        for msg in messages {
            assert!(matches!(msg, GossipMessage::ChainProofAnnouncement { .. }));
        }
    }

    #[test]
    fn test_trust_score_adjustment() {
        let mut auditor = StreamAuditor::default();
        let mut processor = MerkleEnforcer::new();
        
        // Add event
        let event = create_test_event("stream-1", 0);
        let stream_event = StreamEvent::new(
            event,
            "stream-1".to_string(),
            GENESIS_HASH,
        );
        let hash = processor.process_event(stream_event).unwrap();
        
        // Verify proof multiple times
        for _ in 0..5 {
            let proof = ChainProof::new("stream-1".to_string(), hash, 1);
            auditor.verify_chain_proof(&processor, &proof);
        }
        
        // Check trust score increased
        let score = auditor.get_trust_score("stream-1");
        assert!(score.is_some());
    }
}
