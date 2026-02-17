# AetherCore Container Deployment (ECS Fargate + ALB)

This guide documents production Docker packaging and deployment inputs for deployable AetherCore services.

## Service discovery from repository

Validated service locations and entrypoints:

- **Dashboard UI**: `packages/dashboard`
  - Build entrypoint: `packages/dashboard/package.json` script `build` (`tsc && vite build`)
  - Runtime static entrypoint: Nginx serving built `dist/` assets
- **Gateway service**: `services/gateway`
  - Entrypoint: `services/gateway/src/index.ts`
  - Runtime command: `node dist/index.js`
- **Auth service**: `services/auth`
  - Entrypoint: `services/auth/src/server.ts`
  - Runtime command: `node dist/server.js`
- **Collaboration service**: `services/collaboration`
  - Entrypoint: `services/collaboration/src/index.ts`
  - Runtime command: `node dist/index.js`
- **H2 ingest service**: `services/h2-ingest`
  - Entrypoint: `services/h2-ingest/src/main.rs`

## ALB routing contract

- `/` -> dashboard
- `/api/*` -> gateway
- `/auth/*` -> auth
- `/ws/*` -> collaboration (WebSocket upgrade supported by HTTP server + `ws`)
- `/ingest/*` -> h2-ingest

## Container matrix

| Service | Dockerfile path | Port | Health path | ECR repo name |
|---|---|---:|---|---|
| dashboard | `packages/dashboard/docker/Dockerfile.dashboard` | 80 | `/` | `aethercore-dashboard` |
| gateway | `services/gateway/Dockerfile` | 3000 | `/health` | `aethercore-gateway` |
| auth | `services/auth/Dockerfile` | 3001 | `/health` | `aethercore-auth` |
| collaboration | `services/collaboration/Dockerfile` | 8080 | `/health` | `aethercore-collaboration` |
| h2-ingest | `services/h2-ingest/Dockerfile` | 8090 | `/health` | `aethercore-h2-ingest` |

## Required environment variables

### Dashboard (`aethercore-dashboard`)
- `REACT_APP_API_URL` (optional, default `/api`)
- `REACT_APP_WS_URL` (optional, default `/ws`)
- `REACT_APP_TPM_ENABLED` (optional, default `false`)

### Gateway (`aethercore-gateway`)
- `PORT` (optional, default `3000`)
- `C2_ADDR` (optional, defaults from shared helper)
- `AETHER_BUNKER_ENDPOINT` (optional)
- `TPM_ENABLED` (optional)
- `LOG_LEVEL` (optional)

### Auth (`aethercore-auth`)
- `PORT` (optional, default `3001`)
- `AUTH_JWT_SECRET` (**required for token validation**)
- `AUTH_JWT_ISSUER` (optional)
- `AUTH_JWT_AUDIENCE` (optional)
- `AETHER_BUNKER_ENDPOINT` (optional)
- `LOG_LEVEL` (optional)

### Collaboration (`aethercore-collaboration`)
- `PORT` (optional, default `8080`)
- `IDENTITY_REGISTRY_ADDRESS` (optional, defaults from shared helper)

### H2 ingest (`aethercore-h2-ingest`)
- `PORT` (required by current config parser)
- `REDIS_URL` (required)
- `KMS_KEY_ARN` (required)
- `MERKLE_BUCKET` (required)
- `BUFFER_SIZE` (required by parser, default fallback to `65536` if parse fails)

## Build and push all images to ECR

Use:

```bash
./scripts/build-and-push-ecr.sh
```

This script:
- logs into ECR (`565919382365.dkr.ecr.us-east-1.amazonaws.com`)
- ensures repositories exist
- builds each image
- tags with `:latest` and `:<git-sha>`
- pushes both tags

## Local build commands

```bash
docker build -f packages/dashboard/docker/Dockerfile.dashboard -t aethercore-dashboard:local .
docker build -f services/gateway/Dockerfile -t aethercore-gateway:local .
docker build -f services/auth/Dockerfile -t aethercore-auth:local .
docker build -f services/collaboration/Dockerfile -t aethercore-collaboration:local .
docker build -f services/h2-ingest/Dockerfile -t aethercore-h2-ingest:local .
```

## Local run + health verification

### Dashboard
```bash
docker run --rm -d --name dashboard -p 8088:80 \
  -e REACT_APP_API_URL=/api \
  -e REACT_APP_WS_URL=/ws \
  aethercore-dashboard:local
curl -i http://localhost:8088/
```

### Gateway
```bash
docker run --rm -d --name gateway -p 3000:3000 \
  -e PORT=3000 \
  aethercore-gateway:local
curl -i http://localhost:3000/health
```

### Auth
```bash
docker run --rm -d --name auth -p 3001:3001 \
  -e PORT=3001 \
  -e AUTH_JWT_SECRET=dev-secret \
  aethercore-auth:local
curl -i http://localhost:3001/health
```

### Collaboration
```bash
docker run --rm -d --name collaboration -p 8080:8080 \
  -e PORT=8080 \
  aethercore-collaboration:local
curl -i http://localhost:8080/health
```

### H2 ingest
```bash
docker run --rm -d --name h2-ingest -p 8090:8090 \
  -e PORT=8090 \
  -e REDIS_URL=redis://localhost:6379 \
  -e KMS_KEY_ARN=arn:aws:kms:us-east-1:565919382365:key/example \
  -e MERKLE_BUCKET=example-bucket \
  -e BUFFER_SIZE=65536 \
  aethercore-h2-ingest:local
curl -i http://localhost:8090/health
```
