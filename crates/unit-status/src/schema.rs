//! Shared serialization schema for mesh health and revocation websocket-style events.
//!
//! This schema is used by multiple producers (e.g., websocket server and TAK bridge)
//! and preserves stable wire keys for Tactical Glass-compatible consumers.

use serde::{Deserialize, Serialize};

/// Mesh health and revocation event envelope.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(tag = "type")]
pub enum MeshEvent {
    /// Node health update.
    #[serde(rename = "mesh_health")]
    MeshHealth(MeshHealthPayload),

    /// Revocation certificate distribution event.
    #[serde(rename = "revocation")]
    Revocation(RevocationPayload),
}

/// Mesh health payload format.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct MeshHealthPayload {
    /// Node identifier.
    pub node_id: String,
    /// Mesh health state (HEALTHY, DEGRADED, COMPROMISED, UNKNOWN).
    pub status: String,
    /// Trust score emitted by trust mesh.
    pub trust_score: f32,
    /// Last time the node was seen (ns).
    pub last_seen_ns: u64,
    /// Health metrics bundle.
    pub metrics: HealthMetrics,
}

/// Health metrics from trust mesh.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct HealthMetrics {
    /// Ratio of root hash agreement across nodes.
    pub root_agreement_ratio: f64,
    /// Count of detected chain breaks.
    pub chain_break_count: u64,
    /// Count of signature failures.
    pub signature_failure_count: u64,
}

/// Revocation payload.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct RevocationPayload {
    /// Node being revoked.
    pub node_id: String,
    /// Reason for revocation.
    pub revocation_reason: RevocationReason,
    /// Authority issuing revocation.
    pub issuer_id: String,
    /// Timestamp in nanoseconds.
    pub timestamp_ns: u64,
    /// Hex-encoded Ed25519 signature.
    pub signature: String,
    /// Hex-encoded BLAKE3 Merkle root.
    pub merkle_root: String,
}

/// Revocation reasons.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum RevocationReason {
    /// TPM attestation failed.
    AttestationFailure,
    /// Byzantine detection triggered.
    ByzantineDetection,
    /// Operator initiated override.
    OperatorOverride,
    /// Duplicate or conflicting identity observed.
    IdentityCollapse,
}
