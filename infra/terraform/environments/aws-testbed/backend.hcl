# S3 Backend Configuration for AetherCore AWS Testbed Environment
#
# Initialize with: terraform init -backend-config=backend.hcl
#
# The S3 bucket and DynamoDB table should be created by
# infra/scripts/bootstrap-aws-testbed.sh before running terraform init.

bucket         = "aethercore-aws-testbed-terraform-state"
key            = "aws-testbed/terraform.tfstate"
region         = "us-east-1"
encrypt        = true
dynamodb_table = "aethercore-aws-testbed-terraform-locks"
