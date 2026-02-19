# AetherCore AWS Testbed Environment Default Values
# 
# Sensitive values should be set via environment variables:
#   export TF_VAR_db_password="your-secure-password"
#   export TF_VAR_jwt_secret="your-jwt-secret"

aws_region   = "us-east-1"
project_name = "aethercore"
environment  = "aws-testbed"

# VPC Configuration
vpc_cidr               = "10.10.0.0/16"
public_subnet_cidr     = "10.10.1.0/24"
public_subnet_2_cidr   = "10.10.4.0/24"
private_subnet_cidr    = "10.10.2.0/24"
private_subnet_2_cidr  = "10.10.6.0/24"
database_subnet_cidr   = "10.10.3.0/24"
database_subnet_2_cidr = "10.10.5.0/24"

# Restrict access to your organization's IP ranges for production
# For internal testing, you can use ["0.0.0.0/0"]
# SECURITY WARNING: 0.0.0.0/0 violates Prime Directive - restrict in production
allowed_cidr_blocks = ["10.10.0.0/16"]

# SSL Certificate ARN (required for HTTPS ALB with TLS 1.3)
# Create via: aws acm request-certificate --domain-name your-domain.com
ssl_certificate_arn = "arn:aws:acm:us-east-1:ACCOUNT_ID:certificate/CERTIFICATE_ID"

# Hardening Configuration
enable_multi_az        = false  # Set to true for production resilience testing
backup_retention_days  = 1      # Keep retention short in testbed to lower cost
budget_limit_usd                 = 25                   # Lower monthly limit for ephemeral testbed use
budget_alert_emails              = ["ops@aethercore.com"]
budget_actual_threshold_percent  = 50                   # Alert early at 50% actual spend
budget_forecast_threshold_percent = 80                  # Escalate at 80% forecasted spend

# Cost-optimized instance types for aws-testbed environment
rds_instance_class = "db.t4g.micro"
redis_node_type    = "cache.t4g.micro"

# Database configuration
db_name     = "aethercore"
db_username = "aethercore"
# db_password should be set via TF_VAR_db_password environment variable

# Authentication
# jwt_secret should be set via TF_VAR_jwt_secret environment variable

# Docker image tag
image_tag = "aws-testbed-latest"

# Grafana root URL (use ALB DNS name or custom domain)
grafana_root_url = "https://alb-domain/grafana/"
