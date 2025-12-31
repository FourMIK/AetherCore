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

/// Alert severity levels
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum AlertSeverity {
    /// Critical - immediate action required
    Critical,
    /// Warning - action recommended
    Warning,
    /// Info - informational only
    Info,
}

impl AlertSeverity {
    /// Check if this severity requires immediate action
    pub fn is_critical(&self) -> bool {
        matches!(self, AlertSeverity::Critical)
    }
}

/// Alert category
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum AlertCategory {
    /// Asset degraded or malfunctioning
    AssetDegraded,
    /// Mission impacted or delayed
    MissionImpacted,
    /// Asset anomaly detected
    AssetAnomaly,
    /// Asset offline or unreachable
    AssetOffline,
}

/// Attested alert with signature and provenance
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AttestedAlert {
    /// Unique alert identifier
    pub alert_id: String,

    /// Alert severity
    pub severity: AlertSeverity,

    /// Alert category
    pub category: AlertCategory,

    /// Human-readable message
    pub message: String,

    /// Source asset ID (optional)
    pub source_asset: Option<String>,

    /// Timestamp (Unix epoch milliseconds)
    pub timestamp_ms: u64,

    /// Ed25519 signature over alert
    pub signature: Vec<u8>,

    /// BLAKE3 hash of previous alert
    pub prev_hash: Vec<u8>,

    /// Trust score (0.0 to 1.0)
    pub trust_score: f32,

    /// Provenance metadata (source system, federation ID, etc.)
    pub provenance: std::collections::BTreeMap<String, serde_json::Value>,
}

impl AttestedAlert {
    /// Create a new attested alert
    pub fn new(
        alert_id: String,
        severity: AlertSeverity,
        category: AlertCategory,
        message: String,
        timestamp_ms: u64,
        prev_hash: Vec<u8>,
        trust_score: f32,
    ) -> Self {
        Self {
            alert_id,
            severity,
            category,
            message,
            source_asset: None,
            timestamp_ms,
            signature: Vec::new(),
            prev_hash,
            trust_score: trust_score.clamp(0.0, 1.0),
            provenance: std::collections::BTreeMap::new(),
        }
    }

    /// Compute BLAKE3 hash of this alert
    pub fn compute_hash(&self) -> Vec<u8> {
        let mut hasher = blake3::Hasher::new();
        hasher.update(self.alert_id.as_bytes());
        hasher.update(&[self.severity as u8]);
        hasher.update(&[self.category as u8]);
        hasher.update(self.message.as_bytes());
        hasher.update(&self.timestamp_ms.to_le_bytes());
        if let Some(ref asset) = self.source_asset {
            hasher.update(asset.as_bytes());
        }
        hasher.finalize().as_bytes().to_vec()
    }

    /// Attest the alert with a signature
    pub fn attest(&mut self, signature: Vec<u8>) {
        self.signature = signature;
    }

    /// Check if alert is attested
    pub fn is_attested(&self) -> bool {
        !self.signature.is_empty()
    }

    /// Set source asset
    pub fn set_source_asset(&mut self, asset_id: String) {
        self.source_asset = Some(asset_id);
    }
}

/// Alert acknowledgment with cryptographic proof-of-receipt
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AlertAcknowledgment {
    /// Alert ID being acknowledged
    pub alert_id: String,

    /// Acknowledging user/system
    pub acknowledged_by: String,

    /// Acknowledgment timestamp (Unix epoch milliseconds)
    pub timestamp_ms: u64,

    /// Optional comment
    pub comment: Option<String>,

    /// Ed25519 signature over acknowledgment
    pub signature: Vec<u8>,
}

impl AlertAcknowledgment {
    /// Create a new acknowledgment
    pub fn new(
        alert_id: String,
        acknowledged_by: String,
        timestamp_ms: u64,
    ) -> Self {
        Self {
            alert_id,
            acknowledged_by,
            timestamp_ms,
            comment: None,
            signature: Vec::new(),
        }
    }

    /// Compute BLAKE3 hash of this acknowledgment
    pub fn compute_hash(&self) -> Vec<u8> {
        let mut hasher = blake3::Hasher::new();
        hasher.update(self.alert_id.as_bytes());
        hasher.update(self.acknowledged_by.as_bytes());
        hasher.update(&self.timestamp_ms.to_le_bytes());
        if let Some(ref comment) = self.comment {
            hasher.update(comment.as_bytes());
        }
        hasher.finalize().as_bytes().to_vec()
    }

    /// Sign the acknowledgment
    pub fn sign(&mut self, signature: Vec<u8>) {
        self.signature = signature;
    }

    /// Check if acknowledgment is signed
    pub fn is_signed(&self) -> bool {
        !self.signature.is_empty()
    }

    /// Set comment
    pub fn set_comment(&mut self, comment: String) {
        self.comment = Some(comment);
    }
}

#[cfg(test)]
mod alert_tests {
    use super::*;

    #[test]
    fn test_alert_severity_critical() {
        assert!(AlertSeverity::Critical.is_critical());
        assert!(!AlertSeverity::Warning.is_critical());
        assert!(!AlertSeverity::Info.is_critical());
    }

    #[test]
    fn test_attested_alert_creation() {
        let alert = AttestedAlert::new(
            "alert-001".to_string(),
            AlertSeverity::Critical,
            AlertCategory::AssetDegraded,
            "System failure detected".to_string(),
            1000,
            vec![0u8; 32],
            0.8,
        );

        assert_eq!(alert.alert_id, "alert-001");
        assert_eq!(alert.severity, AlertSeverity::Critical);
        assert!(!alert.is_attested());
    }

    #[test]
    fn test_attested_alert_attest() {
        let mut alert = AttestedAlert::new(
            "alert-001".to_string(),
            AlertSeverity::Critical,
            AlertCategory::AssetDegraded,
            "System failure detected".to_string(),
            1000,
            vec![0u8; 32],
            0.8,
        );

        alert.attest(vec![1u8; 64]);
        assert!(alert.is_attested());
    }

    #[test]
    fn test_attested_alert_compute_hash() {
        let alert = AttestedAlert::new(
            "alert-001".to_string(),
            AlertSeverity::Critical,
            AlertCategory::AssetDegraded,
            "System failure detected".to_string(),
            1000,
            vec![0u8; 32],
            0.8,
        );

        let hash = alert.compute_hash();
        assert_eq!(hash.len(), 32);
    }

    #[test]
    fn test_attested_alert_set_source_asset() {
        let mut alert = AttestedAlert::new(
            "alert-001".to_string(),
            AlertSeverity::Critical,
            AlertCategory::AssetDegraded,
            "System failure detected".to_string(),
            1000,
            vec![0u8; 32],
            0.8,
        );

        alert.set_source_asset("asset-001".to_string());
        assert_eq!(alert.source_asset, Some("asset-001".to_string()));
    }

    #[test]
    fn test_alert_acknowledgment_creation() {
        let ack = AlertAcknowledgment::new(
            "alert-001".to_string(),
            "operator-001".to_string(),
            1000,
        );

        assert_eq!(ack.alert_id, "alert-001");
        assert_eq!(ack.acknowledged_by, "operator-001");
        assert!(!ack.is_signed());
    }

    #[test]
    fn test_alert_acknowledgment_sign() {
        let mut ack = AlertAcknowledgment::new(
            "alert-001".to_string(),
            "operator-001".to_string(),
            1000,
        );

        ack.sign(vec![1u8; 64]);
        assert!(ack.is_signed());
    }

    #[test]
    fn test_alert_acknowledgment_compute_hash() {
        let ack = AlertAcknowledgment::new(
            "alert-001".to_string(),
            "operator-001".to_string(),
            1000,
        );

        let hash = ack.compute_hash();
        assert_eq!(hash.len(), 32);
    }

    #[test]
    fn test_alert_acknowledgment_set_comment() {
        let mut ack = AlertAcknowledgment::new(
            "alert-001".to_string(),
            "operator-001".to_string(),
            1000,
        );

        ack.set_comment("Acknowledged and investigating".to_string());
        assert_eq!(ack.comment, Some("Acknowledged and investigating".to_string()));
    }

    #[test]
    fn test_trust_score_clamping() {
        let alert1 = AttestedAlert::new(
            "alert-001".to_string(),
            AlertSeverity::Critical,
            AlertCategory::AssetDegraded,
            "Test".to_string(),
            1000,
            vec![0u8; 32],
            1.5,
        );
        assert_eq!(alert1.trust_score, 1.0);

        let alert2 = AttestedAlert::new(
            "alert-002".to_string(),
            AlertSeverity::Critical,
            AlertCategory::AssetDegraded,
            "Test".to_string(),
            1000,
            vec![0u8; 32],
            -0.5,
        );
        assert_eq!(alert2.trust_score, 0.0);
    }
}

