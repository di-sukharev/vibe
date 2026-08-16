terraform {
  required_version = ">= 1.15.0, < 2.0.0"

  backend "s3" {
    bucket = "configured-by-scripts-infra-mjs"
    key    = "configured-by-scripts-infra-mjs/terraform.tfstate"
    region = "us-east-1"
  }
}

variable "owner_token" { type = string }
variable "holder_executable" { type = string }
variable "holder_script" { type = string }
variable "ready_signal" { type = string }
variable "release_signal" { type = string }
variable "parent_pid" { type = number }

resource "terraform_data" "production_lease" {
  input            = var.owner_token
  triggers_replace = [var.owner_token]

  provisioner "local-exec" {
    command     = "hold"
    interpreter = [var.holder_executable, var.holder_script]
    environment = {
      INFRA_LEASE_OWNER          = var.owner_token
      INFRA_LEASE_READY_SIGNAL   = var.ready_signal
      INFRA_LEASE_RELEASE_SIGNAL = var.release_signal
      INFRA_LEASE_PARENT_PID     = tostring(var.parent_pid)
    }
  }
}
