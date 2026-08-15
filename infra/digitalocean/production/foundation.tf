locals {
  name_prefix   = "${var.project_slug}-prod"
  webapp_origin = "https://${var.webapp_domain}"
}

check "regions_are_compatible" {
  assert {
    condition     = startswith(var.database_region, var.app_region) && var.spaces_region == var.database_region
    error_message = "App Platform, database/VPC, and Spaces must use compatible DigitalOcean regions."
  }
}

check "email_is_complete" {
  assert {
    condition = var.email_delivery == "disabled" || (
      var.email_from != null && contains(keys(var.extra_runtime_secret_env), "EMAIL_RESEND_API_KEY")
    )
    error_message = "email_delivery=resend requires email_from and EMAIL_RESEND_API_KEY in extra_runtime_secret_env."
  }
}

resource "digitalocean_project" "production" {
  name        = "${var.project_slug} production"
  description = "Production infrastructure managed by Terraform."
  purpose     = "Web Application"
  environment = "Production"
}

resource "digitalocean_vpc" "production" {
  name        = "${local.name_prefix}-vpc"
  region      = var.database_region
  ip_range    = var.vpc_ip_range
  description = "Private network for App Platform and Managed PostgreSQL."
}

resource "digitalocean_container_registry" "production" {
  name                   = var.registry_name
  subscription_tier_slug = var.registry_subscription_tier
  region                 = var.database_region

  lifecycle {
    prevent_destroy = true
  }
}

resource "digitalocean_database_cluster" "postgres" {
  name                 = "${local.name_prefix}-postgres"
  engine               = "pg"
  version              = "18"
  size                 = var.database_size
  region               = var.database_region
  node_count           = 1
  private_network_uuid = digitalocean_vpc.production.id
  project_id           = digitalocean_project.production.id
  tags                 = [local.name_prefix, "terraform"]

  maintenance_window {
    day  = "sunday"
    hour = "03:00:00"
  }

  storage_autoscale {
    enabled           = true
    threshold_percent = 80
    increment_gib     = 10
  }

  lifecycle {
    prevent_destroy = true
  }
}

# Managed Databases accept public connections from any source until a firewall exists. The first
# foundation apply trusts only the dedicated VPC. After the API migration succeeds, the release
# wrapper feeds the exact App ID back into this independent state and tightens the rule.
resource "digitalocean_database_firewall" "postgres" {
  cluster_id = digitalocean_database_cluster.postgres.id

  rule {
    type  = var.trusted_api_app_id == null ? "ip_addr" : "app"
    value = var.trusted_api_app_id == null ? var.vpc_ip_range : var.trusted_api_app_id
  }

  lifecycle {
    prevent_destroy = true
  }
}

resource "digitalocean_database_user" "application" {
  cluster_id = digitalocean_database_cluster.postgres.id
  name       = replace("${var.project_slug}_app", "-", "_")

  lifecycle {
    prevent_destroy = true
  }
}

resource "digitalocean_database_db" "application" {
  cluster_id = digitalocean_database_cluster.postgres.id
  name       = replace(var.project_slug, "-", "_")

  lifecycle {
    prevent_destroy = true
  }
}

resource "digitalocean_spaces_bucket" "media" {
  name          = var.media_bucket_name
  region        = var.spaces_region
  acl           = "private"
  force_destroy = false

  lifecycle_rule {
    id      = "abort-incomplete-uploads"
    enabled = true

    abort_incomplete_multipart_upload_days = 7
  }

  lifecycle {
    prevent_destroy = true
  }
}

resource "digitalocean_spaces_bucket_cors_configuration" "media" {
  bucket = digitalocean_spaces_bucket.media.id
  region = var.spaces_region

  cors_rule {
    id              = "browser-direct-upload"
    allowed_origins = [local.webapp_origin]
    allowed_methods = ["GET", "PUT", "HEAD"]
    allowed_headers = ["Content-Type", "If-None-Match"]
    expose_headers  = ["ETag"]
    max_age_seconds = 600
  }
}

resource "digitalocean_spaces_key" "media" {
  name = "${local.name_prefix}-media"

  grant {
    bucket     = digitalocean_spaces_bucket.media.name
    permission = "readwrite"
  }
}

resource "digitalocean_project_resources" "production" {
  project = digitalocean_project.production.id
  resources = [
    digitalocean_vpc.production.urn,
    digitalocean_database_cluster.postgres.urn,
    digitalocean_spaces_bucket.media.urn,
  ]
}
