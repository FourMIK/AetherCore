# Multi-stage Rust build for h2-ingest service
FROM rust:1.75-slim AS builder

WORKDIR /app

# Install build dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    pkg-config \
    libssl-dev \
    && rm -rf /var/lib/apt/lists/*

# Copy workspace files
COPY Cargo.toml Cargo.lock ./
COPY crates/ ./crates/
COPY services/h2-ingest/ ./services/h2-ingest/

# Build release binary
RUN cargo build --release --bin h2-ingest

# Runtime stage compatible with ECS Fargate and container health checks
FROM debian:bookworm-slim AS runtime

RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    curl \
    && rm -rf /var/lib/apt/lists/*

RUN useradd --create-home --shell /usr/sbin/nologin appuser

COPY --from=builder /app/target/release/h2-ingest /usr/local/bin/h2-ingest

USER appuser
EXPOSE 8090

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD curl -fsS "http://127.0.0.1:${PORT:-8090}/health" >/dev/null || exit 1

CMD ["/usr/local/bin/h2-ingest"]
