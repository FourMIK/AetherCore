use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, VecDeque};
use std::io::{BufRead, BufReader};
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex};
use std::thread;

/// Maximum number of log lines to keep in the ring buffer per process
const MAX_LOG_LINES: usize = 1000;

/// Represents a running node process with its metadata
#[derive(Debug)]
pub struct NodeProcess {
    pub node_id: String,
    pub child: Child,
    pub pid: u32,
    pub port: u16,
    pub started_at: u64,
    pub status: ProcessStatus,
    pub logs: Arc<Mutex<VecDeque<String>>>,
    pub config_path: PathBuf,
}

/// Status of a node process
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum ProcessStatus {
    Running,
    Stopped,
    Failed,
}

/// Serializable information about a node process
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NodeProcessInfo {
    pub node_id: String,
    pub pid: u32,
    pub port: u16,
    pub started_at: u64,
    pub status: ProcessStatus,
}

/// Manages spawned node processes
pub struct NodeProcessManager {
    processes: Arc<Mutex<HashMap<String, NodeProcess>>>,
}

impl NodeProcessManager {
    /// Create a new NodeProcessManager
    pub fn new() -> Self {
        Self {
            processes: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    /// Spawn a new node process
    ///
    /// # Arguments
    /// * `node_id` - Unique identifier for the node
    /// * `binary_path` - Path to the node binary executable
    /// * `config_path` - Path to the configuration file
    /// * `port` - Listen port for the node
    ///
    /// # Returns
    /// Result containing the PID of the spawned process
    pub fn spawn(
        &self,
        node_id: String,
        binary_path: String,
        config_path: String,
        port: u16,
    ) -> Result<u32> {
        log::info!("Spawning node process: {} on port {}", node_id, port);

        // Check if node already exists
        {
            let processes = self
                .processes
                .lock()
                .map_err(|e| anyhow::anyhow!("Failed to acquire lock: {}", e))?;
            if processes.contains_key(&node_id) {
                return Err(anyhow::anyhow!("Node {} already exists", node_id));
            }
        }

        // Spawn the child process with captured stdout/stderr
        let mut child = Command::new(&binary_path)
            .arg("--config")
            .arg(&config_path)
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .context(format!(
                "Failed to spawn node process from binary: {}",
                binary_path
            ))?;

        let pid = child.id();
        log::info!("Node {} spawned with PID: {}", node_id, pid);

        // Create log buffer
        let logs = Arc::new(Mutex::new(VecDeque::with_capacity(MAX_LOG_LINES)));

        // Capture stdout
        if let Some(stdout) = child.stdout.take() {
            let logs_clone = Arc::clone(&logs);
            thread::spawn(move || {
                let reader = BufReader::new(stdout);
                for line in reader.lines() {
                    if let Ok(line) = line {
                        if let Ok(mut log_buffer) = logs_clone.lock() {
                            if log_buffer.len() >= MAX_LOG_LINES {
                                log_buffer.pop_front();
                            }
                            log_buffer.push_back(format!("[OUT] {}", line));
                        }
                    }
                }
            });
        }

        // Capture stderr
        if let Some(stderr) = child.stderr.take() {
            let logs_clone = Arc::clone(&logs);
            thread::spawn(move || {
                let reader = BufReader::new(stderr);
                for line in reader.lines() {
                    if let Ok(line) = line {
                        if let Ok(mut log_buffer) = logs_clone.lock() {
                            if log_buffer.len() >= MAX_LOG_LINES {
                                log_buffer.pop_front();
                            }
                            log_buffer.push_back(format!("[ERR] {}", line));
                        }
                    }
                }
            });
        }

        let started_at = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map_err(|e| anyhow::anyhow!("System time error: {}", e))?
            .as_secs();

        let process = NodeProcess {
            node_id: node_id.clone(),
            child,
            pid,
            port,
            started_at,
            status: ProcessStatus::Running,
            logs,
            config_path: PathBuf::from(&config_path),
        };

        // Store the process
        let mut processes = self
            .processes
            .lock()
            .map_err(|e| anyhow::anyhow!("Failed to acquire lock: {}", e))?;
        processes.insert(node_id, process);

        Ok(pid)
    }

    /// Stop a running node process
    ///
    /// # Arguments
    /// * `node_id` - Unique identifier for the node to stop
    ///
    /// # Returns
    /// Result indicating success or failure
    pub fn stop(&self, node_id: &str) -> Result<()> {
        log::info!("Stopping node process: {}", node_id);

        let mut processes = self
            .processes
            .lock()
            .map_err(|e| anyhow::anyhow!("Failed to acquire lock: {}", e))?;

        let process = processes
            .get_mut(node_id)
            .ok_or_else(|| anyhow::anyhow!("Node {} not found", node_id))?;

        // Kill the process
        process
            .child
            .kill()
            .context(format!("Failed to kill process for node {}", node_id))?;

        // Wait for the process to exit
        let _ = process.child.wait();

        process.status = ProcessStatus::Stopped;
        log::info!("Node {} stopped", node_id);

        // Clean up config file
        let config_path = process.config_path.clone();
        if config_path.exists() {
            if let Err(e) = std::fs::remove_file(&config_path) {
                log::warn!(
                    "Failed to remove config file {}: {}",
                    config_path.display(),
                    e
                );
            } else {
                log::info!("Removed config file: {}", config_path.display());
            }
        }

        // Remove from the process map
        processes.remove(node_id);

        Ok(())
    }

    /// Get the status of a specific node
    ///
    /// # Arguments
    /// * `node_id` - Unique identifier for the node
    ///
    /// # Returns
    /// Option containing the NodeProcessInfo if found
    pub fn get_status(&self, node_id: &str) -> Result<Option<NodeProcessInfo>> {
        let mut processes = self
            .processes
            .lock()
            .map_err(|e| anyhow::anyhow!("Failed to acquire lock: {}", e))?;

        if let Some(process) = processes.get_mut(node_id) {
            // Check if process is still running
            match process.child.try_wait() {
                Ok(Some(_)) => {
                    // Process has exited
                    process.status = ProcessStatus::Stopped;
                }
                Ok(None) => {
                    // Process is still running
                    process.status = ProcessStatus::Running;
                }
                Err(e) => {
                    log::error!("Error checking process status for {}: {}", node_id, e);
                    process.status = ProcessStatus::Failed;
                }
            }

            Ok(Some(NodeProcessInfo {
                node_id: process.node_id.clone(),
                pid: process.pid,
                port: process.port,
                started_at: process.started_at,
                status: process.status.clone(),
            }))
        } else {
            Ok(None)
        }
    }

    /// Get the status of all nodes
    ///
    /// # Returns
    /// Vector of NodeProcessInfo for all managed processes
    pub fn get_all_statuses(&self) -> Result<Vec<NodeProcessInfo>> {
        let mut processes = self
            .processes
            .lock()
            .map_err(|e| anyhow::anyhow!("Failed to acquire lock: {}", e))?;

        let mut statuses = Vec::new();

        for (node_id, process) in processes.iter_mut() {
            // Check if process is still running
            match process.child.try_wait() {
                Ok(Some(_)) => {
                    process.status = ProcessStatus::Stopped;
                }
                Ok(None) => {
                    process.status = ProcessStatus::Running;
                }
                Err(e) => {
                    log::error!("Error checking process status for {}: {}", node_id, e);
                    process.status = ProcessStatus::Failed;
                }
            }

            statuses.push(NodeProcessInfo {
                node_id: process.node_id.clone(),
                pid: process.pid,
                port: process.port,
                started_at: process.started_at,
                status: process.status.clone(),
            });
        }

        Ok(statuses)
    }

    /// Get logs for a specific node
    ///
    /// # Arguments
    /// * `node_id` - Unique identifier for the node
    /// * `tail` - Number of lines to retrieve from the end (0 = all)
    ///
    /// # Returns
    /// Vector of log lines
    pub fn get_logs(&self, node_id: &str, tail: usize) -> Result<Vec<String>> {
        let processes = self
            .processes
            .lock()
            .map_err(|e| anyhow::anyhow!("Failed to acquire lock: {}", e))?;

        let process = processes
            .get(node_id)
            .ok_or_else(|| anyhow::anyhow!("Node {} not found", node_id))?;

        let logs = process
            .logs
            .lock()
            .map_err(|e| anyhow::anyhow!("Failed to acquire log lock: {}", e))?;

        let log_lines: Vec<String> = if tail > 0 {
            logs.iter().rev().take(tail).rev().cloned().collect()
        } else {
            logs.iter().cloned().collect()
        };

        Ok(log_lines)
    }

    /// Shutdown all running node processes
    ///
    /// This should be called when the application is exiting to ensure
    /// all child processes are properly terminated.
    pub fn shutdown_all(&self) -> Result<()> {
        log::info!("Shutting down all node processes");

        let mut processes = self
            .processes
            .lock()
            .map_err(|e| anyhow::anyhow!("Failed to acquire lock: {}", e))?;

        let node_ids: Vec<String> = processes.keys().cloned().collect();

        for node_id in node_ids {
            if let Some(mut process) = processes.remove(&node_id) {
                log::info!("Stopping node: {}", node_id);
                let _ = process.child.kill();
                let _ = process.child.wait();

                // Clean up config file
                if process.config_path.exists() {
                    if let Err(e) = std::fs::remove_file(&process.config_path) {
                        log::warn!(
                            "Failed to remove config file {}: {}",
                            process.config_path.display(),
                            e
                        );
                    }
                }
            }
        }

        log::info!("All node processes shut down");
        Ok(())
    }
}

impl Default for NodeProcessManager {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_node_process_manager_creation() {
        let manager = NodeProcessManager::new();
        let statuses = manager.get_all_statuses().unwrap();
        assert_eq!(statuses.len(), 0);
    }

    #[test]
    fn test_process_status_serialization() {
        let status = ProcessStatus::Running;
        let json = serde_json::to_string(&status).unwrap();
        assert!(json.contains("Running"));

        let deserialized: ProcessStatus = serde_json::from_str(&json).unwrap();
        assert_eq!(deserialized, ProcessStatus::Running);
    }
}
