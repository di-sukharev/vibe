variable "project_slug" { type = string }
variable "project_id" { type = string }
variable "vpc_id" { type = string }
variable "app_region" { type = string }
variable "api_domain" { type = string }
variable "webapp_domain" { type = string }
variable "dns_zone" {
  type     = string
  nullable = true
}
variable "database_cluster_name" { type = string }
variable "database_name" { type = string }
variable "database_user" { type = string }
variable "database_admin_user" { type = string }
variable "backend_image_repository" { type = string }
variable "spaces_region" { type = string }
variable "media_bucket_name" { type = string }
variable "media_access_key_id" {
  type      = string
  sensitive = true
}
variable "media_secret_access_key" {
  type      = string
  sensitive = true
}
variable "jwt_secret" {
  type      = string
  sensitive = true
}
variable "email_delivery" { type = string }
variable "email_from" {
  type     = string
  nullable = true
}
variable "extra_runtime_env" { type = map(string) }
variable "extra_runtime_secret_env" {
  type      = map(string)
  sensitive = true
}
variable "api_instance_size" { type = string }
variable "worker_instance_size" { type = string }
variable "runtime_image_digest" {
  description = "Immutable image promoted only after the release source and foundation are verified."
  type        = string

  validation {
    condition     = can(regex("^sha256:[0-9a-f]{64}$", var.runtime_image_digest))
    error_message = "runtime_image_digest must be an immutable sha256 digest."
  }
}
variable "admin_seed_email" {
  type      = string
  default   = null
  nullable  = true
  sensitive = true

  validation {
    condition     = (var.admin_seed_email == null) == (var.admin_seed_password == null)
    error_message = "admin_seed_email and admin_seed_password must be supplied together or both omitted."
  }
}
variable "admin_seed_password" {
  type      = string
  default   = null
  nullable  = true
  sensitive = true
}
