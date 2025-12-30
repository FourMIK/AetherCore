//! Stream types

use serde::{Deserialize, Serialize};

/// Stream configuration
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StreamConfig {
    /// Buffer size
    pub buffer_size: usize,
}
