use std::env;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

fn main() {
    tauri_build::build();

    if let Err(error) = bundle_node_binary() {
        println!("cargo:warning=Failed to prepare aethercore-node resource: {error}");
    }
}

fn bundle_node_binary() -> Result<(), String> {
    let manifest_dir = PathBuf::from(env::var("CARGO_MANIFEST_DIR").map_err(|e| e.to_string())?);
    let workspace_root = manifest_dir
        .ancestors()
        .nth(3)
        .ok_or_else(|| "Unable to resolve workspace root from CARGO_MANIFEST_DIR".to_string())?
        .to_path_buf();

    let target_triple = env::var("TARGET").map_err(|e| e.to_string())?;
    let profile = env::var("PROFILE").unwrap_or_else(|_| "debug".to_string());
    let binary_name = if target_triple.contains("windows") {
        "aethercore-node.exe"
    } else {
        "aethercore-node"
    };

    let cargo = env::var("CARGO").unwrap_or_else(|_| "cargo".to_string());
    let status = Command::new(cargo)
        .arg("build")
        .arg("-p")
        .arg("aethercore-node")
        .arg("--target")
        .arg(&target_triple)
        .arg("--profile")
        .arg(&profile)
        .current_dir(&workspace_root)
        .status()
        .map_err(|e| format!("failed to invoke cargo build for node binary: {e}"))?;

    if !status.success() {
        return Err("cargo build for aethercore-node failed".to_string());
    }

    let compiled_binary = workspace_root
        .join("target")
        .join(&target_triple)
        .join(&profile)
        .join(binary_name);

    if !compiled_binary.exists() {
        return Err(format!(
            "expected node binary not found at {}",
            compiled_binary.display()
        ));
    }

    let resources_dir = manifest_dir.join("resources");
    fs::create_dir_all(&resources_dir).map_err(|e| e.to_string())?;

    let platform_dir = resources_dir.join(platform_resource_dir(&target_triple));
    fs::create_dir_all(&platform_dir).map_err(|e| e.to_string())?;

    let platform_binary_path = platform_dir.join(binary_name);
    fs::copy(&compiled_binary, &platform_binary_path)
        .map_err(|e| format!("failed to copy platform node binary: {e}"))?;
    set_executable(&platform_binary_path);

    println!(
        "cargo:rerun-if-changed={}",
        workspace_root.join("services/aethercore-node").display()
    );

    Ok(())
}

fn platform_resource_dir(target_triple: &str) -> &'static str {
    if target_triple.contains("windows") {
        "windows"
    } else if target_triple.contains("apple") {
        "macos"
    } else {
        "linux"
    }
}

#[cfg(unix)]
fn set_executable(path: &Path) {
    use std::os::unix::fs::PermissionsExt;
    if let Ok(metadata) = fs::metadata(path) {
        let mut perms = metadata.permissions();
        perms.set_mode(0o755);
        let _ = fs::set_permissions(path, perms);
    }
}

#[cfg(not(unix))]
fn set_executable(_path: &Path) {}
