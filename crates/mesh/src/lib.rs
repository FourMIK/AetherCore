//! AetherCore Mesh - Tactical Mesh Layer for Hardware-Rooted Truth
//!
//! Implements resilient peer-to-peer networking for contested, multi-domain environments.
//!
//! # Core Components
//!
//! - **Peer Discovery**: Decentralized node discovery using mDNS and seed peers
//! - **Aetheric Whisper**: Gossip protocol for state propagation without central coordination
//! - **Weaver Ant Routing**: Multi-hop routing with cost-based metrics
//! - **Spectral Agility**: Coordinated frequency hopping for EW hardening
//! - **Bunker Mode**: Offline-first persistence for network isolation scenarios
//!
//! # Design Principles
//!
//! 1. **Truth as a Weapon**: All state changes are cryptographically verifiable
//! 2. **Fail-Visible**: Network failures are immediately detectable
//! 3. **Survivability**: Assumes constant EW attack; disconnection is the default state
//!
//! # Example Usage
//!
//! ```rust,no_run
//! use aethercore_mesh::TacticalMesh;
//!
//! # fn main() -> Result<(), Box<dyn std::error::Error>> {
//! // Create a tactical mesh instance
//! let mut mesh = TacticalMesh::new(
//!     "node-1".to_string(),
//!     vec!["192.168.1.100:8080".to_string()],
//!     "chain_store.db"
//! )?;
//!
//! // Get mesh status
//! let status = mesh.get_mesh_status();
//! println!("Bunker mode: {}", status.bunker_mode);
//! # Ok(())
//! # }
//! ```

#![warn(missing_docs)]

pub mod bunker;
pub mod error;
pub mod gossip;
pub mod network;
pub mod peer;
pub mod routing;
pub mod security;
pub mod spectral;
pub mod tactical;

// Re-export main types
pub use bunker::{BunkerMode, BunkerState, StoredBlock, StoredEvent};
pub use error::{MeshError, MeshResult};
pub use gossip::{AethericWhisper, ConsensusView, GossipMessage, GossipResult};
pub use peer::{PeerInfo, PeerTable};
pub use routing::{LinkQuality, RouteEntry, RouteUpdateResult, RoutingTable};
pub use security::{MeshSecurity, SignedMessage};
pub use spectral::{
    generate_hopping_pattern, FrequencyHopper, HopReason, HopResult, HoppingPattern,
};
pub use tactical::{MeshStatus, TacticalMesh};
