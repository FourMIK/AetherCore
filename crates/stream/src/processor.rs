//! Stream Processor with Merkle-Vine Enforcement
//!
//! Processes incoming event streams and enforces BLAKE3 Merkle chain continuity.
//! Every event must contain a previous_hash that validates against the local chain state.

use crate::integrity::{IntegrityStatus, StreamIntegrityTracker};
use aethercore_crypto::chain::{Blake3Hash, ChainManager, ChainError, GENESIS_HASH};
use aethercore_crypto::signing::CanonicalEvent;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::time::{Instant, SystemTime, UNIX_EPOCH};
use thiserror::Error;
use tracing::{debug, error, warn};

/// Errors that can occur during stream processing
#[derive(Debug, Error)]
pub enum ProcessError {
    /// Chain validation failed
    #[error("Chain validation failed: {0}")]
    ChainError(#[from] ChainError),
    
    /// Hash mismatch detected
    #[error("Hash mismatch for stream {stream_id}: expected {expected:?}, got {actual:?}")]
    HashMismatch {
        /// Stream identifier
        stream_id: String,
        /// Expected hash
        expected: Blake3Hash,
        /// Actual hash
        actual: Blake3Hash,
    },
    
    /// Missing previous hash in event
    #[error("Missing previous_hash in event for stream {0}")]
    MissingPreviousHash(String),
    
    /// Stream not initialized
    #[error("Stream {0} not initialized")]
    StreamNotInitialized(String),
    
    /// Latency budget exceeded
    #[error("Processing latency {actual_us}μs exceeds budget {budget_us}μs")]
    LatencyBudgetExceeded {
        /// Actual latency in microseconds
        actual_us: u64,
        /// Budget in microseconds
        budget_us: u64,
    },
}

/// Event with chain metadata for streaming
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StreamEvent {
    /// The canonical event
    pub event: CanonicalEvent,
    /// Stream identifier
    pub stream_id: String,
    /// Previous event hash (GENESIS_HASH for first event)
    pub previous_hash: Blake3Hash,
    /// Merkle root of the stream at this point
    pub merkle_root: Option<Blake3Hash>,
}

impl StreamEvent {
    /// Create a new stream event
    pub fn new(
        event: CanonicalEvent,
        stream_id: String,
        previous_hash: Blake3Hash,
    ) -> Self {
        Self {
            event,
            stream_id,
            previous_hash,
            merkle_root: None,
        }
    }
}

/// Stream processor trait for enforcing Merkle-Vine integrity
pub trait StreamProcessor: Send + Sync {
    /// Process an incoming event, validating chain continuity
    fn process_event(&mut self, event: StreamEvent) -> Result<Blake3Hash, ProcessError>;
    
    /// Get the current chain head for a stream
    fn get_chain_head(&self, stream_id: &str) -> Option<Blake3Hash>;
    
    /// Check if a stream is compromised
    fn is_stream_compromised(&self, stream_id: &str) -> bool;
    
    /// Get integrity status for a stream
    fn get_integrity_status(&self, stream_id: &str) -> Option<&IntegrityStatus>;
}

/// Merkle-Vine enforcer for stream integrity
pub struct MerkleEnforcer {
    /// Per-stream chain managers
    vine_map: HashMap<String, ChainManager>,
    /// Integrity status tracker
    integrity_tracker: StreamIntegrityTracker,
    /// Performance metrics
    metrics: EnforcerMetrics,
    /// Latency budget in microseconds (default: 200μs)
    latency_budget_us: u64,
}

/// Metrics for the enforcer
#[derive(Debug, Clone, Default)]
pub struct EnforcerMetrics {
    /// Total events processed
    pub total_events: u64,
    /// Total integrity violations detected
    pub integrity_violations: u64,
    /// Total processing time in microseconds
    pub total_processing_time_us: u64,
    /// Maximum processing latency observed (μs)
    pub max_latency_us: u64,
    /// Minimum processing latency observed (μs)
    pub min_latency_us: u64,
    /// Average processing latency (μs)
    pub avg_latency_us: u64,
}

impl EnforcerMetrics {
    /// Update metrics with a new processing time
    pub fn record_processing(&mut self, latency_us: u64) {
        self.total_events += 1;
        self.total_processing_time_us += latency_us;
        
        if self.max_latency_us == 0 || latency_us > self.max_latency_us {
            self.max_latency_us = latency_us;
        }
        
        if self.min_latency_us == 0 || latency_us < self.min_latency_us {
            self.min_latency_us = latency_us;
        }
        
        self.avg_latency_us = self.total_processing_time_us / self.total_events;
    }
    
    /// Record an integrity violation
    pub fn record_violation(&mut self) {
        self.integrity_violations += 1;
    }
}

impl MerkleEnforcer {
    /// Create a new Merkle enforcer with default latency budget (200μs)
    pub fn new() -> Self {
        Self::with_latency_budget(200)
    }
    
    /// Create a new Merkle enforcer with custom latency budget
    pub fn with_latency_budget(latency_budget_us: u64) -> Self {
        Self {
            vine_map: HashMap::new(),
            integrity_tracker: StreamIntegrityTracker::new(),
            metrics: EnforcerMetrics::default(),
            latency_budget_us,
        }
    }
    
    /// Get or create a chain manager for a stream
    fn get_or_create_chain(&mut self, stream_id: &str) -> &mut ChainManager {
        self.vine_map
            .entry(stream_id.to_string())
            .or_insert_with(ChainManager::new)
    }
    
    /// Get metrics
    pub fn metrics(&self) -> &EnforcerMetrics {
        &self.metrics
    }
    
    /// Get the number of active streams
    pub fn stream_count(&self) -> usize {
        self.vine_map.len()
    }
    
    /// Verify and record an event in the chain
    fn verify_and_record(
        &mut self,
        stream_id: &str,
        event: StreamEvent,
    ) -> Result<Blake3Hash, ProcessError> {
        let start = Instant::now();
        
        // Get or create chain for this stream
        let chain = self.get_or_create_chain(stream_id);
        let expected_prev_hash = chain.get_chain_head();
        
        // Verify previous hash matches
        if event.previous_hash != expected_prev_hash {
            let reason = format!(
                "Chain discontinuity: expected prev_hash {:?}, got {:?}",
                expected_prev_hash, event.previous_hash
            );
            
            error!(
                stream_id = stream_id,
                expected = ?expected_prev_hash,
                actual = ?event.previous_hash,
                "Chain discontinuity detected"
            );
            
            // Record integrity violation
            self.integrity_tracker
                .get_or_create(stream_id)
                .record_broken_event(reason.clone());
            self.metrics.record_violation();
            
            return Err(ProcessError::HashMismatch {
                stream_id: stream_id.to_string(),
                expected: expected_prev_hash,
                actual: event.previous_hash,
            });
        }
        
        // Append to chain
        let event_hash = chain.append_to_chain(event.event)?;
        
        // Record success
        self.integrity_tracker
            .get_or_create(stream_id)
            .record_valid_event();
        
        // Check latency budget
        let latency_us = start.elapsed().as_micros() as u64;
        self.metrics.record_processing(latency_us);
        
        if latency_us > self.latency_budget_us {
            warn!(
                stream_id = stream_id,
                latency_us = latency_us,
                budget_us = self.latency_budget_us,
                "Processing latency exceeded budget"
            );
        }
        
        debug!(
            stream_id = stream_id,
            event_hash = ?event_hash,
            latency_us = latency_us,
            "Event processed successfully"
        );
        
        Ok(event_hash)
    }
}

impl Default for MerkleEnforcer {
    fn default() -> Self {
        Self::new()
    }
}

impl StreamProcessor for MerkleEnforcer {
    fn process_event(&mut self, event: StreamEvent) -> Result<Blake3Hash, ProcessError> {
        let stream_id = event.stream_id.clone();
        self.verify_and_record(&stream_id, event)
    }
    
    fn get_chain_head(&self, stream_id: &str) -> Option<Blake3Hash> {
        self.vine_map.get(stream_id).map(|c| c.get_chain_head())
    }
    
    fn is_stream_compromised(&self, stream_id: &str) -> bool {
        self.integrity_tracker.is_stream_compromised(stream_id)
    }
    
    fn get_integrity_status(&self, stream_id: &str) -> Option<&IntegrityStatus> {
        self.integrity_tracker.get(stream_id)
    }
}

/// Get current time in nanoseconds since UNIX epoch
pub fn current_time_ns() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("Time went backwards")
        .as_nanos() as u64
}

#[cfg(test)]
mod tests {
    use super::*;
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
    fn test_merkle_enforcer_new() {
        let enforcer = MerkleEnforcer::new();
        assert_eq!(enforcer.stream_count(), 0);
        assert_eq!(enforcer.metrics().total_events, 0);
    }

    #[test]
    fn test_process_single_event() {
        let mut enforcer = MerkleEnforcer::new();
        let event = create_test_event("stream-1", 0);
        
        let stream_event = StreamEvent::new(
            event,
            "stream-1".to_string(),
            GENESIS_HASH,
        );
        
        let result = enforcer.process_event(stream_event);
        assert!(result.is_ok());
        assert_eq!(enforcer.stream_count(), 1);
        assert_eq!(enforcer.metrics().total_events, 1);
        assert!(!enforcer.is_stream_compromised("stream-1"));
    }

    #[test]
    fn test_process_chain_of_events() {
        let mut enforcer = MerkleEnforcer::new();
        let stream_id = "stream-1";
        
        // First event with GENESIS_HASH
        let event1 = create_test_event(stream_id, 0);
        let stream_event1 = StreamEvent::new(
            event1,
            stream_id.to_string(),
            GENESIS_HASH,
        );
        
        let hash1 = enforcer.process_event(stream_event1).unwrap();
        
        // Second event with hash of first
        let event2 = create_test_event(stream_id, 1);
        let stream_event2 = StreamEvent::new(
            event2,
            stream_id.to_string(),
            hash1,
        );
        
        let hash2 = enforcer.process_event(stream_event2).unwrap();
        
        // Third event with hash of second
        let event3 = create_test_event(stream_id, 2);
        let stream_event3 = StreamEvent::new(
            event3,
            stream_id.to_string(),
            hash2,
        );
        
        let result = enforcer.process_event(stream_event3);
        assert!(result.is_ok());
        assert_eq!(enforcer.metrics().total_events, 3);
        assert!(!enforcer.is_stream_compromised(stream_id));
    }

    #[test]
    fn test_hash_mismatch_detection() {
        let mut enforcer = MerkleEnforcer::new();
        let stream_id = "stream-1";
        
        // First event
        let event1 = create_test_event(stream_id, 0);
        let stream_event1 = StreamEvent::new(
            event1,
            stream_id.to_string(),
            GENESIS_HASH,
        );
        let _hash1 = enforcer.process_event(stream_event1).unwrap();
        
        // Second event with WRONG previous hash
        let event2 = create_test_event(stream_id, 1);
        let wrong_hash = [99u8; 32];
        let stream_event2 = StreamEvent::new(
            event2,
            stream_id.to_string(),
            wrong_hash,
        );
        
        let result = enforcer.process_event(stream_event2);
        assert!(result.is_err());
        assert!(matches!(result, Err(ProcessError::HashMismatch { .. })));
        
        // Stream should be marked as compromised
        assert!(enforcer.is_stream_compromised(stream_id));
        assert_eq!(enforcer.metrics().integrity_violations, 1);
    }

    #[test]
    fn test_multiple_streams() {
        let mut enforcer = MerkleEnforcer::new();
        
        // Stream 1
        let event1 = create_test_event("stream-1", 0);
        let stream_event1 = StreamEvent::new(
            event1,
            "stream-1".to_string(),
            GENESIS_HASH,
        );
        enforcer.process_event(stream_event1).unwrap();
        
        // Stream 2
        let event2 = create_test_event("stream-2", 0);
        let stream_event2 = StreamEvent::new(
            event2,
            "stream-2".to_string(),
            GENESIS_HASH,
        );
        enforcer.process_event(stream_event2).unwrap();
        
        assert_eq!(enforcer.stream_count(), 2);
        assert!(!enforcer.is_stream_compromised("stream-1"));
        assert!(!enforcer.is_stream_compromised("stream-2"));
    }

    #[test]
    fn test_get_chain_head() {
        let mut enforcer = MerkleEnforcer::new();
        let stream_id = "stream-1";
        
        // Initially should be None
        assert!(enforcer.get_chain_head(stream_id).is_none());
        
        // After first event, should return that event's hash
        let event = create_test_event(stream_id, 0);
        let stream_event = StreamEvent::new(
            event,
            stream_id.to_string(),
            GENESIS_HASH,
        );
        let hash = enforcer.process_event(stream_event).unwrap();
        
        assert_eq!(enforcer.get_chain_head(stream_id), Some(hash));
    }

    #[test]
    fn test_latency_budget() {
        let enforcer = MerkleEnforcer::with_latency_budget(100);
        assert_eq!(enforcer.latency_budget_us, 100);
    }

    #[test]
    fn test_integrity_status() {
        let mut enforcer = MerkleEnforcer::new();
        let stream_id = "stream-1";
        
        // Process valid event
        let event = create_test_event(stream_id, 0);
        let stream_event = StreamEvent::new(
            event,
            stream_id.to_string(),
            GENESIS_HASH,
        );
        enforcer.process_event(stream_event).unwrap();
        
        // Check integrity status
        let status = enforcer.get_integrity_status(stream_id).unwrap();
        assert_eq!(status.stream_id, stream_id);
        assert_eq!(status.total_events, 1);
        assert_eq!(status.valid_events, 1);
        assert_eq!(status.broken_events, 0);
    }
}
