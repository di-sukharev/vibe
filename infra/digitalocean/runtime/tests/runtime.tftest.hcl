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
  spaces_region            = "fra1"
  media_bucket_name        = "example-product-media"
  media_access_key_id      = "media-key"
  media_secret_access_key  = "media-secret"
  jwt_secret               = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
  email_delivery           = "disabled"
  email_from               = null
  extra_runtime_env        = {}
  extra_runtime_secret_env = {}
  api_instance_size        = "apps-s-1vcpu-1gb"
  worker_instance_size     = "apps-s-1vcpu-1gb"
  runtime_image_digest     = "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
}

run "migration_gates_runtime" {
  command = plan

  assert {
    condition     = digitalocean_app.api.spec[0].job[0].kind == "PRE_DEPLOY"
    error_message = "The API deployment must be gated by its PRE_DEPLOY migration."
  }

  assert {
    condition = (
      length(digitalocean_app.api.spec[0].database) == 2 &&
      digitalocean_app.api.spec[0].database[0].db_user == var.database_user &&
      digitalocean_app.api.spec[0].database[1].db_user == var.database_admin_user &&
      one([
        for env in digitalocean_app.api.spec[0].job[0].env : env.value
        if env.key == "DATABASE_URL"
      ]) == "$${migration-database.DATABASE_PRIVATE_URL}" &&
      one([
        for env in digitalocean_app.api.spec[0].service[0].env : env.value
        if env.key == "DATABASE_URL"
      ]) == "$${runtime-database.DATABASE_PRIVATE_URL}"
    )
    error_message = "Only PRE_DEPLOY may use doadmin; API and scheduler must use the normal runtime user."
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
