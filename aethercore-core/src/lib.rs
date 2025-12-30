//! Core functionality for the Fourmik (4mik) mesh networking system.
//!
//! This crate provides the fundamental types, traits, and utilities used
//! across the Fourmik ecosystem.

pub mod config;
pub mod error;
pub mod event;
pub mod ledger;
pub mod merkle_aggregator;
pub mod merkle_vine;
pub mod trust_chain;
pub mod types;
pub mod zk_trait;

pub use error::{Error, Result};
pub use event::{Event, EventBuilder, EventCategory, EventMetadata, EventSeverity};
pub use ledger::{
    EventLedger, LedgerError, LedgerHealth, LedgerHealthInfo, LedgerMetrics, SignedEvent,
};
pub use merkle_aggregator::{
    preprocess_leaves, AggregationBatch, AggregationConfig, Hash as MerkleHash, MerkleAggregator,
    MerkleError, MerkleProof, MerkleTree,
};
pub use merkle_vine::{InclusionProof, MerkleVine, VineNode};
pub use trust_chain::{TrustChain, TrustLink};
pub use zk_trait::{ZkProofRequest, ZkProofResult, ZkProverService};

#[cfg(test)]
mod tests {
    #[test]
    fn it_works() {
        assert_eq!(2 + 2, 4);
    }
}
