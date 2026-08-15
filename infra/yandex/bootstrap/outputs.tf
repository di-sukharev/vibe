output "state_bucket" {
  value = yandex_storage_bucket.terraform_state.bucket
}

output "state_region" {
  value = "ru-central1"
}

output "state_service_account_id" {
  description = "Dedicated service account whose replacement keys can recover this backend."
  value       = yandex_iam_service_account.terraform_state.id
}

output "state_access_key_id" {
  value = yandex_iam_service_account_static_access_key.terraform_state.access_key
}

output "state_secret_access_key" {
  value     = yandex_iam_service_account_static_access_key.terraform_state.secret_key
  sensitive = true
}
