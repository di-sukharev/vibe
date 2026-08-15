terraform {
  required_version = ">= 1.15.0, < 2.0.0"

  required_providers {
    digitalocean = {
      source  = "digitalocean/digitalocean"
      version = "2.99.1"
    }
  }

  # The first init is local. `bun run infra:bootstrap -- digitalocean` creates the bucket and
  # scoped key, then migrates this state into the partial S3 backend.
  # Terraform 1.15 validates backend arguments even with `init -backend=false`. These inert values
  # keep offline validation possible; scripts/infra.mjs overrides all three from backend.backend.hcl.
  backend "s3" {
    bucket = "configured-by-scripts-infra-mjs"
    key    = "configured-by-scripts-infra-mjs/terraform.tfstate"
    region = "us-east-1"
  }
}

provider "digitalocean" {}
