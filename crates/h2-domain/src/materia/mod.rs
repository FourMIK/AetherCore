//! Materia Slots - Hardware-rooted sensor schemas
//!
//! This module provides cryptographically bound sensor definitions that replace
//! generic database columns with attested, integrity-verified sensor data.

pub mod configuration;
pub mod sensors;
pub mod traits;
pub mod valves;

pub use configuration::*;
pub use sensors::*;
pub use traits::{MateriaSlot, MerkleVineLink, TpmAttestation};
pub use valves::*;
