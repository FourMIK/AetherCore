use std::env;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

const DEFAULT_BUNDLE_IDENTIFIER: &str = "com.aethercore.commander";
const DEV_UNRESTRICTED_ENTITLEMENTS_ENV: &str = "AETHERCORE_DEV_UNRESTRICTED_ENTITLEMENTS";

fn main() {
    println!("cargo:rerun-if-env-changed=APPLE_TEAM_ID");
    println!("cargo:rerun-if-env-changed=APPLE_SIGNING_IDENTITY");
    println!(
        "cargo:rerun-if-env-changed={}",
        DEV_UNRESTRICTED_ENTITLEMENTS_ENV
    );
    println!("cargo:rerun-if-changed=entitlements.plist");
    if let Err(error) = sync_macos_entitlements() {
        println!("cargo:warning=Failed to sync macOS entitlements: {error}");
    }

    let profile = env::var("PROFILE").unwrap_or_else(|_| "debug".to_string());

    if let Err(error) = bundle_node_binary() {
        println!("cargo:warning=Failed to prepare aethercore-node resource: {error}");
    }

    if matches!(profile.as_str(), "debug" | "dev") {
        println!(
            "cargo:warning=Skipping local control-plane runtime bundling in debug profile; dev fallbacks are used."
        );
    } else if let Err(error) = bundle_local_control_plane_runtime() {
        println!("cargo:warning=Failed to prepare local control-plane runtime bundle: {error}");
    }

    // Rebuild runtime resources before tauri scans the resources directory.
    // This avoids packaging failures when a prior cleanup leaves stale/broken
    // symlinks under resources/macos/local-control-plane.
    tauri_build::build();
}

fn sync_macos_entitlements() -> Result<(), String> {
    let manifest_dir = PathBuf::from(env::var("CARGO_MANIFEST_DIR").map_err(|e| e.to_string())?);
    let entitlements_path = manifest_dir.join("entitlements.plist");

    if env_flag_enabled(DEV_UNRESTRICTED_ENTITLEMENTS_ENV) {
        println!(
            "cargo:warning={} enabled; generating development entitlements without restricted keychain/profile requirements",
            DEV_UNRESTRICTED_ENTITLEMENTS_ENV
        );
        let entitlements = r#"<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>com.apple.security.cs.disable-library-validation</key>
  <true/>
</dict>
</plist>
"#;
        fs::write(&entitlements_path, entitlements).map_err(|e| {
            format!(
                "failed to write development entitlements to {}: {e}",
                entitlements_path.display()
            )
        })?;
        return Ok(());
    }

    let team_id = resolve_signing_team_id()?;

    let Some(team_id) = team_id else {
        println!(
            "cargo:warning=APPLE_TEAM_ID/APPLE_SIGNING_IDENTITY team not set; keeping existing entitlements at {}",
            entitlements_path.display()
        );
        return Ok(());
    };

    let application_identifier = format!("{team_id}.{DEFAULT_BUNDLE_IDENTIFIER}");
    let entitlements = format!(
        r#"<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>com.apple.application-identifier</key>
  <string>{application_identifier}</string>
  <key>com.apple.developer.team-identifier</key>
  <string>{team_id}</string>
  <key>com.apple.security.cs.disable-library-validation</key>
  <true/>
  <key>keychain-access-groups</key>
  <array>
    <string>{application_identifier}</string>
  </array>
</dict>
</plist>
"#
    );

    fs::write(&entitlements_path, entitlements).map_err(|e| {
        format!(
            "failed to write synced entitlements to {}: {e}",
            entitlements_path.display()
        )
    })?;

    Ok(())
}

fn env_flag_enabled(name: &str) -> bool {
    env::var(name)
        .ok()
        .map(|value| {
            let value = value.trim().to_ascii_lowercase();
            value == "1" || value == "true" || value == "yes" || value == "on"
        })
        .unwrap_or(false)
}

fn resolve_signing_team_id() -> Result<Option<String>, String> {
    let team_id_from_env = env::var("APPLE_TEAM_ID")
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());
    let team_id_from_identity = env::var("APPLE_SIGNING_IDENTITY")
        .ok()
        .and_then(|identity| parse_team_id_from_signing_identity(&identity));

    if let (Some(from_env), Some(from_identity)) =
        (team_id_from_env.as_ref(), team_id_from_identity.as_ref())
    {
        if from_env != from_identity {
            println!(
                "cargo:warning=APPLE_TEAM_ID ({from_env}) does not match APPLE_SIGNING_IDENTITY team ({from_identity}); using explicit APPLE_TEAM_ID"
            );
        }
    }

    Ok(team_id_from_env.or(team_id_from_identity))
}

fn parse_team_id_from_signing_identity(identity: &str) -> Option<String> {
    let open_idx = identity.rfind('(')?;
    let close_idx = identity.rfind(')')?;
    if close_idx <= open_idx + 1 {
        return None;
    }

    let candidate = identity[open_idx + 1..close_idx].trim();
    let is_valid = candidate.len() == 10
        && candidate
            .chars()
            .all(|ch| ch.is_ascii_uppercase() || ch.is_ascii_digit());
    if is_valid {
        Some(candidate.to_string())
    } else {
        None
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

    let compiled_profile_dir = match profile.as_str() {
        "debug" | "dev" => "debug",
        custom => custom,
    };

    let compiled_binary = workspace_root
        .join("target")
        .join(&target_triple)
        .join(compiled_profile_dir)
        .join(binary_name);

    if !compiled_binary.exists() {
        return Err(format!(
            "expected node binary not found at {}. Build it first with `cargo build -p aethercore-node --target {}`",
            compiled_binary.display(),
            target_triple
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
    let runtime_pnpm_store = runtime_root.join("pnpm-store");
    let runtime_packages_dir = runtime_root.join("packages");

    if runtime_root.exists() {
        fs::remove_dir_all(&runtime_root).map_err(|e| e.to_string())?;
    }

    fs::create_dir_all(&launchers_dir).map_err(|e| e.to_string())?;
    fs::create_dir_all(&services_dir).map_err(|e| e.to_string())?;
    fs::create_dir_all(&runtime_pnpm_store).map_err(|e| e.to_string())?;
    fs::create_dir_all(&runtime_packages_dir).map_err(|e| e.to_string())?;

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

    bundle_workspace_shared_package(&workspace_root, &runtime_packages_dir)?;
    bundle_pnpm_virtual_store(&workspace_root, &runtime_pnpm_store)?;

    bundle_service_dist(&workspace_root, &services_dir, "gateway")?;
    bundle_service_dist(&workspace_root, &services_dir, "collaboration")?;

    write_launcher_scripts(&runtime_root, &launchers_dir, platform)?;

    println!(
        "cargo:rerun-if-changed={}",
        workspace_root.join("services/gateway/src").display()
    );
    println!(
        "cargo:rerun-if-changed={}",
        workspace_root
            .join("services/gateway/package.json")
            .display()
    );
    println!(
        "cargo:rerun-if-changed={}",
        workspace_root.join("services/collaboration/src").display()
    );
    println!(
        "cargo:rerun-if-changed={}",
        workspace_root
            .join("services/collaboration/package.json")
            .display()
    );
    println!(
        "cargo:rerun-if-changed={}",
        workspace_root
            .join("packages/shared/package.json")
            .display()
    );
    println!(
        "cargo:rerun-if-changed={}",
        workspace_root.join("pnpm-lock.yaml").display()
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

    let proto_source = service_root.join("proto");
    if proto_source.exists() {
        copy_dir_recursive(&proto_source, &target_root.join("proto"))?;
    }

    let node_modules = service_root.join("node_modules");
    if !node_modules.exists() {
        return Err(format!(
            "service '{}' node_modules directory is missing; run dependency install before packaging",
            service_name
        ));
    }
    copy_dir_recursive_preserve_symlinks(&node_modules, &target_root.join("node_modules"))?;

    Ok(())
}

fn bundle_workspace_shared_package(
    workspace_root: &Path,
    runtime_packages_dir: &Path,
) -> Result<(), String> {
    let shared_source = workspace_root.join("packages").join("shared");
    let shared_target = runtime_packages_dir.join("shared");

    if !shared_source.exists() {
        return Err(format!(
            "workspace shared package missing at {}",
            shared_source.display()
        ));
    }

    if shared_target.exists() {
        fs::remove_dir_all(&shared_target).map_err(|e| e.to_string())?;
    }
    fs::create_dir_all(&shared_target).map_err(|e| e.to_string())?;

    fs::copy(
        shared_source.join("package.json"),
        shared_target.join("package.json"),
    )
    .map_err(|e| format!("failed to copy shared package.json: {e}"))?;
    copy_dir_recursive(&shared_source.join("dist"), &shared_target.join("dist"))?;
    let shared_node_modules = shared_source.join("node_modules");
    if shared_node_modules.exists() {
        copy_dir_recursive_preserve_symlinks(
            &shared_node_modules,
            &shared_target.join("node_modules"),
        )?;
    }

    Ok(())
}

fn bundle_pnpm_virtual_store(
    workspace_root: &Path,
    runtime_pnpm_store: &Path,
) -> Result<(), String> {
    let source_store = workspace_root.join("node_modules").join(".pnpm");
    if !source_store.exists() {
        return Err(format!(
            "workspace pnpm virtual store is missing at {}",
            source_store.display()
        ));
    }

    if runtime_pnpm_store.exists() {
        fs::remove_dir_all(runtime_pnpm_store).map_err(|e| e.to_string())?;
    }
    fs::create_dir_all(runtime_pnpm_store).map_err(|e| e.to_string())?;
    for entry in fs::read_dir(&source_store).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let source_path = entry.path();
        let entry_type = fs::symlink_metadata(&source_path)
            .map_err(|e| e.to_string())?
            .file_type();
        let name = entry.file_name();
        let target_path = runtime_pnpm_store.join(&name);

        // Skip .pnpm/node_modules compatibility links because they include
        // workspace-relative symlinks that are invalid inside the app bundle.
        if name == "node_modules" {
            continue;
        }

        if entry_type.is_dir() {
            copy_dir_recursive_preserve_symlinks(&source_path, &target_path)?;
        } else if entry_type.is_file() {
            fs::copy(&source_path, &target_path).map_err(|e| e.to_string())?;
            set_executable_if_script(&target_path);
        } else if entry_type.is_symlink() {
            let link_target = fs::read_link(&source_path)
                .map_err(|e| format!("failed to read symlink {}: {}", source_path.display(), e))?;
            create_symlink(&link_target, &target_path)?;
        }
    }
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
        let source_path = entry.path();
        let entry_type = fs::symlink_metadata(&source_path)
            .map_err(|e| e.to_string())?
            .file_type();
        let target_path = destination.join(entry.file_name());

        if entry_type.is_dir() {
            copy_dir_recursive(&source_path, &target_path)?;
            continue;
        }

        if entry_type.is_file() {
            fs::copy(&source_path, &target_path).map_err(|e| e.to_string())?;
            set_executable_if_script(&target_path);
            continue;
        }

        if entry_type.is_symlink() {
            let resolved = fs::canonicalize(&source_path).map_err(|e| {
                format!("failed to resolve symlink {}: {}", source_path.display(), e)
            })?;

            if resolved.is_dir() {
                copy_dir_recursive(&resolved, &target_path)?;
            } else if resolved.is_file() {
                fs::copy(&resolved, &target_path).map_err(|e| e.to_string())?;
                set_executable_if_script(&target_path);
            } else {
                return Err(format!(
                    "unsupported symlink target while copying {} -> {}",
                    source_path.display(),
                    resolved.display()
                ));
            }
            continue;
        }

        return Err(format!(
            "unsupported filesystem entry while copying runtime assets: {}",
            source_path.display()
        ));
    }
    Ok(())
}

fn copy_dir_recursive_preserve_symlinks(source: &Path, destination: &Path) -> Result<(), String> {
    fs::create_dir_all(destination).map_err(|e| e.to_string())?;
    for entry in fs::read_dir(source).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let source_path = entry.path();
        let entry_type = fs::symlink_metadata(&source_path)
            .map_err(|e| e.to_string())?
            .file_type();
        let target_path = destination.join(entry.file_name());

        if entry_type.is_dir() {
            copy_dir_recursive_preserve_symlinks(&source_path, &target_path)?;
            continue;
        }

        if entry_type.is_file() {
            fs::copy(&source_path, &target_path).map_err(|e| e.to_string())?;
            set_executable_if_script(&target_path);
            continue;
        }

        if entry_type.is_symlink() {
            let link_target = fs::read_link(&source_path)
                .map_err(|e| format!("failed to read symlink {}: {}", source_path.display(), e))?;
            let rewritten_target = rewrite_runtime_symlink_target(&link_target);
            create_symlink(&rewritten_target, &target_path)?;
            continue;
        }

        return Err(format!(
            "unsupported filesystem entry while copying runtime assets: {}",
            source_path.display()
        ));
    }
    Ok(())
}

fn rewrite_runtime_symlink_target(target: &Path) -> PathBuf {
    let raw = target.to_string_lossy();
    if raw.contains("node_modules/.pnpm/") {
        return PathBuf::from(raw.replace("node_modules/.pnpm/", "pnpm-store/"));
    }
    if raw.contains("node_modules\\.pnpm\\") {
        return PathBuf::from(raw.replace("node_modules\\.pnpm\\", "pnpm-store\\"));
    }
    target.to_path_buf()
}

#[cfg(unix)]
fn create_symlink(target: &Path, link_path: &Path) -> Result<(), String> {
    use std::os::unix::fs as unix_fs;
    if link_path.exists() {
        fs::remove_file(link_path).map_err(|e| e.to_string())?;
    }
    unix_fs::symlink(target, link_path).map_err(|e| {
        format!(
            "failed to create symlink {} -> {}: {}",
            link_path.display(),
            target.display(),
            e
        )
    })
}

#[cfg(windows)]
fn create_symlink(target: &Path, link_path: &Path) -> Result<(), String> {
    use std::os::windows::fs as windows_fs;
    if link_path.exists() {
        let _ = fs::remove_file(link_path);
        let _ = fs::remove_dir_all(link_path);
    }
    let absolute_target = link_path
        .parent()
        .unwrap_or_else(|| Path::new("."))
        .join(target);
    if absolute_target.is_dir() {
        windows_fs::symlink_dir(target, link_path).map_err(|e| e.to_string())
    } else {
        windows_fs::symlink_file(target, link_path).map_err(|e| e.to_string())
    }
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
