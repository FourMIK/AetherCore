//! Common types used across Fourmik.

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct NodeId(pub String);

#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct MeshId(pub String);

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Message {
    pub id: String,
    pub source: NodeId,
    pub destination: NodeId,
    pub payload: Vec<u8>,
    pub timestamp: u64,
}

impl NodeId {
    pub fn new(id: impl Into<String>) -> Self {
        Self(id.into())
    }
}

impl MeshId {
    pub fn new(id: impl Into<String>) -> Self {
        Self(id.into())
    }
}
