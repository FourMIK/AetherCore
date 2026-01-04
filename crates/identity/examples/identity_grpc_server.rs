//! Example: Identity Registry gRPC Server
//!
//! This example demonstrates how to start and run the Identity Registry gRPC Server
//! with TPM attestation validation for the Desktop environment.
//!
//! Usage:
//! ```bash
//! cargo run --example identity_grpc_server --features grpc-server
//! ```

use aethercore_identity::grpc_server::start_grpc_server;
use aethercore_identity::{IdentityManager, TpmManager};
use std::sync::{Arc, Mutex};

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    // Initialize tracing for logging
    tracing_subscriber::fmt()
        .with_max_level(tracing::Level::INFO)
        .init();

    tracing::info!("Starting Identity Registry gRPC Server");

    // Create the identity manager (in-memory for now)
    let identity_manager = Arc::new(Mutex::new(IdentityManager::new()));

    // Create the TPM manager (using stub implementation)
    // In production, set use_hardware=true to use real TPM
    let tpm_manager = Arc::new(Mutex::new(TpmManager::new(false)));

    // Server address - listen on all interfaces, port 50051
    let addr = "0.0.0.0:50051".parse()?;

    tracing::info!(
        "Identity Registry gRPC server starting on {}",
        addr
    );
    tracing::info!("Security Model: NO GRACEFUL DEGRADATION for TPM attestation failures");
    tracing::info!("Hardware-rooted trust required for all node registrations");

    // Start the gRPC server
    start_grpc_server(addr, identity_manager, tpm_manager).await?;

    Ok(())
}
