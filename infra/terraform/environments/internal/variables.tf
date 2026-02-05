# AetherCore Internal Environment Variables

variable "aws_region" {
  description = "AWS region for deployment"
  type        = string
  default     = "us-east-1"
}

variable "project_name" {
  description = "Project name used for resource naming"
  type        = string
  default     = "aethercore"
}

variable "environment" {
  description = "Environment name (internal, staging, production)"
  type        = string
  default     = "internal"
}

variable "vpc_cidr" {
  description = "CIDR block for VPC"
  type        = string
  default     = "10.0.0.0/16"
}

variable "public_subnet_cidr" {
  description = "CIDR block for public subnet"
  type        = string
  default     = "10.0.1.0/24"
}

variable "public_subnet_2_cidr" {
  description = "CIDR block for second public subnet (ALB requirement)"
  type        = string
  default     = "10.0.4.0/24"
}

variable "private_subnet_cidr" {
  description = "CIDR block for private subnet"
  type        = string
  default     = "10.0.2.0/24"
}

variable "database_subnet_cidr" {
  description = "CIDR block for database subnet"
  type        = string
  default     = "10.0.3.0/24"
}

variable "database_subnet_2_cidr" {
  description = "CIDR block for second database subnet (AWS RDS multi-AZ requirement)"
  type        = string
  default     = "10.0.5.0/24"
}

variable "allowed_cidr_blocks" {
  description = "CIDR blocks allowed to access ALB (SECURITY: Restrict from 0.0.0.0/0 in production)"
  type        = list(string)
  default     = ["10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16"]
}

variable "ssl_certificate_arn" {
  description = "SSL certificate ARN for HTTPS ALB listener (required for TLS 1.3)"
  type        = string
}

variable "enable_multi_az" {
  description = "Enable Multi-AZ for production resilience"
  type        = bool
  default     = false
}

variable "backup_retention_days" {
  description = "Database backup retention period"
  type        = number
  default     = 7
}

variable "budget_limit_usd" {
  description = "Monthly budget limit in USD"
  type        = number
  default     = 200
}

variable "rds_instance_class" {
  description = "RDS instance class"
  type        = string
  default     = "db.t4g.micro"
}

variable "redis_node_type" {
  description = "ElastiCache Redis node type"
  type        = string
  default     = "cache.t4g.micro"
}

variable "db_name" {
  description = "PostgreSQL database name"
  type        = string
  default     = "aethercore"
}

variable "db_username" {
  description = "PostgreSQL database username"
  type        = string
  default     = "aethercore"
  sensitive   = true
}

variable "db_password" {
  description = "PostgreSQL database password"
  type        = string
  sensitive   = true
}

variable "jwt_secret" {
  description = "JWT secret for authentication"
  type        = string
  sensitive   = true
}

variable "image_tag" {
  description = "Docker image tag to deploy"
  type        = string
  default     = "latest"
}

variable "grafana_root_url" {
  description = "Grafana root URL matching the ALB DNS name or custom domain"
  type        = string
}
