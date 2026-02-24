//! Mission coordination domain models
//!
//! Provides domain models for H2OS dispatch and mission lifecycle events
//! with cryptographically attested state transitions.

pub mod correlation;
pub mod dispatch;
pub mod schedule;

pub use correlation::{AssetMissionCorrelation, MissionCorrelator};
pub use dispatch::{Dispatch, DispatchState, DispatchTransition};
pub use schedule::{Schedule, ScheduledMission};
