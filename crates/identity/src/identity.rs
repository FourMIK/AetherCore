//! Identity types and management

use serde::{Deserialize, Serialize};

/// Identity type
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Identity {
    /// Unique identifier
    pub id: String,
}
