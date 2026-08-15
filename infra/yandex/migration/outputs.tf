output "migration_container_name" { value = yandex_serverless_container.migration.name }
output "migration_container_url" { value = yandex_serverless_container.migration.url }
output "migration_image_digest" { value = var.migration_image_digest }
