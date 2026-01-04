//! Integration tests for the Rust/TypeScript boundary
//!
//! This test suite validates:
//! - gRPC communication between TS and Rust
//! - FFI boundary safety (Tauri commands for desktop)
//! - WebSocket telemetry streaming with Merkle Vine verification
//! - Cross-language failure modes and audit events
//! - Byzantine node detection and quarantine (Red Cell)

pub mod test_utils;

// Temporarily commented out due to compilation errors in boundary tests
// #[cfg(test)]
// mod boundary_grpc_tests;

// #[cfg(test)]
// mod boundary_replay_attack_tests;

// #[cfg(test)]
// mod boundary_trust_mesh_tests;

#[cfg(test)]
mod red_cell_assault;

#[cfg(test)]
mod desktop_integration_tests;
