import { z } from 'zod'

const booleanStringSchema = z
  .enum(['true', 'false'])
  .default('false')
  .transform((value) => value === 'true')

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
  ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().int().positive().default(15 * 60),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().positive().default(30),
  COOKIE_SECURE: booleanStringSchema,
  SPACES_REGION: optionalStringSchema,
  SPACES_BUCKET: optionalStringSchema,
  SPACES_ENDPOINT: optionalUrlSchema,
  SPACES_CDN_BASE_URL: optionalUrlSchema,
  SPACES_ACCESS_KEY_ID: optionalStringSchema,
  SPACES_SECRET_ACCESS_KEY: optionalStringSchema,
  SPACES_UPLOAD_MAX_BYTES: z.coerce.number().int().positive().default(10 * 1024 * 1024),
  SPACES_UPLOAD_URL_TTL_SECONDS: z.coerce.number().int().positive().max(7 * 24 * 60 * 60).default(15 * 60),
  SPACES_DOWNLOAD_URL_TTL_SECONDS: z.coerce.number().int().positive().max(7 * 24 * 60 * 60).default(5 * 60),
  SPACES_PUBLIC_CACHE_CONTROL: stringWithDefault('public, max-age=31536000, immutable'),
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
  PUSH_OUTBOX_PROCESS_LIMIT: optionalPositiveIntegerSchema,
  PUSH_OUTBOX_PROCESS_MAX_LOOPS: optionalPositiveIntegerSchema,
  PUSH_OUTBOX_PROCESS_MAX_RUNTIME_MS: optionalPositiveIntegerSchema,
  PUSH_OUTBOX_PROCESSING_STALE_MS: optionalPositiveIntegerSchema,
  PUSH_RECEIPT_CHECK_LIMIT: optionalPositiveIntegerSchema,
}).superRefine((env, ctx) => {
  validateJwtSecret(env, ctx)
  validateCorsOrigins(env, ctx)
  validateStorageEnv(env, ctx)
  validateAppleIapEnv(env, ctx)
  validateGooglePlayIapEnv(env, ctx)
})

export type AppEnv = z.infer<typeof envSchema>

export function loadEnv(source: Record<string, string | undefined>) {
  return envSchema.parse(source)
}

function validateJwtSecret(env: z.infer<typeof envSchema>, ctx: z.RefinementCtx) {
  if (!isProductionLikeRuntime(env)) return

  if (isWeakJwtSecret(env.JWT_SECRET)) {
    ctx.addIssue({
      code: 'custom',
      path: ['JWT_SECRET'],
      message: 'JWT_SECRET must be a non-placeholder random secret in production',
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

    if (env.COOKIE_SECURE && url.protocol !== 'https:') {
      ctx.addIssue({
        code: 'custom',
        path: ['CORS_ORIGINS'],
        message: `CORS_ORIGINS must use HTTPS when COOKIE_SECURE=true: ${origin}`,
      })
    }
  }
}

function validateStorageEnv(env: z.infer<typeof envSchema>, ctx: z.RefinementCtx) {
  const requiredStorageKeys = [
    'SPACES_REGION',
    'SPACES_BUCKET',
    'SPACES_ENDPOINT',
    'SPACES_ACCESS_KEY_ID',
    'SPACES_SECRET_ACCESS_KEY',
  ] as const
  const storageConfigured =
    requiredStorageKeys.some((key) => env[key] !== undefined) || env.SPACES_CDN_BASE_URL !== undefined

  if (!storageConfigured) return

  for (const key of requiredStorageKeys) {
    if (env[key] === undefined) {
      ctx.addIssue({
        code: 'custom',
        path: [key],
        message: `${key} is required when DigitalOcean Spaces storage is configured`,
      })
    }
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
