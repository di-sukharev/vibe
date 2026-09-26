# Foundation outputs written before per-component scoping carry no component maps. The first
# plan after such an upgrade must name the fix (infra:apply), not stop on a missing variable.
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
  api_instance_size        = "apps-s-1vcpu-1gb"
  worker_instance_size     = "apps-s-1vcpu-1gb"
  runtime_image_digest     = "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
}

run "stale_foundation_outputs_ask_for_infra_apply" {
  command = plan

  expect_failures = [
    var.component_environments,
    var.component_secret_environments,
  ]
}
