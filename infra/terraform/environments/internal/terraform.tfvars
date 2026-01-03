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
database_subnet_cidr   = "10.0.3.0/24"
database_subnet_2_cidr = "10.0.5.0/24"

# Restrict access to your organization's IP ranges for production
# For internal testing, you can use ["0.0.0.0/0"]
allowed_cidr_blocks = ["0.0.0.0/0"]

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
