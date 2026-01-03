use axum::{
    http::StatusCode,
    response::Json,
    routing::{get, post},
    Router,
};
use serde_json::{json, Value};
use std::sync::Arc;
use tokio::net::TcpListener;
use tower::ServiceBuilder;
use tracing::info;
use tracing_subscriber::fmt::init;
use chrono::Utc;

mod config;
mod handlers;
mod state;

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
