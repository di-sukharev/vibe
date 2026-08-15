locals {
  name_prefix    = "${var.project_slug}-prod"
  api_origin     = "https://${var.api_domain}"
  webapp_origin  = "https://${var.webapp_domain}"
  website_origin = "https://${var.website_domain}"
}

resource "digitalocean_app" "webapp" {
  project_id = var.project_id

  spec {
    name   = "${local.name_prefix}-webapp"
    region = var.app_region

    alert { rule = "DEPLOYMENT_FAILED" }
    alert { rule = "DOMAIN_FAILED" }

    domain {
      name = var.webapp_domain
      type = "PRIMARY"
      zone = var.dns_zone
    }

    static_site {
      name              = "webapp"
      source_dir        = "/"
      environment_slug  = "node-js"
      build_command     = "bun install --frozen-lockfile && bun run build:webapp"
      output_dir        = "webapp/dist"
      index_document    = "index.html"
      catchall_document = "index.html"

      github {
        repo           = var.github_repo
        branch         = var.source_branch
        deploy_on_push = false
      }

      env {
        key   = "VITE_API_URL"
        value = local.api_origin
        scope = "BUILD_TIME"
        type  = "GENERAL"
      }

      env {
        key   = "RELEASE_REVISION"
        value = var.release_revision
        scope = "BUILD_TIME"
        type  = "GENERAL"
      }
    }
  }
}

resource "digitalocean_app" "website" {
  project_id = var.project_id

  spec {
    name   = "${local.name_prefix}-website"
    region = var.app_region

    alert { rule = "DEPLOYMENT_FAILED" }
    alert { rule = "DOMAIN_FAILED" }

    domain {
      name = var.website_domain
      type = "PRIMARY"
      zone = var.dns_zone
    }

    static_site {
      name             = "website"
      source_dir       = "/"
      environment_slug = "node-js"
      build_command    = "bun install --frozen-lockfile && bun run build:website"
      output_dir       = "website/dist"
      index_document   = "index.html"

      github {
        repo           = var.github_repo
        branch         = var.source_branch
        deploy_on_push = false
      }

      env {
        key   = "PUBLIC_WEBSITE_URL"
        value = local.website_origin
        scope = "BUILD_TIME"
        type  = "GENERAL"
      }

      env {
        key   = "PUBLIC_WEBAPP_URL"
        value = local.webapp_origin
        scope = "BUILD_TIME"
        type  = "GENERAL"
      }

      env {
        key   = "RELEASE_REVISION"
        value = var.release_revision
        scope = "BUILD_TIME"
        type  = "GENERAL"
      }
    }
  }
}
