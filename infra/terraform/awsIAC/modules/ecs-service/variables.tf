variable "name_prefix" { type = string }
variable "service_name" { type = string }
variable "cluster_arn" { type = string }
variable "subnet_ids" { type = list(string) }
variable "security_group_ids" { type = list(string) }

variable "task_execution_role_arn" { type = string }
variable "task_role_arn" { type = string }

variable "ecr_repo_url" { type = string }
variable "image_tag" { type = string }

variable "cpu" { type = number }
variable "memory" { type = number }
variable "desired_count" { type = number }

variable "container_port" { type = number }
variable "target_group_arn" { type = string }

variable "log_group_name" { type = string }
variable "log_region" { type = string }

variable "environment" {
  type    = map(string)
  default = {}
}

variable "secrets" {
  type    = map(string)
  default = {}
}

variable "architecture" {
  type    = string
  default = "X86_64"
}