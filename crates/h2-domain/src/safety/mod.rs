//! Safety systems module
//! 
//! Implements cryptographic heartbeat monitoring and dead man's switch

pub mod heartbeat;
pub mod dead_man;

pub use heartbeat::*;
pub use dead_man::*;
