#!/usr/bin/env bash
set -euo pipefail

COMPOSE_FILE="infra/docker/docker-compose.yml"
PROJECT_NAME="aethercore-smoke"

cleanup() {
  docker compose -p "$PROJECT_NAME" -f "$COMPOSE_FILE" down -v --remove-orphans || true
}
trap cleanup EXIT

unset C2_ADDR || true
unset AETHER_BUNKER_ENDPOINT || true

echo "[smoke] starting local stack"
docker compose -p "$PROJECT_NAME" -f "$COMPOSE_FILE" up -d --build

echo "[smoke] waiting for gateway health endpoint"
for _ in $(seq 1 30); do
  if curl -fsS http://localhost:3000/health >/dev/null; then
    break
  fi
  sleep 2
done
curl -fsS http://localhost:3000/health >/dev/null

echo "[smoke] waiting for backend CONNECTED transition"
for _ in $(seq 1 45); do
  if docker compose -p "$PROJECT_NAME" -f "$COMPOSE_FILE" logs gateway 2>&1 | grep -q "Backend connection restored"; then
    echo "[smoke] backend reached CONNECTED"
    exit 0
  fi
  sleep 2
done

echo "[smoke] gateway logs"
docker compose -p "$PROJECT_NAME" -f "$COMPOSE_FILE" logs gateway

echo "[smoke] c2-router logs"
docker compose -p "$PROJECT_NAME" -f "$COMPOSE_FILE" logs c2-router

echo "[smoke] backend did not reach CONNECTED"
exit 1
