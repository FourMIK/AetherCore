//! H2OS integration types

use serde::{Deserialize, Serialize};

/// H2OS entity
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct H2Entity {
    /// Entity ID
    pub id: String,
}
