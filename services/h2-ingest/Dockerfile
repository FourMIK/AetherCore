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

# Runtime stage
FROM debian:bookworm-slim

# Install runtime dependencies
RUN apt-get update && apt-get install -y \
    ca-certificates \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Create non-root user
RUN useradd -r -s /bin/false aether

# Copy binary
COPY --from=builder /app/target/release/h2-ingest /usr/local/bin/h2-ingest

# Set ownership and permissions
RUN chown aether:aether /usr/local/bin/h2-ingest

USER aether

EXPOSE 8090

CMD ["h2-ingest"]
