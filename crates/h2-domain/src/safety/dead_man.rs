//! Dead man's switch - Safe state enforcement

use serde::{Deserialize, Serialize};
use crate::materia::ValveState;

/// Safe state mode
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
pub enum SafeStateMode {
    /// Normal operation
    Normal,
    /// FailVisible mode (requires manual attestation to resume)
    FailVisible,
}

/// Safe state enforcer
/// 
/// When triggered (e.g., by expired heartbeat), ensures all SOV valves
/// are closed and system enters FailVisible mode.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SafeState {
    /// Current mode
    pub mode: SafeStateMode,
    /// Timestamp when safe state was triggered (nanoseconds since epoch)
    pub triggered_timestamp_ns: Option<u64>,
    /// Reason for safe state trigger
    pub trigger_reason: Option<String>,
}

impl SafeState {
    /// Create a new safe state enforcer in normal mode
    pub fn new() -> Self {
        Self {
            mode: SafeStateMode::Normal,
            triggered_timestamp_ns: None,
            trigger_reason: None,
        }
    }
    
    /// Trigger safe state
    /// 
    /// # Arguments
    /// * `reason` - Reason for triggering safe state
    /// * `timestamp_ns` - Current timestamp in nanoseconds since epoch
    pub fn trigger(&mut self, reason: String, timestamp_ns: u64) {
        self.mode = SafeStateMode::FailVisible;
        self.triggered_timestamp_ns = Some(timestamp_ns);
        self.trigger_reason = Some(reason);
    }
    
    /// Get required valve state based on safe state mode
    /// 
    /// In FailVisible mode, all valves must be closed.
    pub fn required_valve_state(&self) -> ValveState {
        match self.mode {
            SafeStateMode::Normal => ValveState::Unknown,
            SafeStateMode::FailVisible => ValveState::Closed,
        }
    }
    
    /// Attempt to resume normal operation
    /// 
    /// Requires manual attestation (simulated by operator_id parameter).
    /// In production, this would verify cryptographic attestation.
    /// 
    /// # Arguments
    /// * `operator_id` - Operator identifier (attestation placeholder)
    pub fn resume(&mut self, operator_id: String) -> Result<(), String> {
        if self.mode == SafeStateMode::Normal {
            return Err("Already in normal mode".to_string());
        }
        
        // In production, verify cryptographic attestation here
        // For now, we accept any non-empty operator ID
        if operator_id.is_empty() {
            return Err("Invalid operator ID".to_string());
        }
        
        self.mode = SafeStateMode::Normal;
        self.triggered_timestamp_ns = None;
        self.trigger_reason = None;
        
        Ok(())
    }
    
    /// Check if system is in safe state
    pub fn is_safe_state(&self) -> bool {
        self.mode == SafeStateMode::FailVisible
    }
}

impl Default for SafeState {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    
    #[test]
    fn test_safe_state_trigger() {
        let mut safe_state = SafeState::new();
        assert_eq!(safe_state.mode, SafeStateMode::Normal);
        
        safe_state.trigger("Heartbeat expired".to_string(), 1_000_000_000);
        
        assert_eq!(safe_state.mode, SafeStateMode::FailVisible);
        assert_eq!(safe_state.required_valve_state(), ValveState::Closed);
        assert!(safe_state.is_safe_state());
    }
    
    #[test]
    fn test_safe_state_resume() {
        let mut safe_state = SafeState::new();
        safe_state.trigger("Test trigger".to_string(), 1_000_000_000);
        
        assert!(safe_state.resume("operator123".to_string()).is_ok());
        assert_eq!(safe_state.mode, SafeStateMode::Normal);
        assert!(!safe_state.is_safe_state());
    }
}
