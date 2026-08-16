locals {
  name_prefix    = "${var.project_slug}-prod"
  database_name  = replace(var.project_slug, "-", "_")
  database_owner = replace("${var.project_slug}_migration", "-", "_")
  database_credentials = {
    blue = {
      name     = replace("${var.project_slug}_app_blue", "-", "_")
      password = var.database_blue_password
      version  = var.database_blue_password_version
    }
    green = {
      name     = replace("${var.project_slug}_app_green", "-", "_")
      password = var.database_green_password
      version  = var.database_green_password_version
    }
  }
  api_origin                = "https://${var.api_domain}"
  webapp_origin             = "https://${var.webapp_domain}"
  website_origin            = "https://${var.website_domain}"
  serverless_container_cidr = "198.19.0.0/16"
}

resource "yandex_vpc_network" "production" {
  folder_id   = var.folder_id
  name        = "${local.name_prefix}-network"
  description = "Private production network managed by Terraform."
}

resource "yandex_vpc_subnet" "production" {
  for_each = var.subnets

  folder_id      = var.folder_id
  name           = "${local.name_prefix}-${each.key}"
  zone           = each.key
  network_id     = yandex_vpc_network.production.id
  v4_cidr_blocks = [each.value]
}

resource "yandex_vpc_security_group" "postgres" {
  folder_id  = var.folder_id
  name       = "${local.name_prefix}-postgres"
  network_id = yandex_vpc_network.production.id

  ingress {
    description    = "PostgreSQL pooler from Yandex Serverless Containers service subnets"
    protocol       = "TCP"
    port           = 6432
    v4_cidr_blocks = [local.serverless_container_cidr]
  }

  egress {
    description    = "Required managed service egress"
    protocol       = "ANY"
    v4_cidr_blocks = ["0.0.0.0/0"]
  }
}

resource "yandex_mdb_postgresql_cluster" "production" {
  folder_id           = var.folder_id
  name                = "${local.name_prefix}-postgres"
  environment         = "PRODUCTION"
  network_id          = yandex_vpc_network.production.id
  security_group_ids  = [yandex_vpc_security_group.postgres.id]
  deletion_protection = true

  config {
    version                   = "18"
    backup_retain_period_days = 7

    resources {
      resource_preset_id = var.postgres_resource_preset
      disk_type_id       = "network-ssd"
      disk_size          = var.postgres_disk_size_gb
    }

    disk_size_autoscaling {
      planned_usage_threshold   = 80
      emergency_usage_threshold = 95
      disk_size_limit           = var.postgres_disk_limit_gb
    }

    backup_window_start {
      hours   = 1
      minutes = 0
    }

    access {
      serverless = true
    }
  }

  host {
    zone             = var.primary_zone
    subnet_id        = yandex_vpc_subnet.production[var.primary_zone].id
    assign_public_ip = false
  }

  maintenance_window {
    type = "WEEKLY"
    day  = "SUN"
    hour = 3
  }

  lifecycle {
    prevent_destroy = true
  }
}

resource "yandex_mdb_postgresql_user" "owner" {
  cluster_id          = yandex_mdb_postgresql_cluster.production.id
  name                = local.database_owner
  password_wo         = var.database_owner_password
  password_wo_version = var.database_owner_password_version
  login               = true
  deletion_protection = true

  lifecycle {
    prevent_destroy = true
  }
}

resource "yandex_mdb_postgresql_database" "application" {
  cluster_id          = yandex_mdb_postgresql_cluster.production.id
  name                = local.database_name
  owner               = yandex_mdb_postgresql_user.owner.name
  deletion_protection = true

  lifecycle {
    prevent_destroy = true
  }
}

resource "yandex_mdb_postgresql_user" "application" {
  for_each = local.database_credentials

  cluster_id          = yandex_mdb_postgresql_cluster.production.id
  name                = each.value.name
  password_wo         = each.value.password
  password_wo_version = each.value.version
  deletion_protection = true
  grants              = ["mdb_read_all_data", "mdb_write_all_data"]

  permission {
    database_name = yandex_mdb_postgresql_database.application.name
  }

  lifecycle {
    prevent_destroy = true
  }
}

resource "yandex_container_registry" "production" {
  folder_id = var.folder_id
  name      = "${local.name_prefix}-registry"

  lifecycle {
    prevent_destroy = true
  }
}

resource "yandex_logging_group" "production" {
  folder_id        = var.folder_id
  name             = "${local.name_prefix}-containers"
  retention_period = "168h"
}

resource "yandex_iam_service_account" "runtime" {
  folder_id   = var.folder_id
  name        = "${local.name_prefix}-runtime"
  description = "Private API and task-container runtime identity."
}

resource "yandex_resourcemanager_folder_iam_member" "runtime_roles" {
  for_each = toset([
    "container-registry.images.puller",
    "logging.writer",
    "vpc.user",
  ])

  folder_id = var.folder_id
  role      = each.value
  member    = "serviceAccount:${yandex_iam_service_account.runtime.id}"
}

resource "yandex_iam_service_account" "migration" {
  folder_id   = var.folder_id
  name        = "${local.name_prefix}-migration"
  description = "One-shot database migration identity isolated from the API runtime."
}

resource "yandex_resourcemanager_folder_iam_member" "migration_roles" {
  for_each = toset([
    "container-registry.images.puller",
    "logging.writer",
    "vpc.user",
  ])

  folder_id = var.folder_id
  role      = each.value
  member    = "serviceAccount:${yandex_iam_service_account.migration.id}"
}

resource "yandex_iam_service_account" "gateway" {
  folder_id   = var.folder_id
  name        = "${local.name_prefix}-gateway"
  description = "API Gateway identity allowed to invoke only the API container."
}

resource "yandex_iam_service_account" "trigger" {
  folder_id   = var.folder_id
  name        = "${local.name_prefix}-triggers"
  description = "Timer trigger identity allowed to invoke production HTTP job containers."
}
