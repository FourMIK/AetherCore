//! CoT XML adapter for ATAK trust overlay integration.
//!
//! Converts `tak-bridge.external.v1` JSON events into `a-f-AETHERCORE-TRUST` CoT XML
//! format required by ATAK-Civ trust overlay plugin.
//!
//! # Fail-Visible Doctrine
//!
//! This adapter enforces cryptographic verification semantics:
//! - Missing signature fields result in explicit rejection
//! - Stale timestamps (>300s) result in explicit rejection
//! - All conversions are deterministic and idempotent

use crate::transport::{ExternalEventContract, ExternalSnapshotPayload};
use std::time::{SystemTime, UNIX_EPOCH};

const DEFAULT_TTL_SECONDS: u64 = 300;
const POINT_CE: f64 = 20.0;
const POINT_LE: f64 = 20.0;
const COT_VERSION: &str = "2.0";
const COT_HOW: &str = "m-g"; // machine-generated

/// CoT XML output for ATAK trust events.
#[derive(Debug, Clone, PartialEq)]
pub struct CotTrustEvent {
    /// Complete CoT XML document
    pub xml: String,
}

/// Errors that can occur during CoT adaptation.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum CotAdapterError {
    /// Timestamp is beyond acceptable staleness threshold
    #[error("Event timestamp is stale (age > {threshold_s}s)")]
    StaleTimestamp {
        /// Staleness threshold in seconds
        threshold_s: u64
    },
    
    /// Required signature fields are missing
    #[error("Missing required signature fields in envelope")]
    MissingSignature,
    
    /// Invalid trust label mapping
    #[error("Unknown trust label: {label}")]
    UnknownTrustLabel {
        /// The unrecognized trust label
        label: String
    },
}

/// Converts a signed snapshot event to CoT XML.
///
/// # Verification Requirements
///
/// This function does NOT verify the signature - that must be done by the caller
/// using `crate::verify_signed_snapshot()`. This adapter only performs format
/// conversion after verification has occurred.
///
/// # Staleness Check
///
/// Events with timestamps older than `DEFAULT_TTL_SECONDS` are rejected with
/// `CotAdapterError::StaleTimestamp`.
pub fn snapshot_to_cot(
    contract: &ExternalEventContract<ExternalSnapshotPayload>,
) -> Result<CotTrustEvent, CotAdapterError> {
    // Verify signature fields are present
    if contract.envelope.signature.is_empty() || contract.envelope.key_id.is_empty() {
        return Err(CotAdapterError::MissingSignature);
    }

    // Check freshness
    let now_ns = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos() as u64;
    
    let age_ns = now_ns.saturating_sub(contract.envelope.freshness.timestamp_ns);
    let age_s = age_ns / 1_000_000_000;
    
    if age_s > DEFAULT_TTL_SECONDS {
        return Err(CotAdapterError::StaleTimestamp {
            threshold_s: DEFAULT_TTL_SECONDS,
        });
    }

    // Convert timestamps
    let time_iso = millis_to_iso8601(contract.envelope.freshness.timestamp_ms);
    let stale_iso = millis_to_iso8601(
        contract.envelope.freshness.timestamp_ms + (DEFAULT_TTL_SECONDS * 1000),
    );

    // Map trust label to CoT trust level
    let trust_level = map_trust_label_to_cot(&contract.payload.trust_label)?;

    // Normalize trust score to 0.0-1.0
    let trust_score_0_1 = (contract.payload.trust_score_0_100 as f64) / 100.0;

    // Map integrity metrics (inverted packet loss semantic)
    let integrity_packet_loss = 1.0 - contract.payload.root_agreement_ratio;

    // Build CoT XML
    let xml = format!(
        r#"<event version="{version}" uid="{uid}" type="a-f-AETHERCORE-TRUST" how="{how}" time="{time}" start="{start}" stale="{stale}">
  <point lat="{lat}" lon="{lon}" hae="{hae}" ce="{ce}" le="{le}"/>
  <detail>
    <trust trust_score="{trust_score}" last_updated="{last_updated}" trust_level="{trust_level}" signer_node_id="{signer_node_id}" signature_hex="{signature_hex}" integrity_packet_loss="{integrity_packet_loss}" integrity_signature_fail_count="{signature_fail_count}" integrity_chain_break_count="{chain_break_count}"/>
  </detail>
</event>"#,
        version = COT_VERSION,
        uid = escape_xml(&contract.payload.node_id),
        how = COT_HOW,
        time = time_iso,
        start = time_iso,
        stale = stale_iso,
        lat = contract.payload.lat.unwrap_or(0.0),
        lon = contract.payload.lon.unwrap_or(0.0),
        hae = contract.payload.alt_m.unwrap_or(0.0),
        ce = POINT_CE,
        le = POINT_LE,
        trust_score = format_trust_score(trust_score_0_1),
        last_updated = time_iso,
        trust_level = trust_level,
        signer_node_id = escape_xml(&contract.envelope.key_id),
        signature_hex = escape_xml(&contract.envelope.signature),
        integrity_packet_loss = format_trust_score(integrity_packet_loss),
        signature_fail_count = contract.payload.signature_failure_count,
        chain_break_count = contract.payload.chain_break_count,
    );

    Ok(CotTrustEvent { xml })
}

fn map_trust_label_to_cot(label: &str) -> Result<&'static str, CotAdapterError> {
    match label {
        "trusted" => Ok("healthy"),
        "degraded" => Ok("suspect"),
        "quarantined" => Ok("quarantined"),
        _ => Err(CotAdapterError::UnknownTrustLabel {
            label: label.to_string(),
        }),
    }
}

fn millis_to_iso8601(millis: u64) -> String {
    let secs = millis / 1000;
    let nanos = ((millis % 1000) * 1_000_000) as u32;
    
    let dt = UNIX_EPOCH + std::time::Duration::new(secs, nanos);
    let datetime = chrono::DateTime::<chrono::Utc>::from(dt);
    datetime.to_rfc3339_opts(chrono::SecondsFormat::Millis, true)
}

fn format_trust_score(score: f64) -> String {
    // Format to 2 decimal places for CoT compatibility
    format!("{:.2}", score.clamp(0.0, 1.0))
}

fn escape_xml(s: &str) -> String {
    s.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&apos;")
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::transport::{
        ExternalEventContract, ExternalEventKind, ExternalSnapshotPayload, FreshnessMetadata,
        SignatureEnvelope,
    };

    fn test_contract(timestamp_ms: u64) -> ExternalEventContract<ExternalSnapshotPayload> {
        ExternalEventContract {
            schema_version: "tak-bridge.external.v1",
            event_kind: ExternalEventKind::NodeSnapshot,
            envelope: SignatureEnvelope {
                key_id: "ops-key-1".into(),
                signature: "deadbeefcafebabe".into(),
                freshness: FreshnessMetadata {
                    timestamp_ns: timestamp_ms * 1_000_000,
                    timestamp_ms,
                },
            },
            payload: ExternalSnapshotPayload {
                node_id: "node-alpha".into(),
                trust_score_0_100: 93,
                trust_label: "trusted",
                integrity_label: "integrity_ok",
                root_agreement_ratio: 0.875,
                signature_failure_count: 1,
                chain_break_count: 2,
                telemetry_trust_score_0_1: Some(0.91),
                last_seen_ns: timestamp_ms * 1_000_000,
                lat: Some(35.0),
                lon: Some(-120.5),
                alt_m: Some(10.0),
            },
        }
    }

    fn current_timestamp_ms() -> u64 {
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_millis() as u64
    }

    #[test]
    fn fresh_snapshot_converts_to_cot() {
        let contract = test_contract(current_timestamp_ms());
        let result = snapshot_to_cot(&contract);
        
        assert!(result.is_ok());
        let cot = result.unwrap();
        
        assert!(cot.xml.contains(r#"type="a-f-AETHERCORE-TRUST""#));
        assert!(cot.xml.contains(r#"uid="node-alpha""#));
        assert!(cot.xml.contains(r#"trust_score="0.93""#));
        assert!(cot.xml.contains(r#"trust_level="healthy""#));
        assert!(cot.xml.contains(r#"signer_node_id="ops-key-1""#));
        assert!(cot.xml.contains(r#"signature_hex="deadbeefcafebabe""#));
    }

    #[test]
    fn stale_snapshot_is_rejected() {
        let stale_timestamp = current_timestamp_ms() - (400 * 1000); // 400s ago
        let contract = test_contract(stale_timestamp);
        let result = snapshot_to_cot(&contract);
        
        assert!(result.is_err());
        match result.unwrap_err() {
            CotAdapterError::StaleTimestamp { threshold_s } => {
                assert_eq!(threshold_s, 300);
            }
            _ => panic!("Expected StaleTimestamp error"),
        }
    }

    #[test]
    fn missing_signature_is_rejected() {
        let mut contract = test_contract(current_timestamp_ms());
        contract.envelope.signature = String::new();
        
        let result = snapshot_to_cot(&contract);
        assert!(result.is_err());
        assert_eq!(result.unwrap_err(), CotAdapterError::MissingSignature);
    }

    #[test]
    fn trust_label_mapping_is_correct() {
        let labels = vec![
            ("trusted", "healthy"),
            ("degraded", "suspect"),
            ("quarantined", "quarantined"),
        ];

        for (label, expected) in labels {
            let mut contract = test_contract(current_timestamp_ms());
            contract.payload.trust_label = label;
            
            let result = snapshot_to_cot(&contract).unwrap();
            assert!(result.xml.contains(&format!(r#"trust_level="{}""#, expected)));
        }
    }

    #[test]
    fn unknown_trust_label_is_rejected() {
        let mut contract = test_contract(current_timestamp_ms());
        contract.payload.trust_label = "invalid";
        
        let result = snapshot_to_cot(&contract);
        assert!(result.is_err());
        match result.unwrap_err() {
            CotAdapterError::UnknownTrustLabel { label } => {
                assert_eq!(label, "invalid");
            }
            _ => panic!("Expected UnknownTrustLabel error"),
        }
    }

    #[test]
    fn integrity_metrics_are_mapped_correctly() {
        let contract = test_contract(current_timestamp_ms());
        let result = snapshot_to_cot(&contract).unwrap();
        
        // root_agreement_ratio 0.875 → packet_loss 0.125
        assert!(result.xml.contains(r#"integrity_packet_loss="0.12""#));
        assert!(result.xml.contains(r#"integrity_signature_fail_count="1""#));
        assert!(result.xml.contains(r#"integrity_chain_break_count="2""#));
    }

    #[test]
    fn missing_gps_defaults_to_zero() {
        let mut contract = test_contract(current_timestamp_ms());
        contract.payload.lat = None;
        contract.payload.lon = None;
        contract.payload.alt_m = None;
        
        let result = snapshot_to_cot(&contract).unwrap();
        assert!(result.xml.contains(r#"lat="0" lon="0" hae="0""#));
    }

    #[test]
    fn xml_special_characters_are_escaped() {
        let mut contract = test_contract(current_timestamp_ms());
        contract.payload.node_id = "node<alpha>&\"test\"".into();
        
        let result = snapshot_to_cot(&contract).unwrap();
        assert!(result.xml.contains("node&lt;alpha&gt;&amp;&quot;test&quot;"));
    }

    #[test]
    fn staleness_calculation_uses_ttl_default() {
        let now_ms = current_timestamp_ms();
        let contract = test_contract(now_ms);
        let result = snapshot_to_cot(&contract).unwrap();
        
        // Verify stale timestamp is 300s after event time
        let time_iso = millis_to_iso8601(now_ms);
        let stale_iso = millis_to_iso8601(now_ms + 300_000);
        
        assert!(result.xml.contains(&format!(r#"time="{}""#, time_iso)));
        assert!(result.xml.contains(&format!(r#"stale="{}""#, stale_iso)));
    }
}
