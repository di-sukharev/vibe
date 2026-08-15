output "registry_id" {
  value = yandex_container_registry.production.id
}

output "image_repository" {
  value = "cr.yandex/${yandex_container_registry.production.id}/${var.backend_image_name}"
}

output "release_source" {
  description = "Effective source identity consumed by the guarded release wrapper."
  value = {
    git_branch = var.git_branch
  }
}

output "media_bucket" {
  value = yandex_storage_bucket.media.bucket
}

output "webapp_bucket" {
  value = yandex_storage_bucket.webapp.bucket
}

output "website_bucket" {
  value = yandex_storage_bucket.website.bucket
}

output "static_publisher_access_key_id" {
  value     = yandex_iam_service_account_static_access_key.static_publisher.access_key
  sensitive = true
}

output "static_publisher_secret_access_key" {
  value     = yandex_iam_service_account_static_access_key.static_publisher.secret_key
  sensitive = true
}

output "storage_manager_ready" {
  value = alltrue([
    contains(yandex_storage_bucket_iam_binding.webapp_admins.members, "serviceAccount:${yandex_iam_service_account.storage_manager.id}"),
    contains(yandex_storage_bucket_iam_binding.website_admins.members, "serviceAccount:${yandex_iam_service_account.storage_manager.id}"),
    contains(yandex_storage_bucket_iam_binding.media_admins.members, "serviceAccount:${yandex_iam_service_account.storage_manager.id}"),
  ])
}

output "database_credential_metadata" {
  description = "Sensitive hashes and versions used by the wrapper to protect the live credential slot."
  sensitive   = true
  value = {
    fingerprints = {
      blue  = sha256(var.database_blue_password)
      green = sha256(var.database_green_password)
      jwt   = sha256(var.jwt_secret)
    }
    versions = {
      blue  = var.database_blue_password_version
      green = var.database_green_password_version
    }
  }
}

output "migration_inputs" {
  description = "Sensitive cross-state inputs written only to the ignored migration root by scripts/infra.mjs."
  sensitive   = true
  value = {
    cloud_id                  = var.cloud_id
    folder_id                 = var.folder_id
    primary_zone              = var.primary_zone
    project_slug              = var.project_slug
    network_id                = yandex_vpc_network.production.id
    registry_id               = yandex_container_registry.production.id
    backend_image_name        = var.backend_image_name
    migration_service_account = yandex_iam_service_account.migration.id
    logging_group_id          = yandex_logging_group.production.id
    migration_environment     = { NODE_ENV = "production" }
    migration_secret_bindings = local.migration_secret_bindings
    api_memory_mb             = var.api_memory_mb
  }
}

output "runtime_inputs" {
  description = "Cross-state inputs written only to the ignored runtime root by scripts/infra.mjs."
  sensitive   = true
  value = {
    cloud_id                 = var.cloud_id
    folder_id                = var.folder_id
    primary_zone             = var.primary_zone
    project_slug             = var.project_slug
    network_id               = yandex_vpc_network.production.id
    registry_id              = yandex_container_registry.production.id
    backend_image_name       = var.backend_image_name
    runtime_service_account  = yandex_iam_service_account.runtime.id
    gateway_service_account  = yandex_iam_service_account.gateway.id
    trigger_service_account  = yandex_iam_service_account.trigger.id
    logging_group_id         = yandex_logging_group.production.id
    runtime_environment      = local.runtime_environment
    runtime_secret_bindings  = local.runtime_secret_bindings
    database_credential_slot = var.database_active_slot
    api_memory_mb            = var.api_memory_mb
    task_memory_mb           = var.task_memory_mb
    api_domain               = var.api_domain
    api_certificate_id       = var.api_certificate_id
    webapp_domain            = var.webapp_domain
    webapp_certificate_id    = var.webapp_certificate_id
    website_domain           = var.website_domain
    website_certificate_id   = var.website_certificate_id
    dns_zone_id              = var.dns_zone_id
    dns_zone_domain          = var.dns_zone_domain
    enable_cdn               = var.enable_cdn
    route_static_through_cdn = var.route_static_through_cdn
    webapp_website_endpoint  = yandex_storage_bucket.webapp.website_endpoint
    webapp_website_domain    = yandex_storage_bucket.webapp.website_domain
    website_website_endpoint = yandex_storage_bucket.website.website_endpoint
    website_website_domain   = yandex_storage_bucket.website.website_domain
  }
}
