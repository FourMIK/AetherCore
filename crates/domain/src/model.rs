//! Domain model types

use serde::{Deserialize, Serialize};

/// Domain entity
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Entity {
    /// Entity ID
    pub id: String,
}
