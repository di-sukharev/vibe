output "state_bucket" {
  description = "Bucket used by the bootstrap, foundation, runtime, and static state keys."
  value       = digitalocean_spaces_bucket.terraform_state.name
}

output "state_region" {
  value = var.spaces_region
}

output "state_access_key_id" {
  value = digitalocean_spaces_key.terraform_state.access_key
}

output "state_secret_access_key" {
  value     = digitalocean_spaces_key.terraform_state.secret_key
  sensitive = true
}
