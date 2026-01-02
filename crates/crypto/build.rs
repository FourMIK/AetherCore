//! Build script for compiling protobuf definitions into Rust code

#[cfg(feature = "grpc-server")]
fn main() -> Result<(), Box<dyn std::error::Error>> {
    tonic_build::compile_protos("proto/signing.proto")?;
    Ok(())
}

#[cfg(not(feature = "grpc-server"))]
fn main() {
    // No-op when grpc-server feature is not enabled
}
