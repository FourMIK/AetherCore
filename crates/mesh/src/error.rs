//! Error types for AetherCore Mesh operations.
//!
//! This module provides comprehensive error handling for mesh networking,
//! peer management, routing, and security operations.

use thiserror::Error;

/// Errors that can occur in mesh operations.
#[derive(Debug, Error)]
pub enum MeshError {
    /// Peer-related errors
    #[error("Peer error: {0}")]
    Peer(String),

    /// Peer not found
    #[error("Peer not found: {peer_id}")]
    PeerNotFound { peer_id: String },

    /// Routing errors
    #[error("Routing error: {0}")]
    Routing(String),

    /// Route not found
    #[error("No route found to destination: {destination}")]
    NoRoute { destination: String },

    /// Gossip protocol errors
    #[error("Gossip error: {0}")]
    Gossip(String),

    /// Security and cryptographic errors
    #[error("Security error: {0}")]
    Security(String),

    /// Message signature verification failed
    #[error("Signature verification failed for message from {peer_id}")]
    SignatureVerification { peer_id: String },

    /// Spectral agility / frequency hopping errors
    #[error("Spectral error: {0}")]
    Spectral(String),

    /// Bunker mode / persistence errors
    #[error("Bunker storage error: {0}")]
    BunkerStorage(String),

    /// Database errors
    #[error("Database error: {0}")]
    Database(#[from] rusqlite::Error),

    /// Network I/O errors
    #[error("Network I/O error: {0}")]
    Io(#[from] std::io::Error),

    /// Serialization errors
    #[error("Serialization error: {0}")]
    Serialization(#[from] serde_json::Error),

    /// Configuration errors
    #[error("Configuration error: {0}")]
    Config(String),

    /// Invalid state
    #[error("Invalid state: {0}")]
    InvalidState(String),

    /// Timeout error
    #[error("Operation timed out: {0}")]
    Timeout(String),
}

/// Result type for mesh operations.
pub type MeshResult<T> = Result<T, MeshError>;
