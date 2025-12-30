//! Core types

use serde::{Deserialize, Serialize};

/// Configuration type
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Config {
    /// Configuration name
    pub name: String,
}
