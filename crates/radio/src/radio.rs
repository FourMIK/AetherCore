//! Radio types

use serde::{Deserialize, Serialize};

/// Radio configuration
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RadioConfig {
    /// Channel
    pub channel: u32,
}
