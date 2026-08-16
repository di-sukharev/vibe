variable "cloud_id" { type = string }
variable "folder_id" { type = string }
variable "primary_zone" { type = string }
variable "project_slug" { type = string }
variable "network_id" { type = string }
variable "registry_id" { type = string }
variable "backend_image_name" { type = string }
variable "runtime_service_account" { type = string }
variable "gateway_service_account" { type = string }
variable "trigger_service_account" { type = string }
variable "logging_group_id" { type = string }
variable "runtime_environment" { type = map(string) }
variable "runtime_secret_bindings" {
  type = map(object({
    secret_id  = string
    version_id = string
    key        = string
  }))
}
variable "database_credential_slot" {
  type = string

  validation {
    condition     = contains(["blue", "green"], var.database_credential_slot)
    error_message = "database_credential_slot must be blue or green."
  }
}
variable "api_memory_mb" { type = number }
variable "task_memory_mb" { type = number }
variable "api_domain" { type = string }
variable "api_certificate_id" { type = string }
variable "webapp_domain" { type = string }
variable "webapp_certificate_id" { type = string }
variable "website_domain" { type = string }
variable "website_certificate_id" { type = string }
variable "dns_zone_id" {
  type     = string
  nullable = true
}
variable "dns_zone_domain" {
  type = string

  validation {
    condition = alltrue([
      for domain in [var.api_domain, var.webapp_domain, var.website_domain] :
      domain != var.dns_zone_domain && endswith(domain, ".${var.dns_zone_domain}")
    ])
    error_message = "Managed and documented external DNS require CNAME-safe subdomains; zone-apex domains need a different ANAME-capable non-CDN topology."
  }
}
variable "enable_cdn" { type = bool }
variable "route_static_through_cdn" {
  type = bool

  validation {
    condition     = !var.route_static_through_cdn || var.enable_cdn
    error_message = "route_static_through_cdn requires enable_cdn=true."
  }
}
variable "webapp_website_endpoint" { type = string }
variable "webapp_website_domain" { type = string }
variable "website_website_endpoint" { type = string }
variable "website_website_domain" { type = string }
variable "runtime_image_digest" {
  type = string

  validation {
    condition     = can(regex("^sha256:[0-9a-f]{64}$", var.runtime_image_digest))
    error_message = "runtime_image_digest must be an immutable sha256 digest."
  }
}
