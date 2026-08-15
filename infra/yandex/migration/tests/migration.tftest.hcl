mock_provider "yandex" {}

variables {
  cloud_id                  = "cloud-test"
  folder_id                 = "folder-test"
  primary_zone              = "ru-central1-a"
  project_slug              = "example-product"
  network_id                = "network-id"
  registry_id               = "registry-id"
  backend_image_name        = "backend"
  migration_service_account = "migration-sa"
  logging_group_id          = "logging-id"
  migration_environment     = {}
  migration_secret_bindings = {}
  api_memory_mb             = 1024
  migration_image_digest    = "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
}

run "isolated_migration_revision" {
  command = plan

  assert {
    condition     = yandex_serverless_container.migration.runtime[0].type == "task"
    error_message = "Migration must run as a one-shot task in its own Terraform state."
  }

  assert {
    condition     = strcontains(yandex_serverless_container.migration.image[0].url, var.migration_image_digest)
    error_message = "Migration must use the exact release digest."
  }


  assert {
    condition     = yandex_serverless_container.migration.service_account_id == var.migration_service_account
    error_message = "The one-shot migration must never run as the API runtime identity."
  }
}

run "one_time_seed_is_scoped" {
  command = plan

  variables {
    admin_seed_email    = "owner@example.com"
    admin_seed_password = "one-time-password"
  }

  assert {
    condition     = length(yandex_lockbox_secret.admin_seed) == 1 && length(yandex_lockbox_secret_iam_member.admin_seed) == 1
    error_message = "Administrator bootstrap must use one migration-only Lockbox secret and exact migration grant."
  }


  assert {
    condition     = one(yandex_lockbox_secret_iam_member.admin_seed).member == "serviceAccount:${var.migration_service_account}"
    error_message = "The one-time administrator seed must be visible only to the migration identity."
  }
}
