import { z } from 'zod'

import { isUsableEmailAddress } from './email/address'

const booleanStringSchema = z
  .enum(['true', 'false'])
  .default('false')
  .transform((value) => value === 'true')

const optionalBooleanStringSchema = z.preprocess(
  (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
  z.enum(['true', 'false']).optional(),
).transform((value) => value === 'true')

const knownWeakJwtSecrets = new Set(['replace-with-at-least-32-random-characters'])

const optionalStringSchema = z.preprocess((value) => {
  if (typeof value !== 'string') return value
  const trimmed = value.trim()
  return trimmed === '' ? undefined : trimmed
}, z.string().min(1).optional())

const optionalUrlSchema = z.preprocess((value) => {
  if (typeof value !== 'string') return value
  const trimmed = value.trim()
  return trimmed === '' ? undefined : trimmed
}, z.string().url().optional())

const optionalPositiveIntegerSchema = z.preprocess((value) => {
  if (typeof value !== 'string') return value
  const trimmed = value.trim()
  return trimmed === '' ? undefined : trimmed
}, z.coerce.number().int().positive().optional())

const commaSeparatedStringArraySchema = z
  .string()
  .optional()
  .default('')
  .transform((value) =>
    value
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean),
  )

const optionalHttpHeaderNameSchema = z.preprocess((value) => {
  if (typeof value !== 'string') return value
  const trimmed = value.trim()
  return trimmed === '' ? undefined : trimmed.toLowerCase()
}, z.string().regex(/^[a-z0-9!#$%&'*+.^_`|~-]+$/).optional())

const stringWithDefault = (defaultValue: string) =>
  z.preprocess((value) => {
    if (typeof value !== 'string') return value
    const trimmed = value.trim()
    return trimmed === '' ? undefined : trimmed
  }, z.string().min(1).default(defaultValue))

const envSchema = z.object({
  NODE_ENV: z.string().optional(),
  PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_URL: z.string().min(1),
  JWT_SECRET: z.string().min(32),
  CORS_ORIGINS: z
    .string()
    .default('http://localhost:5173,http://localhost:8081,http://localhost:19006')
    .transform((value) =>
      value
        .split(',')
        .map((origin) => origin.trim())
        .filter(Boolean),
    ),
  WEBAPP_ORIGIN: optionalUrlSchema,
  ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().int().positive().default(15 * 60),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().positive().default(30),
  REFRESH_REUSE_GRACE_SECONDS: z.coerce.number().int().nonnegative().max(60).default(10),
  SESSION_ABSOLUTE_TTL_DAYS: z.coerce.number().int().positive().default(90),
  SESSION_RETENTION_DAYS: z.coerce.number().int().nonnegative().default(7),
  AUTH_BODY_LIMIT_BYTES: z.coerce.number().int().positive().max(1024 * 1024).default(64 * 1024),
  INGRESS_RATE_LIMIT_PROVIDER: z.enum(['local', 'yandex-sws']).default('local'),
  AUTH_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(60),
  AUTH_RATE_LIMIT_WINDOW_SECONDS: z.coerce.number().int().positive().default(60),
  ADMIN_USERS_READ_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(120),
  ADMIN_USERS_READ_RATE_LIMIT_WINDOW_SECONDS: z.coerce.number().int().positive().default(60),
  IAP_BODY_LIMIT_BYTES: z.coerce.number().int().positive().max(1024 * 1024).default(64 * 1024),
  IAP_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(60),
  IAP_RATE_LIMIT_WINDOW_SECONDS: z.coerce.number().int().positive().default(60),
  WEBHOOK_BODY_LIMIT_BYTES: optionalPositiveIntegerSchema,
  WEBHOOK_RATE_LIMIT_MAX: optionalPositiveIntegerSchema,
  WEBHOOK_RATE_LIMIT_WINDOW_SECONDS: optionalPositiveIntegerSchema,
  SHUTDOWN_GRACE_SECONDS: z.coerce.number().int().positive().max(60).default(20),
  // Which email adapter createEmailDelivery builds. 'console' prints the message instead of
  // sending it, so password reset can be followed locally; production refuses it below.
  // The provider drivers are configured by the EMAIL_* group under validateEmailEnv.
  EMAIL_DELIVERY: z.enum(['disabled', 'console', 'postbox', 'resend']).default('disabled'),
  EMAIL_FROM: optionalStringSchema,
  EMAIL_REPLY_TO: optionalStringSchema,
  // Capped below the outbox's own per-attempt deadline (`defaultTaskDeadlineMs`, 15s), so a
  // raised value cannot be wholly inert. It is a ceiling, not a guarantee: the deadline covers the
  // account lookup and the token write as well as the send, so at the very top of this range the
  // drain can still abort first and report its own timeout instead of the provider's.
  // `config.test.ts` pins the ceiling against the deadline.
  EMAIL_REQUEST_TIMEOUT_MS: z.coerce.number().int().positive().max(14_000).default(10_000),
  EMAIL_POSTBOX_ENDPOINT: stringWithDefault('https://postbox.cloud.yandex.net'),
  EMAIL_POSTBOX_REGION: stringWithDefault('ru-central1'),
  EMAIL_POSTBOX_ACCESS_KEY_ID: optionalStringSchema,
  EMAIL_POSTBOX_SECRET_ACCESS_KEY: optionalStringSchema,
  EMAIL_POSTBOX_CONFIGURATION_SET: optionalStringSchema,
  EMAIL_RESEND_ENDPOINT: stringWithDefault('https://api.resend.com'),
  EMAIL_RESEND_API_KEY: optionalStringSchema,
  // Task outbox. Defaults suit a drain running once a minute; see docs/BACKGROUND_JOBS.md.
  TASK_OUTBOX_BATCH_LIMIT: z.coerce.number().int().positive().max(1000).default(50),
  TASK_OUTBOX_MAX_RUNTIME_MS: z.coerce.number().int().positive().max(600_000).default(55_000),
  TASK_OUTBOX_LEASE_STALE_MS: z.coerce.number().int().positive().max(3_600_000).default(120_000),
  TASK_OUTBOX_RETENTION_DAYS: z.coerce.number().int().positive().max(365).default(30),
  TRUST_PROXY: booleanStringSchema,
  TRUSTED_PROXY_CLIENT_IP_HEADER: optionalHttpHeaderNameSchema,
  TRUSTED_PROXY_CLIENT_IP_POSITION: z.enum(['first', 'last']).optional(),
  COOKIE_SECURE: booleanStringSchema,
  PRIVATE_STORAGE_DRIVER: z.enum(['filesystem', 's3']).default('filesystem'),
  PRIVATE_STORAGE_LOCAL_ROOT: stringWithDefault('.storage'),
  PRIVATE_STORAGE_LOCAL_PUBLIC_URL: optionalUrlSchema,
  PRIVATE_STORAGE_REGION: optionalStringSchema,
  PRIVATE_STORAGE_BUCKET: optionalStringSchema,
  PRIVATE_STORAGE_ENDPOINT: optionalUrlSchema,
  PRIVATE_STORAGE_ACCESS_KEY_ID: optionalStringSchema,
  PRIVATE_STORAGE_SECRET_ACCESS_KEY: optionalStringSchema,
  PRIVATE_STORAGE_FORCE_PATH_STYLE: booleanStringSchema,
  PRIVATE_STORAGE_ALLOW_REMOTE_ENDPOINT: booleanStringSchema,
  PRIVATE_STORAGE_UPLOAD_MAX_BYTES: z.coerce.number().int().positive().default(5 * 1024 * 1024),
  PRIVATE_STORAGE_UPLOAD_URL_TTL_SECONDS: z.coerce.number().int().positive().max(7 * 24 * 60 * 60).default(15 * 60),
  PRIVATE_STORAGE_DOWNLOAD_URL_TTL_SECONDS: z.coerce.number().int().positive().max(7 * 24 * 60 * 60).default(5 * 60),
  APPLE_IAP_BUNDLE_ID: optionalStringSchema,
  APPLE_IAP_APP_APPLE_ID: optionalPositiveIntegerSchema,
  APPLE_IAP_ENVIRONMENT: z.enum(['Sandbox', 'Production']).default('Sandbox'),
  APPLE_IAP_ISSUER_ID: optionalStringSchema,
  APPLE_IAP_KEY_ID: optionalStringSchema,
  APPLE_IAP_PRIVATE_KEY_BASE64: optionalStringSchema,
  APPLE_IAP_ROOT_CERTS_DIR: optionalStringSchema,
  APPLE_IAP_PRODUCT_IDS: commaSeparatedStringArraySchema,
  GOOGLE_PLAY_PACKAGE_NAME: optionalStringSchema,
  GOOGLE_PLAY_SERVICE_ACCOUNT_JSON_BASE64: optionalStringSchema,
  GOOGLE_PLAY_PRODUCT_IDS: commaSeparatedStringArraySchema,
  GOOGLE_PLAY_BASE_PLAN_IDS: commaSeparatedStringArraySchema,
  APPLE_AUTH_BUNDLE_ID: optionalStringSchema,
  APPLE_AUTH_JWKS_TIMEOUT_MS: z.coerce.number().int().positive().default(5_000),
  GOOGLE_AUTH_CLIENT_IDS: z
    .string()
    .optional()
    .default('')
    .transform((value) =>
      value
        .split(',')
        .map((clientId) => clientId.trim())
        .filter(Boolean),
    ),
  EXPO_PUSH_ACCESS_TOKEN: optionalStringSchema,
  ENABLE_TEST_PUSH: optionalBooleanStringSchema,
  PUSH_TOKEN_MAX_PER_USER: optionalPositiveIntegerSchema,
  PUSH_OUTBOX_PROCESS_LIMIT: optionalPositiveIntegerSchema,
  PUSH_OUTBOX_PROCESS_MAX_LOOPS: optionalPositiveIntegerSchema,
  PUSH_OUTBOX_PROCESS_MAX_RUNTIME_MS: optionalPositiveIntegerSchema,
  PUSH_OUTBOX_PROCESSING_STALE_MS: optionalPositiveIntegerSchema,
  PUSH_RECEIPT_CHECK_LIMIT: optionalPositiveIntegerSchema,
}).superRefine((env, ctx) => {
  validateJwtSecret(env, ctx)
  validateProductionRuntime(env, ctx)
  validateCorsOrigins(env, ctx)
  validateWebappOrigin(env, ctx)
  validateSessionTtls(env, ctx)
  validateTrustedProxy(env, ctx)
  validateIngressRateLimitProvider(env, ctx)
  validatePrivateStorageEnv(env, ctx)
  validateAppleIapEnv(env, ctx)
  validateGooglePlayIapEnv(env, ctx)
  validateEmailEnv(env, ctx)
})

export type AppEnv = z.infer<typeof envSchema>

export function loadEnv(source: Record<string, string | undefined>) {
  return envSchema.parse(source)
}

const backgroundNonSigningJwtPlaceholder = '0123456789abcdef'.repeat(4)

export function loadBackgroundEnv(source: Record<string, string | undefined>) {
  return loadEnv({
    ...source,
    CORS_ORIGINS: 'https://background.invalid',
    COOKIE_SECURE: 'true',
    JWT_SECRET: backgroundNonSigningJwtPlaceholder,
  })
}

function validateWebappOrigin(env: z.infer<typeof envSchema>, ctx: z.RefinementCtx) {
  if (!env.WEBAPP_ORIGIN) return

  const url = new URL(env.WEBAPP_ORIGIN)
  if (!['http:', 'https:'].includes(url.protocol)) {
    ctx.addIssue({
      code: 'custom',
      path: ['WEBAPP_ORIGIN'],
      message: 'WEBAPP_ORIGIN must use http or https',
    })
  }
  if (url.origin !== env.WEBAPP_ORIGIN) {
    ctx.addIssue({
      code: 'custom',
      path: ['WEBAPP_ORIGIN'],
      message: 'WEBAPP_ORIGIN must contain an origin only, not a path',
    })
  }
  if ((env.COOKIE_SECURE || env.NODE_ENV === 'production') && url.protocol !== 'https:') {
    ctx.addIssue({
      code: 'custom',
      path: ['WEBAPP_ORIGIN'],
      message: 'WEBAPP_ORIGIN must use HTTPS in production',
    })
  }
}

function validateSessionTtls(env: z.infer<typeof envSchema>, ctx: z.RefinementCtx) {
  if (env.SESSION_ABSOLUTE_TTL_DAYS < env.REFRESH_TOKEN_TTL_DAYS) {
    ctx.addIssue({
      code: 'custom',
      path: ['SESSION_ABSOLUTE_TTL_DAYS'],
      message: 'SESSION_ABSOLUTE_TTL_DAYS must be at least REFRESH_TOKEN_TTL_DAYS',
    })
  }
}

function validateTrustedProxy(env: z.infer<typeof envSchema>, ctx: z.RefinementCtx) {
  if (env.TRUST_PROXY && !env.TRUSTED_PROXY_CLIENT_IP_HEADER) {
    ctx.addIssue({
      code: 'custom',
      path: ['TRUSTED_PROXY_CLIENT_IP_HEADER'],
      message: 'TRUSTED_PROXY_CLIENT_IP_HEADER is required when TRUST_PROXY=true',
    })
  }

  if (env.TRUSTED_PROXY_CLIENT_IP_POSITION && !env.TRUSTED_PROXY_CLIENT_IP_HEADER) {
    ctx.addIssue({
      code: 'custom',
      path: ['TRUSTED_PROXY_CLIENT_IP_POSITION'],
      message: 'TRUSTED_PROXY_CLIENT_IP_POSITION requires TRUSTED_PROXY_CLIENT_IP_HEADER',
    })
  }
}

function validateIngressRateLimitProvider(
  env: z.infer<typeof envSchema>,
  ctx: z.RefinementCtx,
) {
  if (env.INGRESS_RATE_LIMIT_PROVIDER !== 'yandex-sws') return

  const hasYandexProxyContract =
    env.TRUST_PROXY &&
    env.TRUSTED_PROXY_CLIENT_IP_HEADER === 'x-forwarded-for' &&
    env.TRUSTED_PROXY_CLIENT_IP_POSITION === 'last'
  if (hasYandexProxyContract) return

  ctx.addIssue({
    code: 'custom',
    path: ['INGRESS_RATE_LIMIT_PROVIDER'],
    message:
      'INGRESS_RATE_LIMIT_PROVIDER=yandex-sws requires TRUST_PROXY=true, ' +
      'TRUSTED_PROXY_CLIENT_IP_HEADER=x-forwarded-for, and ' +
      'TRUSTED_PROXY_CLIENT_IP_POSITION=last',
  })
}

function validateJwtSecret(env: z.infer<typeof envSchema>, ctx: z.RefinementCtx) {
  if (!isProductionLikeRuntime(env)) return

  const invalidProductionFormat = !/^[a-fA-F0-9]{64,}$/.test(env.JWT_SECRET)
  if (isWeakJwtSecret(env.JWT_SECRET) || invalidProductionFormat) {
    ctx.addIssue({
      code: 'custom',
      path: ['JWT_SECRET'],
      message: 'JWT_SECRET must be a non-placeholder random secret in production',
    })
  }
}

function validateProductionRuntime(env: z.infer<typeof envSchema>, ctx: z.RefinementCtx) {
  if (env.NODE_ENV !== 'production') return

  if (!env.COOKIE_SECURE) {
    ctx.addIssue({
      code: 'custom',
      path: ['COOKIE_SECURE'],
      message: 'COOKIE_SECURE must be true in production',
    })
  }

  // Deliberately gated on NODE_ENV rather than isProductionLikeRuntime: a background runner sets
  // COOKIE_SECURE=true because it has no browser to serve, which would make every local scheduler
  // refuse the console sink and take the one way of following a reset link locally with it.
  if (env.EMAIL_DELIVERY === 'console') {
    ctx.addIssue({
      code: 'custom',
      path: ['EMAIL_DELIVERY'],
      // Reported as configured, so password reset would create tokens and queue tasks whose
      // "delivery" is a log line nobody reads while the user waits for mail.
      message: 'EMAIL_DELIVERY=console prints emails instead of sending them and is refused in production',
    })
  }
}

function isProductionLikeRuntime(env: z.infer<typeof envSchema>) {
  return env.NODE_ENV === 'production' || env.COOKIE_SECURE
}

function isWeakJwtSecret(secret: string) {
  const normalized = secret.trim().toLowerCase()
  return (
    normalized.length === 0 ||
    knownWeakJwtSecrets.has(normalized) ||
    new Set(normalized).size === 1
  )
}

function validateCorsOrigins(env: z.infer<typeof envSchema>, ctx: z.RefinementCtx) {
  if (env.CORS_ORIGINS.length === 0) {
    ctx.addIssue({
      code: 'custom',
      path: ['CORS_ORIGINS'],
      message: 'CORS_ORIGINS must contain at least one allowed browser origin',
    })
    return
  }

  for (const origin of env.CORS_ORIGINS) {
    if (origin === '*') {
      ctx.addIssue({
        code: 'custom',
        path: ['CORS_ORIGINS'],
        message: 'CORS_ORIGINS must not use wildcard origins when credentials are enabled',
      })
      continue
    }

    let url: URL
    try {
      url = new URL(origin)
    } catch {
      ctx.addIssue({
        code: 'custom',
        path: ['CORS_ORIGINS'],
        message: `CORS_ORIGINS contains an invalid URL: ${origin}`,
      })
      continue
    }

    if (!['http:', 'https:'].includes(url.protocol)) {
      ctx.addIssue({
        code: 'custom',
        path: ['CORS_ORIGINS'],
        message: `CORS_ORIGINS must use http or https origins: ${origin}`,
      })
    }

    if (url.origin !== origin) {
      ctx.addIssue({
        code: 'custom',
        path: ['CORS_ORIGINS'],
        message: `CORS_ORIGINS must contain origins only, not paths: ${origin}`,
      })
    }

    if ((env.COOKIE_SECURE || env.NODE_ENV === 'production') && url.protocol !== 'https:') {
      ctx.addIssue({
        code: 'custom',
        path: ['CORS_ORIGINS'],
        message: `CORS_ORIGINS must use HTTPS when COOKIE_SECURE=true: ${origin}`,
      })
    }
  }
}

/**
 * Credential-shaped keys that only mean something under one driver. Listed per driver so a key
 * set under the wrong one is refused rather than silently ignored, the same rule the storage
 * group applies to `s3StorageKeys`.
 */
export const emailProviderKeys = {
  postbox: [
    'EMAIL_POSTBOX_ACCESS_KEY_ID',
    'EMAIL_POSTBOX_SECRET_ACCESS_KEY',
    'EMAIL_POSTBOX_CONFIGURATION_SET',
  ],
  resend: ['EMAIL_RESEND_API_KEY'],
} as const satisfies Record<'postbox' | 'resend', readonly string[]>

/** The subset of the above that a driver cannot start without. */
const requiredEmailProviderKeys = {
  postbox: ['EMAIL_POSTBOX_ACCESS_KEY_ID', 'EMAIL_POSTBOX_SECRET_ACCESS_KEY'],
  resend: ['EMAIL_RESEND_API_KEY'],
} as const satisfies Record<'postbox' | 'resend', readonly string[]>

/**
 * Email is either off or fully configured; there is no half-wired state that fails at the first
 * password reset instead of at startup.
 *
 * `EMAIL_FROM`, `EMAIL_REPLY_TO` and `EMAIL_REQUEST_TIMEOUT_MS` are shared and inert, so they are
 * allowed under any driver: forbidding them would make flipping `EMAIL_DELIVERY` between
 * `console` and a provider a multi-line edit for no safety gain. The credential-shaped keys are
 * the opposite, and setting one under the wrong driver is an error.
 */
function validateEmailEnv(env: z.infer<typeof envSchema>, ctx: z.RefinementCtx) {
  const driver = env.EMAIL_DELIVERY
  const sending = driver === 'postbox' || driver === 'resend'

  for (const [owner, keys] of Object.entries(emailProviderKeys)) {
    if (owner === driver) continue

    for (const key of keys) {
      if (env[key as keyof typeof env] !== undefined) {
        ctx.addIssue({
          code: 'custom',
          path: [key],
          message: `${key} is set but EMAIL_DELIVERY is ${driver}, so it would be ignored`,
        })
      }
    }
  }

  if (!sending) return

  for (const key of requiredEmailProviderKeys[driver]) {
    if (env[key as keyof typeof env] === undefined) {
      ctx.addIssue({
        code: 'custom',
        path: [key],
        message: `${key} is required when EMAIL_DELIVERY is ${driver}`,
      })
    }
  }

  if (env.EMAIL_FROM === undefined) {
    ctx.addIssue({
      code: 'custom',
      path: ['EMAIL_FROM'],
      message: `EMAIL_FROM is required when EMAIL_DELIVERY is ${driver}`,
    })
  }

  for (const key of ['EMAIL_FROM', 'EMAIL_REPLY_TO'] as const) {
    const value = env[key]
    if (value !== undefined && !isUsableEmailAddress(value)) {
      ctx.addIssue({
        code: 'custom',
        path: [key],
        message: `${key} must be "addr@example.com" or "Display Name <addr@example.com>"`,
      })
    }
  }

  // The endpoint is parsed with `new URL` while the driver is being built, inside
  // `createBackendRuntime`. A scheme-less value - the form a console copy-paste produces - would
  // otherwise crash every entrypoint at boot with a TypeError naming no variable at all.
  const endpointKey = driver === 'postbox' ? 'EMAIL_POSTBOX_ENDPOINT' : 'EMAIL_RESEND_ENDPOINT'
  const endpoint = env[endpointKey].replace(/\/+$/, '')
  let endpointUrl: URL | null = null
  try {
    endpointUrl = new URL(endpoint)
  } catch {
    ctx.addIssue({
      code: 'custom',
      path: [endpointKey],
      message: `${endpointKey} must be a valid URL, including the scheme`,
    })
  }

  if (endpointUrl && !['http:', 'https:'].includes(endpointUrl.protocol)) {
    ctx.addIssue({
      code: 'custom',
      path: [endpointKey],
      message: `${endpointKey} must use http or https`,
    })
  } else if (endpointUrl && endpointUrl.origin !== endpoint) {
    // The drivers append their own path, so a value carrying one would produce a URL neither the
    // provider nor the signature agrees with.
    ctx.addIssue({
      code: 'custom',
      path: [endpointKey],
      message: `${endpointKey} must contain an origin only, not a path or query`,
    })
  }

  // Without it the reset link is built from CORS_ORIGINS[0], which is not necessarily the browser
  // app - and in a background process on a branch that overrides CORS_ORIGINS it is not an app at
  // all. A link pointing at the wrong origin is a broken email, so refuse to start instead.
  if (env.WEBAPP_ORIGIN === undefined) {
    ctx.addIssue({
      code: 'custom',
      path: ['WEBAPP_ORIGIN'],
      message: `WEBAPP_ORIGIN is required when EMAIL_DELIVERY is ${driver}, because it builds the links inside the emails`,
    })
  }
}

const s3StorageKeys = [
  'PRIVATE_STORAGE_REGION',
  'PRIVATE_STORAGE_BUCKET',
  'PRIVATE_STORAGE_ENDPOINT',
  'PRIVATE_STORAGE_ACCESS_KEY_ID',
  'PRIVATE_STORAGE_SECRET_ACCESS_KEY',
] as const

const loopbackStorageHosts = new Set(['localhost', '127.0.0.1', '::1', '[::1]'])

export function isLoopbackStorageEndpoint(endpoint: string) {
  try {
    return loopbackStorageHosts.has(new URL(endpoint).hostname)
  } catch {
    return false
  }
}

/**
 * The storage driver is the one switch that decides whether uploads touch the local disk or a
 * real S3 bucket, so every way of getting it half-configured fails at startup rather than at the
 * first upload. Two rules carry most of the weight: production refuses the filesystem driver
 * outright, because a container filesystem does not survive a redeploy, and a non-loopback
 * endpoint outside production needs a deliberate opt-in so a stray `.env` cannot point a
 * development machine at someone's real bucket.
 */
function validatePrivateStorageEnv(env: z.infer<typeof envSchema>, ctx: z.RefinementCtx) {
  const isProduction = env.NODE_ENV === 'production'

  if (env.PRIVATE_STORAGE_DRIVER === 'filesystem') {
    if (isProduction) {
      ctx.addIssue({
        code: 'custom',
        path: ['PRIVATE_STORAGE_DRIVER'],
        message:
          'PRIVATE_STORAGE_DRIVER must be s3 in production; a container filesystem does not survive a redeploy',
      })
    }

    for (const key of s3StorageKeys) {
      if (env[key] !== undefined) {
        ctx.addIssue({
          code: 'custom',
          path: [key],
          message: `${key} is set but PRIVATE_STORAGE_DRIVER is filesystem, so it would be ignored`,
        })
      }
    }

    return
  }

  for (const key of s3StorageKeys) {
    if (env[key] === undefined) {
      ctx.addIssue({
        code: 'custom',
        path: [key],
        message: `${key} is required when PRIVATE_STORAGE_DRIVER is s3`,
      })
    }
  }

  const endpoint = env.PRIVATE_STORAGE_ENDPOINT
  if (endpoint === undefined) return

  let url: URL
  try {
    url = new URL(endpoint)
  } catch {
    ctx.addIssue({
      code: 'custom',
      path: ['PRIVATE_STORAGE_ENDPOINT'],
      message: 'PRIVATE_STORAGE_ENDPOINT must be a valid URL',
    })
    return
  }

  if (!['http:', 'https:'].includes(url.protocol)) {
    ctx.addIssue({
      code: 'custom',
      path: ['PRIVATE_STORAGE_ENDPOINT'],
      message: 'PRIVATE_STORAGE_ENDPOINT must use http or https',
    })
    return
  }

  if (url.origin !== endpoint.replace(/\/+$/, '')) {
    ctx.addIssue({
      code: 'custom',
      path: ['PRIVATE_STORAGE_ENDPOINT'],
      message: 'PRIVATE_STORAGE_ENDPOINT must contain an origin only, not a path or query',
    })
  }

  const loopback = loopbackStorageHosts.has(url.hostname)

  if (isProduction && loopback) {
    ctx.addIssue({
      code: 'custom',
      path: ['PRIVATE_STORAGE_ENDPOINT'],
      message: 'PRIVATE_STORAGE_ENDPOINT must not be a loopback address in production',
    })
  }

  if (isProduction && url.protocol !== 'https:') {
    ctx.addIssue({
      code: 'custom',
      path: ['PRIVATE_STORAGE_ENDPOINT'],
      message: 'PRIVATE_STORAGE_ENDPOINT must use https in production',
    })
  }

  // The gate applies wherever the endpoint is remote, production included. Outside production it
  // stops a stray `.env` from pointing a development machine at a real bucket; in production it
  // is the deliberate step that opens storage, so a deploy cannot reach someone else's bucket by
  // inheriting a variable. Exempting production would leave the flag inert exactly where the
  // consequences are worst.
  if (!loopback && !env.PRIVATE_STORAGE_ALLOW_REMOTE_ENDPOINT) {
    ctx.addIssue({
      code: 'custom',
      path: ['PRIVATE_STORAGE_ENDPOINT'],
      message:
        'PRIVATE_STORAGE_ENDPOINT points at a remote bucket; set PRIVATE_STORAGE_ALLOW_REMOTE_ENDPOINT=true to allow it deliberately',
    })
  }

  if (loopback && !env.PRIVATE_STORAGE_FORCE_PATH_STYLE) {
    ctx.addIssue({
      code: 'custom',
      path: ['PRIVATE_STORAGE_FORCE_PATH_STYLE'],
      message:
        'PRIVATE_STORAGE_FORCE_PATH_STYLE must be true for a local S3 endpoint, which cannot resolve bucket subdomains',
    })
  }
}

function validateAppleIapEnv(env: z.infer<typeof envSchema>, ctx: z.RefinementCtx) {
  const configuredKeys = [
    'APPLE_IAP_BUNDLE_ID',
    'APPLE_IAP_ISSUER_ID',
    'APPLE_IAP_KEY_ID',
    'APPLE_IAP_PRIVATE_KEY_BASE64',
  ] as const
  const isConfigured = configuredKeys.some((key) => env[key] !== undefined)

  if (!isConfigured) return

  for (const key of configuredKeys) {
    if (env[key] === undefined) {
      ctx.addIssue({
        code: 'custom',
        path: [key],
        message: `${key} is required when App Store IAP verification is configured`,
      })
    }
  }

  if (env.APPLE_IAP_PRODUCT_IDS.length === 0) {
    ctx.addIssue({
      code: 'custom',
      path: ['APPLE_IAP_PRODUCT_IDS'],
      message: 'APPLE_IAP_PRODUCT_IDS must list every App Store subscription product ID when App Store IAP verification is configured',
    })
  }

  if (env.APPLE_IAP_ENVIRONMENT === 'Production' && env.APPLE_IAP_APP_APPLE_ID === undefined) {
    ctx.addIssue({
      code: 'custom',
      path: ['APPLE_IAP_APP_APPLE_ID'],
      message: 'APPLE_IAP_APP_APPLE_ID is required for production App Store verification',
    })
  }
}

function validateGooglePlayIapEnv(env: z.infer<typeof envSchema>, ctx: z.RefinementCtx) {
  const configuredKeys = [
    'GOOGLE_PLAY_PACKAGE_NAME',
    'GOOGLE_PLAY_SERVICE_ACCOUNT_JSON_BASE64',
  ] as const
  const isConfigured = configuredKeys.some((key) => env[key] !== undefined)

  if (!isConfigured) return

  for (const key of configuredKeys) {
    if (env[key] === undefined) {
      ctx.addIssue({
        code: 'custom',
        path: [key],
        message: `${key} is required when Google Play IAP verification is configured`,
      })
    }
  }

  if (env.GOOGLE_PLAY_PRODUCT_IDS.length === 0) {
    ctx.addIssue({
      code: 'custom',
      path: ['GOOGLE_PLAY_PRODUCT_IDS'],
      message: 'GOOGLE_PLAY_PRODUCT_IDS must list every Google Play subscription product ID when Google Play IAP verification is configured',
    })
  }

  if (env.GOOGLE_PLAY_BASE_PLAN_IDS.length === 0) {
    ctx.addIssue({
      code: 'custom',
      path: ['GOOGLE_PLAY_BASE_PLAN_IDS'],
      message: 'GOOGLE_PLAY_BASE_PLAN_IDS must list every accepted Google Play subscription base plan ID when Google Play IAP verification is configured',
    })
  }
}
