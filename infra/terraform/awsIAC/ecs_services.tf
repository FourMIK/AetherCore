resource "aws_s3_bucket" "artifacts" {
  bucket_prefix = "${local.name_prefix}-artifacts-"
}

resource "aws_s3_bucket_server_side_encryption_configuration" "artifacts" {
  bucket = aws_s3_bucket.artifacts.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm     = "aws:kms"
      kms_master_key_id = aws_kms_key.main.arn
    }
  }
}

resource "aws_s3_bucket_versioning" "artifacts" {
  bucket = aws_s3_bucket.artifacts.id
  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_cloudwatch_log_group" "service" {
  for_each          = { for k, v in var.service_definitions : k => v if v.enabled }
  name              = "/ecs/${local.name_prefix}/${each.key}"
  retention_in_days = var.log_retention_days
}

resource "aws_lb_target_group" "svc" {
  for_each = { for k, v in var.service_definitions : k => v if v.enabled }

  name        = substr("${local.name_prefix}-${each.key}", 0, 32)
  port        = each.value.container_port
  protocol    = "HTTP"
  vpc_id      = aws_vpc.main.id
  target_type = "ip"

  health_check {
    path                = each.value.health_path
    healthy_threshold   = 2
    unhealthy_threshold = 3
    timeout             = 5
    interval            = 15
    matcher             = "200-399"
  }
}

resource "aws_lb_listener_rule" "svc_paths" {
  for_each = { for k, v in var.service_definitions : k => v if v.enabled }

  listener_arn = aws_lb_listener.https.arn
  priority     = 100 + index(keys({ for kk, vv in var.service_definitions : kk => vv if vv.enabled }), each.key)

  action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.svc[each.key].arn
  }

  condition {
    path_pattern {
      values = each.value.path_patterns
    }
  }
}

module "ecs_service" {
  for_each = { for k, v in var.service_definitions : k => v if v.enabled }
  source   = "./modules/ecs-service"

  name_prefix            = local.name_prefix
  service_name           = each.key
  cluster_arn            = aws_ecs_cluster.main.arn
  subnet_ids             = aws_subnet.private[*].id
  security_group_ids     = [aws_security_group.ecs.id]
  task_execution_role_arn = aws_iam_role.task_execution.arn
  task_role_arn          = aws_iam_role.task_runtime.arn

  ecr_repo_url = aws_ecr_repository.svc[each.value.ecr_repo_name].repository_url
  image_tag    = each.value.image_tag

  cpu          = each.value.cpu
  memory       = each.value.memory
  desired_count = each.value.desired_count

  container_port  = each.value.container_port
  target_group_arn = aws_lb_target_group.svc[each.key].arn

  log_group_name = aws_cloudwatch_log_group.service[each.key].name
  log_region     = var.region

  environment = merge(each.value.env, {
    # Standard wiring. Your services can use these or ignore them.
    AETHER_ENV   = var.environment,
    AWS_REGION   = var.region,
    DB_HOST      = aws_db_instance.postgres.address,
    DB_PORT      = "5432",
    DB_USER      = aws_db_instance.postgres.username,
    REDIS_HOST   = aws_elasticache_cluster.redis.cache_nodes[0].address,
    REDIS_PORT   = tostring(aws_elasticache_cluster.redis.port),
    ARTIFACTS_S3 = aws_s3_bucket.artifacts.bucket
  })

  secrets = merge(each.value.secrets, {
    DB_PASSWORD = aws_secretsmanager_secret.db_password.arn,
    JWT_SECRET  = aws_secretsmanager_secret.jwt_secret.arn
  })

  architecture = var.container_architecture
}