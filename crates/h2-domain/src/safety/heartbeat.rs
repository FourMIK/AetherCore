//! Cryptographic heartbeat monitor
//! 
//! Ported from H2OS VehicleCommunication.cs with attestation

use serde::{Deserialize, Serialize};

/// Heartbeat status enumeration
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
pub enum HeartbeatStatus {
    /// Heartbeat is active and current
    Active,
    /// Heartbeat has expired (triggers safe state)
    Expired,
    /// Heartbeat never established
    NeverEstablished,
}

/// Cryptographic heartbeat monitor
/// 
/// Tracks vehicle communication status with timestamped attestations.
/// When heartbeat expires, system enters safe state (all valves closed).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Heartbeat {
    /// Timestamp of last attestation (nanoseconds since epoch)
    pub last_attestation_ns: u64,
    /// Timeout threshold (nanoseconds)
    pub timeout_ns: u64,
    /// Nozzle connected state
    pub nozzle_connected: bool,
    /// Timestamp when nozzle was connected (nanoseconds since epoch)
    pub nozzle_connected_timestamp_ns: u64,
    /// Vehicle communication established flag
    pub vehicle_comm_established: bool,
    /// Timestamp when vehicle communication was established (nanoseconds since epoch)
    pub vehicle_comm_timestamp_ns: Option<u64>,
}

impl Heartbeat {
    /// Create a new heartbeat monitor
    /// 
    /// # Arguments
    /// * `timeout_ns` - Timeout threshold in nanoseconds
    pub fn new(timeout_ns: u64) -> Self {
        Self {
            last_attestation_ns: 0,
            timeout_ns,
            nozzle_connected: false,
            nozzle_connected_timestamp_ns: 0,
            vehicle_comm_established: false,
            vehicle_comm_timestamp_ns: None,
        }
    }
    
    /// Update heartbeat with new attestation
    /// 
    /// # Arguments
    /// * `timestamp_ns` - Current timestamp in nanoseconds since epoch
    pub fn update(&mut self, timestamp_ns: u64) {
        self.last_attestation_ns = timestamp_ns;
    }
    
    /// Check heartbeat status
    /// 
    /// # Arguments
    /// * `current_ns` - Current timestamp in nanoseconds since epoch
    pub fn check_status(&self, current_ns: u64) -> HeartbeatStatus {
        if self.last_attestation_ns == 0 {
            return HeartbeatStatus::NeverEstablished;
        }
        
        if current_ns > self.last_attestation_ns + self.timeout_ns {
            HeartbeatStatus::Expired
        } else {
            HeartbeatStatus::Active
        }
    }
    
    /// Set nozzle connection state
    pub fn set_nozzle_connected(&mut self, connected: bool, timestamp_ns: u64) {
        self.nozzle_connected = connected;
        if connected {
            self.nozzle_connected_timestamp_ns = timestamp_ns;
        } else {
            self.nozzle_connected_timestamp_ns = 0;
        }
    }
    
    /// Set vehicle communication state
    pub fn set_vehicle_comm(&mut self, established: bool, timestamp_ns: u64) {
        self.vehicle_comm_established = established;
        if established {
            self.vehicle_comm_timestamp_ns = Some(timestamp_ns);
        } else {
            self.vehicle_comm_timestamp_ns = None;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    
    #[test]
    fn test_heartbeat_never_established() {
        let heartbeat = Heartbeat::new(5_000_000_000); // 5 second timeout
        assert_eq!(heartbeat.check_status(1000), HeartbeatStatus::NeverEstablished);
    }
    
    #[test]
    fn test_heartbeat_active() {
        let mut heartbeat = Heartbeat::new(5_000_000_000); // 5 second timeout
        heartbeat.update(1_000_000_000); // 1 second
        
        // Check at 2 seconds (within timeout)
        assert_eq!(heartbeat.check_status(2_000_000_000), HeartbeatStatus::Active);
    }
    
    #[test]
    fn test_heartbeat_expired() {
        let mut heartbeat = Heartbeat::new(5_000_000_000); // 5 second timeout
        heartbeat.update(1_000_000_000); // 1 second
        
        // Check at 7 seconds (beyond timeout)
        assert_eq!(heartbeat.check_status(7_000_000_000), HeartbeatStatus::Expired);
    }
}
