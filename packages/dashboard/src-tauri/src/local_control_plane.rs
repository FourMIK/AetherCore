use serde::Deserialize;
use std::io::{Read, Write};
use std::net::TcpStream;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::thread;
use std::time::{Duration, Instant};
use url::Url;

#[derive(Debug, Clone, Deserialize)]
pub struct LocalControlPlaneManifest {
    pub mode: String,
    pub version: u32,
    pub startup: StartupPolicy,
    pub services: Vec<ManagedService>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct StartupPolicy {
    pub health_poll_interval_ms: u64,
    pub service_start_grace_period_ms: u64,
    pub service_health_timeout_secs: u64,
}

#[derive(Debug, Clone, Deserialize)]
pub struct ManagedService {
    pub name: String,
    pub startup_order: u32,
    pub required: bool,
    pub port: u16,
    pub health_endpoint: String,
    pub working_dir: String,
    pub start_command: String,
}

#[derive(Debug)]
pub struct LocalControlPlaneRuntime {
    spawned_children: Vec<Child>,
}

impl Drop for LocalControlPlaneRuntime {
    fn drop(&mut self) {
        for child in &mut self.spawned_children {
            if let Err(error) = child.kill() {
                log::warn!(
                    "Failed to stop local control plane child process: {}",
                    error
                );
            }
        }
    }
}

pub fn bootstrap_local_control_plane() -> Result<LocalControlPlaneRuntime, String> {
    let mode = std::env::var("AETHERCORE_MODE").unwrap_or_else(|_| "desktop-local".to_string());
    if mode != "desktop-local" {
        log::info!(
            "Skipping local control plane bootstrap because AETHERCORE_MODE={} (desktop-local only)",
            mode
        );
        return Ok(LocalControlPlaneRuntime {
            spawned_children: Vec::new(),
        });
    }

    let manifest_path = resolve_manifest_path()?;
    let manifest = read_manifest(&manifest_path)?;

    log::info!(
        "Bootstrapping local control plane: mode={}, version={}, manifest={}",
        manifest.mode,
        manifest.version,
        manifest_path.display()
    );

    let mut services = manifest.services;
    services.sort_by_key(|service| service.startup_order);

    let mut spawned_children = Vec::new();

    for service in services {
        if is_service_healthy(&service.health_endpoint, service.port) {
            log::info!("Service {} already healthy", service.name);
            continue;
        }

        log::info!(
            "Starting local service {} ({})",
            service.name,
            service.start_command
        );
        spawned_children.push(spawn_service(&service)?);

        thread::sleep(Duration::from_millis(
            manifest.startup.service_start_grace_period_ms,
        ));

        wait_for_service_health(&service, &manifest.startup)?;
    }

    Ok(LocalControlPlaneRuntime { spawned_children })
}

fn resolve_manifest_path() -> Result<PathBuf, String> {
    if let Ok(path) = std::env::var("AETHERCORE_LOCAL_CONTROL_PLANE_MANIFEST") {
        return Ok(PathBuf::from(path));
    }

    let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    Ok(manifest_dir
        .join("..")
        .join("..")
        .join("..")
        .join("config")
        .join("local-control-plane.toml"))
}

fn read_manifest(path: &Path) -> Result<LocalControlPlaneManifest, String> {
    let contents = std::fs::read_to_string(path).map_err(|error| {
        format!(
            "Unable to read local control plane manifest {}: {}",
            path.display(),
            error
        )
    })?;

    toml::from_str::<LocalControlPlaneManifest>(&contents).map_err(|error| {
        format!(
            "Unable to parse local control plane manifest {}: {}",
            path.display(),
            error
        )
    })
}

fn spawn_service(service: &ManagedService) -> Result<Child, String> {
    let repo_root = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("..")
        .join("..")
        .join("..");
    let working_directory = repo_root.join(&service.working_dir);

    Command::new("bash")
        .arg("-lc")
        .arg(service.start_command.clone())
        .current_dir(working_directory)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|error| {
            format!(
                "Failed to start service {} using command '{}': {}",
                service.name, service.start_command, error
            )
        })
}

fn wait_for_service_health(
    service: &ManagedService,
    startup: &StartupPolicy,
) -> Result<(), String> {
    let timeout = Duration::from_secs(startup.service_health_timeout_secs);
    let poll_interval = Duration::from_millis(startup.health_poll_interval_ms);
    let started = Instant::now();

    while started.elapsed() < timeout {
        if is_service_healthy(&service.health_endpoint, service.port) {
            log::info!("Service {} is healthy", service.name);
            return Ok(());
        }

        thread::sleep(poll_interval);
    }

    if service.required {
        Err(format!(
            "Local control plane service '{}' failed health checks at {} within {} seconds",
            service.name, service.health_endpoint, startup.service_health_timeout_secs
        ))
    } else {
        log::warn!(
            "Optional local service {} failed health checks at {}",
            service.name,
            service.health_endpoint
        );
        Ok(())
    }
}

fn is_service_healthy(health_endpoint: &str, fallback_port: u16) -> bool {
    let parsed = match Url::parse(health_endpoint) {
        Ok(url) => url,
        Err(error) => {
            log::warn!("Invalid health endpoint {}: {}", health_endpoint, error);
            return false;
        }
    };

    if parsed.scheme() != "http" {
        log::warn!(
            "Unsupported health endpoint scheme {} for {}; only http is supported",
            parsed.scheme(),
            health_endpoint
        );
        return false;
    }

    let host = parsed.host_str().unwrap_or("127.0.0.1");
    let port = parsed.port().unwrap_or(fallback_port);
    let path = if parsed.path().is_empty() {
        "/"
    } else {
        parsed.path()
    };

    let address = format!("{}:{}", host, port);

    let mut stream = match TcpStream::connect(address) {
        Ok(stream) => stream,
        Err(_) => return false,
    };

    if stream
        .set_read_timeout(Some(Duration::from_millis(1500)))
        .is_err()
    {
        return false;
    }

    let request = format!(
        "GET {} HTTP/1.1\r\nHost: {}\r\nConnection: close\r\n\r\n",
        path, host
    );

    if stream.write_all(request.as_bytes()).is_err() {
        return false;
    }

    let mut response_buffer = [0_u8; 1024];
    match stream.read(&mut response_buffer) {
        Ok(size) if size > 0 => {
            let response_head = String::from_utf8_lossy(&response_buffer[..size]);
            response_head.starts_with("HTTP/1.1 200") || response_head.starts_with("HTTP/1.0 200")
        }
        _ => false,
    }
}
