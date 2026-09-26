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

run "unscoped_extra_env_reaches_every_component" {
  command = plan

  variables {
    extra_runtime_env        = { FEATURE_FLAG = "on" }
    extra_runtime_secret_env = { EXTERNAL_API_KEY = "external-secret" }
  }

  assert {
    condition = alltrue([
      for component in ["api", "scheduler"] :
      output.runtime_inputs.component_environments[component]["FEATURE_FLAG"] == "on" &&
      output.runtime_inputs.component_environments[component]["NODE_ENV"] == "production" &&
      contains(keys(output.runtime_inputs.component_secret_environments[component]), "EXTERNAL_API_KEY") &&
      contains(keys(output.runtime_inputs.component_secret_environments[component]), "PRIVATE_STORAGE_SECRET_ACCESS_KEY")
    ])
    error_message = "Without extra_env_components, every extra variable must reach the API and the scheduler as before."
  }

  assert {
    condition = (
      output.runtime_inputs.component_environments["api"] == output.runtime_inputs.component_environments["scheduler"] &&
      setsubtract(
        keys(output.runtime_inputs.component_secret_environments["api"]),
        keys(output.runtime_inputs.component_secret_environments["scheduler"]),
      ) == toset(["JWT_SECRET"])
    )
    error_message = "Unscoped variables must reach both components; the JWT secret is the only built-in difference."
  }
}

run "jwt_secret_reaches_only_the_api" {
  command = plan

  assert {
    condition = (
      contains(keys(output.runtime_inputs.component_secret_environments["api"]), "JWT_SECRET") &&
      !contains(keys(output.runtime_inputs.component_secret_environments["scheduler"]), "JWT_SECRET")
    )
    error_message = "Only the API signs tokens: the scheduler worker must not receive JWT_SECRET."
  }
}

run "scoped_extra_env_reaches_only_its_targets" {
  command = plan

  variables {
    extra_runtime_env = {
      APPLE_IAP_BUNDLE_ID      = "com.example.app"
      GOOGLE_PLAY_PACKAGE_NAME = "com.example.app"
    }
    extra_runtime_secret_env = {
      APPLE_IAP_PRIVATE_KEY_BASE64            = "apple-secret"
      GOOGLE_PLAY_SERVICE_ACCOUNT_JSON_BASE64 = "google-secret"
    }
    extra_env_components = {
      APPLE_IAP_BUNDLE_ID                     = ["api"]
      APPLE_IAP_PRIVATE_KEY_BASE64            = ["api"]
      GOOGLE_PLAY_PACKAGE_NAME                = ["api", "outbox"]
      GOOGLE_PLAY_SERVICE_ACCOUNT_JSON_BASE64 = ["api", "outbox"]
    }
  }

  assert {
    condition = (
      contains(keys(output.runtime_inputs.component_environments["api"]), "APPLE_IAP_BUNDLE_ID") &&
      contains(keys(output.runtime_inputs.component_secret_environments["api"]), "APPLE_IAP_PRIVATE_KEY_BASE64") &&
      !contains(keys(output.runtime_inputs.component_environments["scheduler"]), "APPLE_IAP_BUNDLE_ID") &&
      !contains(keys(output.runtime_inputs.component_secret_environments["scheduler"]), "APPLE_IAP_PRIVATE_KEY_BASE64")
    )
    error_message = "A variable scoped to the API must not reach the scheduler worker."
  }

  assert {
    condition = alltrue([
      for component in ["api", "scheduler"] :
      contains(keys(output.runtime_inputs.component_environments[component]), "GOOGLE_PLAY_PACKAGE_NAME") &&
      contains(keys(output.runtime_inputs.component_secret_environments[component]), "GOOGLE_PLAY_SERVICE_ACCOUNT_JSON_BASE64")
    ])
    error_message = "A variable scoped to a job must reach the scheduler worker, which runs every job."
  }
}

run "extra_env_components_rejects_unknown_targets" {
  command = plan

  variables {
    extra_runtime_env    = { FEATURE_FLAG = "on" }
    extra_env_components = { FEATURE_FLAG = ["scheduler"] }
  }

  expect_failures = [var.extra_env_components]
}

run "extra_env_components_rejects_unknown_variables" {
  command = plan

  variables {
    extra_env_components = { MISSING_VARIABLE = ["api"] }
  }

  expect_failures = [var.extra_env_components]
}

run "extra_env_components_rejects_empty_targets" {
  command = plan

  variables {
    extra_runtime_env    = { FEATURE_FLAG = "on" }
    extra_env_components = { FEATURE_FLAG = [] }
  }

  expect_failures = [var.extra_env_components]
}

run "extra_env_rejects_builtin_names" {
  command = plan

  variables {
    extra_runtime_secret_env = { JWT_SECRET = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" }
  }

  expect_failures = [output.runtime_inputs]
}
