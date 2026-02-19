//! Safety systems module
//!
//! Implements cryptographic heartbeat monitoring and dead man's switch

pub mod dead_man;
pub mod heartbeat;

pub use dead_man::*;
pub use heartbeat::*;
