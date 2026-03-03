use axum::{
    http::StatusCode,
    response::Json,
    routing::{get, post},
    Router,
};
use chrono::Utc;
use serde_json::{json, Value};
use std::sync::Arc;
use tokio::net::TcpListener;
use tower::ServiceBuilder;
use tracing::info;
use tracing_subscriber::fmt::init;

mod config;
mod handlers;
mod state;
pub mod flir;
pub mod video_ingest;

use config::Config;
use state::AppState;

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    init();

    let config = Config::from_env()?;
    let state = Arc::new(AppState::new(config.clone()).await?);

    let app = Router::new()
        .route("/health", get(health_check))
        .route("/ingest/binary", post(handlers::ingest_binary))
        .route("/ingest/telemetry", post(handlers::ingest_telemetry))
        .route("/flir/start", post(flir_start_bridge))
        .route("/video/streams", get(video_ingest::get_sample_streams))
        .route("/video/register", post(video_ingest::register_video_stream))
        .route("/video/sample", post(video_ingest::start_video_sampling))
        .route("/video/frames", get(video_ingest::get_video_frames))
        .with_state(state)
        .layer(ServiceBuilder::new().into_inner());

    let bind_addr = format!("0.0.0.0:{}", config.port);
    let listener = TcpListener::bind(&bind_addr).await?;
    info!("H2-Ingest service listening on {}", bind_addr);

    axum::serve(listener, app).await?;
    Ok(())
}

async fn health_check() -> Result<Json<Value>, StatusCode> {
    Ok(Json(json!({
        "status": "healthy",
        "service": "h2-ingest",
        "timestamp": Utc::now().to_rfc3339()
    })))
}

/// Start FLIR trust bridge endpoint
async fn flir_start_bridge(
    Json(payload): Json<serde_json::Value>,
) -> Result<Json<Value>, StatusCode> {
    let flir_ip = payload["flir_ip"]
        .as_str()
        .unwrap_or("192.168.1.100")
        .to_string();
    let edge_node_ip = payload["edge_node_ip"]
        .as_str()
        .unwrap_or("0.0.0.0")
        .to_string();
    let udp_port = payload["udp_port"]
        .as_u64()
        .unwrap_or(5900) as u16;

    match flir::start_flir_bridge_background(flir_ip.clone(), edge_node_ip.clone(), udp_port).await {
        Ok(_handle) => {
            info!(
                "[FLIR BRIDGE] Started background task for {} on UDP:{}",
                flir_ip, udp_port
            );
            Ok(Json(json!({
                "status": "started",
                "flir_ip": flir_ip,
                "edge_node_ip": edge_node_ip,
                "udp_port": udp_port,
                "timestamp": Utc::now().to_rfc3339()
            })))
        }
        Err(e) => {
            info!("[FLIR BRIDGE] Failed to start: {}", e);
            Err(StatusCode::INTERNAL_SERVER_ERROR)
        }
    }
}

