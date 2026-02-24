//! Stream types

use serde::{Deserialize, Serialize};

/// Stream configuration
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StreamConfig {
    /// Buffer size
    pub buffer_size: usize,
}

impl StreamConfig {
    /// Create a new stream configuration
    pub fn new(buffer_size: usize) -> Self {
        tracing::info!(buffer_size = %buffer_size, "Creating stream configuration");
        Self { buffer_size }
    }
}
