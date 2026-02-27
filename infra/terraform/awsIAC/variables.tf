variable "project_name" {
  type    = string
  default = "aethercore-testbed"
}

variable "environment" {
  type    = string
  default = "dev"
}

variable "region" {
  type    = string
  default = "us-east-1"
}

variable "az_count" {
  type    = number
  default = 2
  validation {
    condition     = var.az_count >= 2 && var.az_count <= 3
    error_message = "az_count must be 2 or 3."
  }
}

variable "vpc_cidr" {
  type    = string
  default = "10.40.0.0/16"
}

variable "public_subnet_cidrs" {
  type    = list(string)
  default = ["10.40.0.0/20", "10.40.16.0/20", "10.40.32.0/20"]
}

variable "private_subnet_cidrs" {
  type    = list(string)
  default = ["10.40.64.0/20", "10.40.80.0/20", "10.40.96.0/20"]
}

variable "db_subnet_cidrs" {
  type    = list(string)
  default = ["10.40.128.0/20", "10.40.144.0/20", "10.40.160.0/20"]
}

variable "enable_single_nat_gateway" {
  type    = bool
  default = true
}

variable "alb_certificate_arn" {
  type        = string
  description = "ACM certificate ARN for HTTPS listener."
}

variable "allowed_ingress_cidrs" {
  type        = list(string)
  description = "CIDRs allowed to access ALB. Set to your office/VPN ranges."
  default     = ["0.0.0.0/0"]
}

variable "container_architecture" {
  type    = string
  default = "X86_64"
  validation {
    condition     = contains(["X86_64", "ARM64"], var.container_architecture)
    error_message = "container_architecture must be X86_64 or ARM64."
  }
}

variable "rds_instance_class" {
  type    = string
  default = "db.t4g.medium"
}

variable "rds_allocated_storage_gb" {
  type    = number
  default = 100
}

variable "rds_backup_retention_days" {
  type    = number
  default = 7
}

variable "redis_node_type" {
  type    = string
  default = "cache.t4g.small"
}

variable "redis_num_cache_nodes" {
  type    = number
  default = 1
}

variable "log_retention_days" {
  type    = number
  default = 30
}

variable "dashboard_custom_domain" {
  type        = string
  default     = null
  description = "Optional. If set, CloudFront alias will be configured. Requires Route53 record management out of scope here."
}

variable "service_definitions" {
  description = "Define ECS services, ports, paths, CPU/mem, desired count, and ECR repo names."
  type = map(object({
    enabled        = bool
    ecr_repo_name  = string
    image_tag      = string
    container_port = number
    health_path    = string
    path_patterns  = list(string)
    cpu            = number
    memory         = number
    desired_count  = number
    env            = map(string)
    secrets        = map(string) # map ENV_VAR_NAME -> SecretsManager secret ARN
  }))

  default = {
    gateway = {
      enabled        = true
      ecr_repo_name  = "aethercore-gateway"
      image_tag      = "latest"
      container_port = 3000
      health_path    = "/health"
      path_patterns  = ["/api/*"]
      cpu            = 512
      memory         = 1024
      desired_count  = 1
      env            = { NODE_ENV = "production", PORT = "3000" }
      secrets        = {}
    }

    auth = {
      enabled        = true
      ecr_repo_name  = "aethercore-auth"
      image_tag      = "latest"
      container_port = 3001
      health_path    = "/health"
      path_patterns  = ["/auth/*"]
      cpu            = 512
      memory         = 1024
      desired_count  = 1
      env            = { NODE_ENV = "production", PORT = "3001" }
      secrets        = {}
    }

    collaboration = {
      enabled        = true
      ecr_repo_name  = "aethercore-collaboration"
      image_tag      = "latest"
      container_port = 3002
      health_path    = "/health"
      path_patterns  = ["/collab/*"]
      cpu            = 512
      memory         = 1024
      desired_count  = 1
      env            = { NODE_ENV = "production", PORT = "3002" }
      secrets        = {}
    }

    h2_ingest = {
      enabled        = true
      ecr_repo_name  = "aethercore-h2-ingest"
      image_tag      = "latest"
      container_port = 8090
      health_path    = "/health"
      path_patterns  = ["/ingest/*"]
      cpu            = 512
      memory         = 1024
      desired_count  = 1
      env            = { RUST_LOG = "info" }
      secrets        = {}
    }

    aetherbunker = {
      enabled        = false
      ecr_repo_name  = "aetherbunker"
      image_tag      = "latest"
      container_port = 5000
      health_path    = "/health"
      path_patterns  = ["/bunker/*"]
      cpu            = 512
      memory         = 1024
      desired_count  = 1
      env            = { ASPNETCORE_URLS = "http://+:5000" }
      secrets        = {}
    }
  }
}