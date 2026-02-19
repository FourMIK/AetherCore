//! Deterministic external transport contract for TAK bridge payloads.

use crate::{SignedTakPayload, TakMeshIntegrity, TakNodeSnapshot, TakTrustLevel};
use aethercore_unit_status::RevocationPayload;
use serde::Serialize;

/// External payload kind identifiers for downstream consumers.
#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ExternalEventKind {
    /// Node trust/integrity snapshot event.
    NodeSnapshot,
    /// Revocation event.
    Revocation,
}

/// Freshness metadata exported with external payloads.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct FreshnessMetadata {
    /// Canonical event timestamp in nanoseconds.
    pub timestamp_ns: u64,
    /// Canonical event timestamp in milliseconds.
    pub timestamp_ms: u64,
}

/// Envelope metadata exported with external payloads.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct SignatureEnvelope {
    /// Key identifier used for signature verification.
    pub key_id: String,
    /// Signature over canonicalized source payload.
    pub signature: String,
    /// Freshness metadata for replay checks.
    pub freshness: FreshnessMetadata,
}

/// External JSON contract for snapshot and revocation event transport.
#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct ExternalEventContract<T>
where
    T: Serialize,
{
    /// Schema version for compatibility management.
    pub schema_version: &'static str,
    /// Event kind.
    pub event_kind: ExternalEventKind,
    /// Signature and freshness envelope.
    pub envelope: SignatureEnvelope,
    /// Deterministic event payload.
    pub payload: T,
}

/// Deterministic payload mapping for TAK snapshot transport.
#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct ExternalSnapshotPayload {
    /// Node identifier.
    pub node_id: String,
    /// Trust score normalized to 0-100.
    pub trust_score_0_100: u8,
    /// External trust label.
    pub trust_label: &'static str,
    /// External integrity label.
    pub integrity_label: &'static str,
    /// Integrity root agreement ratio.
    pub root_agreement_ratio: f64,
    /// Signature failure count.
    pub signature_failure_count: u64,
    /// Chain break count.
    pub chain_break_count: u64,
    /// Secondary trust telemetry (0.0-1.0).
    pub telemetry_trust_score_0_1: Option<f32>,
    /// Last-seen timestamp in nanoseconds.
    pub last_seen_ns: u64,
    /// Latitude.
    pub lat: Option<f64>,
    /// Longitude.
    pub lon: Option<f64>,
    /// Altitude in meters.
    pub alt_m: Option<f32>,
}

/// Deterministic payload mapping for revocation transport.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct ExternalRevocationPayload {
    /// Revoked node identifier.
    pub node_id: String,
    /// Revocation reason as emitted by unit-status schema.
    pub revocation_reason: String,
    /// Issuer identity.
    pub issuer_id: String,
    /// Merkle root associated with revocation evidence.
    pub merkle_root: String,
}

/// Maps a signed TAK snapshot into the deterministic external contract.
pub fn snapshot_contract(
    signed: &SignedTakPayload<TakNodeSnapshot>,
) -> ExternalEventContract<ExternalSnapshotPayload> {
    ExternalEventContract {
        schema_version: "tak-bridge.external.v1",
        event_kind: ExternalEventKind::NodeSnapshot,
        envelope: SignatureEnvelope {
            key_id: signed.key_id.clone(),
            signature: signed.signature.clone(),
            freshness: FreshnessMetadata {
                timestamp_ns: signed.timestamp_ns,
                timestamp_ms: signed.timestamp_ns / 1_000_000,
            },
        },
        payload: ExternalSnapshotPayload {
            node_id: signed.payload.node_id.clone(),
            trust_score_0_100: signed.payload.trust_score_0_100,
            trust_label: map_trust_label(signed.payload.trust_level),
            integrity_label: map_integrity_label(signed.payload.mesh_integrity),
            root_agreement_ratio: signed.payload.root_agreement_ratio,
            signature_failure_count: signed.payload.signature_failure_count,
            chain_break_count: signed.payload.chain_break_count,
            telemetry_trust_score_0_1: signed.payload.telemetry_trust_score_0_1,
            last_seen_ns: signed.payload.last_seen_ns,
            lat: signed.payload.lat,
            lon: signed.payload.lon,
            alt_m: signed.payload.alt_m,
        },
    }
}

/// Maps a revocation event into the deterministic external contract.
pub fn revocation_contract(
    revocation: &RevocationPayload,
) -> ExternalEventContract<ExternalRevocationPayload> {
    ExternalEventContract {
        schema_version: "tak-bridge.external.v1",
        event_kind: ExternalEventKind::Revocation,
        envelope: SignatureEnvelope {
            key_id: revocation.issuer_id.clone(),
            signature: revocation.signature.clone(),
            freshness: FreshnessMetadata {
                timestamp_ns: revocation.timestamp_ns,
                timestamp_ms: revocation.timestamp_ns / 1_000_000,
            },
        },
        payload: ExternalRevocationPayload {
            node_id: revocation.node_id.clone(),
            revocation_reason: format!("{:?}", revocation.revocation_reason),
            issuer_id: revocation.issuer_id.clone(),
            merkle_root: revocation.merkle_root.clone(),
        },
    }
}

/// Deterministically serialize any external contract as JSON.
pub fn to_external_json<T>(event: &ExternalEventContract<T>) -> String
where
    T: Serialize,
{
    serde_json::to_string(event).expect("external event serialization should be infallible")
}

fn map_trust_label(level: TakTrustLevel) -> &'static str {
    match level {
        TakTrustLevel::Healthy => "trusted",
        TakTrustLevel::Suspect => "degraded",
        TakTrustLevel::Quarantined => "quarantined",
    }
}

fn map_integrity_label(integrity: TakMeshIntegrity) -> &'static str {
    match integrity {
        TakMeshIntegrity::Healthy => "integrity_ok",
        TakMeshIntegrity::Degraded => "integrity_degraded",
        TakMeshIntegrity::Compromised => "integrity_compromised",
        TakMeshIntegrity::Unknown => "integrity_unknown",
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::SignedTakPayload;
    use crate::{TakMeshIntegrity, TakNodeSnapshot, TakTrustLevel};
    use aethercore_unit_status::{RevocationPayload, SchemaRevocationReason};

    fn signed_fixture() -> SignedTakPayload<TakNodeSnapshot> {
        SignedTakPayload {
            key_id: "ops-key-7".into(),
            signature: "deadbeefcafebabe".into(),
            timestamp_ns: 1_700_000_000_123_456_789,
            payload: TakNodeSnapshot {
                node_id: "node-alpha".into(),
                trust_score_0_100: 93,
                trust_level: TakTrustLevel::Healthy,
                mesh_integrity: TakMeshIntegrity::Degraded,
                root_agreement_ratio: 0.875,
                chain_break_count: 2,
                signature_failure_count: 1,
                telemetry_trust_score_0_1: Some(0.91),
                telemetry_trust_score_0_100: Some(91),
                lat: Some(35.0),
                lon: Some(-120.5),
                alt_m: Some(10.0),
                last_seen_ns: 1_700_000_000_000_000_000,
            },
        }
    }

    #[test]
    fn snapshot_contract_json_matches_fixed_fixture() {
        let contract = snapshot_contract(&signed_fixture());
        let json = to_external_json(&contract);

        assert_eq!(
            json,
            r#"{"schema_version":"tak-bridge.external.v1","event_kind":"node_snapshot","envelope":{"key_id":"ops-key-7","signature":"deadbeefcafebabe","freshness":{"timestamp_ns":1700000000123456789,"timestamp_ms":1700000000123}},"payload":{"node_id":"node-alpha","trust_score_0_100":93,"trust_label":"trusted","integrity_label":"integrity_degraded","root_agreement_ratio":0.875,"signature_failure_count":1,"chain_break_count":2,"telemetry_trust_score_0_1":0.91,"last_seen_ns":1700000000000000000,"lat":35.0,"lon":-120.5,"alt_m":10.0}}"#
        );
    }

    #[test]
    fn revocation_contract_json_matches_fixed_fixture() {
        let contract = revocation_contract(&RevocationPayload {
            node_id: "node-alpha".into(),
            revocation_reason: SchemaRevocationReason::ByzantineDetection,
            issuer_id: "issuer-1".into(),
            timestamp_ns: 1_700_000_222_000_000_000,
            signature: "abbaabba".into(),
            merkle_root: "001122".into(),
        });

        let json = to_external_json(&contract);
        assert_eq!(
            json,
            r#"{"schema_version":"tak-bridge.external.v1","event_kind":"revocation","envelope":{"key_id":"issuer-1","signature":"abbaabba","freshness":{"timestamp_ns":1700000222000000000,"timestamp_ms":1700000222000}},"payload":{"node_id":"node-alpha","revocation_reason":"ByzantineDetection","issuer_id":"issuer-1","merkle_root":"001122"}}"#
        );
    }

    #[test]
    fn snapshot_contract_schema_version_is_backward_compatible() {
        let contract = snapshot_contract(&signed_fixture());
        assert_eq!(contract.schema_version, "tak-bridge.external.v1");
        assert_eq!(contract.payload.trust_label, "trusted");
        assert_eq!(contract.payload.integrity_label, "integrity_degraded");
    }
}
