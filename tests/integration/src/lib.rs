//! Integration tests for the Rust/TypeScript boundary
//!
//! This test suite validates:
//! - gRPC communication between TS and Rust
//! - FFI boundary safety
//! - WebSocket telemetry streaming with Merkle Vine verification
//! - Cross-language failure modes and audit events

pub mod test_utils;

#[cfg(test)]
mod boundary_grpc_tests;

#[cfg(test)]
mod boundary_replay_attack_tests;

#[cfg(test)]
mod boundary_trust_mesh_tests;
