//! Materia Slots - Hardware-rooted sensor schemas
//! 
//! This module provides cryptographically bound sensor definitions that replace
//! generic database columns with attested, integrity-verified sensor data.

pub mod traits;
pub mod sensors;
pub mod valves;
pub mod configuration;

pub use traits::{MateriaSlot, MerkleVineLink, TpmAttestation};
pub use sensors::*;
pub use valves::*;
pub use configuration::*;
