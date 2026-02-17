FROM rust:1.85-slim AS builder
WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends pkg-config libssl-dev ca-certificates && rm -rf /var/lib/apt/lists/*

COPY Cargo.toml Cargo.lock ./
COPY crates ./crates
COPY services/h2-ingest ./services/h2-ingest

RUN cargo build --release --bin h2-ingest

FROM debian:bookworm-slim AS runtime
WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends curl ca-certificates && rm -rf /var/lib/apt/lists/* \
  && groupadd --system aether && useradd --system --gid aether --create-home aether

COPY --from=builder /app/target/release/h2-ingest /usr/local/bin/h2-ingest

ENV PORT=8090
EXPOSE 8090

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD curl -fsS http://127.0.0.1:8090/health >/dev/null || exit 1

USER aether
ENTRYPOINT ["/usr/local/bin/h2-ingest"]
