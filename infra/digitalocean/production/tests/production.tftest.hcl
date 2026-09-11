mock_provider "digitalocean" {}

variables {
  project_slug      = "example-product"
  app_region        = "fra"
  database_region   = "fra1"
  spaces_region     = "fra1"
  github_repo       = "owner/repository"
  git_branch        = "master"
  registry_name     = "example-product-registry"
  api_domain        = "api.example.com"
  webapp_domain     = "app.example.com"
  website_domain    = "www.example.com"
  media_bucket_name = "example-product-media-test"
  jwt_secret        = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
}

run "foundation_is_runtime_independent" {
  command = plan

  assert {
    condition     = digitalocean_database_cluster.postgres.node_count == 1
    error_message = "The launch profile intentionally starts with one PostgreSQL node."
  }

  assert {
    condition = (
      one(digitalocean_database_firewall.postgres.rule).type == "ip_addr" &&
      one(digitalocean_database_firewall.postgres.rule).value == var.vpc_ip_range
    )
    error_message = "Managed PostgreSQL must trust only the dedicated production VPC from the first apply."
  }

  assert {
    condition     = digitalocean_spaces_bucket.media.acl == "private"
    error_message = "User media must not be publicly readable."
  }

  assert {
    condition     = try(digitalocean_spaces_bucket.media.versioning[0].enabled, false)
    error_message = "User media must be versioned: the runtime key can delete objects and the backend does on every avatar replace or remove, so a delete needs a recoverable version behind it."
  }

  assert {
    condition = (
      try(digitalocean_spaces_bucket.media.lifecycle_rule[0].enabled, false) &&
      try(one(digitalocean_spaces_bucket.media.lifecycle_rule[0].noncurrent_version_expiration).days, 0) == 30
    )
    error_message = "Versioning keeps every replaced or deleted media object as a noncurrent version; the bucket needs one enabled rule expiring them after 30 days, the recovery window docs/STORAGE.md promises, or the Space grows without bound."
  }

  assert {
    condition     = try(digitalocean_spaces_bucket.media.lifecycle_rule[0].abort_incomplete_multipart_upload_days, 0) == 7
    error_message = "An interrupted multipart upload must be aborted instead of being billed forever."
  }

  assert {
    condition     = try(digitalocean_spaces_bucket.media.lifecycle_rule[1].enabled, null) == null
    error_message = "The media Space keeps exactly one lifecycle rule; a second one is where an expiration of current objects would hide."
  }

  assert {
    condition = (
      try(one(digitalocean_spaces_bucket.media.lifecycle_rule[0].expiration).days, null) == null &&
      try(one(digitalocean_spaces_bucket.media.lifecycle_rule[0].expiration).date, null) == null
    )
    error_message = "The lifecycle rule must leave current media objects alone: no expiration by age or date. Removing expired delete markers is the one expiration a versioned media bucket may add."
  }

  assert {
    condition = (
      output.release_source.git_branch == var.git_branch &&
      output.release_source.github_repo == var.github_repo
    )
    error_message = "The guarded release wrapper must read the effective branch and repository from foundation state."
  }
}

run "firewall_tightens_after_api_deployment" {
  command = plan

  variables {
    trusted_api_app_id = "12345678-1234-1234-1234-123456789abc"
  }

  assert {
    condition = (
      one(digitalocean_database_firewall.postgres.rule).type == "app" &&
      one(digitalocean_database_firewall.postgres.rule).value == var.trusted_api_app_id
    )
    error_message = "After promotion PostgreSQL must trust the exact API app instead of the whole VPC CIDR."
  }
}
