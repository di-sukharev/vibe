locals {
  name_prefix = "${var.project_slug}-prod"
  api_origin  = "https://${var.api_domain}"
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
        for_each = var.component_environments["api"]
        content {
          key   = env.key
          value = env.value
          scope = "RUN_TIME"
          type  = "GENERAL"
        }
      }

      dynamic "env" {
        for_each = var.component_secret_environments["api"]
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

      # A stopped scheduler is silent, so the worker carries the component alerts App Platform
      # offers. More than one restart in five minutes is a crash loop, not a deploy. Memory above
      # 85% is the warning before the platform kills the worker for running out of it. A healthy
      # scheduler idles between ticks, so CPU pinned for thirty minutes is a stuck job; a pass is
      # bounded whatever the backlog, so a backlog never shows up here. None of these reads the
      # outbox numbers; docs/BACKGROUND_JOBS.md
      # says which of those still need a person looking at the log. Destinations are deliberately
      # absent: with none, App Platform emails the team's default address. Provider 2.99.1 never
      # reads destinations back into state, so a list here would plan a change on every run and
      # removing it would not restore the default; route alerts in the console instead.
      alert {
        rule     = "RESTART_COUNT"
        operator = "GREATER_THAN"
        value    = 1
        window   = "FIVE_MINUTES"
      }

      alert {
        rule     = "MEM_UTILIZATION"
        operator = "GREATER_THAN"
        value    = 85
        window   = "TEN_MINUTES"
      }

      alert {
        rule     = "CPU_UTILIZATION"
        operator = "GREATER_THAN"
        value    = 90
        window   = "THIRTY_MINUTES"
      }

      env {
        key   = "DATABASE_URL"
        value = "$${runtime-database.DATABASE_PRIVATE_URL}"
        scope = "RUN_TIME"
        type  = "SECRET"
      }

      dynamic "env" {
        for_each = var.component_environments["scheduler"]
        content {
          key   = env.key
          value = env.value
          scope = "RUN_TIME"
          type  = "GENERAL"
        }
      }

      dynamic "env" {
        for_each = var.component_secret_environments["scheduler"]
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
