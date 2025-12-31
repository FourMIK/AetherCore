//! Telemetry trust scoring
//!
//! This module implements trust scoring for unit telemetry based on:
//! - Staleness (> 30s = degraded)
//! - Attestation verification
//! - Anomaly detection (future)

#![warn(missing_docs)]

use crate::types::{UnitStatus, UnitTelemetry};
use serde::{Deserialize, Serialize};

/// Trust level classification
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum TrustLevel {
    /// High trust (> 0.8)
    High,
    /// Medium trust (0.5 - 0.8)
    Medium,
    /// Low trust (0.3 - 0.5)
    Low,
    /// Degraded trust (0.1 - 0.3)
    Degraded,
    /// Spoofed/unverifiable (< 0.1)
    Spoofed,
}

impl TrustLevel {
    /// Convert trust score to trust level
    pub fn from_score(score: f32) -> Self {
        if score > 0.8 {
            TrustLevel::High
        } else if score > 0.5 {
            TrustLevel::Medium
        } else if score > 0.3 {
            TrustLevel::Low
        } else if score > 0.1 {
            TrustLevel::Degraded
        } else {
            TrustLevel::Spoofed
        }
    }
}

/// Telemetry trust scorer
#[derive(Debug)]
pub struct TelemetryTrustScorer {
    /// Stale threshold in nanoseconds (default: 30s)
    stale_threshold_ns: u64,
}

impl TelemetryTrustScorer {
    /// Default stale threshold: 30 seconds
    pub const DEFAULT_STALE_THRESHOLD_NS: u64 = 30_000_000_000;
    
    /// Create a new telemetry trust scorer
    pub fn new() -> Self {
        Self {
            stale_threshold_ns: Self::DEFAULT_STALE_THRESHOLD_NS,
        }
    }
    
    /// Create scorer with custom stale threshold
    pub fn with_stale_threshold(stale_threshold_ns: u64) -> Self {
        Self {
            stale_threshold_ns,
        }
    }
    
    /// Compute trust score for telemetry
    ///
    /// # Arguments
    /// * `telemetry` - Telemetry data to score
    /// * `current_time_ns` - Current timestamp for staleness check
    /// * `attestation_verified` - Whether attestation hash is verified
    ///
    /// # Returns
    /// Trust score (0.0 to 1.0)
    pub fn score_telemetry(
        &self,
        telemetry: &UnitTelemetry,
        current_time_ns: u64,
        attestation_verified: bool,
    ) -> f32 {
        let mut score = 1.0;
        
        // Check attestation
        if !attestation_verified {
            // Unverifiable telemetry is spoofed
            return 0.0;
        }
        
        // Check staleness
        if current_time_ns >= telemetry.timestamp_ns {
            let age_ns = current_time_ns - telemetry.timestamp_ns;
            if age_ns > self.stale_threshold_ns {
                // Degrade score based on staleness
                let staleness_factor = (age_ns as f32) / (self.stale_threshold_ns as f32);
                score *= (1.0 / staleness_factor).min(0.5); // Cap at 0.5 for stale data
            }
        }
        
        // Check connectivity
        match telemetry.connectivity {
            crate::types::ConnectivityState::Connected => {},
            crate::types::ConnectivityState::Degraded => score *= 0.8,
            crate::types::ConnectivityState::Disconnected => score *= 0.3,
            crate::types::ConnectivityState::Unknown => score *= 0.5,
        }
        
        // Check data completeness (optional fields)
        let mut completeness = 0.0;
        let mut field_count = 0;
        
        if telemetry.pressure_psi.is_some() {
            completeness += 1.0;
        }
        field_count += 1;
        
        if telemetry.temperature_c.is_some() {
            completeness += 1.0;
        }
        field_count += 1;
        
        if telemetry.battery_percent.is_some() {
            completeness += 1.0;
        }
        field_count += 1;
        
        if telemetry.gps.is_some() {
            completeness += 1.0;
        }
        field_count += 1;
        
        let completeness_factor = completeness / field_count as f32;
        score *= 0.8 + (0.2 * completeness_factor); // Completeness contributes up to 20%
        
        score.clamp(0.0, 1.0)
    }
    
    /// Compute trust score for unit status
    ///
    /// # Arguments
    /// * `status` - Unit status to score
    /// * `current_time_ns` - Current timestamp
    /// * `attestation_verified` - Whether platform attestation is verified
    ///
    /// # Returns
    /// Updated trust score (0.0 to 1.0)
    pub fn score_unit_status(
        &self,
        status: &UnitStatus,
        current_time_ns: u64,
        attestation_verified: bool,
    ) -> f32 {
        // Base score from telemetry
        let telemetry_score = self.score_telemetry(
            &status.telemetry,
            current_time_ns,
            attestation_verified,
        );
        
        // Adjust based on operational state
        let state_factor = match status.operational_state {
            crate::types::OperationalState::Ready => 1.0,
            crate::types::OperationalState::Active => 1.0,
            crate::types::OperationalState::Standby => 0.9,
            crate::types::OperationalState::Offline => 0.3,
            crate::types::OperationalState::Maintenance => 0.6,
            crate::types::OperationalState::Fault => 0.2,
        };
        
        // Adjust based on last seen staleness
        let last_seen_factor = if status.is_stale(current_time_ns) {
            0.5
        } else {
            1.0
        };
        
        let final_score = telemetry_score * state_factor * last_seen_factor;
        final_score.clamp(0.0, 1.0)
    }
    
    /// Get trust level from trust score
    pub fn get_trust_level(score: f32) -> TrustLevel {
        TrustLevel::from_score(score)
    }
}

impl Default for TelemetryTrustScorer {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::{ConnectivityState, OperationalState, PlatformType};
    use aethercore_identity::{Attestation, PlatformIdentity};
    use std::collections::HashMap;
    
    fn create_test_telemetry(timestamp_ns: u64) -> UnitTelemetry {
        UnitTelemetry {
            pressure_psi: Some(14.7),
            temperature_c: Some(20.0),
            battery_percent: Some(80),
            gps: Some(crate::types::Coordinate {
                lat: 45.0,
                lon: -122.0,
                alt: Some(100.0),
            }),
            connectivity: ConnectivityState::Connected,
            attestation_hash: [0u8; 32],
            timestamp_ns,
        }
    }
    
    #[test]
    fn test_fresh_telemetry_high_score() {
        let scorer = TelemetryTrustScorer::new();
        let telemetry = create_test_telemetry(1000);
        
        let score = scorer.score_telemetry(&telemetry, 1000, true);
        assert!(score > 0.9, "Fresh verified telemetry should have high score");
    }
    
    #[test]
    fn test_unverified_telemetry_spoofed() {
        let scorer = TelemetryTrustScorer::new();
        let telemetry = create_test_telemetry(1000);
        
        let score = scorer.score_telemetry(&telemetry, 1000, false);
        assert_eq!(score, 0.0, "Unverified telemetry should be scored as spoofed");
    }
    
    #[test]
    fn test_stale_telemetry_degraded() {
        let scorer = TelemetryTrustScorer::new();
        let telemetry = create_test_telemetry(1000);
        
        // 60 seconds later (2x stale threshold)
        let score = scorer.score_telemetry(&telemetry, 61_000_000_000, true);
        assert!(score < 0.5, "Stale telemetry should have degraded score");
    }
    
    #[test]
    fn test_trust_level_classification() {
        assert_eq!(TrustLevel::from_score(0.9), TrustLevel::High);
        assert_eq!(TrustLevel::from_score(0.6), TrustLevel::Medium);
        assert_eq!(TrustLevel::from_score(0.4), TrustLevel::Low);
        assert_eq!(TrustLevel::from_score(0.2), TrustLevel::Degraded);
        assert_eq!(TrustLevel::from_score(0.05), TrustLevel::Spoofed);
    }
    
    #[test]
    fn test_unit_status_scoring() {
        let scorer = TelemetryTrustScorer::new();
        
        let status = UnitStatus {
            platform_id: PlatformIdentity {
                id: "unit-1".to_string(),
                public_key: vec![0u8; 32],
                attestation: Attestation::None,
                created_at: 1000,
                metadata: HashMap::new(),
            },
            serial_number: "SN-001".to_string(),
            nickname: Some("Test".to_string()),
            device_type: PlatformType::FTCase,
            operational_state: OperationalState::Ready,
            trust_score: 0.0, // Will be computed
            last_seen_ns: 1000,
            telemetry: create_test_telemetry(1000),
        };
        
        let score = scorer.score_unit_status(&status, 1000, true);
        assert!(score > 0.9, "Operational unit with fresh telemetry should have high score");
    }
}
