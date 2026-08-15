resource "digitalocean_spaces_bucket" "terraform_state" {
  name          = var.state_bucket_name
  region        = var.spaces_region
  acl           = "private"
  force_destroy = false

  versioning {
    enabled = true
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
