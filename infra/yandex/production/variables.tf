variable "cloud_id" {
  type = string
}

variable "folder_id" {
  type = string
}

variable "project_slug" {
  type = string

  validation {
    condition     = can(regex("^[a-z][a-z0-9-]{2,30}$", var.project_slug))
    error_message = "project_slug must be 3-31 lowercase letters, digits, or hyphens and start with a letter."
  }
}

variable "git_branch" {
  description = "Only this pushed branch may be released."
  type        = string
  default     = "master"
}

variable "primary_zone" {
  type    = string
  default = "ru-central1-a"

  validation {
    condition     = contains(keys(var.subnets), var.primary_zone)
    error_message = "subnets must contain primary_zone for the single-host PostgreSQL cluster."
  }
}

variable "subnets" {
  description = "Private subnets available to Serverless Containers and Managed PostgreSQL."
  type        = map(string)
  default = {
    ru-central1-a = "10.20.0.0/24"
    ru-central1-b = "10.20.1.0/24"
    ru-central1-d = "10.20.2.0/24"
  }

  validation {
    condition     = alltrue([for cidr in values(var.subnets) : can(cidrhost(cidr, 0))])
    error_message = "Every subnets value must be a valid CIDR."
  }
}

variable "backend_image_name" {
  type    = string
  default = "backend"
}

variable "database_active_slot" {
  description = "Blue/green database credential slot prepared for the next runtime release."
  type        = string
  default     = "blue"

  validation {
    condition     = contains(["blue", "green"], var.database_active_slot)
    error_message = "database_active_slot must be blue or green."
  }
}

variable "database_owner_password" {
  description = "Migration-only database owner password supplied outside committed tfvars."
  type        = string
  sensitive   = true

  validation {
    condition = (
      length(var.database_owner_password) >= 24 &&
      !startswith(var.database_owner_password, "REPLACE_WITH_")
    )
    error_message = "database_owner_password must contain at least 24 characters and cannot be the example placeholder."
  }
}

variable "database_owner_password_version" {
  description = "Increment to rotate the migration-only owner password."
  type        = number
  default     = 1

  validation {
    condition     = var.database_owner_password_version >= 1 && floor(var.database_owner_password_version) == var.database_owner_password_version
    error_message = "database_owner_password_version must be a positive integer."
  }
}

variable "database_blue_password" {
  description = "Strong blue-slot DB password supplied outside committed tfvars."
  type        = string
  sensitive   = true

  validation {
    condition = (
      length(var.database_blue_password) >= 24 &&
      !startswith(var.database_blue_password, "REPLACE_WITH_")
    )
    error_message = "database_blue_password must contain at least 24 characters and cannot be the example placeholder."
  }
}

variable "database_green_password" {
  description = "Strong green-slot DB password supplied outside committed tfvars."
  type        = string
  sensitive   = true

  validation {
    condition = (
      length(var.database_green_password) >= 24 &&
      !startswith(var.database_green_password, "REPLACE_WITH_")
    )
    error_message = "database_green_password must contain at least 24 characters and cannot be the example placeholder."
  }
}

variable "database_blue_password_version" {
  description = "Increment only while blue is inactive to rotate its write-only password."
  type        = number
  default     = 1

  validation {
    condition     = var.database_blue_password_version >= 1 && floor(var.database_blue_password_version) == var.database_blue_password_version
    error_message = "database_blue_password_version must be a positive integer."
  }
}

variable "database_green_password_version" {
  description = "Increment only while green is inactive to rotate its write-only password."
  type        = number
  default     = 1

  validation {
    condition     = var.database_green_password_version >= 1 && floor(var.database_green_password_version) == var.database_green_password_version
    error_message = "database_green_password_version must be a positive integer."
  }
}

variable "jwt_secret" {
  type      = string
  sensitive = true

  validation {
    condition     = can(regex("^[0-9a-fA-F]{64,}$", var.jwt_secret))
    error_message = "jwt_secret must contain at least 64 hexadecimal characters."
  }
}

variable "api_domain" {
  type = string
}

variable "api_certificate_id" {
  type = string
}

variable "webapp_domain" {
  type = string
}

variable "webapp_certificate_id" {
  type = string
}

variable "website_domain" {
  type = string
}

variable "website_certificate_id" {
  type = string
}

variable "dns_zone_id" {
  description = "Optional Yandex DNS zone id. Null outputs required CNAME records without managing them."
  type        = string
  default     = null
  nullable    = true
}

variable "dns_zone_domain" {
  description = "Public DNS zone apex used to reject unsupported apex CNAMEs, including with external DNS."
  type        = string

  validation {
    condition     = can(regex("^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$", var.dns_zone_domain))
    error_message = "dns_zone_domain must be a lowercase DNS zone such as example.com, without a trailing dot."
  }

  validation {
    condition = alltrue([
      for domain in [var.api_domain, var.webapp_domain, var.website_domain] :
      domain != var.dns_zone_domain && endswith(domain, ".${var.dns_zone_domain}")
    ])
    error_message = "api_domain, webapp_domain, and website_domain must be CNAME-safe subdomains of dns_zone_domain; this minimal topology does not support a zone apex."
  }
}

variable "enable_cdn" {
  description = "Creates and retains CDN resources. DNS routing is controlled separately for safe two-phase changes."
  type        = bool
  default     = false
}

variable "route_static_through_cdn" {
  description = "Routes static domains to provisioned CDN resources. Keep false while creating or draining CDN."
  type        = bool
  default     = false

  validation {
    condition     = !var.route_static_through_cdn || var.enable_cdn
    error_message = "route_static_through_cdn requires enable_cdn=true so DNS never points at a missing CDN resource."
  }
}

variable "storage_bootstrap_access" {
  description = "Temporary folder-wide storage.admin grant used only while creating and configuring the three application buckets."
  type        = bool
  default     = false
}

variable "webapp_bucket_name" {
  type = string

  validation {
    condition = (
      var.webapp_bucket_name == var.webapp_domain && var.website_bucket_name == var.website_domain
    )
    error_message = "Static bucket names must equal their custom domains so direct HTTPS remains a CDN rollback path."
  }
}

variable "website_bucket_name" {
  type = string
}

variable "media_bucket_name" {
  type = string
}

variable "email_delivery" {
  type    = string
  default = "disabled"

  validation {
    condition     = contains(["disabled", "postbox"], var.email_delivery)
    error_message = "Yandex production supports disabled or postbox email delivery."
  }

  validation {
    condition     = var.email_delivery == "disabled" || var.email_from != null
    error_message = "email_delivery=postbox requires email_from."
  }
}

variable "email_from" {
  type     = string
  default  = null
  nullable = true
}

variable "extra_runtime_env" {
  type    = map(string)
  default = {}
}

variable "extra_secret_bindings" {
  description = "Additional Lockbox environment bindings keyed by environment variable name."
  type = map(object({
    secret_id  = string
    version_id = string
    key        = string
  }))
  default = {}
}

variable "postgres_resource_preset" {
  type    = string
  default = "s3-c2-m8"
}

variable "postgres_disk_size_gb" {
  type    = number
  default = 20
}

variable "postgres_disk_limit_gb" {
  type    = number
  default = 100
}

variable "api_memory_mb" {
  type    = number
  default = 1024
}

variable "task_memory_mb" {
  type    = number
  default = 512
}
