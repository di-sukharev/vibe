mock_provider "digitalocean" {}

variables {
  project_slug             = "example-product"
  project_id               = "project-id"
  vpc_id                   = "vpc-id"
  app_region               = "fra"
  api_domain               = "api.example.com"
  webapp_domain            = "app.example.com"
  dns_zone                 = null
  database_cluster_name    = "example-product-postgres"
  database_name            = "example_product"
  database_user            = "example_product_app"
  database_admin_user      = "doadmin"
  backend_image_repository = "backend"
  component_environments = {
    api       = { NODE_ENV = "production" }
    scheduler = { NODE_ENV = "production" }
  }
  component_secret_environments = {
    api       = { JWT_SECRET = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" }
    scheduler = { PRIVATE_STORAGE_SECRET_ACCESS_KEY = "media-secret" }
  }
  api_instance_size    = "apps-s-1vcpu-1gb"
  worker_instance_size = "apps-s-1vcpu-1gb"
  runtime_image_digest = "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
}

run "migration_gates_runtime" {
  command = plan

  assert {
    condition     = digitalocean_app.api.spec[0].job[0].kind == "PRE_DEPLOY"
    error_message = "The API deployment must be gated by its PRE_DEPLOY migration."
  }

  assert {
    condition     = digitalocean_app.api.spec[0].service[0].image[0].digest == var.runtime_image_digest
    error_message = "The API must use the exact promoted image digest."
  }

  assert {
    condition = (
      try(digitalocean_app.api.spec[0].service[0].image[0].registry, null) == null &&
      try(digitalocean_app.api.spec[0].worker[0].image[0].registry, null) == null &&
      try(digitalocean_app.api.spec[0].job[0].image[0].registry, null) == null
    )
    error_message = "DOCR image sources must leave registry empty per the App Platform contract."
  }

  assert {
    condition     = digitalocean_app.api.spec[0].worker[0].run_command == "bun run start:scheduler"
    error_message = "The runtime root must include the shared scheduler worker."
  }
}

run "components_receive_exactly_their_environment" {
  command = plan

  variables {
    component_environments = {
      api       = { NODE_ENV = "production", APPLE_IAP_BUNDLE_ID = "com.example.app" }
      scheduler = { NODE_ENV = "production" }
    }
    component_secret_environments = {
      api       = { APPLE_IAP_PRIVATE_KEY_BASE64 = "api-only-secret" }
      scheduler = {}
    }
  }

  assert {
    condition = (
      toset([for env in digitalocean_app.api.spec[0].service[0].env : env.key if env.type == "GENERAL"]) ==
      toset(keys(var.component_environments["api"])) &&
      toset([for env in digitalocean_app.api.spec[0].worker[0].env : env.key if env.type == "GENERAL"]) ==
      toset(keys(var.component_environments["scheduler"]))
    )
    error_message = "The API and the scheduler must each receive exactly the GENERAL variables the foundation composed for them."
  }

  assert {
    condition = (
      toset([for env in digitalocean_app.api.spec[0].service[0].env : env.key if env.type == "SECRET"]) ==
      toset(["DATABASE_URL", "APPLE_IAP_PRIVATE_KEY_BASE64"]) &&
      toset([for env in digitalocean_app.api.spec[0].worker[0].env : env.key if env.type == "SECRET"]) ==
      toset(["DATABASE_URL"])
    )
    error_message = "A secret scoped to the API must not reach the scheduler worker."
  }
}

run "component_environments_need_every_component" {
  command = plan

  variables {
    component_environments = { api = {} }
  }

  expect_failures = [var.component_environments]
}

run "scheduler_renders_without_jwt_secret" {
  command = plan

  assert {
    condition = (
      contains([for env in digitalocean_app.api.spec[0].service[0].env : env.key], "JWT_SECRET") &&
      !contains([for env in digitalocean_app.api.spec[0].worker[0].env : env.key], "JWT_SECRET") &&
      !contains([for env in digitalocean_app.api.spec[0].job[0].env : env.key], "JWT_SECRET")
    )
    error_message = "Only the API service may carry JWT_SECRET; the scheduler worker and the migration job must not."
  }
}
