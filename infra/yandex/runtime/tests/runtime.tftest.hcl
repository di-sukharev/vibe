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
  cloud_id                 = "cloud-test"
  folder_id                = "folder-test"
  primary_zone             = "ru-central1-a"
  project_slug             = "example-product"
  network_id               = "network-id"
  registry_id              = "registry-id"
  backend_image_name       = "backend"
  runtime_service_account  = "runtime-sa"
  gateway_service_account  = "gateway-sa"
  trigger_service_account  = "trigger-sa"
  logging_group_id         = "logging-id"
  runtime_environment      = {}
  runtime_secret_bindings  = {}
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

run "immutable_runtime_with_provider_timers" {
  command = plan

  assert {
    condition     = strcontains(yandex_serverless_container.api.image[0].url, var.runtime_image_digest)
    error_message = "The API must use the exact promoted image digest."
  }

  assert {
    condition     = length(yandex_function_trigger.jobs) == 4
    error_message = "Outbox, notifications, upload cleanup, and maintenance all need provider timers."
  }

  assert {
    condition = alltrue([
      for container in values(yandex_serverless_container.jobs) :
      container.runtime[0].type == "http" &&
      container.image[0].args[0] == "src/cron.ts" &&
      container.image[0].args[1] == "--http"
    ])
    error_message = "Provider timers must use cron.ts HTTP mode so job failures become non-2xx responses."
  }

  assert {
    condition = alltrue([
      for trigger in values(yandex_function_trigger.jobs) :
      tonumber(trigger.container[0].retry_attempts) == 3
    ])
    error_message = "HTTP-visible job failures must retain the configured provider retries."
  }

  assert {
    condition = (
      yandex_serverless_container.jobs["outbox"].execution_timeout == "180s" &&
      yandex_serverless_container.jobs["notifications"].execution_timeout == "180s" &&
      yandex_serverless_container.jobs["uploads"].execution_timeout == "840s" &&
      yandex_serverless_container.jobs["maintenance"].execution_timeout == "180s"
    )
    error_message = "Each provider task needs enough execution time for its declared workload."
  }

  assert {
    condition     = length(yandex_cdn_resource.webapp) == 0 && length(yandex_cdn_resource.website) == 0
    error_message = "CDN must remain opt-in."
  }
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
