locals {
  name_prefix = "${var.project_slug}-prod"
  admin_secret_bindings = var.admin_seed_email == null ? {} : {
    ADMIN_SEED_EMAIL = {
      secret_id  = yandex_lockbox_secret.admin_seed[0].id
      version_id = yandex_lockbox_secret_version_hashed.admin_seed[0].id
      key        = "ADMIN_SEED_EMAIL"
    }
    ADMIN_SEED_PASSWORD = {
      secret_id  = yandex_lockbox_secret.admin_seed[0].id
      version_id = yandex_lockbox_secret_version_hashed.admin_seed[0].id
      key        = "ADMIN_SEED_PASSWORD"
    }
  }
  migration_secret_bindings = merge(
    var.migration_secret_bindings,
    local.admin_secret_bindings,
  )
}

resource "yandex_lockbox_secret" "admin_seed" {
  count = var.admin_seed_email == null ? 0 : 1

  folder_id   = var.folder_id
  name        = "${local.name_prefix}-migration-admin-seed"
  description = "One-time release secret removed immediately after a successful migration."
}

resource "yandex_lockbox_secret_version_hashed" "admin_seed" {
  count = var.admin_seed_email == null ? 0 : 1

  secret_id    = yandex_lockbox_secret.admin_seed[0].id
  description  = "One-time administrator seed for the current migration."
  key_1        = "ADMIN_SEED_EMAIL"
  text_value_1 = var.admin_seed_email
  key_2        = "ADMIN_SEED_PASSWORD"
  text_value_2 = var.admin_seed_password
}

resource "yandex_lockbox_secret_iam_member" "admin_seed" {
  count = var.admin_seed_email == null ? 0 : 1

  secret_id = yandex_lockbox_secret.admin_seed[0].id
  role      = "lockbox.payloadViewer"
  member    = "serviceAccount:${var.migration_service_account}"
}

resource "yandex_serverless_container" "migration" {
  folder_id          = var.folder_id
  name               = "${local.name_prefix}-migration"
  memory             = var.api_memory_mb
  cores              = 1
  core_fraction      = 100
  execution_timeout  = "900s"
  service_account_id = var.migration_service_account

  runtime { type = "task" }
  connectivity { network_id = var.network_id }

  image {
    url         = "cr.yandex/${var.registry_id}/${var.backend_image_name}@${var.migration_image_digest}"
    command     = ["bun"]
    args        = ["scripts/deploy-database.ts"]
    environment = var.migration_environment
  }

  dynamic "secrets" {
    for_each = local.migration_secret_bindings
    content {
      environment_variable = secrets.key
      id                   = secrets.value.secret_id
      version_id           = secrets.value.version_id
      key                  = secrets.value.key
    }
  }

  log_options {
    log_group_id = var.logging_group_id
    min_level    = "INFO"
  }

  metadata_options {
    gce_http_endpoint    = 2
    aws_v1_http_endpoint = 2
  }

  depends_on = [yandex_lockbox_secret_iam_member.admin_seed]
}
