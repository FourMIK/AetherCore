# ECS Fargate Containerization Layer

## Service discovery results

Containerized runtime services discovered in this repository tree:

- Dashboard UI (`packages/dashboard`) → ALB route `/`
- Gateway (`services/gateway`) → ALB route `/api/*`
- Auth (`services/auth`) → ALB route `/auth/*`
- Collaboration/C2 (`services/collaboration`) → ALB route `/ws/*`
- Lattice Bridge (`services/lattice-bridge`) → ALB route `/lattice/*` (internal/api utility)
- H2 ingest (`services/h2-ingest`) → ALB route `/ingest/*`
- Operator API (`services/operator`) → auxiliary API service

Not containerized for ALB/ECS in this layer:

- `services/fleet` (library-only, no network listener)
- `coderalphie` (edge bootstrap workload, not an ALB-targeted ECS service)

## Folder structure

```text
infra/docker/ecs/
├── README.md
├── auth/
│   ├── .dockerignore
│   └── Dockerfile
├── collaboration/
│   ├── .dockerignore
│   └── Dockerfile
├── dashboard/
│   ├── .dockerignore
│   └── Dockerfile
├── gateway/
│   ├── .dockerignore
│   └── Dockerfile
├── h2-ingest/
│   ├── .dockerignore
│   └── Dockerfile
├── lattice-bridge/
│   ├── .dockerignore
│   └── Dockerfile
└── operator/
    ├── .dockerignore
    └── Dockerfile
```

## Build and push

Use root script:

```bash
./build-and-push-all.sh
```

Manual pattern per service:

```bash
GIT_SHA=$(git rev-parse --short HEAD)
SERVICE=gateway
DOCKERFILE=infra/docker/ecs/gateway/Dockerfile
ECR_REGISTRY=565919382365.dkr.ecr.us-east-1.amazonaws.com

# build local tags
docker build -f "$DOCKERFILE" -t "$SERVICE:latest" -t "$SERVICE:$GIT_SHA" .

# tag for ECR
docker tag "$SERVICE:latest" "$ECR_REGISTRY/aethercore-$SERVICE:latest"
docker tag "$SERVICE:$GIT_SHA" "$ECR_REGISTRY/aethercore-$SERVICE:$GIT_SHA"

# push
docker push "$ECR_REGISTRY/aethercore-$SERVICE:latest"
docker push "$ECR_REGISTRY/aethercore-$SERVICE:$GIT_SHA"
```

## Environment variables

### Dashboard
- `REACT_APP_API_URL` (default `/api`)
- `REACT_APP_WS_URL` (default `wss://www.aether.authynticdefense.com/ws`)
- `REACT_APP_TPM_ENABLED` (default `true`)

### Gateway
- `PORT` (default `3000`)
- `C2_ADDR`
- `AETHER_BUNKER_ENDPOINT`
- `LATTICE_BRIDGE_STATUS_URL`
- `LATTICE_BRIDGE_MODE_URL`
- `TPM_ENABLED`
- `LOG_LEVEL`

### Auth
- `PORT` (default `3001`)
- `AUTH_JWT_SECRET` (required for JWT validation)
- `AUTH_JWT_ISSUER` (optional)
- `AUTH_JWT_AUDIENCE` (optional)
- `AETHER_BUNKER_ENDPOINT` (optional)
- `LOG_LEVEL`

### Collaboration
- `PORT` (default `8080`)
- `IDENTITY_REGISTRY_ADDRESS`

### Lattice bridge
- `PORT` (default `3010`)
- `LATTICE_BASE_URL`
- `LATTICE_CLIENT_ID`
- `LATTICE_CLIENT_SECRET`
- `LATTICE_AGENT_ID`
- `LATTICE_INTEGRATION_MODE` (`stealth_readonly` default)
- `LATTICE_PROTOCOL_MODE` (`rest` default in stealth mode; configurable in standard mode)
- `LATTICE_INPUT_MODE` (`synthetic` default, `live` optional)
- `LATTICE_SYNTHETIC_SCENARIO` (`sf_bay_maritime_incursion_v1` default)
- `LATTICE_SYNTHETIC_SEED` (stable deterministic seed)
- `LATTICE_SYNTHETIC_TIMELINE` (`dual` default)
- `LATTICE_SYNTHETIC_REPLAY_HOURS` (`24` default)
- `LATTICE_SYNTHETIC_INGEST_INTERVAL_MS` (default `2000` for accelerated demo ingest pacing)
- `LATTICE_SANDBOX_MODE` (`true` default)
- `SANDBOXES_TOKEN` (sandbox mode)
- `LATTICE_GRPC_TARGET` (required only for `standard` mode with `hybrid`/`grpc` protocol)
- `LATTICE_GRPC_INSECURE` (`false` default, rejected in production)
- `LATTICE_GRPC_CA_CERT_PATH`
- `LATTICE_GRPC_CLIENT_CERT_PATH`
- `LATTICE_GRPC_CLIENT_KEY_PATH`
- `LATTICE_GRPC_SERVER_NAME_OVERRIDE`
- `LATTICE_GRPC_POLL_WINDOW_MS` (default `1500`)
- `LATTICE_GRPC_MAX_EVENTS` (default `256`)
- `LATTICE_GATEWAY_INTERNAL_URL`
- `LATTICE_GATEWAY_INTERNAL_TOKEN`
- `LATTICE_POLL_INTERVAL_MS` (default `15000` in stealth mode, `5000` otherwise)

### H2 ingest
- `PORT` (default `8090`)
- `REDIS_URL` (required)
- `KMS_KEY_ARN` (required)
- `MERKLE_BUCKET` (required)
- `BUFFER_SIZE` (required)

### Operator
- `RUN_HTTP_SERVER=true`
- `OPERATOR_HTTP_PORT` (default `4001`)

## ECS container definition examples

```json
{
  "name": "gateway",
  "image": "565919382365.dkr.ecr.us-east-1.amazonaws.com/aethercore-gateway:latest",
  "portMappings": [{ "containerPort": 3000, "protocol": "tcp" }],
  "healthCheck": {
    "command": ["CMD-SHELL", "wget -qO- http://127.0.0.1:3000/health >/dev/null || exit 1"],
    "interval": 30,
    "timeout": 5,
    "retries": 3,
    "startPeriod": 15
  }
}
```

```json
{
  "name": "dashboard",
  "image": "565919382365.dkr.ecr.us-east-1.amazonaws.com/aethercore-dashboard:latest",
  "portMappings": [{ "containerPort": 8080, "protocol": "tcp" }],
  "healthCheck": {
    "command": ["CMD-SHELL", "wget -qO- http://127.0.0.1:8080/ >/dev/null || exit 1"],
    "interval": 30,
    "timeout": 5,
    "retries": 3,
    "startPeriod": 10
  }
}
```

## Summary mapping

| Service | Port | Health Path | ECR Repository | Image Tags |
|---|---:|---|---|---|
| dashboard | 8080 | `/` (container has `/healthz`) | `aethercore-dashboard` | `latest`, `<git-sha>` |
| gateway | 3000 | `/health` | `aethercore-gateway` | `latest`, `<git-sha>` |
| auth | 3001 | `/health` | `aethercore-auth` | `latest`, `<git-sha>` |
| collaboration | 8080 | `/health` | `aethercore-collaboration` | `latest`, `<git-sha>` |
| lattice-bridge | 3010 | `/health` | `aethercore-lattice-bridge` | `latest`, `<git-sha>` |
| h2-ingest | 8090 | `/health` | `aethercore-h2-ingest` | `latest`, `<git-sha>` |
| operator | 4001 | `/health` | `aethercore-operator` | `latest`, `<git-sha>` |

