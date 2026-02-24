use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::thread;
use std::time::Duration;

const NODE_PROTOCOL_VERSION: u32 = 1;
const NODE_RUNTIME_VERSION: u32 = 1;

#[derive(Debug, Serialize)]
struct NodeVersionHandshake {
    version: &'static str,
    runtime_version: u32,
    protocol_version: u32,
}

#[derive(Debug, Deserialize)]
struct NodeConfig {
    node_id: String,
    mesh_endpoint: String,
    listen_port: u16,
    data_dir: String,
    log_level: String,
}

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let args: Vec<String> = std::env::args().collect();

    if args.iter().any(|arg| arg == "--version-json") {
        let handshake = NodeVersionHandshake {
            version: env!("CARGO_PKG_VERSION"),
            runtime_version: NODE_RUNTIME_VERSION,
            protocol_version: NODE_PROTOCOL_VERSION,
        };
        println!("{}", serde_json::to_string(&handshake)?);
        return Ok(());
    }

    let config_path = parse_config_path(&args)?;
    let raw = std::fs::read_to_string(&config_path)?;
    let config: NodeConfig = serde_json::from_str(&raw)?;

    eprintln!(
        "[aethercore-node] started node_id={} endpoint={} port={} data_dir={} log_level={}",
        config.node_id, config.mesh_endpoint, config.listen_port, config.data_dir, config.log_level
    );

    loop {
        thread::sleep(Duration::from_secs(30));
    }
}

fn parse_config_path(args: &[String]) -> Result<PathBuf, Box<dyn std::error::Error>> {
    let mut args_iter = args.iter();
    while let Some(arg) = args_iter.next() {
        if arg == "--config" {
            if let Some(path) = args_iter.next() {
                return Ok(PathBuf::from(path));
            }
            return Err("--config was provided without a path".into());
        }
    }

    Err("missing required --config <path> argument".into())
}
