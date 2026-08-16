variable "project_slug" { type = string }
variable "project_id" { type = string }
variable "app_region" { type = string }
variable "api_domain" { type = string }
variable "webapp_domain" { type = string }
variable "website_domain" { type = string }
variable "dns_zone" {
  type     = string
  nullable = true
}
variable "github_repo" { type = string }
variable "source_branch" {
  description = "Immutable remote branch created once for the exact release commit."
  type        = string

  validation {
    condition     = can(regex("^infra-release/[0-9a-f]{40}$", var.source_branch))
    error_message = "source_branch must be the wrapper-owned immutable infra-release/<40-char-sha> branch."
  }

  validation {
    condition     = var.source_branch == "infra-release/${var.release_revision}"
    error_message = "source_branch and release_revision must identify the same immutable commit."
  }
}
variable "release_revision" {
  type = string

  validation {
    condition     = can(regex("^[0-9a-f]{40}$", var.release_revision))
    error_message = "release_revision must be the exact 40-character Git commit."
  }
}
