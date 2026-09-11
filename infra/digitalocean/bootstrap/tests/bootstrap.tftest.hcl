mock_provider "digitalocean" {}

variables {
  project_slug      = "example-product"
  spaces_region     = "fra1"
  state_bucket_name = "example-product-terraform-state-test"
}

run "private_versioned_state" {
  command = plan

  assert {
    condition     = digitalocean_spaces_bucket.terraform_state.acl == "private"
    error_message = "Terraform state must stay private."
  }

  assert {
    condition     = digitalocean_spaces_bucket.terraform_state.versioning[0].enabled
    error_message = "Terraform state must be versioned for recovery."
  }

  assert {
    condition = (
      try(digitalocean_spaces_bucket.terraform_state.lifecycle_rule[0].enabled, false) &&
      try(one(digitalocean_spaces_bucket.terraform_state.lifecycle_rule[0].noncurrent_version_expiration).days, 0) == 30
    )
    error_message = "Every init, plan, and apply writes and deletes the lock object and every apply rewrites state; versioning keeps each as a noncurrent version, so the bucket needs one enabled rule expiring them after 30 days, enough history to recover anything written this month, or the Space grows without bound."
  }

  assert {
    condition     = try(digitalocean_spaces_bucket.terraform_state.lifecycle_rule[0].abort_incomplete_multipart_upload_days, 0) == 7
    error_message = "An interrupted multipart state write must be aborted instead of being billed forever."
  }

  assert {
    condition     = try(digitalocean_spaces_bucket.terraform_state.lifecycle_rule[1].enabled, null) == null
    error_message = "The state bucket keeps exactly one lifecycle rule; a second one is where an expiration of current versions would hide."
  }

  assert {
    condition     = try(length(digitalocean_spaces_bucket.terraform_state.lifecycle_rule[0].expiration), 0) == 0
    error_message = "The lifecycle rule must leave current state versions alone."
  }

  assert {
    condition     = digitalocean_spaces_key.terraform_state.grant[0].permission == "readwrite"
    error_message = "The scoped backend key must be able to lock and update state."
  }
}
