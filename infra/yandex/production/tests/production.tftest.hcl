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
    condition = (
      one(yandex_storage_bucket.webapp.anonymous_access_flags).read &&
      one(yandex_storage_bucket.webapp.anonymous_access_flags).list &&
      !one(yandex_storage_bucket.webapp.anonymous_access_flags).config_read &&
      one(yandex_storage_bucket.website.anonymous_access_flags).read &&
      one(yandex_storage_bucket.website.anonymous_access_flags).list &&
      !one(yandex_storage_bucket.website.anonymous_access_flags).config_read
    )
    error_message = "Static hosting needs public object/list access, never public bucket-configuration access."
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
          if statement.Sid == "PublicBucketList"
        ]).Action == ["s3:ListBucket"] &&
        one([
          for statement in jsondecode(raw_policy).Statement : statement
          if statement.Sid == "PublicBucketList"
        ]).Principal == "*" &&
        !contains(keys(one([
          for statement in jsondecode(raw_policy).Statement : statement
          if statement.Sid == "PublicBucketList"
        ])), "Condition") &&
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
        ])), "Condition")
      )
    ])
    error_message = "Each public static policy must allow anonymous list/read for direct hosting and the documented HTTP CDN origin."
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
          one([
            for statement in jsondecode(raw_policy).Statement : statement
            if statement.Sid == "ProtectBucketFromTerraformKey"
          ]).Action == ["s3:DeleteBucket"] &&
          !strcontains(raw_policy, "s3:DeleteObjectVersion")
        )
      ]) &&
      yandex_storage_bucket_policy.webapp_publisher.access_key == "storage-manager-access-key" &&
      yandex_storage_bucket_policy.website_publisher.access_key == "storage-manager-access-key" &&
      yandex_storage_bucket_policy.media_data_plane.access_key == "storage-manager-access-key"
    )
    error_message = "Every bucket policy must let only the bucket-scoped IaC identity refresh configuration while denying bucket/version deletion."
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

  expect_failures = [check.direct_static_domains_match_bucket_names]
}

run "zone_apex_is_rejected" {
  command = plan

  variables {
    website_domain      = "example.com"
    website_bucket_name = "example.com"
  }

  expect_failures = [check.domains_are_cname_safe_subdomains]
}

run "cdn_route_without_resources_is_rejected" {
  command = plan

  variables { route_static_through_cdn = true }

  expect_failures = [check.cdn_route_requires_resources]
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
