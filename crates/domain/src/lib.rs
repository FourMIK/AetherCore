//! Domain module for 4MIK CLEAN architecture
//!
//! This crate contains pure domain logic with no I/O dependencies:
//! - Canonical event definitions
//! - Chain building and verification
//! - Domain invariants and business rules

pub mod canonical_event;
pub mod chain_builder;
pub mod error;
pub mod tactical_glass;

pub use canonical_event::{CanonicalEvent, EventHash, EventType, PublicKey, Signature};
pub use chain_builder::{ChainBuilder, ChainLink, ChainRoot, SkipLink};
pub use error::{DomainError, Result};
pub use tactical_glass::{GeospatialPosition, TacticalEntity, TacticalState, TrustIndicator};
