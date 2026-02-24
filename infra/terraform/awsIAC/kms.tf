resource "aws_kms_key" "main" {
  description             = "KMS key for ${local.name_prefix} secrets and artifacts"
  deletion_window_in_days = 7
  enable_key_rotation     = true
}

resource "aws_kms_alias" "main" {
  name          = "alias/${local.name_prefix}"
  target_key_id = aws_kms_key.main.key_id
}