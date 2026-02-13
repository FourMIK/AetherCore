# AWS Testbed Deployment (aws-testbed)

This document describes how to deploy AetherCore and optional companion workloads into the new `aws-testbed` environment.

## 1) Deployment paths

### AetherCore (core path)
Deploy AetherCore on AWS using:
- **ECS/Fargate** for application services
- **RDS** for relational persistence
- **Redis** for caching/queue/session needs
- **S3 + CloudFront** for static assets and public distribution

All runtime/configuration should target the **`aws-testbed`** environment naming and tagging convention.

### AetherBunker (optional path)
Deploy AetherBunker as a **separate ECS service** behind the **same ALB** used by AetherCore.

Use secret-backed ECS environment secrets for connection material:
- `DATABASE_SECRET_ARN`
- `REDIS_SECRET_ARN`

These values should be injected via ECS task definition `secrets` (not plain environment variables).

### CodeRalphie path
CodeRalphie is handled as a **build/package/distribution artifact path** and is **not required to be an ECS workload** for this environment.

Recommended approach:
- Build/package artifact in CI or release pipeline
- Upload versioned artifacts to S3
- Distribute via CloudFront or signed S3 URLs as appropriate

---

## 2) Prerequisite matrix

| Area | Required | Notes |
|---|---|---|
| AWS account access | Yes | IAM permissions for ECS, ECR, RDS, ElastiCache/Redis, S3, CloudFront, ALB, Secrets Manager, CloudWatch |
| AWS CLI v2 | Yes | Authenticated to target account/region |
| Docker build capability | Yes | Needed for AetherCore/AetherBunker images |
| ECR repositories | Yes | Separate repos/tags for core and optional bunker images |
| VPC + subnets | Yes | Private subnets for ECS/RDS/Redis; public as needed for ALB |
| Security groups | Yes | Explicit ingress/egress for ALB↔ECS and ECS↔RDS/Redis |
| ECS cluster (Fargate) | Yes | Sized for `aws-testbed` throughput |
| ALB + listeners + target groups | Yes | Shared ALB, distinct target groups/routes per service |
| RDS instance/cluster | Yes | Engine/version + parameter groups approved |
| Redis (ElastiCache) | Yes | Endpoint available from ECS tasks |
| S3 buckets | Yes | Static assets and CodeRalphie artifacts |
| CloudFront distribution(s) | Yes | Front static/public assets |
| Secrets Manager secrets | Yes | Includes DB and Redis secrets ARNs |
| DNS + TLS certificates | Yes | Route53/other DNS + ACM certs for ALB/CloudFront |
| Observability | Strongly recommended | CloudWatch logs/metrics/alarms + dashboards |

---

## 3) Ordered command list

> Replace all `UNSPECIFIED_*` placeholders before running.

1. **Set deployment context**

```bash
export AWS_PROFILE=UNSPECIFIED_AWS_PROFILE
export AWS_REGION=UNSPECIFIED_AWS_REGION
export ENV_NAME=aws-testbed
export AWS_ACCOUNT_ID=UNSPECIFIED_AWS_ACCOUNT_ID
```

2. **Set image/application variables**

```bash
export AETHERCORE_IMAGE_REPO=UNSPECIFIED_AETHERCORE_ECR_REPO
export AETHERCORE_IMAGE_TAG=UNSPECIFIED_AETHERCORE_IMAGE_TAG

export AETHERBUNKER_IMAGE_REPO=UNSPECIFIED_AETHERBUNKER_ECR_REPO
export AETHERBUNKER_IMAGE_TAG=UNSPECIFIED_AETHERBUNKER_IMAGE_TAG

export ECS_CLUSTER=UNSPECIFIED_ECS_CLUSTER
export CORE_SERVICE=UNSPECIFIED_AETHERCORE_SERVICE_NAME
export BUNKER_SERVICE=UNSPECIFIED_AETHERBUNKER_SERVICE_NAME
```

3. **Authenticate Docker to ECR**

```bash
aws ecr get-login-password --region "$AWS_REGION" \
  | docker login --username AWS --password-stdin "$AWS_ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com"
```

4. **Build and push AetherCore image**

```bash
docker build -t "$AETHERCORE_IMAGE_REPO:$AETHERCORE_IMAGE_TAG" -f UNSPECIFIED_AETHERCORE_DOCKERFILE .
docker push "$AETHERCORE_IMAGE_REPO:$AETHERCORE_IMAGE_TAG"
```

5. **(Optional) Build and push AetherBunker image**

```bash
docker build -t "$AETHERBUNKER_IMAGE_REPO:$AETHERBUNKER_IMAGE_TAG" -f UNSPECIFIED_AETHERBUNKER_DOCKERFILE .
docker push "$AETHERBUNKER_IMAGE_REPO:$AETHERBUNKER_IMAGE_TAG"
```

6. **Register/update AetherCore task definition**

```bash
aws ecs register-task-definition \
  --cli-input-json file://UNSPECIFIED_AETHERCORE_TASKDEF_JSON
```

7. **Deploy AetherCore service update**

```bash
aws ecs update-service \
  --cluster "$ECS_CLUSTER" \
  --service "$CORE_SERVICE" \
  --force-new-deployment
```

8. **(Optional) Register/update AetherBunker task definition with env-secrets**

Ensure task definition includes secrets entries similar to:
- `name=DATABASE_SECRET_ARN, valueFrom=<Secrets Manager ARN>`
- `name=REDIS_SECRET_ARN, valueFrom=<Secrets Manager ARN>`

```bash
aws ecs register-task-definition \
  --cli-input-json file://UNSPECIFIED_AETHERBUNKER_TASKDEF_JSON
```

9. **(Optional) Deploy AetherBunker service update**

```bash
aws ecs update-service \
  --cluster "$ECS_CLUSTER" \
  --service "$BUNKER_SERVICE" \
  --force-new-deployment
```

10. **Upload static assets to S3 + invalidate CloudFront (AetherCore/public assets)**

```bash
aws s3 sync UNSPECIFIED_STATIC_ASSET_DIR "s3://UNSPECIFIED_STATIC_BUCKET/" --delete
aws cloudfront create-invalidation \
  --distribution-id UNSPECIFIED_CLOUDFRONT_DISTRIBUTION_ID \
  --paths "/*"
```

11. **CodeRalphie package and publish to S3**

```bash
UNSPECIFIED_CODERALPHIE_BUILD_COMMAND
aws s3 cp UNSPECIFIED_CODERALPHIE_ARTIFACT "s3://UNSPECIFIED_CODERALPHIE_BUCKET/UNSPECIFIED_VERSION/"
```

12. **Wait for ECS service stability**

```bash
aws ecs wait services-stable --cluster "$ECS_CLUSTER" --services "$CORE_SERVICE"
# Optional bunker wait:
aws ecs wait services-stable --cluster "$ECS_CLUSTER" --services "$BUNKER_SERVICE"
```

---

## 4) Health-check URLs

Use these after deployment completes:

- AetherCore liveness: `https://UNSPECIFIED_CORE_HOST/health`
- AetherCore readiness: `https://UNSPECIFIED_CORE_HOST/ready`
- AetherCore API health: `https://UNSPECIFIED_CORE_HOST/api/health`
- AetherBunker liveness (optional): `https://UNSPECIFIED_BUNKER_HOST/health`
- AetherBunker readiness (optional): `https://UNSPECIFIED_BUNKER_HOST/ready`
- Static asset check (CloudFront): `https://UNSPECIFIED_CLOUDFRONT_HOST/UNSPECIFIED_KNOWN_ASSET_PATH`
- CodeRalphie artifact check: `s3://UNSPECIFIED_CODERALPHIE_BUCKET/UNSPECIFIED_VERSION/`

Suggested command checks:

```bash
curl -fsS https://UNSPECIFIED_CORE_HOST/health
curl -fsS https://UNSPECIFIED_CORE_HOST/ready
curl -fsS https://UNSPECIFIED_CORE_HOST/api/health
# Optional:
curl -fsS https://UNSPECIFIED_BUNKER_HOST/health
curl -fsS https://UNSPECIFIED_BUNKER_HOST/ready
```

---

## 5) Rollback steps

1. Identify last known-good ECS task definition revision(s) for AetherCore (and AetherBunker if used).
2. Update service(s) to previous task definition revision.
3. Confirm service stability and target-group health in ALB.
4. Revert static assets in S3 to prior version (or restore from versioned object set).
5. Invalidate CloudFront cache to flush bad assets/config.
6. If schema/config changes were applied, execute approved backward-compatible rollback procedure.
7. Re-run health checks and monitor CloudWatch alarms/logs until stable.

Example rollback commands:

```bash
aws ecs update-service \
  --cluster "$ECS_CLUSTER" \
  --service "$CORE_SERVICE" \
  --task-definition UNSPECIFIED_AETHERCORE_PREVIOUS_TASKDEF

aws ecs update-service \
  --cluster "$ECS_CLUSTER" \
  --service "$BUNKER_SERVICE" \
  --task-definition UNSPECIFIED_AETHERBUNKER_PREVIOUS_TASKDEF

aws ecs wait services-stable --cluster "$ECS_CLUSTER" --services "$CORE_SERVICE" "$BUNKER_SERVICE"
```

---

## 6) UNSPECIFIED checklist (must be filled at deploy time)

- [ ] `UNSPECIFIED_AWS_PROFILE`
- [ ] `UNSPECIFIED_AWS_REGION`
- [ ] `UNSPECIFIED_AWS_ACCOUNT_ID`
- [ ] `UNSPECIFIED_ECS_CLUSTER`
- [ ] `UNSPECIFIED_AETHERCORE_SERVICE_NAME`
- [ ] `UNSPECIFIED_AETHERBUNKER_SERVICE_NAME` (if deploying)
- [ ] `UNSPECIFIED_AETHERCORE_ECR_REPO`
- [ ] `UNSPECIFIED_AETHERCORE_IMAGE_TAG`
- [ ] `UNSPECIFIED_AETHERBUNKER_ECR_REPO` (if deploying)
- [ ] `UNSPECIFIED_AETHERBUNKER_IMAGE_TAG` (if deploying)
- [ ] `UNSPECIFIED_AETHERCORE_DOCKERFILE`
- [ ] `UNSPECIFIED_AETHERBUNKER_DOCKERFILE` (if deploying)
- [ ] `UNSPECIFIED_AETHERCORE_TASKDEF_JSON`
- [ ] `UNSPECIFIED_AETHERBUNKER_TASKDEF_JSON` (if deploying)
- [ ] `UNSPECIFIED_STATIC_ASSET_DIR`
- [ ] `UNSPECIFIED_STATIC_BUCKET`
- [ ] `UNSPECIFIED_CLOUDFRONT_DISTRIBUTION_ID`
- [ ] `UNSPECIFIED_CLOUDFRONT_HOST`
- [ ] `UNSPECIFIED_KNOWN_ASSET_PATH`
- [ ] `UNSPECIFIED_CORE_HOST`
- [ ] `UNSPECIFIED_BUNKER_HOST` (if deploying)
- [ ] `UNSPECIFIED_CODERALPHIE_BUILD_COMMAND`
- [ ] `UNSPECIFIED_CODERALPHIE_ARTIFACT`
- [ ] `UNSPECIFIED_CODERALPHIE_BUCKET`
- [ ] `UNSPECIFIED_VERSION`
- [ ] `DATABASE_SECRET_ARN` (Secrets Manager ARN wired to ECS task definition secrets)
- [ ] `REDIS_SECRET_ARN` (Secrets Manager ARN wired to ECS task definition secrets)
