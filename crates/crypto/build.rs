//! Build script for compiling protobuf definitions into Rust code

#[cfg(feature = "grpc-server")]
fn main() -> Result<(), Box<dyn std::error::Error>> {
    // Use vendored protoc so grpc feature builds in constrained CI/dev environments.
    let protoc = protoc_bin_vendored::protoc_bin_path()?;
    std::env::set_var("PROTOC", protoc);

    tonic_build::compile_protos("proto/signing.proto")?;
    Ok(())
}

#[cfg(not(feature = "grpc-server"))]
fn main() {
    // No-op when grpc-server feature is not enabled
}
