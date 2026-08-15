output "media_bucket" {
  value = digitalocean_spaces_bucket.media.name
}

output "media_endpoint" {
  value = "https://${var.spaces_region}.digitaloceanspaces.com"
}

output "registry" {
  value = digitalocean_container_registry.production.endpoint
}

output "image_repository" {
  value = "${digitalocean_container_registry.production.endpoint}/${var.backend_image_repository}"
}

output "release_source" {
  description = "Effective source identity consumed by the guarded release wrapper."
  value = {
    git_branch  = var.git_branch
    github_repo = var.github_repo
  }
}

output "runtime_inputs" {
  description = "Sensitive cross-state inputs written only to the ignored runtime root by scripts/infra.mjs."
  sensitive   = true
  value = {
    project_slug             = var.project_slug
    project_id               = digitalocean_project.production.id
    vpc_id                   = digitalocean_vpc.production.id
    app_region               = var.app_region
    api_domain               = var.api_domain
    webapp_domain            = var.webapp_domain
    dns_zone                 = var.dns_zone
    database_cluster_name    = digitalocean_database_cluster.postgres.name
    database_name            = digitalocean_database_db.application.name
    database_user            = digitalocean_database_user.application.name
    database_admin_user      = digitalocean_database_cluster.postgres.user
    backend_image_repository = var.backend_image_repository
    spaces_region            = var.spaces_region
    media_bucket_name        = digitalocean_spaces_bucket.media.name
    media_access_key_id      = digitalocean_spaces_key.media.access_key
    media_secret_access_key  = digitalocean_spaces_key.media.secret_key
    jwt_secret               = var.jwt_secret
    email_delivery           = var.email_delivery
    email_from               = var.email_from
    extra_runtime_env        = var.extra_runtime_env
    extra_runtime_secret_env = var.extra_runtime_secret_env
    api_instance_size        = var.api_instance_size
    worker_instance_size     = var.worker_instance_size
  }
}

output "static_inputs" {
  value = {
    project_slug   = var.project_slug
    project_id     = digitalocean_project.production.id
    app_region     = var.app_region
    api_domain     = var.api_domain
    webapp_domain  = var.webapp_domain
    website_domain = var.website_domain
    dns_zone       = var.dns_zone
    github_repo    = var.github_repo
  }
}
