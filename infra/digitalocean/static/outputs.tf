output "webapp_url" { value = local.webapp_origin }
output "website_url" { value = local.website_origin }
output "webapp_app_id" { value = digitalocean_app.webapp.id }
output "website_app_id" { value = digitalocean_app.website.id }
output "release_revision" { value = var.release_revision }
output "source_branch" { value = var.source_branch }
