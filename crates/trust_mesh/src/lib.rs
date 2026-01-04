//! Trust Mesh Service
//!
//! This crate implements the Cryptographic Trust Mesh service that provides:
//! - Event signing and chain building with Ed25519 and BLAKE3
//! - Merkle aggregation and checkpoint management
//! - Distributed ledger synchronization via gossip protocol
//! - Rotating cipher integration and trust scoring
//! - Stream audit and chain proof verification
//!
//! The trust mesh is the backbone for higher-level trust scoring and autonomous coordination.

pub mod audit;
pub mod chain;
pub mod gossip;
pub mod ledger;
pub mod merkle;
pub mod node_health;
pub mod service;
pub mod signing;
pub mod topology_bench;
pub mod trust;

pub use audit::{
    AuditConfig, ProofVerificationResult, StreamAuditResult, StreamAuditor,
    QUARANTINE_THRESHOLD, TRUST_DELTA_SUCCESS,
};
pub use chain::{ChainError, ChainManager};
pub use gossip::{GossipMessage, GossipProtocol, PeerState};
pub use ledger::{ComplianceProof, DistributedLedger, LedgerState};
pub use merkle::{CheckpointWindow, LedgerCheckpoint, MerkleAggregator};
pub use node_health::{
    HealthThresholds, IntegrityCounters, IntegrityMetrics, NodeHealth, NodeHealthComputer,
    NodeHealthStatus,
};
pub use service::{TrustMeshConfig, TrustMeshService};
pub use signing::{EventSigner, KeyManager, SigningError};
pub use trust::{
    TrustComputationConfig, TrustLevel, TrustScore, TrustScorer, HEALTHY_THRESHOLD,
    QUARANTINE_THRESHOLD as TRUST_QUARANTINE_THRESHOLD,
};

#[cfg(test)]
mod tests {
    #[test]
    fn it_works() {
        assert_eq!(2 + 2, 4);
    }
}
