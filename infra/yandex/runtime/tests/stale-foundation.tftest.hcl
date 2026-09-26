# Foundation outputs written before per-component scoping carry no component maps. The first
# plan after such an upgrade must name the fix (infra:apply), not stop on a missing variable.
mock_provider "yandex" {}

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

run "stale_foundation_outputs_ask_for_infra_apply" {
  command = plan

  expect_failures = [
    yandex_serverless_container.api,
    yandex_serverless_container.jobs,
  ]
}
