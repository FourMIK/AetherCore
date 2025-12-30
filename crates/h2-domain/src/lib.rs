//! AetherCore H2-Domain
//! 
//! H2OS domain integration layer with PowerMIK industrial standardization.
//! 
//! This crate provides:
//! - Hardware-rooted sensor schemas (Materia Slots)
//! - Byzantine-resilient actuation (quorum-based commands)
//! - Safety systems (heartbeat monitoring, dead man's switch)
//! 
//! **Note**: This crate is allowed to reference `/legacy` according to monorepo rules.

#![warn(missing_docs)]

pub mod h2;
pub mod materia;
pub mod actuation;
pub mod safety;
