variable "project_slug" {
  description = "Lowercase product slug used in globally unique infrastructure names."
  type        = string

  validation {
    condition     = can(regex("^[a-z][a-z0-9-]{2,30}$", var.project_slug))
    error_message = "project_slug must be 3-31 lowercase letters, digits, or hyphens and start with a letter."
  }
}

variable "spaces_region" {
  description = "DigitalOcean region used by the Terraform state Space."
  type        = string
  default     = "fra1"
}

variable "state_bucket_name" {
  description = "Globally unique private Space name for Terraform state."
  type        = string

  validation {
    condition     = can(regex("^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$", var.state_bucket_name))
    error_message = "state_bucket_name must be a valid globally unique Spaces bucket name."
  }
}
