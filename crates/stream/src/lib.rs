//! AetherCore Stream
//! 
//! Data streaming functionality with Merkle-Vine integrity enforcement.

#![warn(missing_docs)]

pub mod stream;
pub mod processor;
pub mod integrity;
pub mod error;

pub use processor::{StreamProcessor, MerkleEnforcer, ProcessError};
pub use integrity::{IntegrityStatus, StreamIntegrityTracker};
pub use error::{StreamError, StreamResult};
