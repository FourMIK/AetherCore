//! Byzantine-resilient actuation module
//! 
//! Control commands require cryptographic proof, not just requests.

pub mod quorum;
pub mod commands;

pub use quorum::*;
pub use commands::*;
