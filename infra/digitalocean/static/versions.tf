terraform {
  required_version = ">= 1.15.0, < 2.0.0"

  required_providers {
    digitalocean = {
      source  = "digitalocean/digitalocean"
      version = "2.99.1"
    }
  }

  backend "s3" {
    bucket = "configured-by-scripts-infra-mjs"
    key    = "configured-by-scripts-infra-mjs/terraform.tfstate"
    region = "us-east-1"
  }
}

provider "digitalocean" {}
