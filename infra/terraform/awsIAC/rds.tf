resource "aws_db_subnet_group" "main" {
  name       = "${local.name_prefix}-dbsubnets"
  subnet_ids = aws_subnet.db[*].id
}

resource "aws_db_parameter_group" "postgres" {
  name   = "${local.name_prefix}-pg"
  family = "postgres16"

  parameter {
    name  = "log_min_duration_statement"
    value = "250"
  }
}

resource "aws_db_instance" "postgres" {
  identifier             = "${local.name_prefix}-postgres"
  engine                 = "postgres"
  engine_version         = "16.3"
  instance_class         = var.rds_instance_class
  allocated_storage      = var.rds_allocated_storage_gb
  storage_encrypted      = true
  kms_key_id             = aws_kms_key.main.arn
  db_subnet_group_name   = aws_db_subnet_group.main.name
  vpc_security_group_ids = [aws_security_group.rds.id]
  parameter_group_name   = aws_db_parameter_group.postgres.name

  username = "aether"
  password = aws_secretsmanager_secret_version.db_password.secret_string

  backup_retention_period = var.rds_backup_retention_days
  deletion_protection     = false
  skip_final_snapshot     = true
  publicly_accessible     = false
  multi_az                = false

  enabled_cloudwatch_logs_exports = ["postgresql"]
}