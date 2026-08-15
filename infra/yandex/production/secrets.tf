locals {
  database_urls = {
    for slot, credential in local.database_credentials : slot => format(
      "postgresql://%s:%s@%s:6432/%s?schema=public&sslmode=require",
      urlencode(yandex_mdb_postgresql_user.application[slot].name),
      urlencode(credential.password),
      yandex_mdb_postgresql_cluster.production.host[0].fqdn,
      urlencode(yandex_mdb_postgresql_database.application.name),
    )
  }
  migration_database_url = format(
    "postgresql://%s:%s@%s:6432/%s?schema=public&sslmode=require",
    urlencode(yandex_mdb_postgresql_user.owner.name),
    urlencode(var.database_owner_password),
    yandex_mdb_postgresql_cluster.production.host[0].fqdn,
    urlencode(yandex_mdb_postgresql_database.application.name),
  )
}

resource "yandex_lockbox_secret" "runtime" {
  folder_id           = var.folder_id
  name                = "${local.name_prefix}-runtime"
  deletion_protection = true
}

resource "yandex_lockbox_secret_version_hashed" "runtime" {
  for_each = local.database_credentials

  secret_id   = yandex_lockbox_secret.runtime.id
  description = "Persistent runtime secrets for database credential slot ${each.key}."

  key_1        = "DATABASE_URL"
  text_value_1 = local.database_urls[each.key]
  key_2        = "JWT_SECRET"
  text_value_2 = var.jwt_secret
}

resource "yandex_lockbox_secret_iam_member" "runtime" {
  secret_id = yandex_lockbox_secret.runtime.id
  role      = "lockbox.payloadViewer"
  member    = "serviceAccount:${yandex_iam_service_account.runtime.id}"
}

resource "yandex_lockbox_secret" "migration_database" {
  folder_id           = var.folder_id
  name                = "${local.name_prefix}-migration-database"
  deletion_protection = true
}

resource "yandex_lockbox_secret_version_hashed" "migration_database" {
  secret_id   = yandex_lockbox_secret.migration_database.id
  description = "Migration-only PostgreSQL owner connection."

  key_1        = "DATABASE_URL"
  text_value_1 = local.migration_database_url
}

resource "yandex_lockbox_secret_iam_member" "runtime_migration_database" {
  secret_id = yandex_lockbox_secret.migration_database.id
  role      = "lockbox.payloadViewer"
  # The resource name is retained for state compatibility; the runtime identity no longer has
  # access to this DDL-owner credential.
  member = "serviceAccount:${yandex_iam_service_account.migration.id}"
}

locals {
  extra_runtime_secret_ids = toset([
    for binding in values(var.extra_secret_bindings) : binding.secret_id
  ])
}

# Extra bindings may point at existing project secrets. Grant only those exact secrets rather than
# making the runtime a payload viewer for every current and future Lockbox secret in the folder.
resource "yandex_lockbox_secret_iam_member" "runtime_extra" {
  for_each = local.extra_runtime_secret_ids

  secret_id = each.value
  role      = "lockbox.payloadViewer"
  member    = "serviceAccount:${yandex_iam_service_account.runtime.id}"
}

resource "yandex_iam_service_account" "postbox" {
  count = var.email_delivery == "postbox" ? 1 : 0

  folder_id   = var.folder_id
  name        = "${local.name_prefix}-postbox"
  description = "Transactional email sender."
}

resource "yandex_resourcemanager_folder_iam_member" "postbox" {
  count = var.email_delivery == "postbox" ? 1 : 0

  folder_id = var.folder_id
  role      = "postbox.sender"
  member    = "serviceAccount:${yandex_iam_service_account.postbox[0].id}"
}

resource "yandex_lockbox_secret" "postbox" {
  count = var.email_delivery == "postbox" ? 1 : 0

  folder_id           = var.folder_id
  name                = "${local.name_prefix}-postbox-credentials"
  deletion_protection = true
}

resource "yandex_iam_service_account_static_access_key" "postbox" {
  count = var.email_delivery == "postbox" ? 1 : 0

  service_account_id = yandex_iam_service_account.postbox[0].id
  description        = "Postbox SES-compatible HTTP API credentials."

  output_to_lockbox {
    secret_id            = yandex_lockbox_secret.postbox[0].id
    entry_for_access_key = "access_key_id"
    entry_for_secret_key = "secret_access_key"
  }

  depends_on = [yandex_resourcemanager_folder_iam_member.postbox]
}

resource "yandex_lockbox_secret_iam_member" "runtime_postbox" {
  count = var.email_delivery == "postbox" ? 1 : 0

  secret_id = yandex_lockbox_secret.postbox[0].id
  role      = "lockbox.payloadViewer"
  member    = "serviceAccount:${yandex_iam_service_account.runtime.id}"
}

locals {
  base_secret_bindings = {
    DATABASE_URL = {
      secret_id  = yandex_lockbox_secret.runtime.id
      version_id = yandex_lockbox_secret_version_hashed.runtime[var.database_active_slot].id
      key        = "DATABASE_URL"
    }
    JWT_SECRET = {
      secret_id  = yandex_lockbox_secret.runtime.id
      version_id = yandex_lockbox_secret_version_hashed.runtime[var.database_active_slot].id
      key        = "JWT_SECRET"
    }
    PRIVATE_STORAGE_ACCESS_KEY_ID = {
      secret_id  = yandex_lockbox_secret.media.id
      version_id = yandex_iam_service_account_static_access_key.media.output_to_lockbox_version_id
      key        = "access_key_id"
    }
    PRIVATE_STORAGE_SECRET_ACCESS_KEY = {
      secret_id  = yandex_lockbox_secret.media.id
      version_id = yandex_iam_service_account_static_access_key.media.output_to_lockbox_version_id
      key        = "secret_access_key"
    }
  }

  postbox_secret_bindings = var.email_delivery == "postbox" ? {
    EMAIL_POSTBOX_ACCESS_KEY_ID = {
      secret_id  = yandex_lockbox_secret.postbox[0].id
      version_id = yandex_iam_service_account_static_access_key.postbox[0].output_to_lockbox_version_id
      key        = "access_key_id"
    }
    EMAIL_POSTBOX_SECRET_ACCESS_KEY = {
      secret_id  = yandex_lockbox_secret.postbox[0].id
      version_id = yandex_iam_service_account_static_access_key.postbox[0].output_to_lockbox_version_id
      key        = "secret_access_key"
    }
  } : {}

  runtime_secret_bindings = merge(
    var.extra_secret_bindings,
    local.base_secret_bindings,
    local.postbox_secret_bindings,
  )

  migration_secret_bindings = {
    DATABASE_URL = {
      secret_id  = yandex_lockbox_secret.migration_database.id
      version_id = yandex_lockbox_secret_version_hashed.migration_database.id
      key        = "DATABASE_URL"
    }
  }

}
