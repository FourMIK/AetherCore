use std::env;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

fn main() {
    tauri_build::build();

    if let Err(error) = bundle_node_binary() {
        println!("cargo:warning=Failed to prepare aethercore-node resource: {error}");
    }

    if let Err(error) = bundle_local_control_plane_runtime() {
        println!("cargo:warning=Failed to prepare local control-plane runtime bundle: {error}");
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

fn bundle_local_control_plane_runtime() -> Result<(), String> {
    let manifest_dir = PathBuf::from(env::var("CARGO_MANIFEST_DIR").map_err(|e| e.to_string())?);
    let workspace_root = manifest_dir
        .ancestors()
        .nth(3)
        .ok_or_else(|| "Unable to resolve workspace root from CARGO_MANIFEST_DIR".to_string())?
        .to_path_buf();
    let target_triple = env::var("TARGET").map_err(|e| e.to_string())?;
    let platform = platform_resource_dir(&target_triple);

    let platform_root = manifest_dir.join("resources").join(platform);
    let runtime_root = platform_root.join("local-control-plane");
    let launchers_dir = runtime_root.join("launchers");
    let services_dir = runtime_root.join("services");

    fs::create_dir_all(&launchers_dir).map_err(|e| e.to_string())?;
    fs::create_dir_all(&services_dir).map_err(|e| e.to_string())?;

    let node_binary = resolve_host_node_binary()?;
    let node_target_name = if platform == "windows" {
        "node.exe"
    } else {
        "node"
    };
    let bundled_node = runtime_root.join(node_target_name);
    fs::copy(&node_binary, &bundled_node)
        .map_err(|e| format!("failed to copy bundled Node.js runtime: {e}"))?;
    set_executable(&bundled_node);

    bundle_service_dist(&workspace_root, &services_dir, "gateway")?;
    bundle_service_dist(&workspace_root, &services_dir, "collaboration")?;

    write_launcher_scripts(&runtime_root, &launchers_dir, platform)?;

    println!(
        "cargo:rerun-if-changed={}",
        workspace_root.join("services/gateway/src").display()
    );
    println!(
        "cargo:rerun-if-changed={}",
        workspace_root.join("services/collaboration/src").display()
    );

    Ok(())
}

fn resolve_host_node_binary() -> Result<PathBuf, String> {
    if let Ok(path) = env::var("AETHERCORE_EMBEDDED_NODE_PATH") {
        let candidate = PathBuf::from(path);
        if candidate.exists() {
            return Ok(candidate);
        }
        return Err(format!(
            "AETHERCORE_EMBEDDED_NODE_PATH is set but missing: {}",
            candidate.display()
        ));
    }

    which::which("node").map_err(|_| {
        "Unable to locate Node.js binary for runtime bundling. Set AETHERCORE_EMBEDDED_NODE_PATH to a deterministic Node runtime path.".to_string()
    })
}

fn bundle_service_dist(
    workspace_root: &Path,
    services_dir: &Path,
    service_name: &str,
) -> Result<(), String> {
    let service_root = workspace_root.join("services").join(service_name);
    let npm = env::var("AETHERCORE_PACKAGE_MANAGER").unwrap_or_else(|_| "pnpm".to_string());

    let status = Command::new(&npm)
        .arg("--dir")
        .arg(&service_root)
        .arg("run")
        .arg("build")
        .current_dir(workspace_root)
        .status()
        .map_err(|e| format!("failed to run build for service '{service_name}': {e}"))?;

    if !status.success() {
        return Err(format!(
            "failed to build service '{service_name}' for local runtime bundle"
        ));
    }

    let source_dist = service_root.join("dist");
    if !source_dist.exists() {
        return Err(format!(
            "service '{}' dist directory is missing at {}",
            service_name,
            source_dist.display()
        ));
    }

    let target_root = services_dir.join(service_name);
    if target_root.exists() {
        fs::remove_dir_all(&target_root).map_err(|e| e.to_string())?;
    }
    fs::create_dir_all(&target_root).map_err(|e| e.to_string())?;

    copy_dir_recursive(&source_dist, &target_root.join("dist"))?;
    fs::copy(
        service_root.join("package.json"),
        target_root.join("package.json"),
    )
    .map_err(|e| format!("failed to copy {} package.json: {e}", service_name))?;

    let node_modules = service_root.join("node_modules");
    if !node_modules.exists() {
        return Err(format!(
            "service '{}' node_modules directory is missing; run dependency install before packaging",
            service_name
        ));
    }
    copy_dir_recursive(&node_modules, &target_root.join("node_modules"))?;

    Ok(())
}

fn write_launcher_scripts(
    runtime_root: &Path,
    launchers_dir: &Path,
    platform: &str,
) -> Result<(), String> {
    if platform == "windows" {
        let gateway = format!(
            "@echo off\r\nset RUNTIME_ROOT=%~dp0..\r\n\"%RUNTIME_ROOT%\\node.exe\" \"%RUNTIME_ROOT%\\services\\gateway\\dist\\index.js\"\r\n"
        );
        let collaboration = format!(
            "@echo off\r\nset RUNTIME_ROOT=%~dp0..\r\n\"%RUNTIME_ROOT%\\node.exe\" \"%RUNTIME_ROOT%\\services\\collaboration\\dist\\index.js\"\r\n"
        );
        fs::write(launchers_dir.join("gateway-launcher.cmd"), gateway)
            .map_err(|e| e.to_string())?;
        fs::write(
            launchers_dir.join("collaboration-launcher.cmd"),
            collaboration,
        )
        .map_err(|e| e.to_string())?;
    } else {
        let template = |service: &str| {
            format!(
                "#!/usr/bin/env sh\nset -eu\nSCRIPT_DIR=\"$(CDPATH= cd -- \"$(dirname -- \"$0\")\" && pwd)\"\nRUNTIME_ROOT=\"${{SCRIPT_DIR}}/..\"\nexec \"${{RUNTIME_ROOT}}/node\" \"${{RUNTIME_ROOT}}/services/{service}/dist/index.js\"\n"
            )
        };

        let gateway_path = launchers_dir.join("gateway-launcher");
        fs::write(&gateway_path, template("gateway")).map_err(|e| e.to_string())?;
        set_executable(&gateway_path);

        let collaboration_path = launchers_dir.join("collaboration-launcher");
        fs::write(&collaboration_path, template("collaboration")).map_err(|e| e.to_string())?;
        set_executable(&collaboration_path);
    }

    // Ensure runtime root remains available for template replacement and diagnostics.
    if !runtime_root.exists() {
        return Err(format!(
            "runtime root missing at {}",
            runtime_root.display()
        ));
    }

    Ok(())
}

fn copy_dir_recursive(source: &Path, destination: &Path) -> Result<(), String> {
    fs::create_dir_all(destination).map_err(|e| e.to_string())?;
    for entry in fs::read_dir(source).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let entry_type = entry.file_type().map_err(|e| e.to_string())?;
        let target_path = destination.join(entry.file_name());
        if entry_type.is_dir() {
            copy_dir_recursive(&entry.path(), &target_path)?;
        } else {
            fs::copy(entry.path(), &target_path).map_err(|e| e.to_string())?;
            set_executable_if_script(&target_path);
        }
    }
    Ok(())
}

fn set_executable_if_script(path: &Path) {
    if matches!(path.extension().and_then(|v| v.to_str()), Some("sh" | "py")) {
        set_executable(path);
    }
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
