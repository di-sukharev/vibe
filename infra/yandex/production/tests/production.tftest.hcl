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
      try(yandex_storage_bucket.media.lifecycle_rule[0].enabled, false) &&
      try(yandex_storage_bucket.media.lifecycle_rule[0].noncurrent_version_expiration[0].days, 0) == 30
    )
    error_message = "Versioning keeps every replaced or deleted media object as a noncurrent version; the bucket needs one enabled rule expiring them after 30 days, the recovery window docs/STORAGE.md promises, or the bucket grows without bound."
  }

  assert {
    condition     = try(yandex_storage_bucket.media.lifecycle_rule[0].abort_incomplete_multipart_upload_days, 0) == 7
    error_message = "An interrupted multipart upload must be aborted instead of holding storage forever."
  }

  assert {
    condition     = try(yandex_storage_bucket.media.lifecycle_rule[1].enabled, null) == null
    error_message = "The media bucket keeps exactly one lifecycle rule; a second one is where an expiration of current objects would hide."
  }

  assert {
    condition = (
      try(one(yandex_storage_bucket.media.lifecycle_rule[0].expiration).days, null) == null &&
      try(one(yandex_storage_bucket.media.lifecycle_rule[0].expiration).date, null) == null
    )
    error_message = "The lifecycle rule must leave current media objects alone: no expiration by age or date. Removing expired delete markers is the one expiration a versioned media bucket may add."
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
      contains(yandex_storage_bucket_iam_binding.webapp_admins.members, "serviceAccount:${yandex_iam_service_account.storage_manager.id}") &&
      contains(yandex_storage_bucket_iam_binding.website_admins.members, "serviceAccount:${yandex_iam_service_account.storage_manager.id}") &&
      contains(yandex_storage_bucket_iam_binding.media_admins.members, "serviceAccount:${yandex_iam_service_account.storage_manager.id}") &&
      strcontains(yandex_storage_bucket_policy.webapp_publisher.policy, "publisher-access-key") &&
      strcontains(yandex_storage_bucket_policy.website_publisher.policy, "publisher-access-key") &&
      strcontains(yandex_storage_bucket_policy.media_data_plane.policy, "media-access-key") &&
      !strcontains(yandex_storage_bucket_policy.webapp_publisher.policy, "s3:DeleteObjectVersion") &&
      !strcontains(yandex_storage_bucket_policy.media_data_plane.policy, "s3:DeleteObjectVersion")
    )
    error_message = "Publisher and media keys receive only exact data-plane actions and cannot delete object versions."
  }

  assert {
    condition = alltrue([
      for raw_policy in [
        yandex_storage_bucket_policy.webapp_publisher.policy,
        yandex_storage_bucket_policy.website_publisher.policy,
        ] : (
        one([
          for statement in jsondecode(raw_policy).Statement : statement
          if statement.Sid == "PublicObjectRead"
        ]).Action == ["s3:GetObject"] &&
        one([
          for statement in jsondecode(raw_policy).Statement : statement
          if statement.Sid == "PublicObjectRead"
        ]).Principal == "*" &&
        !contains(keys(one([
          for statement in jsondecode(raw_policy).Statement : statement
          if statement.Sid == "PublicObjectRead"
        ])), "Condition") &&
        length([
          for statement in jsondecode(raw_policy).Statement : statement
          if statement.Effect == "Allow" &&
          try(statement.Principal == "*", false) &&
          !can(statement.Condition.StringEquals["yc:access-key-id"]) &&
          length(setintersection(toset(flatten([statement.Action])), toset(["s3:ListBucket", "s3:ListBucketVersions", "s3:ListBucketMultipartUploads", "s3:*", "*"]))) > 0
        ]) == 0 &&
        contains(one([
          for statement in jsondecode(raw_policy).Statement : statement
          if statement.Sid == "PublisherBucketDataPlane"
        ]).Action, "s3:ListBucket") &&
        one([
          for statement in jsondecode(raw_policy).Statement : statement
          if statement.Sid == "PublisherBucketDataPlane"
        ]).Condition.StringEquals["yc:access-key-id"] == "publisher-access-key"
      )
    ])
    error_message = "Each public static policy must allow anonymous object reads only; bucket listing stays keyed to the publisher."
  }

  assert {
    condition = (
      alltrue([
        for raw_policy in [
          yandex_storage_bucket_policy.webapp_publisher.policy,
          yandex_storage_bucket_policy.website_publisher.policy,
          yandex_storage_bucket_policy.media_data_plane.policy,
          ] : (
          one([
            for statement in jsondecode(raw_policy).Statement : statement
            if statement.Sid == "TerraformBucketConfiguration"
          ]).Principal.CanonicalUser == yandex_iam_service_account.storage_manager.id &&
          one([
            for statement in jsondecode(raw_policy).Statement : statement
            if statement.Sid == "TerraformBucketConfiguration"
          ]).Action == "s3:*" &&
          !endswith(one([
            for statement in jsondecode(raw_policy).Statement : statement
            if statement.Sid == "TerraformBucketConfiguration"
          ]).Resource, "/*") &&
          toset(one([
            for statement in jsondecode(raw_policy).Statement : statement
            if statement.Sid == "ProtectBucketFromTerraformKey"
          ]).Action) == toset(["s3:DeleteBucket", "s3:PutBucketVersioning"]) &&
          !strcontains(raw_policy, "s3:DeleteObjectVersion")
        )
      ]) &&
      yandex_storage_bucket_policy.webapp_publisher.access_key == "storage-manager-access-key" &&
      yandex_storage_bucket_policy.website_publisher.access_key == "storage-manager-access-key" &&
      yandex_storage_bucket_policy.media_data_plane.access_key == "storage-manager-access-key"
    )
    error_message = "Every bucket policy must let only the bucket-scoped IaC identity refresh configuration while denying bucket deletion, versioning changes, and object-version deletion."
  }

  assert {
    condition = (
      length(yandex_lockbox_secret_version_hashed.runtime) == 2 &&
      yandex_lockbox_secret_version_hashed.runtime["blue"].description != yandex_lockbox_secret_version_hashed.runtime["green"].description
    )
    error_message = "Blue and green runtime payloads must remain separate persistent Lockbox versions."
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

run "extra_secret_is_granted_exactly" {
  command = plan

  variables {
    extra_secret_bindings = {
      EXTERNAL_API_KEY = {
        secret_id  = "external-lockbox-secret"
        version_id = "external-lockbox-version"
        key        = "api_key"
      }
    }
  }

  assert {
    condition     = length(yandex_lockbox_secret_iam_member.runtime_extra) == 1
    error_message = "Every externally bound Lockbox secret needs an exact runtime grant."
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

run "scoped_extra_env_reaches_only_its_targets" {
  command = plan

  variables {
    extra_runtime_env = {
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
      contains(keys(output.runtime_inputs.component_secret_bindings["api"]), "APPLE_IAP_PRIVATE_KEY_BASE64") &&
      alltrue([
        for component in ["outbox", "uploads"] :
        !contains(keys(output.runtime_inputs.component_environments[component]), "APPLE_IAP_BUNDLE_ID") &&
        !contains(keys(output.runtime_inputs.component_secret_bindings[component]), "APPLE_IAP_PRIVATE_KEY_BASE64")
      ])
    )
    error_message = "A variable scoped to the API must not reach any job container."
  }

  assert {
    condition = (
      contains(keys(output.runtime_inputs.component_environments["outbox"]), "GOOGLE_PLAY_PACKAGE_NAME") &&
      contains(keys(output.runtime_inputs.component_secret_bindings["outbox"]), "GOOGLE_PLAY_SERVICE_ACCOUNT_JSON_BASE64") &&
      !contains(keys(output.runtime_inputs.component_environments["uploads"]), "GOOGLE_PLAY_PACKAGE_NAME") &&
      !contains(keys(output.runtime_inputs.component_secret_bindings["uploads"]), "GOOGLE_PLAY_SERVICE_ACCOUNT_JSON_BASE64")
    )
    error_message = "A variable scoped to one job must reach that job container and no other."
  }

  assert {
    condition     = length(yandex_lockbox_secret_iam_member.runtime_extra) == 1
    error_message = "Scoping changes which containers bind a secret, not the exact runtime grant for it."
  }
}

run "jobs_target_reaches_every_job" {
  command = plan

  variables {
    extra_runtime_env    = { FEATURE_FLAG = "on" }
    extra_env_components = { FEATURE_FLAG = ["jobs"] }
  }

  assert {
    condition = (
      !contains(keys(output.runtime_inputs.component_environments["api"]), "FEATURE_FLAG") &&
      alltrue([
        for component in ["outbox", "uploads"] :
        output.runtime_inputs.component_environments[component]["FEATURE_FLAG"] == "on"
      ])
    )
    error_message = "The jobs target must reach every job container and not the API."
  }
}

run "mobile_env_defaults_to_the_components_that_read_it" {
  command = plan

  variables {
    extra_runtime_env = {
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
      contains(keys(environment), "GOOGLE_PLAY_PACKAGE_NAME") == contains(["api", "maintenance"], component) &&
      contains(keys(output.runtime_inputs.component_secret_bindings[component]), "GOOGLE_PLAY_SERVICE_ACCOUNT_JSON_BASE64") == contains(["api", "maintenance"], component)
    ])
    error_message = "The Google Play group must reach only the API and the maintenance job that reconciles purchases."
  }

  assert {
    condition = alltrue([
      for component, bindings in output.runtime_inputs.component_secret_bindings :
      contains(keys(bindings), "EXPO_PUSH_ACCESS_TOKEN") == (component == "notifications")
    ])
    error_message = "Only the notifications job sends pushes: the Expo access token must reach no other container."
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
