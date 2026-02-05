//! Error types for AetherCore Stream operations.
//!
//! This module provides comprehensive error handling for stream processing,
//! integrity tracking, and Merkle-Vine enforcement.

use thiserror::Error;

pub use crate::processor::ProcessError;

/// Errors that can occur in stream operations.
#[derive(Debug, Error)]
pub enum StreamError {
    /// Processing errors
    #[error("Processing error: {0}")]
    Process(#[from] ProcessError),

    /// Stream integrity errors
    #[error("Integrity violation: {0}")]
    Integrity(String),

    /// Stream not found
    #[error("Stream not found: {stream_id}")]
    StreamNotFound { stream_id: String },

    /// Stream already exists
    #[error("Stream already exists: {stream_id}")]
    StreamExists { stream_id: String },

    /// Invalid stream configuration
    #[error("Invalid stream configuration: {0}")]
    InvalidConfig(String),

    /// Serialization errors
    #[error("Serialization error: {0}")]
    Serialization(#[from] serde_json::Error),

    /// I/O errors
    #[error("I/O error: {0}")]
    Io(#[from] std::io::Error),

    /// Timeout error
    #[error("Operation timed out: {0}")]
    Timeout(String),
}

/// Result type for stream operations.
pub type StreamResult<T> = Result<T, StreamError>;
