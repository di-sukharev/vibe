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

run "scheduler_alerts_reach_someone" {
  command = plan

  assert {
    condition     = length(digitalocean_app.api.spec[0].worker[0].alert) == 3
    error_message = "A stopped scheduler is silent: the worker needs its three App Platform component alerts (RESTART_COUNT, MEM_UTILIZATION, CPU_UTILIZATION) so someone is told when it keeps dying, is about to be killed, or never idles."
  }

  assert {
    condition = (
      digitalocean_app.api.spec[0].worker[0].alert[0].rule == "RESTART_COUNT" &&
      digitalocean_app.api.spec[0].worker[0].alert[0].operator == "GREATER_THAN" &&
      digitalocean_app.api.spec[0].worker[0].alert[0].value == 1 &&
      digitalocean_app.api.spec[0].worker[0].alert[0].window == "FIVE_MINUTES"
    )
    error_message = "The first scheduler alert must fire on more than one restart in five minutes, which is what a crash-looping scheduler looks like; a single restart after a deploy must stay quiet."
  }

  assert {
    condition = (
      digitalocean_app.api.spec[0].worker[0].alert[1].rule == "MEM_UTILIZATION" &&
      digitalocean_app.api.spec[0].worker[0].alert[1].operator == "GREATER_THAN" &&
      digitalocean_app.api.spec[0].worker[0].alert[1].value == 85 &&
      digitalocean_app.api.spec[0].worker[0].alert[1].window == "TEN_MINUTES"
    )
    error_message = "The second scheduler alert must fire on memory above 85% for ten minutes, before App Platform kills the worker for running out of it."
  }

  assert {
    condition = (
      digitalocean_app.api.spec[0].worker[0].alert[2].rule == "CPU_UTILIZATION" &&
      digitalocean_app.api.spec[0].worker[0].alert[2].operator == "GREATER_THAN" &&
      digitalocean_app.api.spec[0].worker[0].alert[2].value == 90 &&
      digitalocean_app.api.spec[0].worker[0].alert[2].window == "THIRTY_MINUTES"
    )
    error_message = "The third scheduler alert must fire on CPU above 90% for thirty minutes: a healthy scheduler idles between ticks, so a worker that never idles has a stuck job; a pass is bounded whatever the backlog, so this is not a backlog signal."
  }

  assert {
    condition = (
      !coalesce(digitalocean_app.api.spec[0].worker[0].alert[0].disabled, false) &&
      !coalesce(digitalocean_app.api.spec[0].worker[0].alert[1].disabled, false) &&
      !coalesce(digitalocean_app.api.spec[0].worker[0].alert[2].disabled, false)
    )
    error_message = "Scheduler alerts must not ship disabled."
  }

  assert {
    condition = (
      length(digitalocean_app.api.spec[0].alert[0].destinations) == 0 &&
      length(digitalocean_app.api.spec[0].alert[1].destinations) == 0 &&
      length(digitalocean_app.api.spec[0].worker[0].alert[0].destinations) == 0 &&
      length(digitalocean_app.api.spec[0].worker[0].alert[1].destinations) == 0 &&
      length(digitalocean_app.api.spec[0].worker[0].alert[2].destinations) == 0
    )
    error_message = "No alert may carry a destinations block: App Platform delivers to the team's default email without one, and provider 2.99.1 never reads destinations back into state, so a configured list would plan a change on every run and a removed one would never restore the default. Route alerts in the console instead."
  }
}
