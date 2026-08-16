variable "cloud_id" { type = string }
variable "folder_id" { type = string }
variable "primary_zone" { type = string }
variable "project_slug" { type = string }
variable "network_id" { type = string }
variable "registry_id" { type = string }
variable "backend_image_name" { type = string }
variable "migration_service_account" { type = string }
variable "logging_group_id" { type = string }
variable "migration_environment" { type = map(string) }
variable "migration_secret_bindings" {
  type = map(object({
    secret_id  = string
    version_id = string
    key        = string
  }))
}
variable "api_memory_mb" { type = number }
variable "migration_image_digest" {
  type = string

  validation {
    condition     = can(regex("^sha256:[0-9a-f]{64}$", var.migration_image_digest))
    error_message = "migration_image_digest must be an immutable sha256 digest."
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
