variable "cloud_id" {
  description = "Yandex Cloud id verified by the release preflight."
  type        = string
}

variable "folder_id" {
  description = "Yandex folder that owns the production infrastructure."
  type        = string
}

variable "zone" {
  type    = string
  default = "ru-central1-a"
}

variable "project_slug" {
  type = string

  validation {
    condition     = can(regex("^[a-z][a-z0-9-]{2,30}$", var.project_slug))
    error_message = "project_slug must be 3-31 lowercase letters, digits, or hyphens and start with a letter."
  }
}

variable "state_bucket_name" {
  description = "Globally unique private Object Storage bucket for Terraform state."
  type        = string
}

variable "bootstrap_folder_storage_access" {
  description = "Temporary bootstrap-only folder role. scripts/infra.mjs enables it for the first apply and removes it before state migration."
  type        = bool
  default     = false
}
