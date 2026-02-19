# AetherCore AWS Testbed IaC (Terraform)

This stack provisions an AWS testbed for AetherCore:

- VPC with public, private, and db subnets across up to 3 AZs
- ECS Cluster (Fargate) + ALB with path-based routing
- RDS PostgreSQL + ElastiCache Redis
- Secrets Manager + KMS for secrets encryption
- ECR repositories for service images
- S3 + CloudFront (OAC) for Tactical Glass static dashboard hosting
- CloudWatch Logs (+ basic alarms)

## Quick start

1. Create Terraform remote state bucket and lock table manually or via your standard bootstrap.
2. Copy `backend.hcl.example` to `backend.hcl` and set values.
3. Run `terraform init -backend-config=backend.hcl`.
4. Run `terraform apply`.

## Service images

This IaC assumes images already exist in ECR (or will be pushed after provisioning). You can deploy a first time with placeholder tags and update later via `terraform apply`.

## Notes

- Default routing assumes:
  - `/api/*` -> gateway
  - `/auth/*` -> auth
  - `/collab/*` -> collaboration
  - `/ingest/*` -> h2-ingest
  - `/bunker/*` -> aetherbunker (optional)
  - Adjust paths and ports in `variables.tf` as your services dictate.
