locals {
  job_keys = [
    for schedule in jsondecode(file("${path.module}/../../../backend/src/job-schedules.json")) :
    schedule.key
  ]
  runtime_env_targets = concat(["api", "jobs"], local.job_keys)

  builtin_runtime_env = {
    NODE_ENV                                   = "production"
    PORT                                       = "8080"
    CORS_ORIGINS                               = local.webapp_origin
    WEBAPP_ORIGIN                              = local.webapp_origin
    ACCESS_TOKEN_TTL_SECONDS                   = "900"
    REFRESH_TOKEN_TTL_DAYS                     = "30"
    REFRESH_REUSE_GRACE_SECONDS                = "10"
    SESSION_ABSOLUTE_TTL_DAYS                  = "90"
    SESSION_RETENTION_DAYS                     = "7"
    AUTH_BODY_LIMIT_BYTES                      = "65536"
    AUTH_RATE_LIMIT_MAX                        = "60"
    AUTH_RATE_LIMIT_WINDOW_SECONDS             = "60"
    ADMIN_USERS_READ_RATE_LIMIT_MAX            = "120"
    ADMIN_USERS_READ_RATE_LIMIT_WINDOW_SECONDS = "60"
    SHUTDOWN_GRACE_SECONDS                     = "20"
    TRUST_PROXY                                = "true"
    TRUSTED_PROXY_CLIENT_IP_HEADER             = "do-connecting-ip"
    COOKIE_SECURE                              = "true"
    PRIVATE_STORAGE_DRIVER                     = "s3"
    PRIVATE_STORAGE_ALLOW_REMOTE_ENDPOINT      = "true"
    PRIVATE_STORAGE_REGION                     = var.spaces_region
    PRIVATE_STORAGE_BUCKET                     = digitalocean_spaces_bucket.media.name
    PRIVATE_STORAGE_ENDPOINT                   = "https://${var.spaces_region}.digitaloceanspaces.com"
    EMAIL_DELIVERY                             = var.email_delivery
    EMAIL_FROM                                 = var.email_from == null ? "" : var.email_from
  }

  builtin_runtime_secret_env = {
    PRIVATE_STORAGE_ACCESS_KEY_ID     = digitalocean_spaces_key.media.access_key
    PRIVATE_STORAGE_SECRET_ACCESS_KEY = digitalocean_spaces_key.media.secret_key
  }

  # Only the API signs and verifies tokens; background runners load their env without the key.
  builtin_component_secret_env = {
    api       = merge(local.builtin_runtime_secret_env, { JWT_SECRET = var.jwt_secret })
    scheduler = local.builtin_runtime_secret_env
  }

  # The runtime root binds DATABASE_URL to each component itself.
  builtin_runtime_env_names = concat(
    keys(local.builtin_runtime_env),
    keys(local.builtin_component_secret_env["api"]),
    ["DATABASE_URL"],
  )

  # An extra variable reaches every component unless extra_env_components scopes it. App Platform
  # runs every job in the one scheduler worker, so any job target reaches that worker.
  extra_env_receivers = {
    for name, targets in var.extra_env_components : name => {
      api       = contains(targets, "api")
      scheduler = length(setintersection(targets, concat(["jobs"], local.job_keys))) > 0
    }
  }

  component_environments = {
    for component in ["api", "scheduler"] : component => merge(
      {
        for name, value in var.extra_runtime_env : name => value
        if try(local.extra_env_receivers[name][component], true)
      },
      local.builtin_runtime_env,
    )
  }

  component_secret_environments = {
    for component in ["api", "scheduler"] : component => merge(
      {
        for name, value in var.extra_runtime_secret_env : name => value
        if try(local.extra_env_receivers[name][component], true)
      },
      local.builtin_component_secret_env[component],
    )
  }
}
