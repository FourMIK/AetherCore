# AetherCore Infrastructure

This directory contains production-ready AWS infrastructure-as-code for deploying AetherCore as an internal application.

## Directory Structure

```
infra/
├── docker/              # Docker build files
│   ├── Dockerfile.gateway
│   ├── Dockerfile.auth
│   ├── Dockerfile.collaboration
│   ├── Dockerfile.rust-base
│   └── docker-compose.yml
├── terraform/           # Terraform configurations
│   ├── environments/
│   │   ├── internal/    # Internal environment
│   │   └── aws-testbed/ # Isolated AWS test-bed environment
│   └── modules/
│       └── ecs-service/ # Reusable ECS service module
├── k8s/                 # Kubernetes manifests (optional)
│   └── base/
└── scripts/             # Utility scripts
    ├── bootstrap-aws.sh
    ├── bootstrap-aws-testbed.sh
    └── build-push.sh
```

## Prerequisites

- **AWS CLI** configured with appropriate credentials
- **Docker** for building container images
- **Terraform** >= 1.5.0
- **Node.js** >= 18 and **npm** >= 9 (for building TypeScript services)
- **Rust** >= 1.70 (for building Rust crates)

## Quick Start

### 1. Bootstrap AWS Infrastructure

Create the S3 bucket and DynamoDB table for Terraform state:

```bash
cd infra/scripts
./bootstrap-aws.sh us-east-1 aethercore
```

### 2. Set Required Environment Variables

```bash
export TF_VAR_db_password='your-secure-password-here'
export TF_VAR_jwt_secret='your-jwt-secret-here'
```

### 3. Initialize Terraform

```bash
cd ../terraform/environments/internal
terraform init -backend-config=backend.hcl
```

### 4. Review and Apply Infrastructure

```bash
terraform plan
terraform apply
```

This will create:
- VPC with public/private/database subnets
- ECS Cluster with Fargate Spot
- RDS PostgreSQL (db.t4g.micro)
- ElastiCache Redis (cache.t4g.micro)
- Application Load Balancer
- ECR repositories for each service
- KMS key for Ed25519 signing
- S3 bucket for Merkle proofs
- IAM roles and security groups
- Secrets Manager secrets

### 5. Build and Push Docker Images

```bash
cd ../../scripts
./build-push.sh us-east-1 aethercore v1.0.0
```

### 6. Deploy Services

After images are pushed to ECR:

```bash
cd ../terraform/environments/internal
terraform apply -var='image_tag=v1.0.0'
```


## AWS Testbed Environment

Use the dedicated test-bed bootstrap wrapper so Terraform remote state is isolated from other environments.

### Required Environment Variables

```bash
export AWS_REGION=us-east-1
export TF_VAR_db_password='your-secure-password-here'
export TF_VAR_jwt_secret='your-jwt-secret-here'
```

### Bootstrap + Terraform Commands (exact sequence)

```bash
cd infra/scripts
./bootstrap-aws-testbed.sh "$AWS_REGION"

cd ../terraform/environments/aws-testbed
terraform init -backend-config=backend.hcl
terraform apply
```

This initializes Terraform with the aws-testbed backend (`aethercore-aws-testbed-terraform-state` and `aethercore-aws-testbed-terraform-locks`) and applies infrastructure in the isolated test-bed environment.

## Local Development

Use Docker Compose for local development:

```bash
cd infra/docker
docker-compose up
```

This starts:
- C2 Router gRPC mock service on port 50051
- PostgreSQL 16 on port 5432
- Redis 7 on port 6379
- Gateway service on port 3000
- Auth service on port 3001
- Collaboration service on port 8080

**Note**: The enrollment service is not included in the Docker Compose stack. Enrollment functionality must be added and configured separately if required.


### Container DNS defaults for C2/Bunker endpoints

**Automatic Container Detection**: Services now automatically detect when running in Docker and default to the correct service DNS names. No manual configuration needed!

- **In containers** (Docker/K8s): Defaults to `c2-router:50051` automatically
- **Outside containers** (local dev): Defaults to `localhost:50051` automatically

Services detect containers via:
- `/.dockerenv` file existence
- `RUNNING_IN_CONTAINER=true` environment variable
- `CONTAINER=true` environment variable

**Why this matters**: Inside a container, `localhost` points to the container itself, not sibling services. The automatic detection ensures services connect correctly in all environments.

**Manual override**: You can still explicitly set environment variables to override defaults:
- `C2_ADDR=custom-service:50051`
- `AETHER_BUNKER_ENDPOINT=custom-service:50051`
- `IDENTITY_REGISTRY_ADDRESS=custom-service:50051`

### Health Check Endpoints

All services expose HTTP health check endpoints for readiness probes:

- **Gateway**: `GET http://localhost:3000/health` - Returns HTTP 200 OK
- **Auth**: `GET http://localhost:3001/health` - Returns HTTP 200 OK
- **Collaboration**: `GET http://localhost:8080/health` - Returns HTTP 200 OK

These endpoints are used by Docker Compose and Kubernetes for readiness/liveness probes.

## Service Endpoints

After deployment, access services through the ALB:

- **Gateway**: `http://<alb-dns>/api/*`
- **Auth**: `http://<alb-dns>/auth/*`
- **Collaboration**: `http://<alb-dns>/ws/*`

Get the ALB DNS name:

```bash
terraform output alb_dns_name
```

## Cost Optimization

The internal environment is optimized for < $200/month:

| Resource | Type | Estimated Cost |
|----------|------|----------------|
| RDS PostgreSQL | db.t4g.micro | ~$15/mo |
| ElastiCache Redis | cache.t4g.micro | ~$12/mo |
| ECS Fargate Spot | 3 services @ 0.25 vCPU | ~$40/mo |
| Application Load Balancer | 1 ALB | ~$20/mo |
| NAT Gateway | 1 NAT | ~$35/mo |
| S3 + Data Transfer | Storage + bandwidth | ~$5/mo |
| **Total** | | **~$127/mo** |

## Security Features

- All data encrypted at rest (KMS)
- VPC with microsegmented security groups
- No public database access
- Task IAM roles with least privilege
- S3 bucket public access blocked
- Secrets stored in AWS Secrets Manager
- ECR image scanning enabled

## Monitoring

View logs in CloudWatch:

```bash
# Gateway logs
aws logs tail /ecs/aethercore-internal/gateway --follow

# Auth logs
aws logs tail /ecs/aethercore-internal/auth --follow

# Collaboration logs
aws logs tail /ecs/aethercore-internal/collaboration --follow
```

## Updating Services

To deploy new versions:

1. Build and push new images:
   ```bash
   cd infra/scripts
   ./build-push.sh us-east-1 aethercore v1.1.0
   ```

2. Update ECS services:
   ```bash
   cd ../terraform/environments/internal
   terraform apply -var='image_tag=v1.1.0'
   ```

ECS will perform a rolling deployment with circuit breaker enabled.

## Cleanup

To destroy all infrastructure:

```bash
cd infra/terraform/environments/internal
terraform destroy
```

**Warning**: This will delete all resources including databases. Ensure you have backups!

## Troubleshooting

### Services not passing health checks

Check ECS service status:
```bash
aws ecs describe-services --cluster aethercore-internal-cluster --services aethercore-internal-gateway
```

View container logs:
```bash
aws logs tail /ecs/aethercore-internal/gateway --since 10m
```


### Backend remains unreachable in local Docker stack

Symptoms:
- Gateway logs warning about `C2_ADDR`/`AETHER_BUNKER_ENDPOINT` pointing to localhost
- Gateway backend state stays `UNREACHABLE`

Resolution:
- Use container DNS service naming in compose networking
- Ensure endpoint variables resolve to `c2-router:50051` (or your actual in-stack gRPC service name)
- Recreate stack after config changes:
  ```bash
  cd infra/docker
  docker compose down -v
  docker compose up --build
  ```

### Cannot connect to database

Verify security groups allow traffic from ECS to RDS:
```bash
terraform state show aws_security_group.rds
terraform state show aws_security_group.ecs_services
```

### Terraform state locked

If Terraform state is locked after a failed apply:
```bash
terraform force-unlock <lock-id>
```

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────────┐
│                          Internet                            │
└────────────────────────┬────────────────────────────────────┘
                         │
                         ▼
              ┌──────────────────────┐
              │ Application Load     │
              │ Balancer             │
              │ (Public Subnets)     │
              └──────────┬───────────┘
                         │
         ┌───────────────┼───────────────┐
         ▼               ▼               ▼
    ┌────────┐     ┌────────┐     ┌─────────────┐
    │Gateway │     │  Auth  │     │Collaboration│
    │Service │     │Service │     │  Service    │
    │(ECS)   │     │(ECS)   │     │  (ECS)      │
    └───┬────┘     └───┬────┘     └──────┬──────┘
        │              │                  │
        │              │                  │
        └──────────────┼──────────────────┘
                       │
         ┌─────────────┼─────────────┐
         ▼             ▼             ▼
    ┌────────┐    ┌────────┐   ┌────────┐
    │  RDS   │    │ Redis  │   │  KMS   │
    │Postgres│    │Cache   │   │Signing │
    └────────┘    └────────┘   └───┬────┘
                                    │
                                    ▼
                              ┌─────────┐
                              │   S3    │
                              │ Merkle  │
                              │ Proofs  │
                              └─────────┘
```

## Future Enhancements

- [ ] HTTPS with ACM certificates
- [ ] CloudHSM integration for hardware-backed signing
- [ ] Multi-AZ RDS for high availability
- [ ] CloudFront CDN for static assets
- [ ] WAF for additional security
- [ ] Auto-scaling based on metrics
- [ ] Blue-green deployments
- [ ] Integration with CI/CD pipeline

## Support

For issues or questions, please open an issue in the repository or contact the AetherCore team.
