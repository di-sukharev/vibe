output "api_url" { value = local.api_origin }
output "api_app_id" { value = digitalocean_app.api.id }
output "runtime_image_digest" { value = var.runtime_image_digest }
