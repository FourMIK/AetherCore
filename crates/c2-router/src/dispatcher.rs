//! Command dispatcher for unit and swarm operations
//!
//! This module provides command dispatch logic with fan-out for swarm operations
//! and result aggregation.

#![warn(missing_docs)]

use crate::command_types::{SwarmCommand, UnitCommand};
use serde::{Deserialize, Serialize};
use thiserror::Error;

/// Dispatcher errors
#[derive(Debug, Error)]
pub enum DispatchError {
    /// Invalid unit identifier
    #[error("Invalid unit ID: {0}")]
    InvalidUnitId(String),
    
    /// Unit not reachable
    #[error("Unit not reachable: {0}")]
    UnitUnreachable(String),
    
    /// Command dispatch timeout
    #[error("Command dispatch timeout for unit {0}")]
    Timeout(String),
    
    /// Swarm batch exceeds limit
    #[error("Swarm batch size {got} exceeds limit {limit}")]
    BatchSizeExceeded {
        /// Actual batch size
        got: usize,
        /// Maximum allowed batch size
        limit: usize,
    },
    
    /// Data integrity compromised - chain discontinuity detected
    #[error("Identity Collapse: Chain Discontinuity Detected for unit {unit_id}: {reason}")]
    DataLoss {
        /// Unit identifier
        unit_id: String,
        /// Reason for data loss
        reason: String,
    },
}

/// Command dispatch result for a single unit
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum UnitDispatchResult {
    /// Command dispatched successfully
    Success {
        /// Unit identifier
        unit_id: String,
        /// Dispatch timestamp
        timestamp_ns: u64,
    },
    /// Command dispatch failed
    Failed {
        /// Unit identifier
        unit_id: String,
        /// Failure reason
        reason: String,
        /// Failure timestamp
        timestamp_ns: u64,
    },
    /// Command dispatch timed out
    Timeout {
        /// Unit identifier
        unit_id: String,
        /// Timeout timestamp
        timestamp_ns: u64,
    },
}

impl UnitDispatchResult {
    /// Check if dispatch was successful
    pub fn is_success(&self) -> bool {
        matches!(self, UnitDispatchResult::Success { .. })
    }
    
    /// Get the unit ID
    pub fn unit_id(&self) -> &str {
        match self {
            UnitDispatchResult::Success { unit_id, .. } => unit_id,
            UnitDispatchResult::Failed { unit_id, .. } => unit_id,
            UnitDispatchResult::Timeout { unit_id, .. } => unit_id,
        }
    }
}

/// Swarm command dispatch status
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SwarmDispatchStatus {
    /// Swarm command identifier
    pub swarm_command_id: String,
    /// Unit dispatch results
    pub unit_results: Vec<UnitDispatchResult>,
    /// Number of successful dispatches
    pub success_count: usize,
    /// Number of failed dispatches
    pub failure_count: usize,
    /// Number of timeouts
    pub timeout_count: usize,
    /// Total units targeted
    pub total_units: usize,
    /// Overall status timestamp
    pub timestamp_ns: u64,
}

impl SwarmDispatchStatus {
    /// Create a new swarm dispatch status
    pub fn new(swarm_command_id: String, unit_results: Vec<UnitDispatchResult>, timestamp_ns: u64) -> Self {
        let success_count = unit_results.iter().filter(|r| r.is_success()).count();
        let failure_count = unit_results.iter().filter(|r| matches!(r, UnitDispatchResult::Failed { .. })).count();
        let timeout_count = unit_results.iter().filter(|r| matches!(r, UnitDispatchResult::Timeout { .. })).count();
        let total_units = unit_results.len();
        
        Self {
            swarm_command_id,
            unit_results,
            success_count,
            failure_count,
            timeout_count,
            total_units,
            timestamp_ns,
        }
    }
    
    /// Get completion percentage
    pub fn completion_percent(&self) -> f32 {
        if self.total_units == 0 {
            return 0.0;
        }
        (self.success_count as f32 / self.total_units as f32) * 100.0
    }
    
    /// Check if all units succeeded
    pub fn all_success(&self) -> bool {
        self.success_count == self.total_units
    }
}

/// Command dispatcher for unit and swarm operations
#[derive(Debug)]
pub struct CommandDispatcher {
    /// Maximum batch size for swarm commands
    max_batch_size: usize,
    /// Integrity status tracker (optional - if None, integrity checks are disabled)
    integrity_tracker: Option<std::sync::Arc<std::sync::Mutex<aethercore_stream::StreamIntegrityTracker>>>,
}

impl CommandDispatcher {
    /// Maximum allowed batch size (from spec: ≤ 100 units per batch)
    pub const DEFAULT_MAX_BATCH_SIZE: usize = 100;
    
    /// Create a new command dispatcher without integrity checking
    pub fn new() -> Self {
        Self {
            max_batch_size: Self::DEFAULT_MAX_BATCH_SIZE,
            integrity_tracker: None,
        }
    }
    
    /// Create a dispatcher with custom max batch size
    pub fn with_max_batch_size(max_batch_size: usize) -> Self {
        Self { 
            max_batch_size,
            integrity_tracker: None,
        }
    }
    
    /// Create a dispatcher with integrity checking enabled
    pub fn with_integrity_tracker(
        tracker: std::sync::Arc<std::sync::Mutex<aethercore_stream::StreamIntegrityTracker>>,
    ) -> Self {
        Self {
            max_batch_size: Self::DEFAULT_MAX_BATCH_SIZE,
            integrity_tracker: Some(tracker),
        }
    }
    
    /// Check if a unit's integrity is compromised
    fn check_integrity(&self, unit_id: &str) -> Result<(), DispatchError> {
        if let Some(tracker) = &self.integrity_tracker {
            let tracker_lock = tracker.lock().unwrap();
            if tracker_lock.is_stream_compromised(unit_id) {
                let reason = tracker_lock
                    .get(unit_id)
                    .and_then(|s| s.get_compromise_reason())
                    .unwrap_or("Unknown integrity violation")
                    .to_string();
                
                return Err(DispatchError::DataLoss {
                    unit_id: unit_id.to_string(),
                    reason,
                });
            }
        }
        Ok(())
    }
    
    /// Dispatch a command to a single unit
    ///
    /// This is a placeholder that returns a mock result. In production, this would:
    /// 1. Check integrity status
    /// 2. Validate unit_id
    /// 3. Send command via gRPC/message queue
    /// 4. Wait for acknowledgment
    /// 5. Return result
    pub fn dispatch_unit_command(
        &self,
        unit_id: &str,
        _command: &UnitCommand,
        timestamp_ns: u64,
    ) -> Result<UnitDispatchResult, DispatchError> {
        // Check integrity first - block compromised nodes
        self.check_integrity(unit_id)?;
        
        // Placeholder: In production, this would dispatch to the actual unit
        // For now, simulate success
        Ok(UnitDispatchResult::Success {
            unit_id: unit_id.to_string(),
            timestamp_ns,
        })
    }
    
    /// Fan out swarm command to multiple units
    ///
    /// # Arguments
    /// * `swarm_command_id` - Unique identifier for the swarm operation
    /// * `command` - Swarm command to execute
    /// * `target_unit_ids` - List of unit IDs to target
    /// * `timestamp_ns` - Command timestamp
    ///
    /// # Returns
    /// Aggregated dispatch status
    pub fn dispatch_swarm_command(
        &self,
        swarm_command_id: String,
        _command: &SwarmCommand,
        target_unit_ids: &[String],
        timestamp_ns: u64,
    ) -> Result<SwarmDispatchStatus, DispatchError> {
        // Validate batch size
        if target_unit_ids.len() > self.max_batch_size {
            return Err(DispatchError::BatchSizeExceeded {
                got: target_unit_ids.len(),
                limit: self.max_batch_size,
            });
        }
        
        // Convert swarm command to unit commands and dispatch
        // Check integrity for each unit
        let unit_results: Vec<UnitDispatchResult> = target_unit_ids
            .iter()
            .map(|unit_id| {
                // Check integrity - if compromised, return failure
                match self.check_integrity(unit_id) {
                    Ok(_) => {
                        // In production, this would convert the swarm command to appropriate unit command
                        // and dispatch it. For now, simulate success.
                        UnitDispatchResult::Success {
                            unit_id: unit_id.clone(),
                            timestamp_ns,
                        }
                    }
                    Err(DispatchError::DataLoss { unit_id, reason }) => {
                        UnitDispatchResult::Failed {
                            unit_id,
                            reason,
                            timestamp_ns,
                        }
                    }
                    Err(e) => {
                        UnitDispatchResult::Failed {
                            unit_id: unit_id.clone(),
                            reason: e.to_string(),
                            timestamp_ns,
                        }
                    }
                }
            })
            .collect();
        
        Ok(SwarmDispatchStatus::new(
            swarm_command_id,
            unit_results,
            timestamp_ns,
        ))
    }
    
    /// Abort a swarm command
    ///
    /// Sends abort signal to all units in the swarm operation
    pub fn abort_swarm_command(
        &self,
        _swarm_command_id: &str,
        _target_unit_ids: &[String],
    ) -> Result<(), DispatchError> {
        // Placeholder: In production, this would send abort to all units
        Ok(())
    }
}

impl Default for CommandDispatcher {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::command_types::Coordinate;
    
    #[test]
    fn test_unit_dispatch_result_success() {
        let result = UnitDispatchResult::Success {
            unit_id: "unit-1".to_string(),
            timestamp_ns: 1000,
        };
        
        assert!(result.is_success());
        assert_eq!(result.unit_id(), "unit-1");
    }
    
    #[test]
    fn test_swarm_dispatch_status_completion() {
        let results = vec![
            UnitDispatchResult::Success { unit_id: "unit-1".to_string(), timestamp_ns: 1000 },
            UnitDispatchResult::Success { unit_id: "unit-2".to_string(), timestamp_ns: 1000 },
            UnitDispatchResult::Failed { unit_id: "unit-3".to_string(), reason: "timeout".to_string(), timestamp_ns: 1000 },
        ];
        
        let status = SwarmDispatchStatus::new("swarm-1".to_string(), results, 1000);
        
        assert_eq!(status.success_count, 2);
        assert_eq!(status.failure_count, 1);
        assert_eq!(status.total_units, 3);
        assert!((status.completion_percent() - 66.666).abs() < 0.01);
        assert!(!status.all_success());
    }
    
    #[test]
    fn test_batch_size_limit() {
        let dispatcher = CommandDispatcher::new();
        let command = SwarmCommand::RecallAll { base_id: "BASE-1".to_string() };
        
        // Create too many units
        let unit_ids: Vec<String> = (0..101).map(|i| format!("unit-{}", i)).collect();
        
        let result = dispatcher.dispatch_swarm_command(
            "swarm-1".to_string(),
            &command,
            &unit_ids,
            1000,
        );
        
        assert!(matches!(result, Err(DispatchError::BatchSizeExceeded { .. })));
    }
    
    #[test]
    fn test_dispatch_unit_command() {
        let dispatcher = CommandDispatcher::new();
        let command = UnitCommand::Navigate {
            waypoint: Coordinate { lat: 45.0, lon: -122.0, alt: None },
            speed: None,
            altitude: None,
        };
        
        let result = dispatcher.dispatch_unit_command("unit-1", &command, 1000);
        assert!(result.is_ok());
        assert!(result.unwrap().is_success());
    }
    
    #[test]
    fn test_dispatch_unit_command_integrity_check() {
        use aethercore_stream::StreamIntegrityTracker;
        use std::sync::{Arc, Mutex};
        
        // Create tracker and mark a unit as compromised
        let mut tracker = StreamIntegrityTracker::new();
        tracker.get_or_create("unit-compromised")
            .record_broken_event("Test integrity violation".to_string());
        
        let tracker_arc = Arc::new(Mutex::new(tracker));
        let dispatcher = CommandDispatcher::with_integrity_tracker(tracker_arc);
        
        let command = UnitCommand::Navigate {
            waypoint: Coordinate { lat: 0.0, lon: 0.0, alt: Some(100.0) },
            speed: Some(10.0),
            altitude: None,
        };
        
        // Compromised unit should fail
        let result = dispatcher.dispatch_unit_command("unit-compromised", &command, 1000);
        assert!(result.is_err());
        assert!(matches!(result, Err(DispatchError::DataLoss { .. })));
        
        // Non-compromised unit should succeed
        let result = dispatcher.dispatch_unit_command("unit-ok", &command, 1000);
        assert!(result.is_ok());
    }
    
    #[test]
    fn test_dispatch_swarm_command_integrity_check() {
        use aethercore_stream::StreamIntegrityTracker;
        use std::sync::{Arc, Mutex};
        
        // Create tracker and mark one unit as compromised
        let mut tracker = StreamIntegrityTracker::new();
        tracker.get_or_create("unit-2")
            .record_broken_event("Chain discontinuity".to_string());
        
        let tracker_arc = Arc::new(Mutex::new(tracker));
        let dispatcher = CommandDispatcher::with_integrity_tracker(tracker_arc);
        
        let command = SwarmCommand::RecallAll {
            base_id: "BASE-1".to_string(),
        };
        
        let target_units = vec![
            "unit-1".to_string(),
            "unit-2".to_string(),  // Compromised
            "unit-3".to_string(),
        ];
        
        let status = dispatcher.dispatch_swarm_command(
            "swarm-1".to_string(),
            &command,
            &target_units,
            1000,
        ).unwrap();
        
        // Should have 2 successes and 1 failure
        assert_eq!(status.total_units, 3);
        assert_eq!(status.success_count, 2);
        assert_eq!(status.failure_count, 1);
        
        // Find the failed unit
        let failed = status.unit_results.iter()
            .find(|r| matches!(r, UnitDispatchResult::Failed { .. }))
            .unwrap();
        
        assert_eq!(failed.unit_id(), "unit-2");
    }
    
    #[test]
    fn test_dispatch_without_integrity_tracker() {
        // Dispatcher without integrity tracker should not block anything
        let dispatcher = CommandDispatcher::new();
        
        let command = UnitCommand::Navigate {
            waypoint: Coordinate { lat: 0.0, lon: 0.0, alt: Some(100.0) },
            speed: Some(10.0),
            altitude: None,
        };
        
        let result = dispatcher.dispatch_unit_command("any-unit", &command, 1000);
        assert!(result.is_ok());
    }
}

