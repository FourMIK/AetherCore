output "alb_dns_name" {
  value = aws_lb.main.dns_name
}

output "alb_https_listener_arn" {
  value = aws_lb_listener.https.arn
}

output "rds_endpoint" {
  value = aws_db_instance.postgres.address
}

output "redis_endpoint" {
  value = aws_elasticache_cluster.redis.cache_nodes[0].address
}

output "artifacts_bucket" {
  value = aws_s3_bucket.artifacts.bucket
}

output "dashboard_bucket" {
  value = module.dashboard.dashboard_bucket
}

output "dashboard_cloudfront_domain" {
  value = module.dashboard.dashboard_cloudfront_domain
}

output "secrets" {
  value = {
    db_password_secret_arn = aws_secretsmanager_secret.db_password.arn
    jwt_secret_arn         = aws_secretsmanager_secret.jwt_secret.arn
  }
  sensitive = true
}

output "ecr_repositories" {
  value = { for k, v in aws_ecr_repository.svc : k => v.repository_url }
}