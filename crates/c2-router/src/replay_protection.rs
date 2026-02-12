//! Replay attack protection module
//!
//! Implements nonce-based and timestamp-based replay protection for C2 commands.
//! Enforces the fail-visible doctrine: suspected replay attacks are rejected immediately.

use std::collections::HashMap;
use std::sync::{Arc, RwLock};
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use thiserror::Error;

/// Maximum age of a command timestamp (5 minutes)
const MAX_TIMESTAMP_AGE_SECS: u64 = 300;

/// Maximum future timestamp skew allowed (30 seconds)
const MAX_FUTURE_SKEW_SECS: u64 = 30;

/// Time window to keep processed nonces in memory (10 minutes)
const NONCE_RETENTION_SECS: u64 = 600;

/// Maximum number of nonces to track per device (prevents memory exhaustion)
const MAX_NONCES_PER_DEVICE: usize = 1000;

/// Replay protection error types
#[derive(Debug, Error)]
pub enum ReplayError {
    #[error("Timestamp too old: {0} seconds ago (max: {1} seconds)")]
    TimestampTooOld(u64, u64),

    #[error("Timestamp too far in future: {0} seconds ahead (max: {1} seconds)")]
    TimestampTooFuture(u64, u64),

    #[error("Duplicate nonce detected: {0}")]
    DuplicateNonce(String),

    #[error("Nonce tracking limit exceeded for device")]
    NonceLimitExceeded,

    #[error("Invalid timestamp: {0}")]
    InvalidTimestamp(String),

    #[error("System time error: {0}")]
    SystemTimeError(String),
}

/// Result type for replay protection operations
pub type ReplayResult<T> = Result<T, ReplayError>;

/// Nonce entry with timestamp for cleanup
#[derive(Debug, Clone)]
struct NonceEntry {
    nonce: String,
    timestamp_ns: u64,
}

/// Replay protection tracker
///
/// Tracks processed nonces per device to prevent replay attacks.
/// Uses time-based cleanup to prevent memory exhaustion.
pub struct ReplayProtector {
    /// Nonces seen per device ID
    nonces: Arc<RwLock<HashMap<String, Vec<NonceEntry>>>>,
}

impl ReplayProtector {
    /// Create a new replay protector
    pub fn new() -> Self {
        Self {
            nonces: Arc::new(RwLock::new(HashMap::new())),
        }
    }

    /// Validate command timestamp and nonce
    ///
    /// Checks:
    /// 1. Timestamp is not too old (prevents replay of stale commands)
    /// 2. Timestamp is not too far in future (prevents time manipulation)
    /// 3. Nonce has not been seen before (prevents exact replay)
    ///
    /// Returns Ok if validation passes, Err for replay attack or invalid input.
    pub fn validate_command(
        &self,
        device_id: &str,
        timestamp_ns: u64,
        nonce: &str,
    ) -> ReplayResult<()> {
        // Step 1: Validate timestamp freshness
        self.validate_timestamp(timestamp_ns)?;

        // Step 2: Check for duplicate nonce
        self.check_and_record_nonce(device_id, timestamp_ns, nonce)?;

        // Step 3: Cleanup old nonces (async cleanup to avoid blocking)
        self.cleanup_old_nonces();

        Ok(())
    }

    /// Validate that timestamp is within acceptable window
    fn validate_timestamp(&self, timestamp_ns: u64) -> ReplayResult<()> {
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_err(|e| ReplayError::SystemTimeError(e.to_string()))?
            .as_nanos() as u64;

        // Check if timestamp is too old
        if timestamp_ns < now {
            let age_secs = (now - timestamp_ns) / 1_000_000_000;
            if age_secs > MAX_TIMESTAMP_AGE_SECS {
                return Err(ReplayError::TimestampTooOld(age_secs, MAX_TIMESTAMP_AGE_SECS));
            }
        } else {
            // Check if timestamp is too far in future
            let future_secs = (timestamp_ns - now) / 1_000_000_000;
            if future_secs > MAX_FUTURE_SKEW_SECS {
                return Err(ReplayError::TimestampTooFuture(
                    future_secs,
                    MAX_FUTURE_SKEW_SECS,
                ));
            }
        }

        Ok(())
    }

    /// Check if nonce has been seen before and record it
    fn check_and_record_nonce(
        &self,
        device_id: &str,
        timestamp_ns: u64,
        nonce: &str,
    ) -> ReplayResult<()> {
        let mut nonces = self.nonces.write().map_err(|e| {
            ReplayError::InvalidTimestamp(format!("Lock error: {}", e))
        })?;

        let device_nonces = nonces.entry(device_id.to_string()).or_insert_with(Vec::new);

        // Check if nonce already exists
        if device_nonces.iter().any(|entry| entry.nonce == nonce) {
            return Err(ReplayError::DuplicateNonce(nonce.to_string()));
        }

        // Check nonce limit
        if device_nonces.len() >= MAX_NONCES_PER_DEVICE {
            return Err(ReplayError::NonceLimitExceeded);
        }

        // Record the nonce
        device_nonces.push(NonceEntry {
            nonce: nonce.to_string(),
            timestamp_ns,
        });

        Ok(())
    }

    /// Clean up old nonces that are beyond the retention window
    fn cleanup_old_nonces(&self) {
        if let Ok(mut nonces) = self.nonces.write() {
            let cutoff_time = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .map(|d| d.as_nanos() as u64 - (NONCE_RETENTION_SECS * 1_000_000_000))
                .unwrap_or(0);

            for (_, device_nonces) in nonces.iter_mut() {
                device_nonces.retain(|entry| entry.timestamp_ns >= cutoff_time);
            }

            // Remove devices with no nonces
            nonces.retain(|_, device_nonces| !device_nonces.is_empty());
        }
    }

    /// Get the number of tracked nonces for a device (for testing/monitoring)
    pub fn nonce_count(&self, device_id: &str) -> usize {
        self.nonces
            .read()
            .ok()
            .and_then(|nonces| nonces.get(device_id).map(|v| v.len()))
            .unwrap_or(0)
    }

    /// Clear all tracked nonces (for testing)
    #[cfg(test)]
    pub fn clear(&self) {
        if let Ok(mut nonces) = self.nonces.write() {
            nonces.clear();
        }
    }
}

impl Default for ReplayProtector {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn current_timestamp_ns() -> u64 {
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos() as u64
    }

    #[test]
    fn test_valid_command_accepted() {
        let protector = ReplayProtector::new();
        let device_id = "device-001";
        let timestamp = current_timestamp_ns();
        let nonce = "nonce-001";

        let result = protector.validate_command(device_id, timestamp, nonce);
        assert!(result.is_ok());
    }

    #[test]
    fn test_duplicate_nonce_rejected() {
        let protector = ReplayProtector::new();
        let device_id = "device-001";
        let timestamp = current_timestamp_ns();
        let nonce = "nonce-001";

        // First attempt should succeed
        assert!(protector.validate_command(device_id, timestamp, nonce).is_ok());

        // Second attempt with same nonce should fail
        let result = protector.validate_command(device_id, timestamp, nonce);
        assert!(matches!(result, Err(ReplayError::DuplicateNonce(_))));
    }

    #[test]
    fn test_old_timestamp_rejected() {
        let protector = ReplayProtector::new();
        let device_id = "device-001";
        // Timestamp from 1 hour ago
        let old_timestamp = current_timestamp_ns() - (3600 * 1_000_000_000);
        let nonce = "nonce-001";

        let result = protector.validate_command(device_id, old_timestamp, nonce);
        assert!(matches!(result, Err(ReplayError::TimestampTooOld(_, _))));
    }

    #[test]
    fn test_future_timestamp_rejected() {
        let protector = ReplayProtector::new();
        let device_id = "device-001";
        // Timestamp 1 hour in future
        let future_timestamp = current_timestamp_ns() + (3600 * 1_000_000_000);
        let nonce = "nonce-001";

        let result = protector.validate_command(device_id, future_timestamp, nonce);
        assert!(matches!(result, Err(ReplayError::TimestampTooFuture(_, _))));
    }

    #[test]
    fn test_different_devices_independent() {
        let protector = ReplayProtector::new();
        let timestamp = current_timestamp_ns();
        let nonce = "nonce-001";

        // Same nonce should be allowed for different devices
        assert!(protector.validate_command("device-001", timestamp, nonce).is_ok());
        assert!(protector.validate_command("device-002", timestamp, nonce).is_ok());
    }

    #[test]
    fn test_different_nonces_allowed() {
        let protector = ReplayProtector::new();
        let device_id = "device-001";
        let timestamp = current_timestamp_ns();

        // Different nonces should be allowed
        assert!(protector.validate_command(device_id, timestamp, "nonce-001").is_ok());
        assert!(protector.validate_command(device_id, timestamp, "nonce-002").is_ok());
        assert!(protector.validate_command(device_id, timestamp, "nonce-003").is_ok());
    }

    #[test]
    fn test_nonce_cleanup() {
        let protector = ReplayProtector::new();
        let device_id = "device-001";
        
        // Add some nonces
        for i in 0..5 {
            let timestamp = current_timestamp_ns();
            let nonce = format!("nonce-{}", i);
            protector.validate_command(device_id, timestamp, &nonce).unwrap();
        }

        assert_eq!(protector.nonce_count(device_id), 5);

        // Cleanup doesn't remove recent nonces
        protector.cleanup_old_nonces();
        assert_eq!(protector.nonce_count(device_id), 5);
    }

    #[test]
    fn test_nonce_limit() {
        let protector = ReplayProtector::new();
        let device_id = "device-001";
        let timestamp = current_timestamp_ns();

        // Add nonces up to the limit
        for i in 0..MAX_NONCES_PER_DEVICE {
            let nonce = format!("nonce-{}", i);
            protector.validate_command(device_id, timestamp, &nonce).unwrap();
        }

        // Adding one more should fail
        let result = protector.validate_command(device_id, timestamp, "nonce-overflow");
        assert!(matches!(result, Err(ReplayError::NonceLimitExceeded)));
    }

    #[test]
    fn test_timestamp_within_window_accepted() {
        let protector = ReplayProtector::new();
        let device_id = "device-001";
        
        // Timestamp 1 minute ago (within 5 minute window)
        let recent_timestamp = current_timestamp_ns() - (60 * 1_000_000_000);
        let result = protector.validate_command(device_id, recent_timestamp, "nonce-001");
        assert!(result.is_ok());

        // Timestamp 10 seconds in future (within 30 second window)
        let near_future = current_timestamp_ns() + (10 * 1_000_000_000);
        let result = protector.validate_command(device_id, near_future, "nonce-002");
        assert!(result.is_ok());
    }
}
