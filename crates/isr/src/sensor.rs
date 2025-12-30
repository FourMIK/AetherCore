//! Sensor types

use serde::{Deserialize, Serialize};

/// Sensor data
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SensorData {
    /// Data type
    pub data_type: String,
}
