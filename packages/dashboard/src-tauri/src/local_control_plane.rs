use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::io::{Read, Write};
use std::net::TcpStream;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::{Mutex, OnceLock};
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
    #[serde(default = "default_max_retries")]
    pub health_check_retries: u32,
    #[serde(default = "default_retry_backoff_ms")]
    pub retry_backoff_ms: u64,
}

#[derive(Debug, Clone, Deserialize)]
pub struct ManagedService {
    pub name: String,
    pub startup_order: u32,
    pub required: bool,
    pub port: u16,
    pub health_endpoint: String,
    #[serde(default)]
    pub remediation_hint: String,
    #[serde(default)]
    pub depends_on: Vec<String>,
    pub working_dir: String,
    pub start_command: String,
}

#[derive(Debug)]
pub struct LocalControlPlaneRuntime {
    spawned_children: HashMap<String, Child>,
}

static MANAGED_RUNTIME: OnceLock<Mutex<LocalControlPlaneRuntime>> = OnceLock::new();

#[derive(Debug, Clone, Serialize)]
pub struct ServiceStatus {
    pub name: String,
    pub required: bool,
    pub healthy: bool,
    pub health_endpoint: String,
    pub port: u16,
    pub remediation_hint: String,
    pub startup_order: u32,
    pub running: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct ServiceReadiness {
    pub name: String,
    pub healthy: bool,
    pub attempts: u32,
    pub elapsed_ms: u128,
    pub last_error: Option<String>,
    pub remediation_hint: String,
}

impl Drop for LocalControlPlaneRuntime {
    fn drop(&mut self) {
        for child in self.spawned_children.values_mut() {
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
            spawned_children: HashMap::new(),
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

    let mut spawned_children = HashMap::new();

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
        spawned_children.insert(service.name.clone(), spawn_service(&service)?);

        thread::sleep(Duration::from_millis(
            manifest.startup.service_start_grace_period_ms,
        ));

        ensure_service_health(&service, &manifest.startup)?;
    }

    Ok(LocalControlPlaneRuntime { spawned_children })
}

pub fn initialize_managed_runtime() {
    MANAGED_RUNTIME.get_or_init(|| {
        Mutex::new(LocalControlPlaneRuntime {
            spawned_children: HashMap::new(),
        })
    });
}

pub fn ensure_local_data_dirs() -> Result<Vec<String>, String> {
    let base = std::env::var("AETHERCORE_LOCAL_DATA_ROOT")
        .map(PathBuf::from)
        .unwrap_or_else(|_| std::env::temp_dir().join("aethercore"));

    let dirs = [
        base.join("dashboard"),
        base.join("dashboard").join("config"),
        base.join("dashboard").join("logs"),
        base.join("dashboard").join("state"),
    ];

    let mut created = Vec::new();
    for dir in dirs {
        std::fs::create_dir_all(&dir).map_err(|error| {
            format!(
                "Failed to initialize data directory {}: {}",
                dir.display(),
                error
            )
        })?;
        created.push(dir.to_string_lossy().to_string());
    }

    Ok(created)
}

pub fn check_service_statuses() -> Result<Vec<ServiceStatus>, String> {
    let manifest = read_manifest(&resolve_manifest_path()?)?;
    initialize_managed_runtime();
    let runtime = MANAGED_RUNTIME
        .get()
        .expect("managed runtime must be initialized")
        .lock()
        .map_err(|_| "Failed to lock managed runtime".to_string())?;

    Ok(manifest
        .services
        .iter()
        .map(|service| ServiceStatus {
            name: service.name.clone(),
            required: service.required,
            healthy: is_service_healthy(&service.health_endpoint, service.port),
            health_endpoint: service.health_endpoint.clone(),
            port: service.port,
            remediation_hint: service.remediation_hint.clone(),
            startup_order: service.startup_order,
            running: runtime.spawned_children.contains_key(&service.name),
        })
        .collect())
}

pub fn start_managed_services() -> Result<Vec<ServiceStatus>, String> {
    initialize_managed_runtime();
    let manifest = read_manifest(&resolve_manifest_path()?)?;
    let mut services = manifest.services;
    services.sort_by_key(|service| service.startup_order);

    let mut runtime = MANAGED_RUNTIME
        .get()
        .expect("managed runtime must be initialized")
        .lock()
        .map_err(|_| "Failed to lock managed runtime".to_string())?;

    for service in &services {
        if is_service_healthy(&service.health_endpoint, service.port) {
            continue;
        }

        if runtime.spawned_children.contains_key(&service.name) {
            continue;
        }

        runtime
            .spawned_children
            .insert(service.name.clone(), spawn_service(service)?);
        thread::sleep(Duration::from_millis(
            manifest.startup.service_start_grace_period_ms,
        ));
        ensure_service_health(service, &manifest.startup)?;
    }

    Ok(services
        .iter()
        .map(|service| ServiceStatus {
            name: service.name.clone(),
            required: service.required,
            healthy: is_service_healthy(&service.health_endpoint, service.port),
            health_endpoint: service.health_endpoint.clone(),
            port: service.port,
            remediation_hint: service.remediation_hint.clone(),
            startup_order: service.startup_order,
            running: runtime.spawned_children.contains_key(&service.name),
        })
        .collect())
}

pub fn start_dependency(service_name: &str) -> Result<ServiceStatus, String> {
    initialize_managed_runtime();
    let manifest = read_manifest(&resolve_manifest_path()?)?;
    let service = manifest
        .services
        .iter()
        .find(|service| service.name == service_name)
        .ok_or_else(|| format!("Service '{}' not found in manifest", service_name))?;

    let mut runtime = MANAGED_RUNTIME
        .get()
        .expect("managed runtime must be initialized")
        .lock()
        .map_err(|_| "Failed to lock managed runtime".to_string())?;

    if !runtime.spawned_children.contains_key(service_name)
        && !is_service_healthy(&service.health_endpoint, service.port)
    {
        runtime
            .spawned_children
            .insert(service.name.clone(), spawn_service(service)?);
        thread::sleep(Duration::from_millis(
            manifest.startup.service_start_grace_period_ms,
        ));
    }

    let readiness = ensure_service_health(service, &manifest.startup)?;
    Ok(ServiceStatus {
        name: service.name.clone(),
        required: service.required,
        healthy: readiness.healthy,
        health_endpoint: service.health_endpoint.clone(),
        port: service.port,
        remediation_hint: service.remediation_hint.clone(),
        startup_order: service.startup_order,
        running: runtime.spawned_children.contains_key(service_name),
    })
}

pub fn stop_dependency(service_name: &str) -> Result<ServiceStatus, String> {
    initialize_managed_runtime();
    let manifest = read_manifest(&resolve_manifest_path()?)?;
    let service = manifest
        .services
        .iter()
        .find(|service| service.name == service_name)
        .ok_or_else(|| format!("Service '{}' not found in manifest", service_name))?;

    let mut runtime = MANAGED_RUNTIME
        .get()
        .expect("managed runtime must be initialized")
        .lock()
        .map_err(|_| "Failed to lock managed runtime".to_string())?;

    if let Some(mut child) = runtime.spawned_children.remove(service_name) {
        let _ = child.kill();
    }

    Ok(ServiceStatus {
        name: service.name.clone(),
        required: service.required,
        healthy: is_service_healthy(&service.health_endpoint, service.port),
        health_endpoint: service.health_endpoint.clone(),
        port: service.port,
        remediation_hint: service.remediation_hint.clone(),
        startup_order: service.startup_order,
        running: runtime.spawned_children.contains_key(service_name),
    })
}

pub fn retry_dependency(service_name: &str) -> Result<ServiceReadiness, String> {
    stop_dependency(service_name)?;
    let manifest = read_manifest(&resolve_manifest_path()?)?;
    let service = manifest
        .services
        .iter()
        .find(|service| service.name == service_name)
        .ok_or_else(|| format!("Service '{}' not found in manifest", service_name))?;

    initialize_managed_runtime();
    let mut runtime = MANAGED_RUNTIME
        .get()
        .expect("managed runtime must be initialized")
        .lock()
        .map_err(|_| "Failed to lock managed runtime".to_string())?;
    runtime
        .spawned_children
        .insert(service.name.clone(), spawn_service(service)?);
    thread::sleep(Duration::from_millis(
        manifest.startup.service_start_grace_period_ms,
    ));

    ensure_service_health(service, &manifest.startup)
}

pub fn stop_managed_services() -> Result<(), String> {
    initialize_managed_runtime();
    let mut runtime = MANAGED_RUNTIME
        .get()
        .expect("managed runtime must be initialized")
        .lock()
        .map_err(|_| "Failed to lock managed runtime".to_string())?;

    for child in runtime.spawned_children.values_mut() {
        let _ = child.kill();
    }
    runtime.spawned_children.clear();
    Ok(())
}

pub fn verify_http_endpoint(endpoint: &str, fallback_port: u16) -> Result<(), String> {
    if is_service_healthy(endpoint, fallback_port) {
        Ok(())
    } else {
        Err(format!(
            "HTTP endpoint {} failed health verification",
            endpoint
        ))
    }
}

pub fn verify_websocket_port(endpoint: &str) -> Result<(), String> {
    let parsed = Url::parse(endpoint)
        .map_err(|error| format!("Invalid WebSocket endpoint {}: {}", endpoint, error))?;
    if parsed.scheme() != "ws" && parsed.scheme() != "wss" {
        return Err(format!(
            "Unsupported WebSocket scheme {} for {}",
            parsed.scheme(),
            endpoint
        ));
    }

    let host = parsed.host_str().unwrap_or("127.0.0.1");
    let port = parsed
        .port()
        .unwrap_or(if parsed.scheme() == "wss" { 443 } else { 80 });
    let address = format!("{}:{}", host, port);

    TcpStream::connect_timeout(
        &address
            .parse()
            .map_err(|error| format!("Invalid WebSocket socket address {}: {}", address, error))?,
        Duration::from_secs(2),
    )
    .map(|_| ())
    .map_err(|error| format!("WebSocket endpoint {} is unreachable: {}", endpoint, error))
}

pub fn resolve_manifest_path() -> Result<PathBuf, String> {
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

pub fn read_manifest(path: &Path) -> Result<LocalControlPlaneManifest, String> {
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

fn ensure_service_health(
    service: &ManagedService,
    startup: &StartupPolicy,
) -> Result<ServiceReadiness, String> {
    let max_attempts = startup.health_check_retries + 1;
    let total_started = Instant::now();
    let mut last_error = None;

    for attempt in 1..=max_attempts {
        let timeout = Duration::from_secs(startup.service_health_timeout_secs);
        let poll_interval = Duration::from_millis(startup.health_poll_interval_ms);
        let started = Instant::now();

        while started.elapsed() < timeout {
            if is_service_healthy(&service.health_endpoint, service.port) {
                log::info!(
                    "Service {} is healthy on attempt {}/{}",
                    service.name,
                    attempt,
                    max_attempts
                );
                return Ok(ServiceReadiness {
                    name: service.name.clone(),
                    healthy: true,
                    attempts: attempt,
                    elapsed_ms: total_started.elapsed().as_millis(),
                    last_error: None,
                    remediation_hint: service.remediation_hint.clone(),
                });
            }

            thread::sleep(poll_interval);
        }

        last_error = Some(format!(
            "Service '{}' failed health checks at {} within {} seconds (attempt {}/{})",
            service.name,
            service.health_endpoint,
            startup.service_health_timeout_secs,
            attempt,
            max_attempts
        ));
        if attempt < max_attempts {
            thread::sleep(Duration::from_millis(startup.retry_backoff_ms));
        }
    }

    if service.required {
        Err(format!(
            "{}. Remediation hint: {}",
            last_error
                .unwrap_or_else(|| format!("Service '{}' did not become healthy", service.name)),
            service.remediation_hint
        ))
    } else {
        log::warn!(
            "Optional local service {} failed health checks at {}",
            service.name,
            service.health_endpoint
        );
        Ok(ServiceReadiness {
            name: service.name.clone(),
            healthy: false,
            attempts: max_attempts,
            elapsed_ms: total_started.elapsed().as_millis(),
            last_error,
            remediation_hint: service.remediation_hint.clone(),
        })
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

fn default_max_retries() -> u32 {
    2
}

fn default_retry_backoff_ms() -> u64 {
    1250
}
