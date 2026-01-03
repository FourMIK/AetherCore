# AetherCore Internal Environment Outputs

output "vpc_id" {
  description = "VPC ID"
  value       = aws_vpc.main.id
}

output "alb_dns_name" {
  description = "Application Load Balancer DNS name"
  value       = aws_lb.main.dns_name
}

output "alb_zone_id" {
  description = "Application Load Balancer Zone ID"
  value       = aws_lb.main.zone_id
}

output "alb_arn" {
  description = "Application Load Balancer ARN"
  value       = aws_lb.main.arn
}

output "ecs_cluster_id" {
  description = "ECS Cluster ID"
  value       = aws_ecs_cluster.main.id
}

output "ecs_cluster_name" {
  description = "ECS Cluster name"
  value       = aws_ecs_cluster.main.name
}

output "ecr_repository_gateway_url" {
  description = "ECR repository URL for gateway service"
  value       = aws_ecr_repository.gateway.repository_url
}

output "ecr_repository_auth_url" {
  description = "ECR repository URL for auth service"
  value       = aws_ecr_repository.auth.repository_url
}

output "ecr_repository_collaboration_url" {
  description = "ECR repository URL for collaboration service"
  value       = aws_ecr_repository.collaboration.repository_url
}

output "ecr_repository_rust_base_url" {
  description = "ECR repository URL for rust base image"
  value       = aws_ecr_repository.rust_base.repository_url
}

output "rds_endpoint" {
  description = "RDS PostgreSQL endpoint"
  value       = aws_db_instance.postgres.endpoint
  sensitive   = true
}

output "rds_address" {
  description = "RDS PostgreSQL address"
  value       = aws_db_instance.postgres.address
  sensitive   = true
}

output "redis_endpoint" {
  description = "ElastiCache Redis endpoint"
  value       = "${aws_elasticache_cluster.redis.cache_nodes[0].address}:${aws_elasticache_cluster.redis.cache_nodes[0].port}"
  sensitive   = true
}

output "kms_key_id" {
  description = "KMS signing key ID"
  value       = aws_kms_key.signing.key_id
}

output "kms_key_arn" {
  description = "KMS signing key ARN"
  value       = aws_kms_key.signing.arn
}

output "s3_merkle_bucket_name" {
  description = "S3 bucket name for Merkle proofs"
  value       = aws_s3_bucket.merkle_proofs.id
}

output "s3_merkle_bucket_arn" {
  description = "S3 bucket ARN for Merkle proofs"
  value       = aws_s3_bucket.merkle_proofs.arn
}

output "gateway_service_name" {
  description = "Gateway ECS service name"
  value       = module.gateway_service.service_name
}

output "auth_service_name" {
  description = "Auth ECS service name"
  value       = module.auth_service.service_name
}

output "collaboration_service_name" {
  description = "Collaboration ECS service name"
  value       = module.collaboration_service.service_name
}

output "database_secret_arn" {
  description = "Secrets Manager ARN for database URL"
  value       = aws_secretsmanager_secret.database_url.arn
}

output "redis_secret_arn" {
  description = "Secrets Manager ARN for Redis URL"
  value       = aws_secretsmanager_secret.redis_url.arn
}

output "jwt_secret_arn" {
  description = "Secrets Manager ARN for JWT secret"
  value       = aws_secretsmanager_secret.jwt_secret.arn
}
