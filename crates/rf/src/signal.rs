//! RF signal types

use serde::{Deserialize, Serialize};

/// RF Signal
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Signal {
    /// Frequency in Hz
    pub frequency: f64,
}
