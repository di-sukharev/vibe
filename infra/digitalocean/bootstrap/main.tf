resource "digitalocean_spaces_bucket" "terraform_state" {
  name          = var.state_bucket_name
  region        = var.spaces_region
  acl           = "private"
  force_destroy = false

  versioning {
    enabled = true
  }

  # Every init, plan, and apply creates and deletes the lock object, every apply rewrites the state
  # key, and versioning keeps each of those as a noncurrent version that Spaces stores and bills
  # forever. 30 days of history is enough to recover anything written this month; current versions
  # are never touched.
  lifecycle_rule {
    id                                     = "state-history"
    enabled                                = true
    abort_incomplete_multipart_upload_days = 7

    noncurrent_version_expiration {
      days = 30
    }
  }

  lifecycle {
    prevent_destroy = true
  }
}

resource "digitalocean_spaces_key" "terraform_state" {
  name = "${var.project_slug}-terraform-state"

  grant {
    bucket     = digitalocean_spaces_bucket.terraform_state.name
    permission = "readwrite"
  }
}
