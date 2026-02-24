fn main() -> Result<(), Box<dyn std::error::Error>> {
    // Use vendored protoc so builds/tests don't depend on a host-installed binary.
    let protoc = protoc_bin_vendored::protoc_bin_path()?;
    std::env::set_var("PROTOC", protoc);

    tonic_build::configure()
        .build_server(true)
        .build_client(false)
        .compile(&["proto/c2.proto"], &["proto"])?;
    Ok(())
}
