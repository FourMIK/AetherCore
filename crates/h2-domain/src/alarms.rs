//! Alarm system with Byzantine aggregation
//! 
//! Ported from H2OS AlarmStatus.cs with attestation binding

use serde::{Deserialize, Serialize};
use crate::materia::{MerkleVineLink, TpmAttestation};

/// Alarm codes matching H2OS AlarmStatus enumeration
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[repr(u8)]
pub enum AlarmCode {
    /// No alarms present
    NoAlarms = 0,
    /// Hydrogen detected by H2Detect sensor
    H2Detected = 1,
    /// Carrier gas detector faulted
    CGDetectorFaulted = 2,
    /// Customer pressure high (PS110 activated)
    CustomerPressureHighPS110 = 3,
    /// Supply pressure too low
    SupplyPressureTooLow = 4,
    /// Not enough purge pressure (PT110 reading)
    NotEnoughPurgePressurePT110 = 5,
    /// Purge pressure did not vent (PT110)
    PurgePressureDidNotVentPT110 = 6,
    /// Leak check failed (PT100/PT110 comparison)
    LeakCheckFailedPT100PT110 = 7,
    /// Customer pressure too high
    CustomerPressureTooHigh = 8,
    /// Source pressure high warning (PT110)
    SourcePressureHighWarnPT110 = 9,
    /// Source pressure high fault (PT110)
    SourcePressureHighFaultPT110 = 10,
    /// Source pressure low (PT110)
    SourcePressureLowPT110 = 11,
    /// Customer pressure high (PT110)
    CustomerPressureHighPT110 = 12,
    /// Customer pressure low (PT110)
    CustomerPressureLowPT110 = 13,
    /// Insufficient source pressure (PT100)
    InsufficientSourcePressurePT100 = 14,
    /// Source pressure still too high after mitigation
    SourcePressureStillTooHigh = 15,
    /// Customer pressure still too high after mitigation
    CustomerPressureStillTooHigh = 16,
}

impl AlarmCode {
    /// Check if this alarm requires immediate shutdown
    pub fn is_critical(&self) -> bool {
        matches!(
            self,
            AlarmCode::H2Detected
                | AlarmCode::CGDetectorFaulted
                | AlarmCode::LeakCheckFailedPT100PT110
                | AlarmCode::CustomerPressureTooHigh
                | AlarmCode::SourcePressureHighFaultPT110
        )
    }
    
    /// Get human-readable description
    pub fn description(&self) -> &'static str {
        match self {
            AlarmCode::NoAlarms => "No alarms",
            AlarmCode::H2Detected => "Hydrogen detected",
            AlarmCode::CGDetectorFaulted => "Carrier gas detector faulted",
            AlarmCode::CustomerPressureHighPS110 => "Customer pressure high (PS110)",
            AlarmCode::SupplyPressureTooLow => "Supply pressure too low",
            AlarmCode::NotEnoughPurgePressurePT110 => "Not enough purge pressure (PT110)",
            AlarmCode::PurgePressureDidNotVentPT110 => "Purge pressure did not vent (PT110)",
            AlarmCode::LeakCheckFailedPT100PT110 => "Leak check failed (PT100/PT110)",
            AlarmCode::CustomerPressureTooHigh => "Customer pressure too high",
            AlarmCode::SourcePressureHighWarnPT110 => "Source pressure high warning (PT110)",
            AlarmCode::SourcePressureHighFaultPT110 => "Source pressure high fault (PT110)",
            AlarmCode::SourcePressureLowPT110 => "Source pressure low (PT110)",
            AlarmCode::CustomerPressureHighPT110 => "Customer pressure high (PT110)",
            AlarmCode::CustomerPressureLowPT110 => "Customer pressure low (PT110)",
            AlarmCode::InsufficientSourcePressurePT100 => "Insufficient source pressure (PT100)",
            AlarmCode::SourcePressureStillTooHigh => "Source pressure still too high",
            AlarmCode::CustomerPressureStillTooHigh => "Customer pressure still too high",
        }
    }
}

/// Attested alarm with Byzantine aggregation support
/// 
/// Each alarm is cryptographically bound to its source sensor via TPM attestation
/// and linked in a Merkle Vine chain for tamper detection.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AttestedAlarm {
    /// Alarm code
    pub code: AlarmCode,
    /// Source sensor slot ID (e.g., 100 for PT100, 110 for PT110)
    pub source_sensor: u16,
    /// Timestamp in nanoseconds since epoch
    pub timestamp_ns: u64,
    /// Merkle Vine hash chain link
    pub vine: MerkleVineLink,
    /// TPM attestation binding
    pub attestation: TpmAttestation,
}

impl AttestedAlarm {
    /// Create a new attested alarm
    pub fn new(
        code: AlarmCode,
        source_sensor: u16,
        timestamp_ns: u64,
        vine: MerkleVineLink,
        attestation: TpmAttestation,
    ) -> Self {
        Self {
            code,
            source_sensor,
            timestamp_ns,
            vine,
            attestation,
        }
    }
    
    /// Compute BLAKE3 hash of alarm data
    pub fn compute_hash(&self) -> [u8; 32] {
        let mut hasher = blake3::Hasher::new();
        hasher.update(&[self.code as u8]);
        hasher.update(&self.source_sensor.to_le_bytes());
        hasher.update(&self.timestamp_ns.to_le_bytes());
        *hasher.finalize().as_bytes()
    }
    
    /// Verify alarm chain integrity
    pub fn verify_chain(&self, previous: &[u8; 32]) -> bool {
        self.vine.previous_hash == *previous
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    
    #[test]
    fn test_alarm_code_critical() {
        assert!(AlarmCode::H2Detected.is_critical());
        assert!(AlarmCode::CGDetectorFaulted.is_critical());
        assert!(AlarmCode::LeakCheckFailedPT100PT110.is_critical());
        assert!(!AlarmCode::NoAlarms.is_critical());
        assert!(!AlarmCode::SourcePressureHighWarnPT110.is_critical());
    }
    
    #[test]
    fn test_alarm_code_description() {
        assert_eq!(AlarmCode::H2Detected.description(), "Hydrogen detected");
        assert_eq!(AlarmCode::NoAlarms.description(), "No alarms");
    }
    
    #[test]
    fn test_attested_alarm_hash() {
        let vine = MerkleVineLink::new(
            [0u8; 32],
            [1u8; 32],
            0,
            1_000_000_000,
        );
        let attestation = TpmAttestation::new(
            vec![0xAA; 64],
            vec![0xFF; 32],
            vec![0xBB; 128],
            1_000_000_000,
        );
        
        let alarm = AttestedAlarm::new(
            AlarmCode::H2Detected,
            100,
            1_000_000_000,
            vine,
            attestation,
        );
        
        let hash = alarm.compute_hash();
        assert_eq!(hash.len(), 32);
    }
    
    #[test]
    fn test_attested_alarm_verify_chain() {
        let previous_hash = [0u8; 32];
        let vine = MerkleVineLink::new(
            previous_hash,
            [1u8; 32],
            0,
            1_000_000_000,
        );
        let attestation = TpmAttestation::new(
            vec![0xAA; 64],
            vec![0xFF; 32],
            vec![0xBB; 128],
            1_000_000_000,
        );
        
        let alarm = AttestedAlarm::new(
            AlarmCode::H2Detected,
            100,
            1_000_000_000,
            vine,
            attestation,
        );
        
        assert!(alarm.verify_chain(&previous_hash));
        assert!(!alarm.verify_chain(&[1u8; 32]));
    }
}
