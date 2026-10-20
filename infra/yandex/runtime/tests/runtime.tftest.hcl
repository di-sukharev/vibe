mock_provider "yandex" {}

override_resource {
  target          = yandex_cdn_resource.webapp
  override_during = plan
  values          = { provider_cname = "webapp.cdn.yandex.test" }
}

override_resource {
  target          = yandex_cdn_resource.website
  override_during = plan
  values          = { provider_cname = "website.cdn.yandex.test" }
}

variables {
  cloud_id                = "cloud-test"
  folder_id               = "folder-test"
  primary_zone            = "ru-central1-a"
  project_slug            = "example-product"
  network_id              = "network-id"
  registry_id             = "registry-id"
  backend_image_name      = "backend"
  runtime_service_account = "runtime-sa"
  gateway_service_account = "gateway-sa"
  trigger_service_account = "trigger-sa"
  logging_group_id        = "logging-id"
  component_environments = merge(
    { api = {} },
    { for schedule in jsondecode(file("../../../backend/src/job-schedules.json")) : schedule.key => {} },
  )
  component_secret_bindings = merge(
    { api = {} },
    { for schedule in jsondecode(file("../../../backend/src/job-schedules.json")) : schedule.key => {} },
  )
  database_credential_slot = "blue"
  api_memory_mb            = 1024
  task_memory_mb           = 512
  api_domain               = "api.example.com"
  api_certificate_id       = "certificate-api"
  webapp_domain            = "app.example.com"
  webapp_certificate_id    = "certificate-webapp"
  website_domain           = "www.example.com"
  website_certificate_id   = "certificate-website"
  dns_zone_id              = null
  dns_zone_domain          = "example.com"
  enable_cdn               = false
  route_static_through_cdn = false
  webapp_website_endpoint  = "http://app.example.com.website.yandexcloud.net"
  webapp_website_domain    = "app.example.com.website.yandexcloud.net"
  website_website_endpoint = "http://www.example.com.website.yandexcloud.net"
  website_website_domain   = "www.example.com.website.yandexcloud.net"
  runtime_image_digest     = "sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc"
}

run "optional_cdn" {
  command = plan

  variables { enable_cdn = true }

  assert {
    condition     = length(yandex_cdn_resource.webapp) == 1 && length(yandex_cdn_resource.website) == 1
    error_message = "CDN resources must appear only after explicit opt-in."
  }

  assert {
    condition = (
      output.required_dns_records.webapp.value == var.webapp_website_domain &&
      length(output.cdn_dns_records) == 2
    )
    error_message = "Provisioning CDN must expose its targets without routing DNS before the explicit second phase."
  }
}

run "cdn_dns_routing_is_separate" {
  command = plan

  variables {
    enable_cdn               = true
    route_static_through_cdn = true
  }

  assert {
    condition = (
      output.required_dns_records.webapp.value == yandex_cdn_resource.webapp[0].provider_cname &&
      output.required_dns_records.website.value == yandex_cdn_resource.website[0].provider_cname
    )
    error_message = "Only the routing phase may point required DNS at retained CDN resources."
  }
}

run "cdn_route_without_resources_is_rejected" {
  command = plan

  variables { route_static_through_cdn = true }

  expect_failures = [var.route_static_through_cdn]
}

run "zone_apex_is_rejected" {
  command = plan

  variables { website_domain = "example.com" }

  expect_failures = [var.dns_zone_domain]
}

run "every_job_needs_a_composed_environment" {
  command = plan

  variables {
    component_environments = merge(
      { api = {} },
      { for schedule in jsondecode(file("../../../backend/src/job-schedules.json")) : schedule.key => {} if schedule.key != "uploads" },
    )
  }

  expect_failures = [yandex_serverless_container.jobs]
}

run "job_containers_render_without_jwt_secret" {
  command = plan

  variables {
    component_secret_bindings = merge(
      { for schedule in jsondecode(file("../../../backend/src/job-schedules.json")) : schedule.key => {} },
      {
        api = {
          JWT_SECRET = {
            secret_id  = "runtime-lockbox-secret"
            version_id = "runtime-lockbox-version"
            key        = "JWT_SECRET"
          }
        }
      },
    )
  }

  assert {
    condition = (
      contains([for secret in yandex_serverless_container.api.secrets : secret.environment_variable], "JWT_SECRET") &&
      alltrue([
        for container in values(yandex_serverless_container.jobs) :
        !contains([for secret in container.secrets : secret.environment_variable], "JWT_SECRET")
      ])
    )
    error_message = "Only the API container may bind JWT_SECRET; job containers must not."
  }
}
