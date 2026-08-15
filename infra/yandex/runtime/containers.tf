locals {
  name_prefix = "${var.project_slug}-prod"
  api_origin  = "https://${var.api_domain}"
  job_schedules = {
    for schedule in jsondecode(file("${path.module}/../../../backend/src/job-schedules.json")) :
    schedule.key => {
      job             = schedule.job
      cron            = schedule.yandexExpression
      timeout_seconds = schedule.yandexExecutionTimeoutSeconds
    }
  }
}

resource "yandex_serverless_container" "api" {
  folder_id          = var.folder_id
  name               = "${local.name_prefix}-api"
  memory             = var.api_memory_mb
  cores              = 1
  core_fraction      = 100
  concurrency        = 1
  execution_timeout  = "30s"
  service_account_id = var.runtime_service_account

  runtime { type = "http" }
  connectivity { network_id = var.network_id }

  image {
    url         = "cr.yandex/${var.registry_id}/${var.backend_image_name}@${var.runtime_image_digest}"
    environment = var.runtime_environment
  }

  dynamic "secrets" {
    for_each = var.runtime_secret_bindings
    content {
      environment_variable = secrets.key
      id                   = secrets.value.secret_id
      version_id           = secrets.value.version_id
      key                  = secrets.value.key
    }
  }

  log_options {
    log_group_id = var.logging_group_id
    min_level    = "INFO"
  }

  metadata_options {
    gce_http_endpoint    = 2
    aws_v1_http_endpoint = 2
  }
}

resource "yandex_serverless_container" "jobs" {
  for_each = local.job_schedules

  folder_id          = var.folder_id
  name               = "${local.name_prefix}-${each.key}"
  memory             = var.task_memory_mb
  cores              = 1
  core_fraction      = 100
  concurrency        = 1
  execution_timeout  = "${each.value.timeout_seconds}s"
  service_account_id = var.runtime_service_account

  runtime { type = "http" }
  connectivity { network_id = var.network_id }

  image {
    url         = "cr.yandex/${var.registry_id}/${var.backend_image_name}@${var.runtime_image_digest}"
    command     = ["bun"]
    args        = ["src/cron.ts", "--http", each.value.job]
    environment = var.runtime_environment
  }

  dynamic "secrets" {
    for_each = var.runtime_secret_bindings
    content {
      environment_variable = secrets.key
      id                   = secrets.value.secret_id
      version_id           = secrets.value.version_id
      key                  = secrets.value.key
    }
  }

  log_options {
    log_group_id = var.logging_group_id
    min_level    = "INFO"
  }

  metadata_options {
    gce_http_endpoint    = 2
    aws_v1_http_endpoint = 2
  }
}

resource "yandex_serverless_container_iam_member" "trigger_jobs" {
  for_each = yandex_serverless_container.jobs

  container_id = each.value.id
  role         = "serverless-containers.containerInvoker"
  member       = "serviceAccount:${var.trigger_service_account}"
}

resource "yandex_function_trigger" "jobs" {
  for_each = yandex_serverless_container.jobs

  folder_id = var.folder_id
  name      = "${local.name_prefix}-${each.key}-timer"

  timer { cron_expression = local.job_schedules[each.key].cron }

  container {
    id                 = each.value.id
    service_account_id = var.trigger_service_account
    retry_attempts     = 3
    retry_interval     = 30
  }

  depends_on = [yandex_serverless_container_iam_member.trigger_jobs]
}
