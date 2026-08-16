locals {
  webapp_origin      = "https://${var.webapp_domain}"
  website_origin     = "https://${var.website_domain}"
  webapp_cdn_cname   = try(yandex_cdn_resource.webapp[0].provider_cname, null)
  website_cdn_cname  = try(yandex_cdn_resource.website[0].provider_cname, null)
  webapp_dns_target  = var.route_static_through_cdn ? coalesce(local.webapp_cdn_cname, var.webapp_website_domain) : var.webapp_website_domain
  website_dns_target = var.route_static_through_cdn ? coalesce(local.website_cdn_cname, var.website_website_domain) : var.website_website_domain
  api_gateway_spec = yamlencode({
    openapi = "3.0.0"
    info = {
      title   = "${var.project_slug} API"
      version = "1.0.0"
    }
    paths = {
      "/{proxy+}" = {
        "x-yc-apigateway-any-method" = {
          "x-yc-apigateway-integration" = {
            type               = "serverless_containers"
            container_id       = yandex_serverless_container.api.id
            service_account_id = var.gateway_service_account
          }
          parameters = [{
            explode  = false
            in       = "path"
            name     = "proxy"
            required = false
            schema = {
              default = "-"
              type    = "string"
            }
            style = "simple"
          }]
        }
      }
    }
  })
}

resource "yandex_serverless_container_iam_member" "gateway_api" {
  container_id = yandex_serverless_container.api.id
  role         = "serverless-containers.containerInvoker"
  member       = "serviceAccount:${var.gateway_service_account}"
}

resource "yandex_api_gateway" "api" {
  folder_id = var.folder_id
  name      = "${local.name_prefix}-api"
  spec      = local.api_gateway_spec

  custom_domains {
    fqdn           = var.api_domain
    certificate_id = var.api_certificate_id
  }

  log_options {
    log_group_id = var.logging_group_id
    min_level    = "INFO"
  }

  depends_on = [yandex_serverless_container_iam_member.gateway_api]
}

resource "yandex_cdn_origin_group" "webapp" {
  count = var.enable_cdn ? 1 : 0

  folder_id = var.folder_id
  name      = "${local.name_prefix}-webapp"

  origin { source = trimprefix(var.webapp_website_endpoint, "http://") }
}

resource "yandex_cdn_origin_group" "website" {
  count = var.enable_cdn ? 1 : 0

  folder_id = var.folder_id
  name      = "${local.name_prefix}-website"

  origin { source = trimprefix(var.website_website_endpoint, "http://") }
}

resource "yandex_cdn_resource" "webapp" {
  count = var.enable_cdn ? 1 : 0

  folder_id       = var.folder_id
  cname           = var.webapp_domain
  origin_group_id = yandex_cdn_origin_group.webapp[0].id
  origin_protocol = "http"
  active          = true

  options {
    custom_host_header     = trimprefix(var.webapp_website_endpoint, "http://")
    redirect_http_to_https = true
    gzip_on                = true
  }

  ssl_certificate {
    type                   = "certificate_manager"
    certificate_manager_id = var.webapp_certificate_id
  }
}

resource "yandex_cdn_resource" "website" {
  count = var.enable_cdn ? 1 : 0

  folder_id       = var.folder_id
  cname           = var.website_domain
  origin_group_id = yandex_cdn_origin_group.website[0].id
  origin_protocol = "http"
  active          = true

  options {
    custom_host_header     = trimprefix(var.website_website_endpoint, "http://")
    redirect_http_to_https = true
    gzip_on                = true
  }

  ssl_certificate {
    type                   = "certificate_manager"
    certificate_manager_id = var.website_certificate_id
  }
}

resource "yandex_dns_recordset" "api" {
  count = var.dns_zone_id == null ? 0 : 1

  zone_id = var.dns_zone_id
  name    = "${var.api_domain}."
  type    = "CNAME"
  ttl     = 300
  data    = ["${yandex_api_gateway.api.domain}."]
}

resource "yandex_dns_recordset" "webapp" {
  count = var.dns_zone_id == null ? 0 : 1

  zone_id = var.dns_zone_id
  name    = "${var.webapp_domain}."
  type    = "CNAME"
  ttl     = 300
  data = [var.route_static_through_cdn
    ? "${local.webapp_dns_target}."
  : "${var.webapp_website_domain}."]
}

resource "yandex_dns_recordset" "website" {
  count = var.dns_zone_id == null ? 0 : 1

  zone_id = var.dns_zone_id
  name    = "${var.website_domain}."
  type    = "CNAME"
  ttl     = 300
  data = [var.route_static_through_cdn
    ? "${local.website_dns_target}."
  : "${var.website_website_domain}."]
}
