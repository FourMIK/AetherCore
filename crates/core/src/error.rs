//! Core error types

use thiserror::Error;

/// Core error type for AetherCore
#[derive(Debug, Error)]
pub enum CoreError {
    /// Generic error
    #[error("Core error: {0}")]
    Generic(String),
    
    /// IO error
    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),
}
