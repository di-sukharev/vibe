locals {
  job_keys = [
    for schedule in jsondecode(file("${path.module}/../../../backend/src/job-schedules.json")) :
    schedule.key
  ]
  runtime_components  = concat(["api"], local.job_keys)
  runtime_env_targets = concat(["api", "jobs"], local.job_keys)

  builtin_runtime_environment = {
    NODE_ENV                                   = "production"
    CORS_ORIGINS                               = local.webapp_origin
    WEBAPP_ORIGIN                              = local.webapp_origin
    ACCESS_TOKEN_TTL_SECONDS                   = "900"
    REFRESH_TOKEN_TTL_DAYS                     = "30"
    REFRESH_REUSE_GRACE_SECONDS                = "10"
    SESSION_ABSOLUTE_TTL_DAYS                  = "90"
    SESSION_RETENTION_DAYS                     = "7"
    AUTH_BODY_LIMIT_BYTES                      = "65536"
    AUTH_RATE_LIMIT_MAX                        = "60"
    AUTH_RATE_LIMIT_WINDOW_SECONDS             = "60"
    ADMIN_USERS_READ_RATE_LIMIT_MAX            = "120"
    ADMIN_USERS_READ_RATE_LIMIT_WINDOW_SECONDS = "60"
    RATE_LIMIT_STORE                           = "database"
    SHUTDOWN_GRACE_SECONDS                     = "20"
    TRUST_PROXY                                = "true"
    TRUSTED_PROXY_CLIENT_IP_HEADER             = "x-forwarded-for"
    TRUSTED_PROXY_CLIENT_IP_POSITION           = "last"
    COOKIE_SECURE                              = "true"
    PRIVATE_STORAGE_DRIVER                     = "s3"
    PRIVATE_STORAGE_REGION                     = "ru-central1"
    PRIVATE_STORAGE_BUCKET                     = yandex_storage_bucket.media.bucket
    PRIVATE_STORAGE_ENDPOINT                   = "https://storage.yandexcloud.net"
    PRIVATE_STORAGE_ALLOW_REMOTE_ENDPOINT      = "true"
    EMAIL_DELIVERY                             = var.email_delivery
    EMAIL_FROM                                 = var.email_from == null ? "" : var.email_from
    EMAIL_POSTBOX_REGION                       = "ru-central1"
  }

  # The mobile env groups default to the components that read them, so an operator who sets them
  # without extra_env_components does not hand them to every runner. Only the API verifies App
  # Store purchases and webhooks; Google Play is verified by the API and reconciled by the
  # `maintenance` job; only the `notifications` job sends pushes, while the API just queues them.
  # A group keeps one target set because backend/src/env.ts refuses a partial group. An entry in
  # extra_env_components replaces the default for that variable.
  mobile_env_components = merge(
    {
      for name in [
        "APPLE_IAP_BUNDLE_ID",
        "APPLE_IAP_APP_APPLE_ID",
        "APPLE_IAP_ENVIRONMENT",
        "APPLE_IAP_ISSUER_ID",
        "APPLE_IAP_KEY_ID",
        "APPLE_IAP_PRIVATE_KEY_BASE64",
        "APPLE_IAP_ROOT_CERTS_DIR",
        "APPLE_IAP_PRODUCT_IDS",
      ] : name => toset(["api"])
    },
    {
      for name in [
        "GOOGLE_PLAY_PACKAGE_NAME",
        "GOOGLE_PLAY_SERVICE_ACCOUNT_JSON_BASE64",
        "GOOGLE_PLAY_PRODUCT_IDS",
        "GOOGLE_PLAY_BASE_PLAN_IDS",
      ] : name => toset(["api", "maintenance"])
    },
    { EXPO_PUSH_ACCESS_TOKEN = toset(["notifications"]) },
  )
  extra_env_components = merge(local.mobile_env_components, var.extra_env_components)

  # Any other extra variable reaches every component unless extra_env_components scopes it. Each job runs
  # in its own container, so a job target reaches only that job.
  extra_env_receivers = {
    for name, targets in local.extra_env_components : name => toset([
      for component in local.runtime_components : component
      if contains(targets, component) || (component != "api" && contains(targets, "jobs"))
    ])
  }

  component_environments = {
    for component in local.runtime_components : component => merge(
      {
        for name, value in var.extra_runtime_env : name => value
        if contains(lookup(local.extra_env_receivers, name, toset(local.runtime_components)), component)
      },
      local.builtin_runtime_environment,
    )
  }
}
