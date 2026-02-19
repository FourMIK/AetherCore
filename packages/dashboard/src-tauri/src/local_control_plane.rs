use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::io::{Read, Write};
use std::net::TcpStream;
#[cfg(unix)]
use std::os::unix::fs::PermissionsExt;
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
    #[serde(default)]
    pub health_check_timeout_secs: Option<u64>,
    #[serde(default)]
    pub health_check_retries: Option<u32>,
    pub working_dir: String,
    pub start_executable: String,
    #[serde(default)]
    pub start_args: Vec<String>,
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

#[derive(Debug, Clone, Serialize)]
pub struct StackReadiness {
    pub ready: bool,
    pub required_services: usize,
    pub healthy_required_services: usize,
    pub services: Vec<ServiceStatus>,
    pub readiness: Vec<ServiceReadiness>,
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

    let ordered = ordered_services(&manifest.services)?;
    let services_by_name = manifest
        .services
        .iter()
        .map(|service| (service.name.clone(), service))
        .collect::<HashMap<_, _>>();
    let mut health_by_name = manifest
        .services
        .iter()
        .map(|service| {
            (
                service.name.clone(),
                is_service_healthy(&service.health_endpoint, service.port),
            )
        })
        .collect::<HashMap<_, _>>();

    let mut spawned_children = HashMap::new();

    for service in ordered {
        if let Some(blocking_dependency) =
            first_unhealthy_dependency(service, &services_by_name, &health_by_name)
        {
            return Err(dependency_block_error(
                service,
                &blocking_dependency,
                &services_by_name,
            ));
        }

        if is_service_healthy(&service.health_endpoint, service.port) {
            log::info!("Service {} already healthy", service.name);
            health_by_name.insert(service.name.clone(), true);
            continue;
        }

        log::info!(
            "Starting local service {} ({})",
            service.name,
            service.start_executable
        );
        spawned_children.insert(service.name.clone(), spawn_service(service)?);

        thread::sleep(Duration::from_millis(
            manifest.startup.service_start_grace_period_ms,
        ));

        let readiness = ensure_service_health(service, &manifest.startup)?;
        health_by_name.insert(service.name.clone(), readiness.healthy);
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

pub fn evaluate_stack_readiness() -> Result<StackReadiness, String> {
    let manifest = read_manifest(&resolve_manifest_path()?)?;
    let statuses = check_service_statuses()?;
    let services_by_name = manifest
        .services
        .iter()
        .map(|service| (service.name.clone(), service))
        .collect::<HashMap<_, _>>();
    let health_by_name = statuses
        .iter()
        .map(|status| (status.name.clone(), status.healthy))
        .collect::<HashMap<_, _>>();

    let readiness = manifest
        .services
        .iter()
        .map(|service| {
            let direct_health = is_service_healthy(&service.health_endpoint, service.port);
            if let Some(blocking_dependency) =
                first_unhealthy_dependency(service, &services_by_name, &health_by_name)
            {
                ServiceReadiness {
                    name: service.name.clone(),
                    healthy: false,
                    attempts: 0,
                    elapsed_ms: 0,
                    last_error: Some(format!(
                        "Dependency '{}' is unhealthy and blocks startup readiness",
                        blocking_dependency
                    )),
                    remediation_hint: dependency_block_error(
                        service,
                        &blocking_dependency,
                        &services_by_name,
                    ),
                }
            } else {
                ServiceReadiness {
                    name: service.name.clone(),
                    healthy: direct_health,
                    attempts: 0,
                    elapsed_ms: 0,
                    last_error: None,
                    remediation_hint: service.remediation_hint.clone(),
                }
            }
        })
        .collect::<Vec<_>>();

    let required_services = statuses.iter().filter(|service| service.required).count();
    let healthy_required_services = statuses
        .iter()
        .filter(|service| service.required && service.healthy)
        .count();

    Ok(StackReadiness {
        ready: required_services == healthy_required_services,
        required_services,
        healthy_required_services,
        services: statuses,
        readiness,
    })
}

pub fn start_managed_services() -> Result<Vec<ServiceStatus>, String> {
    initialize_managed_runtime();
    let manifest = read_manifest(&resolve_manifest_path()?)?;
    let services = ordered_services(&manifest.services)?;
    let services_by_name = manifest
        .services
        .iter()
        .map(|service| (service.name.clone(), service))
        .collect::<HashMap<_, _>>();
    let mut health_by_name = manifest
        .services
        .iter()
        .map(|service| {
            (
                service.name.clone(),
                is_service_healthy(&service.health_endpoint, service.port),
            )
        })
        .collect::<HashMap<_, _>>();

    let mut runtime = MANAGED_RUNTIME
        .get()
        .expect("managed runtime must be initialized")
        .lock()
        .map_err(|_| "Failed to lock managed runtime".to_string())?;

    for service in &services {
        if let Some(blocking_dependency) =
            first_unhealthy_dependency(service, &services_by_name, &health_by_name)
        {
            return Err(dependency_block_error(
                service,
                &blocking_dependency,
                &services_by_name,
            ));
        }

        if is_service_healthy(&service.health_endpoint, service.port) {
            health_by_name.insert(service.name.clone(), true);
            continue;
        }

        if runtime.spawned_children.contains_key(&service.name) {
            let readiness = ensure_service_health(service, &manifest.startup)?;
            health_by_name.insert(service.name.clone(), readiness.healthy);
            continue;
        }

        runtime
            .spawned_children
            .insert(service.name.clone(), spawn_service(service)?);
        thread::sleep(Duration::from_millis(
            manifest.startup.service_start_grace_period_ms,
        ));
        let readiness = ensure_service_health(service, &manifest.startup)?;
        health_by_name.insert(service.name.clone(), readiness.healthy);
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
    let services_by_name = manifest
        .services
        .iter()
        .map(|entry| (entry.name.clone(), entry))
        .collect::<HashMap<_, _>>();
    let health_by_name = manifest
        .services
        .iter()
        .map(|entry| {
            (
                entry.name.clone(),
                is_service_healthy(&entry.health_endpoint, entry.port),
            )
        })
        .collect::<HashMap<_, _>>();

    if let Some(blocking_dependency) =
        first_unhealthy_dependency(service, &services_by_name, &health_by_name)
    {
        return Err(dependency_block_error(
            service,
            &blocking_dependency,
            &services_by_name,
        ));
    }

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

    let manifest = toml::from_str::<LocalControlPlaneManifest>(&contents).map_err(|error| {
        format!(
            "Unable to parse local control plane manifest {}: {}",
            path.display(),
            error
        )
    })?;

    validate_dependency_graph(&manifest.services)?;

    Ok(manifest)
}

fn validate_dependency_graph(services: &[ManagedService]) -> Result<(), String> {
    let services_by_name = services
        .iter()
        .map(|service| (service.name.clone(), service))
        .collect::<HashMap<_, _>>();

    for service in services {
        for dependency in &service.depends_on {
            if !services_by_name.contains_key(dependency) {
                return Err(format!(
                    "Service '{}' depends on missing service '{}'. Remediation hint: {}",
                    service.name, dependency, service.remediation_hint
                ));
            }
        }
    }

    fn dfs_cycle<'a>(
        service_name: &'a str,
        services_by_name: &HashMap<String, &'a ManagedService>,
        visited: &mut HashSet<String>,
        stack: &mut Vec<String>,
        stack_set: &mut HashSet<String>,
    ) -> Option<Vec<String>> {
        if stack_set.contains(service_name) {
            if let Some(index) = stack.iter().position(|name| name == service_name) {
                let mut cycle = stack[index..].to_vec();
                cycle.push(service_name.to_string());
                return Some(cycle);
            }
        }

        if !visited.insert(service_name.to_string()) {
            return None;
        }

        stack.push(service_name.to_string());
        stack_set.insert(service_name.to_string());

        if let Some(service) = services_by_name.get(service_name) {
            for dependency in &service.depends_on {
                if let Some(cycle) =
                    dfs_cycle(dependency, services_by_name, visited, stack, stack_set)
                {
                    return Some(cycle);
                }
            }
        }

        stack.pop();
        stack_set.remove(service_name);
        None
    }

    let mut visited = HashSet::new();
    let mut stack = Vec::new();
    let mut stack_set = HashSet::new();
    for service in services {
        if let Some(cycle) = dfs_cycle(
            &service.name,
            &services_by_name,
            &mut visited,
            &mut stack,
            &mut stack_set,
        ) {
            return Err(format!(
                "Dependency cycle detected in local control plane manifest: {}",
                cycle.join(" -> ")
            ));
        }
    }

    Ok(())
}

fn ordered_services<'a>(services: &'a [ManagedService]) -> Result<Vec<&'a ManagedService>, String> {
    let mut services_by_name = HashMap::new();
    let mut indegree = HashMap::new();
    let mut reverse_edges: HashMap<String, Vec<String>> = HashMap::new();

    for service in services {
        services_by_name.insert(service.name.clone(), service);
        indegree.entry(service.name.clone()).or_insert(0_u32);
    }

    for service in services {
        for dependency in &service.depends_on {
            *indegree.entry(service.name.clone()).or_insert(0) += 1;
            reverse_edges
                .entry(dependency.clone())
                .or_default()
                .push(service.name.clone());
        }
    }

    let mut ready = services
        .iter()
        .filter(|service| *indegree.get(&service.name).unwrap_or(&0) == 0)
        .collect::<Vec<_>>();
    ready.sort_by_key(|service| (service.startup_order, service.name.clone()));

    let mut ordered = Vec::with_capacity(services.len());

    while let Some(service) = ready.first().copied() {
        ready.remove(0);
        ordered.push(service);

        if let Some(dependents) = reverse_edges.get(&service.name) {
            for dependent in dependents {
                if let Some(next) = indegree.get_mut(dependent) {
                    *next = next.saturating_sub(1);
                    if *next == 0 {
                        if let Some(candidate) = services_by_name.get(dependent) {
                            ready.push(candidate);
                        }
                    }
                }
            }
            ready.sort_by_key(|candidate| (candidate.startup_order, candidate.name.clone()));
        }
    }

    if ordered.len() != services.len() {
        return Err("Unable to resolve startup ordering due to dependency cycle".to_string());
    }

    Ok(ordered)
}

fn first_unhealthy_dependency(
    service: &ManagedService,
    services_by_name: &HashMap<String, &ManagedService>,
    health_by_name: &HashMap<String, bool>,
) -> Option<String> {
    fn walk(
        service_name: &str,
        services_by_name: &HashMap<String, &ManagedService>,
        health_by_name: &HashMap<String, bool>,
        visited: &mut HashSet<String>,
    ) -> Option<String> {
        if !visited.insert(service_name.to_string()) {
            return None;
        }

        let service = services_by_name.get(service_name)?;
        for dependency in &service.depends_on {
            if !health_by_name.get(dependency).copied().unwrap_or(false) {
                return Some(dependency.clone());
            }
            if let Some(blocker) = walk(dependency, services_by_name, health_by_name, visited) {
                return Some(blocker);
            }
        }
        None
    }

    walk(
        &service.name,
        services_by_name,
        health_by_name,
        &mut HashSet::new(),
    )
}

fn dependency_block_error(
    service: &ManagedService,
    blocking_dependency: &str,
    services_by_name: &HashMap<String, &ManagedService>,
) -> String {
    let dependency_hint = services_by_name
        .get(blocking_dependency)
        .map(|dependency| dependency.remediation_hint.as_str())
        .unwrap_or("Investigate dependency health checks and startup logs");

    format!(
        "Service '{}' is blocked by unhealthy dependency '{}'. Service hint: {}. Upstream hint: {}",
        service.name, blocking_dependency, service.remediation_hint, dependency_hint
    )
}

fn spawn_service(service: &ManagedService) -> Result<Child, String> {
    let repo_root = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("..")
        .join("..")
        .join("..");
    let working_directory = repo_root.join(&service.working_dir);

    validate_service_startup(service, &working_directory)?;

    let executable = expand_runtime_tokens(&service.start_executable, &working_directory)?;

    Command::new(&executable)
        .args(service.start_args.iter())
        .current_dir(working_directory)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|error| {
            format!(
                "Failed to start service {} using executable '{}' and args {:?}: {}",
                service.name,
                executable.display(),
                service.start_args,
                error
            )
        })
}

fn validate_service_startup(
    service: &ManagedService,
    working_directory: &Path,
) -> Result<(), String> {
    if !working_directory.exists() {
        return Err(format!(
            "Service '{}' working directory does not exist: {}. Remediation hint: {}",
            service.name,
            working_directory.display(),
            service.remediation_hint
        ));
    }

    let executable = expand_runtime_tokens(&service.start_executable, working_directory)?;
    if !executable.exists() {
        return Err(format!(
            "Service '{}' executable is missing at {}. Remediation hint: {}",
            service.name,
            executable.display(),
            service.remediation_hint
        ));
    }

    if !executable.is_file() {
        return Err(format!(
            "Service '{}' executable path is not a file: {}. Remediation hint: {}",
            service.name,
            executable.display(),
            service.remediation_hint
        ));
    }

    #[cfg(unix)]
    {
        let metadata = std::fs::metadata(&executable).map_err(|error| {
            format!(
                "Unable to read metadata for service '{}' executable {}: {}",
                service.name,
                executable.display(),
                error
            )
        })?;
        let mode = metadata.permissions().mode();
        if mode & 0o111 == 0 {
            return Err(format!(
                "Service '{}' executable is not marked executable: {}. Remediation hint: {}",
                service.name,
                executable.display(),
                service.remediation_hint
            ));
        }
    }

    #[cfg(windows)]
    {
        let is_exe = executable
            .extension()
            .and_then(|ext| ext.to_str())
            .map(|ext| {
                ext.eq_ignore_ascii_case("exe")
                    || ext.eq_ignore_ascii_case("cmd")
                    || ext.eq_ignore_ascii_case("bat")
            })
            .unwrap_or(false);
        if !is_exe {
            return Err(format!(
                "Service '{}' executable must be .exe, .cmd, or .bat on Windows: {}. Remediation hint: {}",
                service.name,
                executable.display(),
                service.remediation_hint
            ));
        }
    }

    Ok(())
}

fn runtime_root() -> PathBuf {
    if let Ok(path) = std::env::var("AETHERCORE_RUNTIME_ROOT") {
        return PathBuf::from(path);
    }

    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("resources")
        .join(current_platform_dir())
}

fn current_platform_dir() -> &'static str {
    if cfg!(target_os = "windows") {
        "windows"
    } else if cfg!(target_os = "macos") {
        "macos"
    } else {
        "linux"
    }
}

fn expand_runtime_tokens(raw: &str, working_directory: &Path) -> Result<PathBuf, String> {
    let runtime_root = runtime_root();
    let rendered = raw
        .replace(
            "${AETHERCORE_RUNTIME_ROOT}",
            &runtime_root.to_string_lossy(),
        )
        .replace("${WORKING_DIR}", &working_directory.to_string_lossy());
    let candidate = PathBuf::from(rendered);

    let mut resolved = if candidate.is_absolute() {
        candidate
    } else {
        working_directory.join(candidate)
    };

    #[cfg(windows)]
    {
        if resolved.extension().is_none() {
            let cmd_candidate = resolved.with_extension("cmd");
            if cmd_candidate.exists() {
                resolved = cmd_candidate;
            }
        }
    }

    Ok(resolved)
}

fn ensure_service_health(
    service: &ManagedService,
    startup: &StartupPolicy,
) -> Result<ServiceReadiness, String> {
    let max_attempts = service
        .health_check_retries
        .unwrap_or(startup.health_check_retries)
        + 1;
    let total_started = Instant::now();
    let mut last_error = None;

    for attempt in 1..=max_attempts {
        let timeout = Duration::from_secs(
            service
                .health_check_timeout_secs
                .unwrap_or(startup.service_health_timeout_secs),
        );
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
            service
                .health_check_timeout_secs
                .unwrap_or(startup.service_health_timeout_secs),
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

#[cfg(test)]
mod tests {
    use super::*;

    fn test_service(name: &str, startup_order: u32, depends_on: Vec<&str>) -> ManagedService {
        ManagedService {
            name: name.to_string(),
            startup_order,
            required: true,
            port: 1000 + startup_order as u16,
            health_endpoint: format!("http://127.0.0.1:{}/health", 1000 + startup_order as u16),
            remediation_hint: format!("fix {}", name),
            depends_on: depends_on.into_iter().map(|dep| dep.to_string()).collect(),
            health_check_timeout_secs: Some(1),
            health_check_retries: Some(0),
            working_dir: ".".to_string(),
            start_executable: "/bin/echo".to_string(),
            start_args: vec![],
        }
    }

    #[test]
    fn detects_missing_dependency_reference() {
        let services = vec![
            test_service("alpha", 2, vec!["missing"]),
            test_service("beta", 1, vec![]),
        ];

        let error = validate_dependency_graph(&services).unwrap_err();
        assert!(error.contains("missing service 'missing'"));
    }

    #[test]
    fn detects_dependency_cycle() {
        let services = vec![
            test_service("alpha", 1, vec!["beta"]),
            test_service("beta", 2, vec!["gamma"]),
            test_service("gamma", 3, vec!["alpha"]),
        ];

        let error = validate_dependency_graph(&services).unwrap_err();
        assert!(error.contains("Dependency cycle detected"));
        assert!(error.contains("alpha -> beta -> gamma -> alpha"));
    }

    #[test]
    fn orders_services_by_dependencies_before_startup_order() {
        let services = vec![
            test_service("api", 1, vec!["db"]),
            test_service("db", 50, vec![]),
            test_service("cache", 2, vec![]),
        ];

        let ordered = ordered_services(&services).expect("ordering should succeed");
        let names = ordered
            .into_iter()
            .map(|service| service.name.clone())
            .collect::<Vec<_>>();

        let db_index = names.iter().position(|name| name == "db").unwrap();
        let api_index = names.iter().position(|name| name == "api").unwrap();
        assert!(
            db_index < api_index,
            "dependency should start before dependent"
        );
    }

    #[test]
    fn finds_transitive_unhealthy_dependency_for_gating() {
        let database = test_service("database", 1, vec![]);
        let backend = test_service("backend", 2, vec!["database"]);
        let frontend = test_service("frontend", 3, vec!["backend"]);

        let services = vec![database.clone(), backend.clone(), frontend.clone()];
        let services_by_name = services
            .iter()
            .map(|service| (service.name.clone(), service))
            .collect::<HashMap<_, _>>();
        let health_by_name = HashMap::from([
            ("database".to_string(), false),
            ("backend".to_string(), true),
            ("frontend".to_string(), false),
        ]);

        let blocker = first_unhealthy_dependency(&frontend, &services_by_name, &health_by_name)
            .expect("frontend should be blocked by unhealthy dependency");
        assert_eq!(blocker, "database");

        let error = dependency_block_error(&frontend, &blocker, &services_by_name);
        assert!(error.contains("unhealthy dependency 'database'"));
        assert!(error.contains("Upstream hint: fix database"));
    }
}
