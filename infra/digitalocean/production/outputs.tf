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

  precondition {
    condition     = length(setintersection(local.job_keys, ["api", "jobs"])) == 0
    error_message = "A job key in backend/src/job-schedules.json must not be api or jobs: extra_env_components uses those names as targets."
  }

  precondition {
    condition = length(setintersection(
      concat(keys(var.extra_runtime_env), nonsensitive(keys(var.extra_runtime_secret_env))),
      local.builtin_runtime_env_names,
    )) == 0
    error_message = "extra_runtime_env and extra_runtime_secret_env must not repeat a variable that Terraform already sets for the runtime."
  }

  value = {
    project_slug                  = var.project_slug
    project_id                    = digitalocean_project.production.id
    vpc_id                        = digitalocean_vpc.production.id
    app_region                    = var.app_region
    api_domain                    = var.api_domain
    webapp_domain                 = var.webapp_domain
    dns_zone                      = var.dns_zone
    database_cluster_name         = digitalocean_database_cluster.postgres.name
    database_name                 = digitalocean_database_db.application.name
    database_user                 = digitalocean_database_user.application.name
    database_admin_user           = digitalocean_database_cluster.postgres.user
    backend_image_repository      = var.backend_image_repository
    component_environments        = local.component_environments
    component_secret_environments = local.component_secret_environments
    api_instance_size             = var.api_instance_size
    worker_instance_size          = var.worker_instance_size
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
