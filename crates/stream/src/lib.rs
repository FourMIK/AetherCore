//! AetherCore Stream
//!
//! Data streaming functionality with Merkle-Vine integrity enforcement.

#![warn(missing_docs)]

pub mod error;
pub mod integrity;
pub mod processor;
pub mod stream;

pub use error::{StreamError, StreamResult};
pub use integrity::{IntegrityStatus, StreamIntegrityTracker};
pub use processor::{MerkleEnforcer, ProcessError, StreamProcessor};
