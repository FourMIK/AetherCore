//! Radio types

use serde::{Deserialize, Serialize};

/// Radio configuration
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RadioConfig {
    /// Channel
    pub channel: u32,
}

impl RadioConfig {
    /// Create a new radio configuration
    pub fn new(channel: u32) -> Self {
        tracing::info!(channel = %channel, "Configuring radio");
        Self { channel }
    }
}
