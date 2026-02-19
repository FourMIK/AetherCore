//! TAK bridge snapshot models.

#![warn(missing_docs)]

use aethercore_trust_mesh::{
    HealthThresholds, NodeHealth, NodeHealthStatus, TrustLevel, TrustScore,
};
use aethercore_unit_status::UnitStatus;
use serde::{Deserialize, Serialize};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

/// TAK-oriented view of node trust and integrity state.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct TakNodeSnapshot {
    /// Mesh node identifier.
    pub node_id: String,
    /// Primary mesh-integrity trust score from `aethercore_trust_mesh::TrustScore`, normalized to 0-100.
    pub trust_score_0_100: u8,
    /// Trust level preserving trust mesh semantics.
    pub trust_level: TakTrustLevel,
    /// Health status mapped for TAK output.
    pub mesh_integrity: TakMeshIntegrity,
    /// Ratio of roots matching majority (0.0 to 1.0).
    pub root_agreement_ratio: f64,
    /// Total chain breaks observed for the node.
    pub chain_break_count: u64,
    /// Total signature failures observed for the node.
    pub signature_failure_count: u64,
    /// Optional secondary telemetry-reported trust score in 0.0-1.0 scale.
    pub telemetry_trust_score_0_1: Option<f32>,
    /// Optional secondary telemetry-reported trust score in 0-100 scale.
    pub telemetry_trust_score_0_100: Option<u8>,
    /// Optional latitude.
    pub lat: Option<f64>,
    /// Optional longitude.
    pub lon: Option<f64>,
    /// Optional altitude in meters.
    pub alt_m: Option<f32>,
    /// Last-seen timestamp in nanoseconds.
    pub last_seen_ns: u64,
}

/// Stable trust level labels for TAK serialization.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum TakTrustLevel {
    /// Healthy/fully trusted state.
    Healthy,
    /// Suspect/degraded but still above quarantine threshold.
    Suspect,
    /// Quarantined/low trust state.
    Quarantined,
}

/// Stable integrity labels for TAK serialization.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum TakMeshIntegrity {
    /// Integrity metrics indicate healthy state.
    Healthy,
    /// Integrity metrics indicate degraded state.
    Degraded,
    /// Integrity metrics indicate compromised state.
    Compromised,
    /// Integrity metrics are unavailable or stale; TAK consumers should apply zero-trust defaults.
    Unknown,
}

/// Build a TAK snapshot from trust mesh and unit-status models.
///
/// Primary trust fields (`trust_score_0_100`, `trust_level`) always derive from
/// `crates/trust_mesh/src/trust.rs` via [`TrustScore`].
/// Unit-status trust is retained only as optional telemetry metadata.
///
/// If node health metrics are stale, `mesh_integrity` is exported as `UNKNOWN` to preserve
/// trust-mesh zero-trust fallback semantics for downstream TAK consumers.
pub fn snapshot_from(
    trust: &TrustScore,
    health: &NodeHealth,
    unit: &UnitStatus,
) -> TakNodeSnapshot {
    let gps = unit.telemetry.gps.as_ref();

    TakNodeSnapshot {
        node_id: trust.node_id.clone(),
        trust_score_0_100: scale_trust_score_0_100(trust.score),
        trust_level: map_trust_level(trust.level),
        mesh_integrity: map_mesh_integrity(effective_node_health_status(health)),
        root_agreement_ratio: health.metrics.root_agreement_ratio,
        chain_break_count: health.metrics.chain_break_count,
        signature_failure_count: health.metrics.signature_failure_count,
        telemetry_trust_score_0_1: Some(unit.trust_score),
        telemetry_trust_score_0_100: Some(scale_trust_score_0_100(unit.trust_score as f64)),
        lat: gps.map(|c| c.lat),
        lon: gps.map(|c| c.lon),
        alt_m: gps.and_then(|c| c.alt),
        last_seen_ns: unit.last_seen_ns,
    }
}

fn scale_trust_score_0_100(score_0_1: f64) -> u8 {
    (score_0_1.clamp(0.0, 1.0) * 100.0).round() as u8
}

fn map_trust_level(level: TrustLevel) -> TakTrustLevel {
    match level {
        TrustLevel::Healthy => TakTrustLevel::Healthy,
        TrustLevel::Suspect => TakTrustLevel::Suspect,
        TrustLevel::Quarantined => TakTrustLevel::Quarantined,
    }
}

fn map_mesh_integrity(status: aethercore_trust_mesh::NodeHealthStatus) -> TakMeshIntegrity {
    match status {
        aethercore_trust_mesh::NodeHealthStatus::HEALTHY => TakMeshIntegrity::Healthy,
        aethercore_trust_mesh::NodeHealthStatus::DEGRADED => TakMeshIntegrity::Degraded,
        aethercore_trust_mesh::NodeHealthStatus::COMPROMISED => TakMeshIntegrity::Compromised,
        aethercore_trust_mesh::NodeHealthStatus::UNKNOWN => TakMeshIntegrity::Unknown,
    }
}

fn effective_node_health_status(health: &NodeHealth) -> NodeHealthStatus {
    let now_ms = current_timestamp_ms();
    let age_ms = now_ms.saturating_sub(health.metrics.last_updated);
    if age_ms > HealthThresholds::default().staleness_ttl_ms {
        return NodeHealthStatus::UNKNOWN;
    }

    health.status
}

fn current_timestamp_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or(Duration::ZERO)
        .as_millis() as u64
}

#[cfg(test)]
mod tests {
    use super::*;
    use aethercore_trust_mesh::{IntegrityMetrics, NodeHealth, NodeHealthStatus, TrustScore};
    use aethercore_unit_status::{
        ConnectivityState, Coordinate, OperationalState, PlatformType, UnitStatus, UnitTelemetry,
    };
    use std::collections::HashMap;

    fn test_unit(gps: Option<Coordinate>) -> UnitStatus {
        UnitStatus {
            platform_id: aethercore_identity::PlatformIdentity {
                id: "node-1".into(),
                public_key: vec![0; 32],
                attestation: aethercore_identity::Attestation::None,
                created_at: 1,
                metadata: HashMap::new(),
            },
            serial_number: "SN-1".into(),
            nickname: None,
            device_type: PlatformType::Mobile,
            operational_state: OperationalState::Ready,
            trust_score: 0.8,
            last_seen_ns: 123,
            telemetry: UnitTelemetry {
                pressure_psi: None,
                temperature_c: None,
                battery_percent: None,
                gps,
                connectivity: ConnectivityState::Connected,
                attestation_hash: [0; 32],
                timestamp_ns: 123,
            },
        }
    }

    fn test_trust(score: f64) -> TrustScore {
        TrustScore {
            node_id: "node-1".into(),
            score,
            level: TrustLevel::Suspect,
            last_updated: 1,
        }
    }

    fn test_health(status: NodeHealthStatus, last_updated: u64) -> NodeHealth {
        NodeHealth {
            node_id: "node-1".into(),
            timestamp: 1,
            status,
            metrics: IntegrityMetrics {
                root_agreement_ratio: 0.84,
                root_drift_count: 1,
                chain_break_count: 2,
                signature_failure_count: 3,
                missing_window_count: 0,
                last_updated,
            },
        }
    }

    #[test]
    fn score_scaling_uses_clamp_and_round() {
        assert_eq!(scale_trust_score_0_100(-0.1), 0);
        assert_eq!(scale_trust_score_0_100(0.0), 0);
        assert_eq!(scale_trust_score_0_100(0.555), 56);
        assert_eq!(scale_trust_score_0_100(0.999), 100);
        assert_eq!(scale_trust_score_0_100(1.2), 100);
    }

    #[test]
    fn snapshot_handles_empty_gps() {
        let snapshot = snapshot_from(
            &test_trust(0.73),
            &test_health(NodeHealthStatus::DEGRADED, current_timestamp_ms()),
            &test_unit(None),
        );
        assert_eq!(snapshot.lat, None);
        assert_eq!(snapshot.lon, None);
        assert_eq!(snapshot.alt_m, None);
    }

    #[test]
    fn snapshot_serialization_has_stable_fields() {
        let snapshot = snapshot_from(
            &test_trust(0.555),
            &test_health(NodeHealthStatus::DEGRADED, current_timestamp_ms()),
            &test_unit(Some(Coordinate {
                lat: 10.0,
                lon: 20.0,
                alt: Some(30.0),
            })),
        );

        let json = serde_json::to_string(&snapshot).unwrap();
        assert_eq!(
            json,
            r#"{"node_id":"node-1","trust_score_0_100":56,"trust_level":"SUSPECT","mesh_integrity":"DEGRADED","root_agreement_ratio":0.84,"chain_break_count":2,"signature_failure_count":3,"telemetry_trust_score_0_1":0.8,"telemetry_trust_score_0_100":80,"lat":10.0,"lon":20.0,"alt_m":30.0,"last_seen_ns":123}"#
        );
    }

    #[test]
    fn snapshot_primary_trust_uses_mesh_trust_not_telemetry_trust() {
        let mut unit = test_unit(None);
        unit.trust_score = 0.99;

        let snapshot = snapshot_from(
            &test_trust(0.22),
            &test_health(NodeHealthStatus::DEGRADED, current_timestamp_ms()),
            &unit,
        );

        assert_eq!(snapshot.trust_score_0_100, 22);
        assert_eq!(snapshot.telemetry_trust_score_0_1, Some(0.99));
        assert_eq!(snapshot.telemetry_trust_score_0_100, Some(99));
    }

    #[test]
    fn mesh_integrity_maps_all_node_health_variants() {
        let last_updated = current_timestamp_ms();
        let unit = test_unit(None);
        let trust = test_trust(0.5);

        let healthy = snapshot_from(
            &trust,
            &test_health(NodeHealthStatus::HEALTHY, last_updated),
            &unit,
        );
        let degraded = snapshot_from(
            &trust,
            &test_health(NodeHealthStatus::DEGRADED, last_updated),
            &unit,
        );
        let compromised = snapshot_from(
            &trust,
            &test_health(NodeHealthStatus::COMPROMISED, last_updated),
            &unit,
        );
        let unknown = snapshot_from(
            &trust,
            &test_health(NodeHealthStatus::UNKNOWN, last_updated),
            &unit,
        );

        assert_eq!(healthy.mesh_integrity, TakMeshIntegrity::Healthy);
        assert_eq!(degraded.mesh_integrity, TakMeshIntegrity::Degraded);
        assert_eq!(compromised.mesh_integrity, TakMeshIntegrity::Compromised);
        assert_eq!(unknown.mesh_integrity, TakMeshIntegrity::Unknown);
    }

    #[test]
    fn mesh_integrity_becomes_unknown_when_health_is_stale() {
        let ttl_ms = HealthThresholds::default().staleness_ttl_ms;
        let stale_last_updated = current_timestamp_ms().saturating_sub(ttl_ms + 1);
        let snapshot = snapshot_from(
            &test_trust(0.5),
            &test_health(NodeHealthStatus::HEALTHY, stale_last_updated),
            &test_unit(None),
        );

        assert_eq!(snapshot.mesh_integrity, TakMeshIntegrity::Unknown);
    }
}
