# ECS Service Module for AetherCore Services

variable "project_name" {
  description = "Project name"
  type        = string
}

variable "environment" {
  description = "Environment name"
  type        = string
}

variable "service_name" {
  description = "Service name (e.g., gateway, auth, collaboration)"
  type        = string
}

variable "cluster_id" {
  description = "ECS cluster ID"
  type        = string
}

variable "vpc_id" {
  description = "VPC ID"
  type        = string
}

variable "private_subnet_id" {
  description = "Private subnet ID for service"
  type        = string
}

variable "security_group_id" {
  description = "Security group ID for service"
  type        = string
}

variable "ecr_repository_url" {
  description = "ECR repository URL"
  type        = string
}

variable "image_tag" {
  description = "Docker image tag"
  type        = string
  default     = "latest"
}

variable "container_port" {
  description = "Container port"
  type        = number
}

variable "cpu" {
  description = "Fargate CPU units (256, 512, 1024, 2048, 4096)"
  type        = number
  default     = 256
}

variable "memory" {
  description = "Fargate memory in MB (512, 1024, 2048, 4096, 8192)"
  type        = number
  default     = 512
}

variable "desired_count" {
  description = "Desired number of tasks"
  type        = number
  default     = 1
}

variable "target_group_arn" {
  description = "ALB target group ARN"
  type        = string
}

variable "task_execution_role_arn" {
  description = "ECS task execution role ARN"
  type        = string
}

variable "task_role_arn" {
  description = "ECS task role ARN"
  type        = string
}

variable "environment_variables" {
  description = "Environment variables for the container"
  type        = map(string)
  default     = {}
}

variable "secrets" {
  description = "Secrets Manager ARNs for sensitive data"
  type        = map(string)
  default     = {}
}

variable "health_check_command" {
  description = "Custom health check command. If not provided, defaults to HTTP health check on container port using Node.js."
  type        = list(string)
  default     = null
}

# CloudWatch Log Group
resource "aws_cloudwatch_log_group" "service" {
  name              = "/ecs/${var.project_name}-${var.environment}/${var.service_name}"
  retention_in_days = 7

  tags = {
    Name        = "${var.project_name}-${var.environment}-${var.service_name}-logs"
    Service     = var.service_name
    Environment = var.environment
  }
}

# ECS Task Definition
resource "aws_ecs_task_definition" "service" {
  family                   = "${var.project_name}-${var.environment}-${var.service_name}"
  network_mode             = "awsvpc"
  requires_compatibilities = ["FARGATE"]
  cpu                      = var.cpu
  memory                   = var.memory
  execution_role_arn       = var.task_execution_role_arn
  task_role_arn            = var.task_role_arn

  container_definitions = jsonencode([
    {
      name  = var.service_name
      image = "${var.ecr_repository_url}:${var.image_tag}"

      portMappings = [
        {
          containerPort = var.container_port
          protocol      = "tcp"
        }
      ]

      environment = [
        for key, value in var.environment_variables : {
          name  = key
          value = value
        }
      ]

      secrets = [
        for key, arn in var.secrets : {
          name      = key
          valueFrom = arn
        }
      ]

      logConfiguration = {
        logDriver = "awslogs"
        options = {
          "awslogs-group"         = aws_cloudwatch_log_group.service.name
          "awslogs-region"        = data.aws_region.current.name
          "awslogs-stream-prefix" = "ecs"
        }
      }

      # Container health check - verify service responds on port
      # Uses Node.js http module for TypeScript services
      # Can be overridden via health_check_command variable for other runtimes
      # ALB performs more thorough health checks at /health endpoint
      healthCheck = {
        command = var.health_check_command != null ? var.health_check_command : [
          "CMD-SHELL",
          "node -e \"require('http').get('http://localhost:${var.container_port}/health', (r) => process.exit(r.statusCode === 200 ? 0 : 1)).on('error', () => process.exit(1))\""
        ]
        interval    = 30
        timeout     = 5
        retries     = 3
        startPeriod = 60
      }
    }
  ])

  tags = {
    Name        = "${var.project_name}-${var.environment}-${var.service_name}-task"
    Service     = var.service_name
    Environment = var.environment
  }
}

# ECS Service
resource "aws_ecs_service" "service" {
  name            = "${var.project_name}-${var.environment}-${var.service_name}"
  cluster         = var.cluster_id
  task_definition = aws_ecs_task_definition.service.arn
  desired_count   = var.desired_count

  capacity_provider_strategy {
    capacity_provider = "FARGATE_SPOT"
    weight            = 1
    base              = 0
  }

  network_configuration {
    subnets          = [var.private_subnet_id]
    security_groups  = [var.security_group_id]
    assign_public_ip = false
  }

  load_balancer {
    target_group_arn = var.target_group_arn
    container_name   = var.service_name
    container_port   = var.container_port
  }

  deployment_maximum_percent         = 200
  deployment_minimum_healthy_percent = 100

  deployment_circuit_breaker {
    enable   = true
    rollback = true
  }

  tags = {
    Name        = "${var.project_name}-${var.environment}-${var.service_name}-service"
    Service     = var.service_name
    Environment = var.environment
  }

  depends_on = [var.target_group_arn]
}

# Data source for current AWS region
data "aws_region" "current" {}

# Outputs
output "service_name" {
  description = "ECS service name"
  value       = aws_ecs_service.service.name
}

output "service_id" {
  description = "ECS service ID"
  value       = aws_ecs_service.service.id
}

output "task_definition_arn" {
  description = "ECS task definition ARN"
  value       = aws_ecs_task_definition.service.arn
}

output "log_group_name" {
  description = "CloudWatch log group name"
  value       = aws_cloudwatch_log_group.service.name
}
