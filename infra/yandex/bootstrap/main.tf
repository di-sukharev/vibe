resource "yandex_iam_service_account" "terraform_state" {
  folder_id   = var.folder_id
  name        = "${var.project_slug}-tf-state"
  description = "S3-compatible access to the private Terraform state bucket only."
}

resource "yandex_resourcemanager_folder_iam_member" "terraform_state_storage" {
  count = var.bootstrap_folder_storage_access ? 1 : 0

  folder_id = var.folder_id
  role      = "storage.admin"
  member    = "serviceAccount:${yandex_iam_service_account.terraform_state.id}"
}

resource "yandex_iam_service_account_static_access_key" "terraform_state" {
  service_account_id = yandex_iam_service_account.terraform_state.id
  description        = "Terraform S3 backend key for ${var.project_slug}."

  depends_on = [yandex_resourcemanager_folder_iam_member.terraform_state_storage]
}

resource "yandex_storage_bucket" "terraform_state" {
  bucket        = var.state_bucket_name
  folder_id     = var.folder_id
  access_key    = yandex_iam_service_account_static_access_key.terraform_state.access_key
  secret_key    = yandex_iam_service_account_static_access_key.terraform_state.secret_key
  max_size      = 1073741824
  force_destroy = false

  anonymous_access_flags {
    read        = false
    list        = false
    config_read = false
  }

  versioning {
    enabled = true
  }

  lifecycle {
    prevent_destroy = true
  }
}

resource "yandex_storage_bucket_policy" "terraform_state" {
  bucket     = yandex_storage_bucket.terraform_state.bucket
  access_key = yandex_iam_service_account_static_access_key.terraform_state.access_key
  secret_key = yandex_iam_service_account_static_access_key.terraform_state.secret_key
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid       = "TerraformStateBucketConfiguration"
        Effect    = "Allow"
        Principal = { CanonicalUser = yandex_iam_service_account.terraform_state.id }
        Action    = "s3:*"
        Resource  = "arn:aws:s3:::${yandex_storage_bucket.terraform_state.bucket}"
      },
      {
        Sid       = "ProtectStateBucket"
        Effect    = "Deny"
        Principal = { CanonicalUser = yandex_iam_service_account.terraform_state.id }
        Action    = ["s3:DeleteBucket"]
        Resource  = "arn:aws:s3:::${yandex_storage_bucket.terraform_state.bucket}"
      },
      {
        Sid       = "TerraformStateObjectDataPlane"
        Effect    = "Allow"
        Principal = { CanonicalUser = yandex_iam_service_account.terraform_state.id }
        Action    = ["s3:DeleteObject", "s3:GetObject", "s3:PutObject"]
        Resource  = "arn:aws:s3:::${yandex_storage_bucket.terraform_state.bucket}/*"
      },
    ]
  })
}
