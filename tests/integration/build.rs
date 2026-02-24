fn main() {
    // No proto files to compile in this test crate
    // We use the proto definitions from the main crates
    println!("cargo:rerun-if-changed=build.rs");
}
