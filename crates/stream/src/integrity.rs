//! Stream Integrity Tracking
//!
//! Tracks the integrity status of data streams, marking them as VERIFIED,
//! STATUS_UNVERIFIED, or INTEGRITY_COMPROMISED based on Merkle-Vine chain validation.

use serde::{Deserialize, Serialize};
use std::time::{SystemTime, UNIX_EPOCH};

/// Verification status for fail-visible design
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum VerificationStatus {
    /// Valid cryptographic chain with all hashes matching
    Verified,
    /// Missing hashes or unable to verify
    StatusUnverified,
    /// Hash mismatch detected - Byzantine behavior
    Spoofed,
}

impl Default for VerificationStatus {
    fn default() -> Self {
        Self::StatusUnverified
    }
}

/// Integrity status for a stream
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IntegrityStatus {
    /// Stream identifier
    pub stream_id: String,
    /// Current verification status
    pub verification_status: VerificationStatus,
    /// Total events processed
    pub total_events: u64,
    /// Events with valid chain links
    pub valid_events: u64,
    /// Events with broken chain links
    pub broken_events: u64,
    /// Last check timestamp (nanoseconds)
    pub last_check_ns: u64,
    /// Whether this stream is compromised
    pub is_compromised: bool,
    /// Reason for compromise (if any)
    pub compromise_reason: Option<String>,
    /// Last seen sequence ID for replay attack prevention
    pub last_sequence_id: u64,
}

impl IntegrityStatus {
    /// Create a new integrity status tracker for a stream
    pub fn new(stream_id: String) -> Self {
        Self {
            stream_id,
            verification_status: VerificationStatus::StatusUnverified,
            total_events: 0,
            valid_events: 0,
            broken_events: 0,
            last_check_ns: current_time_ns(),
            is_compromised: false,
            compromise_reason: None,
            last_sequence_id: 0,
        }
    }

    /// Mark an event as valid
    pub fn record_valid_event(&mut self) {
        self.total_events += 1;
        self.valid_events += 1;
        self.last_check_ns = current_time_ns();
        
        // Update verification status
        if self.total_events > 0 && self.broken_events == 0 {
            self.verification_status = VerificationStatus::Verified;
            tracing::info!(
                stream_id = %self.stream_id,
                total_events = self.total_events,
                "Stream integrity verified"
            );
        }
    }

    /// Mark an event as broken (integrity violation)
    pub fn record_broken_event(&mut self, reason: String) {
        self.total_events += 1;
        self.broken_events += 1;
        self.last_check_ns = current_time_ns();
        self.is_compromised = true;
        self.verification_status = VerificationStatus::Spoofed;
        self.compromise_reason = Some(reason.clone());
        
        tracing::error!(
            stream_id = %self.stream_id,
            reason = %reason,
            broken_events = self.broken_events,
            "Stream integrity compromised"
        );
    }

    /// Reset compromise status (after re-audit)
    pub fn reset_compromise(&mut self) {
        self.is_compromised = false;
        self.compromise_reason = None;
        self.broken_events = 0;
        
        // Recalculate status
        if self.total_events > 0 && self.valid_events > 0 {
            self.verification_status = VerificationStatus::Verified;
        } else {
            self.verification_status = VerificationStatus::StatusUnverified;
        }
    }

    /// Check if stream has any integrity violations
    pub fn has_violations(&self) -> bool {
        self.broken_events > 0
    }

    /// Get the compromise reason if compromised
    pub fn get_compromise_reason(&self) -> Option<&str> {
        self.compromise_reason.as_deref()
    }

    /// Validate sequence ID for replay attack prevention
    /// Returns Ok(()) if sequence is valid, Err with reason if replay detected
    pub fn validate_sequence(&mut self, sequence_id: u64) -> Result<(), String> {
        // Sequence ID must be strictly increasing
        if sequence_id <= self.last_sequence_id {
            let reason = format!(
                "Replay attack detected: sequence_id {} <= last_seen {}",
                sequence_id, self.last_sequence_id
            );
            tracing::error!(
                stream_id = %self.stream_id,
                sequence_id,
                last_sequence_id = self.last_sequence_id,
                "Replay attack detected"
            );
            return Err(reason);
        }

        // Check for suspiciously large gaps (potential indicator of attack)
        const MAX_SEQUENCE_GAP: u64 = 1000;
        let gap = sequence_id.saturating_sub(self.last_sequence_id);
        if gap > MAX_SEQUENCE_GAP && self.last_sequence_id > 0 {
            tracing::warn!(
                stream_id = %self.stream_id,
                sequence_id,
                last_sequence_id = self.last_sequence_id,
                gap,
                "Large sequence gap detected - possible attack or network disruption"
            );
        }

        // Update last seen sequence
        self.last_sequence_id = sequence_id;
        Ok(())
    }
}

/// Tracks integrity status for multiple streams
#[derive(Debug, Default)]
pub struct StreamIntegrityTracker {
    /// Map of stream_id to integrity status
    streams: std::collections::HashMap<String, IntegrityStatus>,
}

impl StreamIntegrityTracker {
    /// Create a new stream integrity tracker
    pub fn new() -> Self {
        Self::default()
    }

    /// Get or create integrity status for a stream
    pub fn get_or_create(&mut self, stream_id: &str) -> &mut IntegrityStatus {
        self.streams
            .entry(stream_id.to_string())
            .or_insert_with(|| IntegrityStatus::new(stream_id.to_string()))
    }

    /// Get integrity status for a stream
    pub fn get(&self, stream_id: &str) -> Option<&IntegrityStatus> {
        self.streams.get(stream_id)
    }

    /// Check if a stream is compromised
    pub fn is_stream_compromised(&self, stream_id: &str) -> bool {
        self.streams
            .get(stream_id)
            .map(|s| s.is_compromised)
            .unwrap_or(false)
    }

    /// Get all compromised streams
    pub fn get_compromised_streams(&self) -> Vec<&IntegrityStatus> {
        self.streams
            .values()
            .filter(|s| s.is_compromised)
            .collect()
    }

    /// Reset compromise status for a stream
    pub fn reset_stream(&mut self, stream_id: &str) {
        if let Some(status) = self.streams.get_mut(stream_id) {
            status.reset_compromise();
        }
    }

    /// Get total number of tracked streams
    pub fn stream_count(&self) -> usize {
        self.streams.len()
    }

    /// Get all stream IDs
    pub fn stream_ids(&self) -> Vec<String> {
        self.streams.keys().cloned().collect()
    }

    /// Validate sequence ID for a stream (replay attack prevention)
    pub fn validate_sequence(&mut self, stream_id: &str, sequence_id: u64) -> Result<(), String> {
        let status = self.get_or_create(stream_id);
        status.validate_sequence(sequence_id)
    }
}

/// Get current time in nanoseconds since UNIX epoch
fn current_time_ns() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("Time went backwards")
        .as_nanos() as u64
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_integrity_status_new() {
        let status = IntegrityStatus::new("test-stream".to_string());
        assert_eq!(status.stream_id, "test-stream");
        assert_eq!(status.verification_status, VerificationStatus::StatusUnverified);
        assert_eq!(status.total_events, 0);
        assert!(!status.is_compromised);
    }

    #[test]
    fn test_record_valid_event() {
        let mut status = IntegrityStatus::new("test-stream".to_string());
        status.record_valid_event();
        
        assert_eq!(status.total_events, 1);
        assert_eq!(status.valid_events, 1);
        assert_eq!(status.verification_status, VerificationStatus::Verified);
        assert!(!status.is_compromised);
    }

    #[test]
    fn test_record_broken_event() {
        let mut status = IntegrityStatus::new("test-stream".to_string());
        status.record_broken_event("Hash mismatch".to_string());
        
        assert_eq!(status.total_events, 1);
        assert_eq!(status.broken_events, 1);
        assert_eq!(status.verification_status, VerificationStatus::Spoofed);
        assert!(status.is_compromised);
        assert_eq!(status.get_compromise_reason(), Some("Hash mismatch"));
    }

    #[test]
    fn test_reset_compromise() {
        let mut status = IntegrityStatus::new("test-stream".to_string());
        status.record_broken_event("Hash mismatch".to_string());
        assert!(status.is_compromised);
        
        status.record_valid_event();
        status.reset_compromise();
        
        assert!(!status.is_compromised);
        assert_eq!(status.broken_events, 0);
        assert!(status.get_compromise_reason().is_none());
    }

    #[test]
    fn test_stream_integrity_tracker() {
        let mut tracker = StreamIntegrityTracker::new();
        
        // Create stream
        let status = tracker.get_or_create("stream-1");
        status.record_valid_event();
        
        assert_eq!(tracker.stream_count(), 1);
        assert!(!tracker.is_stream_compromised("stream-1"));
        
        // Mark as compromised
        let status = tracker.get_or_create("stream-1");
        status.record_broken_event("Test failure".to_string());
        
        assert!(tracker.is_stream_compromised("stream-1"));
        assert_eq!(tracker.get_compromised_streams().len(), 1);
    }

    #[test]
    fn test_multiple_streams() {
        let mut tracker = StreamIntegrityTracker::new();
        
        tracker.get_or_create("stream-1").record_valid_event();
        tracker.get_or_create("stream-2").record_valid_event();
        tracker.get_or_create("stream-3").record_broken_event("Test".to_string());
        
        assert_eq!(tracker.stream_count(), 3);
        assert_eq!(tracker.get_compromised_streams().len(), 1);
        assert!(tracker.is_stream_compromised("stream-3"));
        assert!(!tracker.is_stream_compromised("stream-1"));
    }

    #[test]
    fn test_sequence_validation_accepts_increasing() {
        let mut status = IntegrityStatus::new("test-stream".to_string());
        
        assert!(status.validate_sequence(1).is_ok());
        assert!(status.validate_sequence(2).is_ok());
        assert!(status.validate_sequence(100).is_ok());
        assert_eq!(status.last_sequence_id, 100);
    }

    #[test]
    fn test_sequence_validation_rejects_replay() {
        let mut status = IntegrityStatus::new("test-stream".to_string());
        
        assert!(status.validate_sequence(10).is_ok());
        
        // Replay with same sequence
        let result = status.validate_sequence(10);
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("Replay attack"));
        
        // Replay with lower sequence
        let result = status.validate_sequence(5);
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("Replay attack"));
    }

    #[test]
    fn test_sequence_validation_warns_on_large_gap() {
        let mut status = IntegrityStatus::new("test-stream".to_string());
        
        assert!(status.validate_sequence(10).is_ok());
        
        // Large gap should still be accepted but logged
        let result = status.validate_sequence(2000);
        assert!(result.is_ok());
        assert_eq!(status.last_sequence_id, 2000);
    }

    #[test]
    fn test_tracker_validates_sequence() {
        let mut tracker = StreamIntegrityTracker::new();
        
        // First event
        assert!(tracker.validate_sequence("stream-1", 1).is_ok());
        assert!(tracker.validate_sequence("stream-1", 2).is_ok());
        
        // Replay attack
        let result = tracker.validate_sequence("stream-1", 1);
        assert!(result.is_err());
        
        // Different stream should work
        assert!(tracker.validate_sequence("stream-2", 1).is_ok());
    }

    #[test]
    fn test_sequence_starts_at_zero() {
        let status = IntegrityStatus::new("test-stream".to_string());
        assert_eq!(status.last_sequence_id, 0);
        
        // First sequence ID of 1 should be valid
        let mut status = status;
        assert!(status.validate_sequence(1).is_ok());
    }
}
