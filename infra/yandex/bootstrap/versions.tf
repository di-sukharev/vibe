terraform {
  required_version = ">= 1.15.0, < 2.0.0"

  required_providers {
    yandex = {
      source  = "yandex-cloud/yandex"
      version = "0.221.0"
    }
  }

  # Terraform 1.15 validates backend arguments even with `init -backend=false`. These inert values
  # keep offline validation possible; scripts/infra.mjs overrides all three from backend.backend.hcl.
  backend "s3" {
    bucket = "configured-by-scripts-infra-mjs"
    key    = "configured-by-scripts-infra-mjs/terraform.tfstate"
    region = "us-east-1"
  }
}

provider "yandex" {
  cloud_id  = var.cloud_id
  folder_id = var.folder_id
  zone      = var.zone
}
