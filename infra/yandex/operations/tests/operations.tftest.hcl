variables {
  owner_token    = "review-owner"
  holder_command = "true"
  ready_signal   = "/tmp/review-ready"
  release_signal = "/tmp/review-release"
  parent_pid     = 2
}

run "owner_token_replaces_the_lease_holder" {
  command = plan

  assert {
    condition     = terraform_data.production_lease.input == var.owner_token
    error_message = "The backend lock holder must be replaced for every production mutation owner."
  }
}
