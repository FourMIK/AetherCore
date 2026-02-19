module "dashboard" {
  source      = "./modules/dashboard"
  name_prefix = local.name_prefix
  kms_key_arn = aws_kms_key.main.arn
  tags        = local.tags
}