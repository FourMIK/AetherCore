# AetherCore Container Deployment (ECS Field Test)

This runbook packages the ECS-routed dashboard stack and publishes deterministic tags to ECR.

## ECS routing and health contract

- `/` -> dashboard UI
- `/api/*` -> gateway
- `/auth/*` -> auth
- `/ws/*` -> collaboration
- `/ingest/*` -> h2-ingest

Health checks:
- dashboard must return `200` on `/`
- backend services must return `200` on `/health`

## Service build/deploy matrix

| service | dockerfile path | build context | port | health path | ECR repo | tags |
|---|---|---|---:|---|---|---|
| dashboard | `infra/docker/ecs/dashboard/Dockerfile` | `.` | 8080 | `/` | `aethercore-dashboard` | `latest`, `<git-sha-8>` |
| gateway | `infra/docker/ecs/gateway/Dockerfile` | `.` | 3000 | `/health` | `aethercore-gateway` | `latest`, `<git-sha-8>` |
| auth | `infra/docker/ecs/auth/Dockerfile` | `.` | 3001 | `/health` | `aethercore-auth` | `latest`, `<git-sha-8>` |
| collaboration | `infra/docker/ecs/collaboration/Dockerfile` | `.` | 8080 | `/health` | `aethercore-collaboration` | `latest`, `<git-sha-8>` |
| h2-ingest | `infra/docker/ecs/h2-ingest/Dockerfile` | `.` | 8090 | `/health` | `aethercore-h2-ingest` | `latest`, `<git-sha-8>` |

## Deterministic workspace image builds

`infra/docker/ecs/{gateway,auth,collaboration}/Dockerfile` build flow:
1. copy `package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml` first
2. copy workspace package manifests for target service and `@aethercore/shared`
3. run `pnpm install --frozen-lockfile` with filters
4. copy source
5. build `@aethercore/shared` then the service
6. run `pnpm deploy --prod` to produce a portable runtime payload (no broken pnpm workspace symlinks)

This keeps workspace linking correct without modifying service dependency declarations.

## Scripts

- `scripts/build-tag-all.sh`
  - builds all ECS images
  - tags local image as `:latest` and `:<git-sha-8>`
  - tags ECR references for both tags
- `scripts/push-ecr-all.sh`
  - logs into ECR
  - creates repos if missing
  - pushes `latest` and `:<git-sha-8>` for every service
- `scripts/verify-ecr.sh`
  - verifies both tags exist in each ECR repo via `aws ecr describe-images`
- `scripts/smoke-local.sh`
  - runs each image locally and checks HTTP health endpoints

All scripts support overriding `AWS_ACCOUNT_ID`, `AWS_REGION`, and `GIT_SHA` via environment variables.

## Minimal local smoke env defaults

Used by `scripts/smoke-local.sh`:

- dashboard:
  - `REACT_APP_API_URL=/api`
  - `REACT_APP_WS_URL=/ws`
  - `REACT_APP_TPM_ENABLED=true`
- gateway:
  - `PORT=3000`
  - `TPM_ENABLED=false`
- auth:
  - `PORT=3001`
  - `AUTH_JWT_SECRET=local-smoke-secret`
- collaboration:
  - `PORT=8080`
  - `IDENTITY_REGISTRY_ADDRESS=localhost:50051`
- h2-ingest:
  - `PORT=8090`
  - `REDIS_URL=redis://localhost:6379`
  - `KMS_KEY_ARN=arn:aws:kms:us-east-1:565919382365:key/local-smoke`
  - `MERKLE_BUCKET=aethercore-local-smoke`
  - `BUFFER_SIZE=65536`
  - `AWS_EC2_METADATA_DISABLED=true`
  - `AWS_ACCESS_KEY_ID=dummy`
  - `AWS_SECRET_ACCESS_KEY=dummy`
  - `AWS_REGION=us-east-1`

## CodeBuild configuration

Use `buildspec.ecr.yml` with a Linux standard image and **Privileged mode enabled**.

Required CodeBuild service role permissions:
- ECR push/pull lifecycle (at minimum):
  - `ecr:GetAuthorizationToken`
  - `ecr:BatchCheckLayerAvailability`
  - `ecr:CompleteLayerUpload`
  - `ecr:InitiateLayerUpload`
  - `ecr:UploadLayerPart`
  - `ecr:PutImage`
  - `ecr:BatchGetImage`
  - `ecr:DescribeRepositories`
  - `ecr:CreateRepository`
  - `ecr:DescribeImages`
- CloudWatch Logs:
  - `logs:CreateLogGroup`
  - `logs:CreateLogStream`
  - `logs:PutLogEvents`

## Final runbook steps

```bash
# 1) Build and tag (latest + git-sha-8)
./scripts/build-tag-all.sh

# 2) Local runtime smoke checks
./scripts/smoke-local.sh

# 3) Push to ECR
./scripts/push-ecr-all.sh

# 4) Verify tags in ECR
./scripts/verify-ecr.sh
```

For CI/CD, configure CodeBuild to use `buildspec.ecr.yml` and privileged mode.
