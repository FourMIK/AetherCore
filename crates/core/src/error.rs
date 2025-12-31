//! Error types for Fourmik.

use thiserror::Error;

pub type Result<T> = std::result::Result<T, Error>;

#[derive(Error, Debug)]
pub enum Error {
    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),

    #[error("Configuration error: {0}")]
    Config(String),

    #[error("Network error: {0}")]
    Network(String),

    #[error("Radio error: {0}")]
    Radio(String),

    #[error("Processing error: {0}")]
    Processing(String),

    #[error("Identity error: {0}")]
    Identity(String),

    #[error("ZK proof error: {0}")]
    Zk(String),

    #[error("Serialization error: {0}")]
    Serialization(#[from] serde_json::Error),

    #[error("Unknown error: {0}")]
    Unknown(String),
}
