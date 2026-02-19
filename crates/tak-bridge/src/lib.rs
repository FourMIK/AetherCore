//! TAK bridge snapshot models.

#![warn(missing_docs)]

use aethercore_trust_mesh::{
    HealthThresholds, NodeHealth, NodeHealthStatus, TrustLevel, TrustScore,
};
use aethercore_unit_status::{
    HealthMetrics, MeshEvent, MeshHealthPayload, RevocationPayload, UnitStatus,
};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

/// Signing interface for TAK bridge payloads.
pub trait PayloadSigner {
    /// Signs canonicalized payload bytes and returns an encoded signature.
    fn sign(&self, payload: &[u8]) -> String;

    /// Verifies canonicalized payload bytes against an encoded signature.
    fn verify(&self, payload: &[u8], signature: &str) -> bool;
}

/// Signed envelope for TAK-exported payloads.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct SignedTakPayload<T> {
    /// Key identifier used by receivers to resolve signer public key material.
    pub key_id: String,
    /// Signature over the canonicalized payload content.
    pub signature: String,
    /// Canonical timestamp included in signature input and freshness checks.
    pub timestamp_ns: u64,
    /// Original payload.
    pub payload: T,
}

/// Errors returned by freshness validation.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum FreshnessError {
    /// Payload timestamp is outside the configured freshness window.
    Stale,
    /// Same payload digest was seen before inside the freshness window.
    Replay,
}

/// Stateful freshness validator based on timestamp window + replay cache.
#[derive(Debug)]
pub struct FreshnessValidator {
    window_ns: u64,
    seen: HashMap<Vec<u8>, u64>,
}

impl FreshnessValidator {
    /// Creates validator with accepted age window.
    pub fn new(window: Duration) -> Self {
        Self {
            window_ns: u64::try_from(window.as_nanos()).unwrap_or(u64::MAX),
            seen: HashMap::new(),
        }
    }

    /// Validates timestamp freshness and rejects replayed payload digests.
    pub fn validate_and_record(
        &mut self,
        payload_digest: Vec<u8>,
        timestamp_ns: u64,
        now_ns: u64,
    ) -> Result<(), FreshnessError> {
        let cutoff = now_ns.saturating_sub(self.window_ns);
        if timestamp_ns < cutoff || timestamp_ns > now_ns.saturating_add(self.window_ns) {
            return Err(FreshnessError::Stale);
        }

        self.seen.retain(|_, seen_ts| *seen_ts >= cutoff);
        if self.seen.contains_key(&payload_digest) {
            return Err(FreshnessError::Replay);
        }

        self.seen.insert(payload_digest, timestamp_ns);
        Ok(())
    }
}

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

impl TakTrustLevel {
    fn as_canonical_str(self) -> &'static str {
        match self {
            TakTrustLevel::Healthy => "HEALTHY",
            TakTrustLevel::Suspect => "SUSPECT",
            TakTrustLevel::Quarantined => "QUARANTINED",
        }
    }
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

impl TakMeshIntegrity {
    fn as_canonical_str(self) -> &'static str {
        match self {
            TakMeshIntegrity::Healthy => "HEALTHY",
            TakMeshIntegrity::Degraded => "DEGRADED",
            TakMeshIntegrity::Compromised => "COMPROMISED",
            TakMeshIntegrity::Unknown => "UNKNOWN",
        }
    }
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

/// Build a TAK bridge mesh health event aligned with websocket payload semantics.
pub fn mesh_health_event_from(
    trust: &TrustScore,
    health: &NodeHealth,
    unit: &UnitStatus,
) -> MeshEvent {
    MeshEvent::MeshHealth(MeshHealthPayload {
        node_id: trust.node_id.clone(),
        status: format!("{:?}", effective_node_health_status(health)),
        trust_score: unit.trust_score,
        last_seen_ns: unit.last_seen_ns,
        metrics: HealthMetrics {
            root_agreement_ratio: health.metrics.root_agreement_ratio,
            chain_break_count: health.metrics.chain_break_count,
            signature_failure_count: health.metrics.signature_failure_count,
        },
    })
}

/// Build a TAK bridge revocation event aligned with websocket payload semantics.
pub fn revocation_event_from(payload: RevocationPayload) -> MeshEvent {
    MeshEvent::Revocation(payload)
}

/// Canonicalizes snapshot signing input using strict field order.
///
/// Canonicalization rules:
/// 1. Field order is fixed and must be exactly:
///    `node_id,trust_score_0_100,trust_level,mesh_integrity,root_agreement_ratio_bits,`
///    `chain_break_count,signature_failure_count,telemetry_trust_score_0_1_bits,`
///    `telemetry_trust_score_0_100,lat_bits,lon_bits,alt_m_bits,last_seen_ns,timestamp_ns,key_id`.
/// 2. `timestamp_ns` is treated as an unsigned integer in nanoseconds and serialized
///    as a base-10 integer string with no rounding or unit conversion.
/// 3. Floating-point fields are canonicalized using raw IEEE-754 bit patterns so precision
///    is preserved and formatting drift cannot invalidate signatures.
pub fn canonicalize_snapshot_input(
    snapshot: &TakNodeSnapshot,
    timestamp_ns: u64,
    key_id: &str,
) -> Vec<u8> {
    format!(
        concat!(
            "node_id={};trust_score_0_100={};trust_level={};mesh_integrity={};",
            "root_agreement_ratio_bits={};chain_break_count={};signature_failure_count={};",
            "telemetry_trust_score_0_1_bits={};telemetry_trust_score_0_100={};",
            "lat_bits={};lon_bits={};alt_m_bits={};",
            "last_seen_ns={};timestamp_ns={};key_id={}",
        ),
        snapshot.node_id,
        snapshot.trust_score_0_100,
        snapshot.trust_level.as_canonical_str(),
        snapshot.mesh_integrity.as_canonical_str(),
        snapshot.root_agreement_ratio.to_bits(),
        snapshot.chain_break_count,
        snapshot.signature_failure_count,
        snapshot
            .telemetry_trust_score_0_1
            .map(f32::to_bits)
            .map_or_else(|| "null".to_owned(), |v| v.to_string()),
        snapshot
            .telemetry_trust_score_0_100
            .map_or_else(|| "null".to_owned(), |v| v.to_string()),
        snapshot
            .lat
            .map(f64::to_bits)
            .map_or_else(|| "null".to_owned(), |v| v.to_string()),
        snapshot
            .lon
            .map(f64::to_bits)
            .map_or_else(|| "null".to_owned(), |v| v.to_string()),
        snapshot
            .alt_m
            .map(f32::to_bits)
            .map_or_else(|| "null".to_owned(), |v| v.to_string()),
        snapshot.last_seen_ns,
        timestamp_ns,
        key_id,
    )
    .into_bytes()
}

/// Builds signed TAK snapshot payload with `key_id` and `signature` fields.
pub fn signed_snapshot_from(
    trust: &TrustScore,
    health: &NodeHealth,
    unit: &UnitStatus,
    signer: &dyn PayloadSigner,
    key_id: impl Into<String>,
    timestamp_ns: u64,
) -> SignedTakPayload<TakNodeSnapshot> {
    let payload = snapshot_from(trust, health, unit);
    let key_id = key_id.into();
    let canonical = canonicalize_snapshot_input(&payload, timestamp_ns, &key_id);
    let signature = signer.sign(&canonical);

    SignedTakPayload {
        key_id,
        signature,
        timestamp_ns,
        payload,
    }
}

/// Verifies signed snapshot using canonicalized payload bytes.
pub fn verify_signed_snapshot(
    signed: &SignedTakPayload<TakNodeSnapshot>,
    signer: &dyn PayloadSigner,
) -> bool {
    let canonical =
        canonicalize_snapshot_input(&signed.payload, signed.timestamp_ns, &signed.key_id);
    signer.verify(&canonical, &signed.signature)
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
        ConnectivityState, Coordinate, OperationalState, PlatformType, SchemaRevocationReason,
        UnitStatus, UnitTelemetry,
    };
    use std::collections::HashMap;

    struct Blake3Signer;

    impl PayloadSigner for Blake3Signer {
        fn sign(&self, payload: &[u8]) -> String {
            blake3::hash(payload).to_hex().to_string()
        }

        fn verify(&self, payload: &[u8], signature: &str) -> bool {
            self.sign(payload) == signature
        }
    }

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

    #[test]
    fn mesh_health_event_serializes_to_expected_fixture_shape() {
        let event = mesh_health_event_from(
            &test_trust(0.73),
            &test_health(NodeHealthStatus::DEGRADED, current_timestamp_ms()),
            &test_unit(None),
        );

        let json = serde_json::to_value(&event).unwrap();
        assert_eq!(json["type"], "mesh_health");
        assert_eq!(json["node_id"], "node-1");
        assert_eq!(json["status"], "DEGRADED");
        assert_eq!(json["last_seen_ns"], 123);
        assert_eq!(json["metrics"]["root_agreement_ratio"], 0.84);
        assert_eq!(json["metrics"]["chain_break_count"], 2);
        assert_eq!(json["metrics"]["signature_failure_count"], 3);

        let trust_score = json["trust_score"].as_f64().unwrap();
        assert!((trust_score - 0.8).abs() < 1e-5);
    }

    #[test]
    fn revocation_event_serializes_to_expected_fixture_shape() {
        let event = revocation_event_from(RevocationPayload {
            node_id: "node-1".into(),
            revocation_reason: SchemaRevocationReason::ByzantineDetection,
            issuer_id: "authority-1".into(),
            timestamp_ns: 1700000000000000000,
            signature: "deadbeef".into(),
            merkle_root: "beadfeed".into(),
        });

        let json = serde_json::to_value(&event).unwrap();
        let expected = serde_json::json!({
            "type": "revocation",
            "node_id": "node-1",
            "revocation_reason": "ByzantineDetection",
            "issuer_id": "authority-1",
            "timestamp_ns": 1700000000000000000u64,
            "signature": "deadbeef",
            "merkle_root": "beadfeed"
        });

        assert_eq!(json, expected);
    }

    #[test]
    fn canonicalization_uses_stable_field_order_and_timestamp_decimal_encoding() {
        let snapshot = snapshot_from(
            &test_trust(0.555),
            &test_health(NodeHealthStatus::DEGRADED, current_timestamp_ms()),
            &test_unit(None),
        );

        let canonical = String::from_utf8(canonicalize_snapshot_input(
            &snapshot,
            1700000000000000123,
            "key-a",
        ))
        .unwrap();

        assert!(canonical.starts_with(
            "node_id=node-1;trust_score_0_100=56;trust_level=SUSPECT;mesh_integrity=DEGRADED;"
        ));
        assert!(canonical.contains("root_agreement_ratio_bits=4605741266919258849;"));
        assert!(
            canonical.contains("last_seen_ns=123;timestamp_ns=1700000000000000123;key_id=key-a")
        );
    }

    #[test]
    fn signed_payload_includes_signature_and_key_id_fields() {
        let signed = signed_snapshot_from(
            &test_trust(0.8),
            &test_health(NodeHealthStatus::HEALTHY, current_timestamp_ms()),
            &test_unit(None),
            &Blake3Signer,
            "ops-key-1",
            1700000000000000000,
        );

        let json = serde_json::to_value(&signed).unwrap();
        assert_eq!(json["key_id"], "ops-key-1");
        assert!(json["signature"].as_str().unwrap().len() > 10);
        assert_eq!(json["timestamp_ns"], 1700000000000000000u64);
        assert_eq!(json["payload"]["node_id"], "node-1");
    }

    #[test]
    fn tampered_field_is_rejected_by_signature_verification() {
        let signer = Blake3Signer;
        let signed = signed_snapshot_from(
            &test_trust(0.8),
            &test_health(NodeHealthStatus::HEALTHY, current_timestamp_ms()),
            &test_unit(None),
            &signer,
            "ops-key-1",
            1700000000000000000,
        );

        assert!(verify_signed_snapshot(&signed, &signer));

        let mut tampered = signed.payload.clone();
        tampered.chain_break_count += 1;
        let canonical = canonicalize_snapshot_input(&tampered, signed.timestamp_ns, &signed.key_id);

        assert!(!signer.verify(&canonical, &signed.signature));
    }

    #[test]
    fn stale_payload_is_rejected_by_freshness_validator() {
        let mut validator = FreshnessValidator::new(Duration::from_secs(60));
        let digest = blake3::hash(b"payload").as_bytes().to_vec();
        let now = 1_700_000_000_000_000_000u64;
        let stale_ts = now - 120_000_000_000;

        let result = validator.validate_and_record(digest, stale_ts, now);
        assert_eq!(result, Err(FreshnessError::Stale));
    }

    #[test]
    fn replayed_payload_is_rejected_by_freshness_validator() {
        let mut validator = FreshnessValidator::new(Duration::from_secs(60));
        let digest = blake3::hash(b"payload").as_bytes().to_vec();
        let now = 1_700_000_000_000_000_000u64;
        let ts = now - 1_000_000_000;

        assert_eq!(
            validator.validate_and_record(digest.clone(), ts, now),
            Ok(())
        );
        assert_eq!(
            validator.validate_and_record(digest, ts + 1, now),
            Err(FreshnessError::Replay)
        );
    }
}
