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
variable "component_environments" {
  description = "GENERAL runtime variables per App Platform component, composed by the foundation."
  type        = map(map(string))
  # Empty only when the foundation outputs predate this shape; the validation then asks for
  # infra:apply instead of Terraform stopping on a missing variable.
  default = {}

  validation {
    condition     = alltrue([for component in ["api", "scheduler"] : contains(keys(var.component_environments), component)])
    error_message = "component_environments needs api and scheduler entries; run infra:apply to refresh the foundation outputs."
  }
}
variable "component_secret_environments" {
  description = "SECRET runtime variables per App Platform component, composed by the foundation."
  type        = map(map(string))
  default     = {}
  sensitive   = true

  validation {
    condition = alltrue([
      for component in ["api", "scheduler"] :
      contains(nonsensitive(keys(var.component_secret_environments)), component)
    ])
    error_message = "component_secret_environments needs api and scheduler entries; run infra:apply to refresh the foundation outputs."
  }
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
