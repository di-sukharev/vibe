variable "project_slug" {
  type = string

  validation {
    condition     = can(regex("^[a-z][a-z0-9-]{2,30}$", var.project_slug))
    error_message = "project_slug must be 3-31 lowercase letters, digits, or hyphens and start with a letter."
  }
}

variable "app_region" {
  description = "App Platform region slug."
  type        = string
  default     = "fra"
}

variable "database_region" {
  description = "Managed Database/VPC region slug."
  type        = string
  default     = "fra1"
}

variable "spaces_region" {
  type    = string
  default = "fra1"
}

variable "vpc_ip_range" {
  type    = string
  default = "10.10.0.0/24"

  validation {
    condition     = can(cidrhost(var.vpc_ip_range, 0))
    error_message = "vpc_ip_range must be a valid IPv4 CIDR."
  }
}

variable "github_repo" {
  description = "GitHub repository in owner/repository form."
  type        = string

  validation {
    condition     = can(regex("^[^/]+/[^/]+$", var.github_repo))
    error_message = "github_repo must use owner/repository form."
  }
}

variable "git_branch" {
  type    = string
  default = "master"
}

variable "registry_name" {
  description = "Account-wide DigitalOcean Container Registry name; import it when one already exists."
  type        = string
}

variable "registry_subscription_tier" {
  type    = string
  default = "starter"
}

variable "backend_image_repository" {
  type    = string
  default = "backend"
}

variable "api_domain" {
  type = string
}

variable "webapp_domain" {
  type = string
}

variable "website_domain" {
  type = string
}

variable "dns_zone" {
  description = "Optional DigitalOcean DNS zone; null leaves DNS records under external management."
  type        = string
  default     = null
  nullable    = true
}

variable "media_bucket_name" {
  description = "Globally unique private Spaces bucket name."
  type        = string
}

variable "jwt_secret" {
  description = "Production JWT signing secret: 32 random bytes encoded as 64+ hexadecimal characters."
  type        = string
  sensitive   = true

  validation {
    condition     = can(regex("^[0-9a-fA-F]{64,}$", var.jwt_secret))
    error_message = "jwt_secret must contain at least 64 hexadecimal characters."
  }
}

variable "email_delivery" {
  type    = string
  default = "disabled"

  validation {
    condition     = contains(["disabled", "resend"], var.email_delivery)
    error_message = "DigitalOcean production supports disabled or resend email delivery."
  }
}

variable "email_from" {
  type     = string
  default  = null
  nullable = true
}

variable "extra_runtime_env" {
  description = "Non-secret provider/product settings shared by API and scheduler."
  type        = map(string)
  default     = {}
}

variable "extra_runtime_secret_env" {
  description = "Additional App Platform SECRET variables, such as EMAIL_RESEND_API_KEY. Never commit them in tfvars."
  type        = map(string)
  default     = {}
  sensitive   = true
}

variable "trusted_api_app_id" {
  description = "API App Platform ID injected by the wrapper after its migration-gated deployment."
  type        = string
  default     = null
  nullable    = true

  validation {
    condition     = var.trusted_api_app_id == null || can(regex("^[0-9a-f-]{36}$", var.trusted_api_app_id))
    error_message = "trusted_api_app_id must be null or a DigitalOcean App UUID."
  }
}

variable "database_size" {
  type    = string
  default = "db-s-1vcpu-1gb"
}

variable "api_instance_size" {
  type    = string
  default = "apps-s-1vcpu-1gb"
}

variable "worker_instance_size" {
  type    = string
  default = "apps-s-1vcpu-1gb"
}
