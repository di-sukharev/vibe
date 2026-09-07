resource "yandex_iam_service_account" "storage_manager" {
  folder_id   = var.folder_id
  name        = "${local.name_prefix}-storage-iac"
  description = "Terraform-owned Object Storage management identity."
}

resource "yandex_resourcemanager_folder_iam_member" "storage_manager" {
  count = var.storage_bootstrap_access ? 1 : 0

  folder_id = var.folder_id
  role      = "storage.admin"
  member    = "serviceAccount:${yandex_iam_service_account.storage_manager.id}"
}

resource "yandex_iam_service_account_static_access_key" "storage_manager" {
  service_account_id = yandex_iam_service_account.storage_manager.id
  description        = "Terraform Object Storage resource management."

  depends_on = [yandex_resourcemanager_folder_iam_member.storage_manager]
}

resource "yandex_storage_bucket" "webapp" {
  bucket        = var.webapp_bucket_name
  folder_id     = var.folder_id
  access_key    = yandex_iam_service_account_static_access_key.storage_manager.access_key
  secret_key    = yandex_iam_service_account_static_access_key.storage_manager.secret_key
  force_destroy = false

  anonymous_access_flags {
    read        = true
    list        = false
    config_read = false
  }

  versioning {
    enabled = true
  }

  lifecycle_rule {
    id      = "old-static-versions"
    enabled = true

    noncurrent_version_expiration {
      days = 30
    }
  }

  website {
    index_document = "index.html"
    error_document = "index.html"
  }

  https {
    certificate_id = var.webapp_certificate_id
  }
}

resource "yandex_storage_bucket" "website" {
  bucket        = var.website_bucket_name
  folder_id     = var.folder_id
  access_key    = yandex_iam_service_account_static_access_key.storage_manager.access_key
  secret_key    = yandex_iam_service_account_static_access_key.storage_manager.secret_key
  force_destroy = false

  anonymous_access_flags {
    read        = true
    list        = false
    config_read = false
  }

  versioning {
    enabled = true
  }

  lifecycle_rule {
    id      = "old-static-versions"
    enabled = true

    noncurrent_version_expiration {
      days = 30
    }
  }

  website {
    index_document = "index.html"
  }

  https {
    certificate_id = var.website_certificate_id
  }
}

resource "yandex_storage_bucket" "media" {
  bucket        = var.media_bucket_name
  folder_id     = var.folder_id
  access_key    = yandex_iam_service_account_static_access_key.storage_manager.access_key
  secret_key    = yandex_iam_service_account_static_access_key.storage_manager.secret_key
  force_destroy = false

  anonymous_access_flags {
    read        = false
    list        = false
    config_read = false
  }

  cors_rule {
    allowed_origins = [local.webapp_origin]
    allowed_methods = ["GET", "PUT", "HEAD"]
    allowed_headers = ["Content-Type", "If-None-Match"]
    expose_headers  = ["ETag"]
    max_age_seconds = 600
  }

  lifecycle_rule {
    id                                     = "abort-incomplete-uploads"
    enabled                                = true
    abort_incomplete_multipart_upload_days = 7
  }

  lifecycle {
    prevent_destroy = true
  }
}

resource "yandex_iam_service_account" "static_publisher" {
  folder_id   = var.folder_id
  name        = "${local.name_prefix}-static-publisher"
  description = "Release-only write access to public static website buckets."
}

resource "yandex_storage_bucket_iam_binding" "webapp_admins" {
  bucket  = yandex_storage_bucket.webapp.bucket
  role    = "storage.admin"
  members = ["serviceAccount:${yandex_iam_service_account.storage_manager.id}"]
}

resource "yandex_storage_bucket_iam_binding" "website_admins" {
  bucket  = yandex_storage_bucket.website.bucket
  role    = "storage.admin"
  members = ["serviceAccount:${yandex_iam_service_account.storage_manager.id}"]
}

resource "yandex_iam_service_account_static_access_key" "static_publisher" {
  service_account_id = yandex_iam_service_account.static_publisher.id
  description        = "Static release uploads for ${var.project_slug}."
}

locals {
  # Every policy below lets the bucket-scoped IaC key refresh and update bucket configuration
  # (`s3:*` on the bucket ARN, never on objects) and denies it the two bucket-level changes
  # Terraform never sends after creation. On Yandex, bucket deletion and policy management are not
  # policy actions: IAM authorizes them, and the IaC account holds bucket-scoped `storage.admin`,
  # so the next apply always rewrites these policies and whoever holds that key can lift the Deny.
  # `s3:PutBucketVersioning` is a documented policy action and the provider sends it only when the
  # `versioning` block changes, so the Deny turns an accidental versioning change into a failed
  # apply. `s3:DeleteBucket` is defense in depth only: Terraform removes the policy resource before
  # it would delete a bucket. Keep `s3:*`: an enumerated allow list buys no protection and breaks
  # refresh the day the provider reads one more bucket attribute.
  iac_key_denied_bucket_actions = ["s3:DeleteBucket", "s3:PutBucketVersioning"]
  static_publisher_bucket_actions = [
    "s3:GetBucketLocation",
    "s3:ListBucket",
    "s3:ListBucketMultipartUploads",
  ]
  static_publisher_object_actions = [
    "s3:AbortMultipartUpload",
    "s3:DeleteObject",
    "s3:GetObject",
    "s3:ListMultipartUploadParts",
    "s3:PutObject",
  ]
}

resource "yandex_storage_bucket_policy" "webapp_publisher" {
  bucket     = yandex_storage_bucket.webapp.bucket
  access_key = yandex_iam_service_account_static_access_key.storage_manager.access_key
  secret_key = yandex_iam_service_account_static_access_key.storage_manager.secret_key
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid       = "TerraformBucketConfiguration"
        Effect    = "Allow"
        Principal = { CanonicalUser = yandex_iam_service_account.storage_manager.id }
        Action    = "s3:*"
        Resource  = "arn:aws:s3:::${yandex_storage_bucket.webapp.bucket}"
      },
      {
        Sid       = "ProtectBucketFromTerraformKey"
        Effect    = "Deny"
        Principal = { CanonicalUser = yandex_iam_service_account.storage_manager.id }
        Action    = local.iac_key_denied_bucket_actions
        Resource  = "arn:aws:s3:::${yandex_storage_bucket.webapp.bucket}"
      },
      {
        Sid       = "PublicObjectRead"
        Effect    = "Allow"
        Principal = "*"
        Action    = ["s3:GetObject"]
        Resource  = "arn:aws:s3:::${yandex_storage_bucket.webapp.bucket}/*"
      },
      {
        Sid       = "PublisherBucketDataPlane"
        Effect    = "Allow"
        Principal = "*"
        Action    = local.static_publisher_bucket_actions
        Resource  = "arn:aws:s3:::${yandex_storage_bucket.webapp.bucket}"
        Condition = { StringEquals = { "yc:access-key-id" = yandex_iam_service_account_static_access_key.static_publisher.access_key } }
      },
      {
        Sid       = "PublisherObjectDataPlane"
        Effect    = "Allow"
        Principal = "*"
        Action    = local.static_publisher_object_actions
        Resource  = "arn:aws:s3:::${yandex_storage_bucket.webapp.bucket}/*"
        Condition = { StringEquals = { "yc:access-key-id" = yandex_iam_service_account_static_access_key.static_publisher.access_key } }
      },
    ]
  })
}

resource "yandex_storage_bucket_policy" "website_publisher" {
  bucket     = yandex_storage_bucket.website.bucket
  access_key = yandex_iam_service_account_static_access_key.storage_manager.access_key
  secret_key = yandex_iam_service_account_static_access_key.storage_manager.secret_key
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid       = "TerraformBucketConfiguration"
        Effect    = "Allow"
        Principal = { CanonicalUser = yandex_iam_service_account.storage_manager.id }
        Action    = "s3:*"
        Resource  = "arn:aws:s3:::${yandex_storage_bucket.website.bucket}"
      },
      {
        Sid       = "ProtectBucketFromTerraformKey"
        Effect    = "Deny"
        Principal = { CanonicalUser = yandex_iam_service_account.storage_manager.id }
        Action    = local.iac_key_denied_bucket_actions
        Resource  = "arn:aws:s3:::${yandex_storage_bucket.website.bucket}"
      },
      {
        Sid       = "PublicObjectRead"
        Effect    = "Allow"
        Principal = "*"
        Action    = ["s3:GetObject"]
        Resource  = "arn:aws:s3:::${yandex_storage_bucket.website.bucket}/*"
      },
      {
        Sid       = "PublisherBucketDataPlane"
        Effect    = "Allow"
        Principal = "*"
        Action    = local.static_publisher_bucket_actions
        Resource  = "arn:aws:s3:::${yandex_storage_bucket.website.bucket}"
        Condition = { StringEquals = { "yc:access-key-id" = yandex_iam_service_account_static_access_key.static_publisher.access_key } }
      },
      {
        Sid       = "PublisherObjectDataPlane"
        Effect    = "Allow"
        Principal = "*"
        Action    = local.static_publisher_object_actions
        Resource  = "arn:aws:s3:::${yandex_storage_bucket.website.bucket}/*"
        Condition = { StringEquals = { "yc:access-key-id" = yandex_iam_service_account_static_access_key.static_publisher.access_key } }
      },
    ]
  })
}

resource "yandex_iam_service_account" "media" {
  folder_id   = var.folder_id
  name        = "${local.name_prefix}-media"
  description = "Backend read/write access to the private media bucket only."
}

resource "yandex_storage_bucket_iam_binding" "media_admins" {
  bucket  = yandex_storage_bucket.media.bucket
  role    = "storage.admin"
  members = ["serviceAccount:${yandex_iam_service_account.storage_manager.id}"]
}

resource "yandex_lockbox_secret" "media" {
  folder_id           = var.folder_id
  name                = "${local.name_prefix}-media-credentials"
  deletion_protection = true
}

resource "yandex_iam_service_account_static_access_key" "media" {
  service_account_id = yandex_iam_service_account.media.id
  description        = "Private media bucket runtime credentials."

  output_to_lockbox {
    secret_id            = yandex_lockbox_secret.media.id
    entry_for_access_key = "access_key_id"
    entry_for_secret_key = "secret_access_key"
  }
}

resource "yandex_storage_bucket_policy" "media_data_plane" {
  bucket     = yandex_storage_bucket.media.bucket
  access_key = yandex_iam_service_account_static_access_key.storage_manager.access_key
  secret_key = yandex_iam_service_account_static_access_key.storage_manager.secret_key
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid       = "TerraformBucketConfiguration"
        Effect    = "Allow"
        Principal = { CanonicalUser = yandex_iam_service_account.storage_manager.id }
        Action    = "s3:*"
        Resource  = "arn:aws:s3:::${yandex_storage_bucket.media.bucket}"
      },
      {
        Sid       = "ProtectBucketFromTerraformKey"
        Effect    = "Deny"
        Principal = { CanonicalUser = yandex_iam_service_account.storage_manager.id }
        Action    = local.iac_key_denied_bucket_actions
        Resource  = "arn:aws:s3:::${yandex_storage_bucket.media.bucket}"
      },
      {
        Sid       = "RuntimeBucketLocation"
        Effect    = "Allow"
        Principal = "*"
        Action    = ["s3:GetBucketLocation"]
        Resource  = "arn:aws:s3:::${yandex_storage_bucket.media.bucket}"
        Condition = { StringEquals = { "yc:access-key-id" = yandex_iam_service_account_static_access_key.media.access_key } }
      },
      {
        Sid       = "RuntimeObjectDataPlane"
        Effect    = "Allow"
        Principal = "*"
        Action    = ["s3:DeleteObject", "s3:GetObject", "s3:PutObject"]
        Resource  = "arn:aws:s3:::${yandex_storage_bucket.media.bucket}/*"
        Condition = { StringEquals = { "yc:access-key-id" = yandex_iam_service_account_static_access_key.media.access_key } }
      },
    ]
  })
}

resource "yandex_lockbox_secret_iam_member" "runtime_media" {
  secret_id = yandex_lockbox_secret.media.id
  role      = "lockbox.payloadViewer"
  member    = "serviceAccount:${yandex_iam_service_account.runtime.id}"
}
