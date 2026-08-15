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
    condition     = digitalocean_spaces_key.terraform_state.grant[0].permission == "readwrite"
    error_message = "The scoped backend key must be able to lock and update state."
  }
}
