locals {
  name_prefix   = "${var.project_slug}-prod"
  api_origin    = "https://${var.api_domain}"
  webapp_origin = "https://${var.webapp_domain}"

  runtime_general_env = merge(var.extra_runtime_env, {
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
    PRIVATE_STORAGE_BUCKET                     = var.media_bucket_name
    PRIVATE_STORAGE_ENDPOINT                   = "https://${var.spaces_region}.digitaloceanspaces.com"
    EMAIL_DELIVERY                             = var.email_delivery
    EMAIL_FROM                                 = var.email_from == null ? "" : var.email_from
  })

  runtime_secret_env = merge(var.extra_runtime_secret_env, {
    JWT_SECRET                        = var.jwt_secret
    PRIVATE_STORAGE_ACCESS_KEY_ID     = var.media_access_key_id
    PRIVATE_STORAGE_SECRET_ACCESS_KEY = var.media_secret_access_key
  })
}

resource "digitalocean_app" "api" {
  project_id = var.project_id

  spec {
    name   = "${local.name_prefix}-api"
    region = var.app_region

    alert { rule = "DEPLOYMENT_FAILED" }
    alert { rule = "DOMAIN_FAILED" }

    domain {
      name = var.api_domain
      type = "PRIMARY"
      zone = var.dns_zone
    }

    vpc { id = var.vpc_id }

    database {
      name         = "runtime-database"
      engine       = "PG"
      version      = "18"
      production   = true
      cluster_name = var.database_cluster_name
      db_name      = var.database_name
      db_user      = var.database_user
    }

    # App Platform resolves each bindable URL using the selected managed-database user. The
    # administrative connection is visible only to PRE_DEPLOY; services use the least-privilege
    # runtime login whose grants are reconciled by backend/scripts/deploy-database.ts.
    database {
      name         = "migration-database"
      engine       = "PG"
      version      = "18"
      production   = true
      cluster_name = var.database_cluster_name
      db_name      = var.database_name
      db_user      = var.database_admin_user
    }

    service {
      name               = "api"
      http_port          = 8080
      instance_size_slug = var.api_instance_size
      instance_count     = 1

      image {
        registry_type = "DOCR"
        repository    = var.backend_image_repository
        digest        = var.runtime_image_digest
      }

      health_check {
        http_path             = "/health/ready"
        initial_delay_seconds = 10
        period_seconds        = 10
        timeout_seconds       = 5
        success_threshold     = 1
        failure_threshold     = 5
      }

      liveness_health_check {
        http_path             = "/health/live"
        initial_delay_seconds = 30
        period_seconds        = 10
        timeout_seconds       = 5
        success_threshold     = 1
        failure_threshold     = 5
      }

      env {
        key   = "DATABASE_URL"
        value = "$${runtime-database.DATABASE_PRIVATE_URL}"
        scope = "RUN_TIME"
        type  = "SECRET"
      }

      dynamic "env" {
        for_each = local.runtime_general_env
        content {
          key   = env.key
          value = env.value
          scope = "RUN_TIME"
          type  = "GENERAL"
        }
      }

      dynamic "env" {
        for_each = local.runtime_secret_env
        content {
          key   = env.key
          value = env.value
          scope = "RUN_TIME"
          type  = "SECRET"
        }
      }
    }

    worker {
      name               = "scheduler"
      instance_size_slug = var.worker_instance_size
      instance_count     = 1
      run_command        = "bun run start:scheduler"

      image {
        registry_type = "DOCR"
        repository    = var.backend_image_repository
        digest        = var.runtime_image_digest
      }

      env {
        key   = "DATABASE_URL"
        value = "$${runtime-database.DATABASE_PRIVATE_URL}"
        scope = "RUN_TIME"
        type  = "SECRET"
      }

      dynamic "env" {
        for_each = local.runtime_general_env
        content {
          key   = env.key
          value = env.value
          scope = "RUN_TIME"
          type  = "GENERAL"
        }
      }

      dynamic "env" {
        for_each = local.runtime_secret_env
        content {
          key   = env.key
          value = env.value
          scope = "RUN_TIME"
          type  = "SECRET"
        }
      }
    }

    job {
      name               = "migrate"
      kind               = "PRE_DEPLOY"
      instance_size_slug = var.worker_instance_size
      instance_count     = 1
      run_command        = "bun run db:deploy"

      image {
        registry_type = "DOCR"
        repository    = var.backend_image_repository
        digest        = var.runtime_image_digest
      }

      env {
        key   = "DATABASE_URL"
        value = "$${migration-database.DATABASE_PRIVATE_URL}"
        scope = "RUN_TIME"
        type  = "SECRET"
      }

      env {
        key   = "DATABASE_RUNTIME_USER"
        value = "$${runtime-database.USERNAME}"
        scope = "RUN_TIME"
        type  = "GENERAL"
      }

      dynamic "env" {
        for_each = var.admin_seed_email == null ? {} : {
          ADMIN_SEED_EMAIL    = var.admin_seed_email
          ADMIN_SEED_PASSWORD = var.admin_seed_password
        }
        content {
          key   = env.key
          value = env.value
          scope = "RUN_TIME"
          type  = "SECRET"
        }
      }
    }
  }
}
