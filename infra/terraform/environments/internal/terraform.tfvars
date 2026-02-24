# AetherCore Internal Environment Default Values
# 
# Sensitive values should be set via environment variables:
#   export TF_VAR_db_password="your-secure-password"
#   export TF_VAR_jwt_secret="your-jwt-secret"

aws_region   = "us-east-1"
project_name = "aethercore"
environment  = "internal"

# VPC Configuration
vpc_cidr               = "10.0.0.0/16"
public_subnet_cidr     = "10.0.1.0/24"
public_subnet_2_cidr   = "10.0.4.0/24"
private_subnet_cidr    = "10.0.2.0/24"
private_subnet_2_cidr  = "10.0.6.0/24"
database_subnet_cidr   = "10.0.3.0/24"
database_subnet_2_cidr = "10.0.5.0/24"

# Restrict access to your organization's IP ranges for production
# For internal testing, you can use ["0.0.0.0/0"]
# SECURITY WARNING: 0.0.0.0/0 violates Prime Directive - restrict in production
allowed_cidr_blocks = ["10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16"]

# SSL Certificate ARN (required for HTTPS ALB with TLS 1.3)
# Create via: aws acm request-certificate --domain-name your-domain.com
ssl_certificate_arn = "arn:aws:acm:us-east-1:ACCOUNT_ID:certificate/CERTIFICATE_ID"

# Hardening Configuration
enable_multi_az        = false  # Set to true for production resilience testing
backup_retention_days  = 7      # 30 for production
budget_limit_usd      = 200     # Monthly cost limit

# Cost-optimized instance types for internal environment
rds_instance_class = "db.t4g.micro"
redis_node_type    = "cache.t4g.micro"

# Database configuration
db_name     = "aethercore"
db_username = "aethercore"
# db_password should be set via TF_VAR_db_password environment variable

# Authentication
# jwt_secret should be set via TF_VAR_jwt_secret environment variable

# Docker image tag
image_tag = "latest"

# Grafana root URL (use ALB DNS name or custom domain)
grafana_root_url = "https://alb-domain/grafana/"
