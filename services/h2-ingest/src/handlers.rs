use axum::{
    extract::{Request, State},
    http::StatusCode,
    response::Json,
};
use serde_json::{json, Value};
use std::sync::Arc;
use tracing::{error, info};
use uuid::Uuid;

use crate::state::AppState;

pub async fn ingest_binary(
    State(state): State<Arc<AppState>>,
    request: Request,
) -> Result<Json<Value>, StatusCode> {
    let body = axum::body::to_bytes(request.into_body(), state.config.buffer_size)
        .await
        .map_err(|_| StatusCode::BAD_REQUEST)?;

    let stream_id = Uuid::new_v4();
    
    // Store in S3 for immutable Merkle proof
    let key = format!("streams/{}/binary", stream_id);
    
    match state.s3
        .put_object()
        .bucket(&state.config.merkle_bucket)
        .key(&key)
        .body(body.into())
        .send()
        .await
    {
        Ok(_) => {
            info!("Binary stream {} stored in S3", stream_id);
            
            // Publish to Redis for real-time processing
            if let Ok(mut conn) = state.redis.get_connection() {
                let _: Result<(), _> = redis::cmd("PUBLISH")
                    .arg("h2:binary")
                    .arg(stream_id.to_string())
                    .query(&mut conn);
            }

            Ok(Json(json!({
                "stream_id": stream_id,
                "status": "ingested",
                "s3_key": key
            })))
        }
        Err(e) => {
            error!("S3 upload failed: {}", e);
            Err(StatusCode::INTERNAL_SERVER_ERROR)
        }
    }
}

pub async fn ingest_telemetry(
    State(state): State<Arc<AppState>>,
    Json(payload): Json<Value>,
) -> Result<Json<Value>, StatusCode> {
    let stream_id = Uuid::new_v4();
    
    // Publish telemetry to Redis for Tactical Glass dashboard
    if let Ok(mut conn) = state.redis.get_connection() {
        let telemetry_json = serde_json::to_string(&payload)
            .map_err(|_| StatusCode::BAD_REQUEST)?;
            
        let _: Result<(), _> = redis::cmd("PUBLISH")
            .arg("h2:telemetry")
            .arg(&telemetry_json)
            .query(&mut conn);
    }

    Ok(Json(json!({
        "stream_id": stream_id,
        "status": "published"
    })))
}
