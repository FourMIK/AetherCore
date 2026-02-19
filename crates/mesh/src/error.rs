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
    Peer(
        /// Peer error details
        String,
    ),

    /// Peer not found
    #[error("Peer not found: {peer_id}")]
    PeerNotFound {
        /// Peer identifier
        peer_id: String,
    },

    /// Routing errors
    #[error("Routing error: {0}")]
    Routing(
        /// Routing error details
        String,
    ),

    /// Route not found
    #[error("No route found to destination: {destination}")]
    NoRoute {
        /// Destination identifier
        destination: String,
    },

    /// Gossip protocol errors
    #[error("Gossip error: {0}")]
    Gossip(
        /// Gossip error details
        String,
    ),

    /// Security and cryptographic errors
    #[error("Security error: {0}")]
    Security(
        /// Security error details
        String,
    ),

    /// Message signature verification failed
    #[error("Signature verification failed for message from {peer_id}")]
    SignatureVerification {
        /// Peer identifier
        peer_id: String,
    },

    /// Spectral agility / frequency hopping errors
    #[error("Spectral error: {0}")]
    Spectral(
        /// Spectral error details
        String,
    ),

    /// Bunker mode / persistence errors
    #[error("Bunker storage error: {0}")]
    BunkerStorage(
        /// Bunker storage error details
        String,
    ),

    /// Database errors
    #[error("Database error: {0}")]
    Database(
        /// Database error details
        #[from]
        rusqlite::Error,
    ),

    /// Network I/O errors
    #[error("Network I/O error: {0}")]
    Io(
        /// Network I/O error details
        #[from]
        std::io::Error,
    ),

    /// Serialization errors
    #[error("Serialization error: {0}")]
    Serialization(
        /// Serialization error details
        #[from]
        serde_json::Error,
    ),

    /// Configuration errors
    #[error("Configuration error: {0}")]
    Config(
        /// Configuration error details
        String,
    ),

    /// Invalid state
    #[error("Invalid state: {0}")]
    InvalidState(
        /// Invalid state details
        String,
    ),

    /// Timeout error
    #[error("Operation timed out: {0}")]
    Timeout(
        /// Timeout details
        String,
    ),
}

/// Result type for mesh operations.
pub type MeshResult<T> = Result<T, MeshError>;
