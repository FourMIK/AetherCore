//! Trust types

use serde::{Deserialize, Serialize};

/// Trust level
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TrustLevel {
    /// Trust score
    pub score: f64,
}
