//! Domain errors
//!
//! Pure domain errors with no infrastructure dependencies

use thiserror::Error;

#[derive(Error, Debug, Clone, PartialEq, Eq)]
pub enum DomainError {
    #[error("Invalid event: {0}")]
    InvalidEvent(String),

    #[error("Chain error: {0}")]
    ChainError(String),

    #[error("Serialization error: {0}")]
    SerializationError(String),

    #[error("Validation error: {0}")]
    ValidationError(String),

    #[error("Invariant violation: {0}")]
    InvariantViolation(String),
}

pub type Result<T> = std::result::Result<T, DomainError>;
