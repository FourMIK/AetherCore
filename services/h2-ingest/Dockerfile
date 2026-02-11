# Multi-stage Rust build for h2-ingest service
FROM rust:1.75-slim as builder

WORKDIR /app

# Install build dependencies
RUN apt-get update && apt-get install -y \
    pkg-config \
    libssl-dev \
    && rm -rf /var/lib/apt/lists/*

# Copy workspace files
COPY Cargo.toml Cargo.lock ./
COPY crates/ ./crates/
COPY services/h2-ingest/ ./services/h2-ingest/

# Build release binary
RUN cargo build --release --bin h2-ingest

# Runtime stage - distroless for minimal attack surface
FROM gcr.io/distroless/cc-debian12

# Copy binary
COPY --from=builder /app/target/release/h2-ingest /usr/local/bin/h2-ingest

# Run as non-root user (distroless nonroot user UID 65532)
USER 65532:65532

EXPOSE 8090

# Health check - Note: distroless doesn't have curl, so this needs external monitoring
# In Kubernetes/ECS, use a liveness probe instead
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD ["/usr/local/bin/h2-ingest", "--health-check"]

CMD ["/usr/local/bin/h2-ingest"]
