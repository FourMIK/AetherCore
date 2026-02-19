//! Byzantine-resilient actuation module
//!
//! Control commands require cryptographic proof, not just requests.

pub mod commands;
pub mod quorum;

pub use commands::*;
pub use quorum::*;
