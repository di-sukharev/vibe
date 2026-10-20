mock_provider "yandex" {}

override_resource {
  target          = yandex_iam_service_account.storage_manager
  override_during = plan
  values          = { id = "storage-manager-id" }
}

override_resource {
  target          = yandex_iam_service_account_static_access_key.static_publisher
  override_during = plan
  values          = { access_key = "publisher-access-key" }
}

override_resource {
  target          = yandex_iam_service_account_static_access_key.storage_manager
  override_during = plan
  values = {
    access_key = "storage-manager-access-key"
    secret_key = "storage-manager-secret-key"
  }
}

override_resource {
  target          = yandex_iam_service_account_static_access_key.media
  override_during = plan
  values          = { access_key = "media-access-key" }
}

override_resource {
  target          = yandex_iam_service_account.static_publisher
  override_during = plan
  values          = { id = "static-publisher-id" }
}

override_resource {
  target          = yandex_iam_service_account.media
  override_during = plan
  values          = { id = "media-id" }
}

override_resource {
  target          = yandex_iam_service_account.runtime
  override_during = plan
  values          = { id = "runtime-service-account" }
}

override_resource {
  target          = yandex_iam_service_account.migration
  override_during = plan
  values          = { id = "migration-service-account" }
}

variables {
  cloud_id                        = "cloud-test"
  folder_id                       = "folder-test"
  project_slug                    = "example-product"
  database_active_slot            = "blue"
  database_owner_password         = "owner-database-password-at-least-24-characters"
  database_owner_password_version = 1
  database_blue_password          = "blue-database-password-at-least-24-characters"
  database_green_password         = "green-database-password-at-least-24-characters"
  database_blue_password_version  = 1
  database_green_password_version = 1
  jwt_secret                      = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
  api_domain                      = "api.example.com"
  api_certificate_id              = "certificate-api"
  webapp_domain                   = "app.example.com"
  webapp_certificate_id           = "certificate-webapp"
  website_domain                  = "www.example.com"
  website_certificate_id          = "certificate-website"
  dns_zone_domain                 = "example.com"
  webapp_bucket_name              = "app.example.com"
  website_bucket_name             = "www.example.com"
  media_bucket_name               = "example-product-media-test"
}

run "steady_state_foundation" {
  command = plan

  assert {
    condition     = yandex_mdb_postgresql_cluster.production.deletion_protection
    error_message = "Managed PostgreSQL must keep provider deletion protection enabled."
  }

  assert {
    condition = (
      length(one(yandex_vpc_security_group.postgres.ingress).v4_cidr_blocks) == 1 &&
      contains(one(yandex_vpc_security_group.postgres.ingress).v4_cidr_blocks, "198.19.0.0/16")
    )
    error_message = "PostgreSQL must accept the documented Serverless Containers service subnet."
  }

  assert {
    condition     = one(yandex_storage_bucket.media.anonymous_access_flags).read == false
    error_message = "User media must not be publicly readable."
  }

  assert {
    condition     = try(one(yandex_storage_bucket.media.versioning).enabled, false)
    error_message = "User media must be versioned: the runtime key can delete objects and the backend does on every avatar replace or remove, so a delete needs a recoverable version behind it."
  }

  assert {
    condition = (
      one(yandex_storage_bucket.webapp.anonymous_access_flags).read &&
      !one(yandex_storage_bucket.webapp.anonymous_access_flags).list &&
      !one(yandex_storage_bucket.webapp.anonymous_access_flags).config_read &&
      one(yandex_storage_bucket.website.anonymous_access_flags).read &&
      !one(yandex_storage_bucket.website.anonymous_access_flags).list &&
      !one(yandex_storage_bucket.website.anonymous_access_flags).config_read
    )
    error_message = "Static hosting needs public object reads only; anonymous listing and bucket-configuration reads stay off."
  }

  assert {
    condition     = length(yandex_resourcemanager_folder_iam_member.storage_manager) == 0
    error_message = "Steady state must never retain folder-wide Object Storage administration access."
  }

  assert {
    condition = (
      yandex_mdb_postgresql_database.application.owner == yandex_mdb_postgresql_user.owner.name &&
      yandex_mdb_postgresql_user.owner.login
    )
    error_message = "A login-capable migration-only owner must own the database while runtime users remain separate."
  }

  assert {
    condition = (
      length(yandex_mdb_postgresql_user.application) == 2 &&
      one(yandex_mdb_postgresql_user.application["blue"].permission).database_name == yandex_mdb_postgresql_database.application.name &&
      one(yandex_mdb_postgresql_user.application["green"].permission).database_name == yandex_mdb_postgresql_database.application.name &&
      toset(yandex_mdb_postgresql_user.application["blue"].grants) == toset(["mdb_read_all_data", "mdb_write_all_data"]) &&
      toset(yandex_mdb_postgresql_user.application["green"].grants) == toset(["mdb_read_all_data", "mdb_write_all_data"])
    )
    error_message = "Both runtime slots need CONNECT plus managed read/write roles, without migration DDL privileges."
  }

  assert {
    condition = (
      yandex_lockbox_secret_version_hashed.migration_database.key_1 == "DATABASE_URL" &&
      yandex_mdb_postgresql_user.owner.name != yandex_mdb_postgresql_user.application["blue"].name
    )
    error_message = "Migrations need a dedicated owner URL rather than a runtime credential."
  }

  assert {
    condition = (
      yandex_lockbox_secret_iam_member.runtime_migration_database.member == "serviceAccount:${yandex_iam_service_account.migration.id}" &&
      yandex_lockbox_secret_iam_member.runtime_migration_database.member != "serviceAccount:${yandex_iam_service_account.runtime.id}" &&
      output.migration_inputs.migration_service_account == yandex_iam_service_account.migration.id &&
      toset(keys(output.migration_inputs.migration_secret_bindings)) == toset(["DATABASE_URL"])
    )
    error_message = "The migration owner secret must be available only to a dedicated migration identity and migration input."
  }

  assert {
    condition     = !contains(keys(yandex_resourcemanager_folder_iam_member.runtime_roles), "lockbox.payloadViewer")
    error_message = "The runtime must receive per-secret Lockbox grants, never folder-wide payload access."
  }

  assert {
    condition     = output.release_source.git_branch == var.git_branch
    error_message = "The guarded release wrapper must read the effective branch from foundation state."
  }

  assert {
    condition = alltrue([
      for environment in values(output.runtime_inputs.component_environments) :
      environment["RATE_LIMIT_STORE"] == "database"
    ])
    error_message = "Serverless Containers scale out per request, so the auth limiter must count in PostgreSQL rather than in one instance's memory."
  }
}

run "cdn_keeps_direct_https_rollback" {
  command = plan

  variables { enable_cdn = true }

  assert {
    condition = (
      one(yandex_storage_bucket.webapp.https).certificate_id == var.webapp_certificate_id &&
      one(yandex_storage_bucket.website.https).certificate_id == var.website_certificate_id
    )
    error_message = "Enabling CDN must retain direct Object Storage HTTPS until DNS has moved and as a rollback origin."
  }
}

run "cdn_requires_domain_named_buckets" {
  command = plan

  variables {
    enable_cdn         = true
    webapp_bucket_name = "unrelated-webapp-bucket"
  }

  expect_failures = [var.webapp_bucket_name]
}

run "zone_apex_is_rejected" {
  command = plan

  variables {
    website_domain      = "example.com"
    website_bucket_name = "example.com"
  }

  expect_failures = [var.dns_zone_domain]
}

run "cdn_route_without_resources_is_rejected" {
  command = plan

  variables { route_static_through_cdn = true }

  expect_failures = [var.route_static_through_cdn]
}

run "first_bucket_bootstrap_is_explicit" {
  command = plan

  variables { storage_bootstrap_access = true }

  assert {
    condition     = length(yandex_resourcemanager_folder_iam_member.storage_manager) == 1
    error_message = "The initial bucket create needs one explicitly enabled temporary folder grant."
  }

  assert {
    condition     = one(yandex_resourcemanager_folder_iam_member.storage_manager).role == "storage.admin"
    error_message = "The temporary grant must support provider-managed bucket versioning and configuration."
  }
}

run "unscoped_extra_env_reaches_every_component" {
  command = plan

  variables {
    extra_runtime_env = { FEATURE_FLAG = "on" }
    extra_secret_bindings = {
      EXTERNAL_API_KEY = {
        secret_id  = "external-lockbox-secret"
        version_id = "external-lockbox-version"
        key        = "api_key"
      }
    }
  }

  assert {
    condition = (
      toset(keys(output.runtime_inputs.component_environments)) == toset(concat(
        ["api"],
        [for schedule in jsondecode(file("../../../backend/src/job-schedules.json")) : schedule.key],
      )) &&
      toset(keys(output.runtime_inputs.component_secret_bindings)) == toset(keys(output.runtime_inputs.component_environments))
    )
    error_message = "The foundation must compose an environment for the API and every job container."
  }

  assert {
    condition = alltrue([
      for component, environment in output.runtime_inputs.component_environments :
      environment["FEATURE_FLAG"] == "on" &&
      environment["NODE_ENV"] == "production" &&
      contains(keys(output.runtime_inputs.component_secret_bindings[component]), "EXTERNAL_API_KEY") &&
      contains(keys(output.runtime_inputs.component_secret_bindings[component]), "DATABASE_URL")
    ])
    error_message = "Without extra_env_components, every extra variable must reach the API and every job as before."
  }

  assert {
    condition = alltrue([
      for component, environment in output.runtime_inputs.component_environments :
      environment == output.runtime_inputs.component_environments["api"] &&
      setunion(keys(output.runtime_inputs.component_secret_bindings[component]), ["JWT_SECRET"]) ==
      toset(keys(output.runtime_inputs.component_secret_bindings["api"]))
    ])
    error_message = "Unscoped variables must reach every container; the JWT secret is the only built-in difference."
  }
}

run "jwt_secret_reaches_only_the_api" {
  command = plan

  assert {
    condition = (
      contains(keys(output.runtime_inputs.component_secret_bindings["api"]), "JWT_SECRET") &&
      alltrue([
        for component, bindings in output.runtime_inputs.component_secret_bindings :
        !contains(keys(bindings), "JWT_SECRET") if component != "api"
      ])
    )
    error_message = "Only the API signs tokens: no job container may bind JWT_SECRET."
  }

  assert {
    condition     = !contains(keys(output.migration_inputs.migration_secret_bindings), "JWT_SECRET")
    error_message = "The migration container must stay without the JWT secret."
  }
}

run "mobile_env_defaults_to_the_components_that_read_it" {
  command = plan

  variables {
    extra_runtime_env = {
      BILLING_ENABLED          = "true"
      APPLE_IAP_BUNDLE_ID      = "com.example.app"
      GOOGLE_PLAY_PACKAGE_NAME = "com.example.app"
    }
    extra_secret_bindings = {
      APPLE_IAP_PRIVATE_KEY_BASE64 = {
        secret_id  = "store-lockbox-secret"
        version_id = "store-lockbox-version"
        key        = "apple_private_key"
      }
      GOOGLE_PLAY_SERVICE_ACCOUNT_JSON_BASE64 = {
        secret_id  = "store-lockbox-secret"
        version_id = "store-lockbox-version"
        key        = "google_service_account"
      }
      EXPO_PUSH_ACCESS_TOKEN = {
        secret_id  = "push-lockbox-secret"
        version_id = "push-lockbox-version"
        key        = "expo_access_token"
      }
    }
  }

  assert {
    condition = alltrue([
      for component, environment in output.runtime_inputs.component_environments :
      contains(keys(environment), "APPLE_IAP_BUNDLE_ID") == (component == "api") &&
      contains(keys(output.runtime_inputs.component_secret_bindings[component]), "APPLE_IAP_PRIVATE_KEY_BASE64") == (component == "api")
    ])
    error_message = "Only the API verifies App Store purchases: the Apple IAP group must reach no job container."
  }

  assert {
    condition = alltrue([
      for component, environment in output.runtime_inputs.component_environments :
      contains(keys(environment), "GOOGLE_PLAY_PACKAGE_NAME") == contains(["api", "maintenance", "outbox"], component) &&
      contains(keys(output.runtime_inputs.component_secret_bindings[component]), "GOOGLE_PLAY_SERVICE_ACCOUNT_JSON_BASE64") == contains(["api", "maintenance", "outbox"], component)
    ])
    error_message = "The Google Play group must reach the API, maintenance reconciler, and outbox acknowledgement worker."
  }

  assert {
    condition = alltrue([
      for component, bindings in output.runtime_inputs.component_secret_bindings :
      contains(keys(bindings), "EXPO_PUSH_ACCESS_TOKEN") == (component == "notifications")
    ])
    error_message = "Only the notifications job sends pushes: the Expo access token must reach no other container."
  }

  assert {
    condition = (
      output.runtime_inputs.component_environments["api"]["BILLING_ENABLED"] == "true" &&
      output.runtime_inputs.component_environments["maintenance"]["BILLING_ENABLED"] == "true" &&
      output.runtime_inputs.component_environments["outbox"]["BILLING_ENABLED"] == "true"
    )
    error_message = "Billing availability must reach API, maintenance, and outbox."
  }
}

run "extra_env_components_overrides_a_mobile_default" {
  command = plan

  variables {
    extra_secret_bindings = {
      EXPO_PUSH_ACCESS_TOKEN = {
        secret_id  = "push-lockbox-secret"
        version_id = "push-lockbox-version"
        key        = "expo_access_token"
      }
    }
    extra_env_components = { EXPO_PUSH_ACCESS_TOKEN = ["api", "notifications"] }
  }

  assert {
    condition = alltrue([
      for component, bindings in output.runtime_inputs.component_secret_bindings :
      contains(keys(bindings), "EXPO_PUSH_ACCESS_TOKEN") == contains(["api", "notifications"], component)
    ])
    error_message = "An extra_env_components entry must replace the default targets of a mobile variable."
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
    extra_runtime_env = { NODE_ENV = "development" }
  }

  expect_failures = [output.runtime_inputs]
}

run "extra_env_rejects_the_removed_sws_ingress_mode" {
  command = plan

  variables {
    extra_runtime_env = { INGRESS_RATE_LIMIT_PROVIDER = "yandex-sws" }
  }

  expect_failures = [var.extra_runtime_env]
}
