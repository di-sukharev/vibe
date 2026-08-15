locals {
  runtime_environment = merge(var.extra_runtime_env, {
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
  })
}
