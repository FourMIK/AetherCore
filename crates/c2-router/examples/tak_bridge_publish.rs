//! Example publisher that forwards tak-bridge external JSON to a downstream transport.

use aethercore_tak_bridge::{
    transport::{revocation_contract, snapshot_contract, to_external_json},
    SignedTakPayload, TakMeshIntegrity, TakNodeSnapshot, TakTrustLevel,
};
use aethercore_unit_status::{RevocationPayload, SchemaRevocationReason};

/// Minimal publisher contract for plugin/socket/gRPC integrations.
trait TakPublisher {
    fn publish(&self, topic: &str, message: &str);
}

struct StdoutPublisher;

impl TakPublisher for StdoutPublisher {
    fn publish(&self, topic: &str, message: &str) {
        println!("[{topic}] {message}");
    }
}

fn main() {
    let publisher = StdoutPublisher;

    let signed = SignedTakPayload {
        key_id: "ops-key-1".into(),
        signature: "feedface".into(),
        timestamp_ns: 1_700_000_100_000_000_000,
        payload: TakNodeSnapshot {
            node_id: "node-42".into(),
            trust_score_0_100: 88,
            trust_level: TakTrustLevel::Suspect,
            mesh_integrity: TakMeshIntegrity::Degraded,
            root_agreement_ratio: 0.82,
            chain_break_count: 1,
            signature_failure_count: 0,
            telemetry_trust_score_0_1: Some(0.86),
            telemetry_trust_score_0_100: Some(86),
            lat: Some(34.25),
            lon: Some(-117.19),
            alt_m: Some(320.0),
            last_seen_ns: 1_700_000_099_500_000_000,
        },
    };

    let snapshot_json = to_external_json(&snapshot_contract(&signed));
    publisher.publish("tak.snapshot", &snapshot_json);

    let revocation = RevocationPayload {
        node_id: "node-42".into(),
        revocation_reason: SchemaRevocationReason::ByzantineDetection,
        issuer_id: "authority-main".into(),
        timestamp_ns: 1_700_000_200_000_000_000,
        signature: "0011aabb".into(),
        merkle_root: "9f9f9f".into(),
    };

    let revocation_json = to_external_json(&revocation_contract(&revocation));
    publisher.publish("tak.revocation", &revocation_json);
}
