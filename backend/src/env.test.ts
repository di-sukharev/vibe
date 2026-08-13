import { readFileSync } from 'node:fs'

import { describe, expect, test } from 'bun:test'

import { loadBackgroundEnv, loadEnv } from './env'

describe('loadEnv', () => {
  test('splits a comma-separated origin list, trimming the spaces people leave in .env', () => {
    // Only the parsing is worth asserting. Reading `.default()` literals back out of the schema
    // asserts nothing - there is no code between the default and the assertion - and turns every
    // retuned default into a failing test whose only fix is editing the expectation.
    const env = loadEnv({
      DATABASE_URL: 'postgresql://superuser:superpassword@localhost:54329/web_app_demo',
      JWT_SECRET: '12345678901234567890123456789012',
      CORS_ORIGINS: 'http://localhost:5173, http://localhost:8081',
    })

    expect(env.CORS_ORIGINS).toEqual(['http://localhost:5173', 'http://localhost:8081'])
  })

  test('loads background entrypoints without exposing the API signing key', () => {
    const env = loadBackgroundEnv({
      NODE_ENV: 'production',
      DATABASE_URL: 'postgresql://superuser:superpassword@localhost:54329/web_app_demo',
      JWT_SECRET: 'fedcba9876543210'.repeat(4),
      // A background runner boots the same image as the API, so it faces the same fail-closed
      // storage rules: no filesystem driver in production, and a remote endpoint behind a gate.
      PRIVATE_STORAGE_DRIVER: 's3',
      PRIVATE_STORAGE_REGION: 'nyc3',
      PRIVATE_STORAGE_BUCKET: 'uploads',
      PRIVATE_STORAGE_ENDPOINT: 'https://storage.example.com',
      PRIVATE_STORAGE_ACCESS_KEY_ID: 'access-key',
      PRIVATE_STORAGE_SECRET_ACCESS_KEY: 'secret-key',
      PRIVATE_STORAGE_ALLOW_REMOTE_ENDPOINT: 'true',
    })

    expect(env.JWT_SECRET).toBe('0123456789abcdef'.repeat(4))
    expect(env.CORS_ORIGINS).toEqual(['https://background.invalid'])
    expect(env.COOKIE_SECURE).toBe(true)
  })

  test('a background runner in development accepts the local origin .env.example ships', () => {
    // COOKIE_SECURE is forced only in production. Forcing it everywhere would make the HTTPS rule
    // on WEBAPP_ORIGIN refuse http://localhost:5173, and the scheduler `bun run dev` now starts
    // would die at boot while the API next to it kept running.
    const env = loadBackgroundEnv({
      DATABASE_URL: 'postgresql://superuser:superpassword@localhost:54329/web_app_demo',
      JWT_SECRET: '12345678901234567890123456789012',
      WEBAPP_ORIGIN: 'http://localhost:5173',
      EMAIL_DELIVERY: 'console',
    })

    expect({ origin: env.WEBAPP_ORIGIN, secure: env.COOKIE_SECURE }).toEqual({
      origin: 'http://localhost:5173',
      secure: false,
    })
  })

  test('the shipped .env.example loads without throwing', () => {
    // That the template file is loadable is worth knowing. Its literal values are not: asserting
    // the example bundle ids means the first person to put their own in breaks `bun run test`.
    expect(() => loadEnv(parseEnvExample())).not.toThrow()
  })

  test('parses social auth provider configuration', () => {
    const env = loadEnv({
      DATABASE_URL: 'postgresql://superuser:superpassword@localhost:54329/web_app_demo',
      JWT_SECRET: '12345678901234567890123456789012',
      APPLE_AUTH_BUNDLE_ID: 'com.example.app',
      APPLE_AUTH_JWKS_TIMEOUT_MS: '8000',
      GOOGLE_AUTH_CLIENT_IDS: 'ios-client-id, web-client-id',
    })

    expect(env.APPLE_AUTH_BUNDLE_ID).toBe('com.example.app')
    expect(env.APPLE_AUTH_JWKS_TIMEOUT_MS).toBe(8000)
    expect(env.GOOGLE_AUTH_CLIENT_IDS).toEqual(['ios-client-id', 'web-client-id'])
  })

  test('rejects known weak JWT secrets in production-like runtimes', () => {
    expect(() =>
      loadEnv({
        NODE_ENV: 'production',
        DATABASE_URL: 'postgresql://superuser:superpassword@localhost:54329/web_app_demo',
        JWT_SECRET: 'replace-with-at-least-32-random-characters',
      }),
    ).toThrow('JWT_SECRET')

    expect(() =>
      loadEnv({
        DATABASE_URL: 'postgresql://superuser:superpassword@localhost:54329/web_app_demo',
        JWT_SECRET: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        COOKIE_SECURE: 'true',
        CORS_ORIGINS: 'https://web.example.com',
      }),
    ).toThrow('JWT_SECRET')

    expect(() =>
      loadEnv({
        DATABASE_URL: 'postgresql://superuser:superpassword@localhost:54329/web_app_demo',
        JWT_SECRET: 'a-memorable-human-secret-phrase-that-is-long-enough-to-pass',
        COOKIE_SECURE: 'true',
        CORS_ORIGINS: 'https://web.example.com',
      }),
    ).toThrow('JWT_SECRET')
  })

  test('requires generated secrets, secure cookies, and HTTPS origins in production', () => {
    const productionBase = {
      NODE_ENV: 'production',
      DATABASE_URL: 'postgresql://superuser:superpassword@localhost:54329/web_app_demo',
      JWT_SECRET: '0123456789abcdef'.repeat(4),
      COOKIE_SECURE: 'true',
      CORS_ORIGINS: 'https://web.example.com',
      // Production ships the avatar feature, so it must have durable object storage; the
      // filesystem driver is refused there. See the private storage env suite below.
      PRIVATE_STORAGE_DRIVER: 's3',
      PRIVATE_STORAGE_REGION: 'ru-central1',
      PRIVATE_STORAGE_BUCKET: 'uploads',
      PRIVATE_STORAGE_ENDPOINT: 'https://storage.example.com',
      PRIVATE_STORAGE_ACCESS_KEY_ID: 'access-key',
      PRIVATE_STORAGE_SECRET_ACCESS_KEY: 'secret-key',
      PRIVATE_STORAGE_ALLOW_REMOTE_ENDPOINT: 'true',
    }

    expect(() => loadEnv(productionBase)).not.toThrow()
    expect(() => loadEnv({ ...productionBase, JWT_SECRET: 'a-memorable-human-secret-phrase-that-is-long-enough-to-pass' }))
      .toThrow('JWT_SECRET')
    expect(() => loadEnv({ ...productionBase, COOKIE_SECURE: 'false' })).toThrow('COOKIE_SECURE')
    expect(() => loadEnv({ ...productionBase, CORS_ORIGINS: 'http://web.example.com' }))
      .toThrow('CORS_ORIGINS')
    // The console sink reports itself as configured, so production would create reset tokens and
    // queue tasks whose delivery is a log line while the user waits for mail that never arrives.
    expect(() => loadEnv({ ...productionBase, EMAIL_DELIVERY: 'console' })).toThrow('EMAIL_DELIVERY')
  })

  test('the task outbox has usable defaults and refuses nonsense', () => {
    const base = {
      DATABASE_URL: 'postgresql://superuser:superpassword@localhost:54329/web_app_demo',
      JWT_SECRET: '12345678901234567890123456789012',
    }

    // Fail-closed contract, not tuning: a fresh install must not send mail. The batch/lease/runtime
    // numbers are `.default()` literals and are deliberately not asserted here.
    expect(loadEnv(base).EMAIL_DELIVERY).toBe('disabled')

    expect(() => loadEnv({ ...base, TASK_OUTBOX_BATCH_LIMIT: '0' })).toThrow('TASK_OUTBOX_BATCH_LIMIT')
    expect(() => loadEnv({ ...base, TASK_OUTBOX_RETENTION_DAYS: '-1' })).toThrow('TASK_OUTBOX_RETENTION_DAYS')
    expect(() => loadEnv({ ...base, EMAIL_DELIVERY: 'smtp' })).toThrow('EMAIL_DELIVERY')
  })

  test('rejects unsafe production CORS origins', () => {
    const baseEnv = {
      DATABASE_URL: 'postgresql://superuser:superpassword@localhost:54329/web_app_demo',
      JWT_SECRET: '12345678901234567890123456789012',
    }

    expect(() =>
      loadEnv({
        ...baseEnv,
        CORS_ORIGINS: '',
      }),
    ).toThrow('CORS_ORIGINS')

    expect(() =>
      loadEnv({
        ...baseEnv,
        CORS_ORIGINS: '*',
      }),
    ).toThrow('CORS_ORIGINS')

    expect(() =>
      loadEnv({
        ...baseEnv,
        CORS_ORIGINS: 'https://web.example.com/path',
      }),
    ).toThrow('CORS_ORIGINS')

    expect(() =>
      loadEnv({
        ...baseEnv,
        COOKIE_SECURE: 'true',
        CORS_ORIGINS: 'http://web.example.com',
      }),
    ).toThrow('CORS_ORIGINS')
  })

  test('requires complete App Store IAP verification config when enabled', () => {
    const baseEnv = {
      DATABASE_URL: 'postgresql://superuser:superpassword@localhost:54329/web_app_demo',
      JWT_SECRET: '12345678901234567890123456789012',
    }

    expect(() =>
      loadEnv({
        ...baseEnv,
        APPLE_IAP_BUNDLE_ID: 'com.example.app',
      }),
    ).toThrow('APPLE_IAP_ISSUER_ID')

    expect(() =>
      loadEnv({
        ...baseEnv,
        APPLE_IAP_BUNDLE_ID: 'com.example.app',
        APPLE_IAP_ENVIRONMENT: 'Production',
        APPLE_IAP_ISSUER_ID: 'issuer-id',
        APPLE_IAP_KEY_ID: 'key-id',
        APPLE_IAP_PRIVATE_KEY_BASE64: 'private-key',
      }),
    ).toThrow('APPLE_IAP_APP_APPLE_ID')

    expect(() =>
      loadEnv({
        ...baseEnv,
        APPLE_IAP_BUNDLE_ID: 'com.example.app',
        APPLE_IAP_ISSUER_ID: 'issuer-id',
        APPLE_IAP_KEY_ID: 'key-id',
        APPLE_IAP_PRIVATE_KEY_BASE64: 'private-key',
      }),
    ).toThrow('APPLE_IAP_PRODUCT_IDS')

    const env = loadEnv({
      ...baseEnv,
      APPLE_IAP_BUNDLE_ID: 'com.example.app',
      APPLE_IAP_ISSUER_ID: 'issuer-id',
      APPLE_IAP_KEY_ID: 'key-id',
      APPLE_IAP_PRIVATE_KEY_BASE64: 'private-key',
      APPLE_IAP_PRODUCT_IDS: 'premium_monthly, premium_yearly',
    })

    expect(env.APPLE_IAP_PRODUCT_IDS).toEqual(['premium_monthly', 'premium_yearly'])
  })

  test('requires complete Google Play IAP verification config when enabled', () => {
    const baseEnv = {
      DATABASE_URL: 'postgresql://superuser:superpassword@localhost:54329/web_app_demo',
      JWT_SECRET: '12345678901234567890123456789012',
    }

    expect(() =>
      loadEnv({
        ...baseEnv,
        GOOGLE_PLAY_PACKAGE_NAME: 'com.example.app',
      }),
    ).toThrow('GOOGLE_PLAY_SERVICE_ACCOUNT_JSON_BASE64')

    expect(() =>
      loadEnv({
        ...baseEnv,
        GOOGLE_PLAY_SERVICE_ACCOUNT_JSON_BASE64: Buffer.from(JSON.stringify({ client_email: 'iap@example.com' })).toString('base64'),
      }),
    ).toThrow('GOOGLE_PLAY_PACKAGE_NAME')

    expect(() =>
      loadEnv({
        ...baseEnv,
        GOOGLE_PLAY_PACKAGE_NAME: 'com.example.app',
        GOOGLE_PLAY_SERVICE_ACCOUNT_JSON_BASE64: Buffer.from(JSON.stringify({ client_email: 'iap@example.com' })).toString('base64'),
      }),
    ).toThrow('GOOGLE_PLAY_PRODUCT_IDS')

    expect(() =>
      loadEnv({
        ...baseEnv,
        GOOGLE_PLAY_PACKAGE_NAME: 'com.example.app',
        GOOGLE_PLAY_SERVICE_ACCOUNT_JSON_BASE64: Buffer.from(JSON.stringify({ client_email: 'iap@example.com' })).toString('base64'),
        GOOGLE_PLAY_PRODUCT_IDS: 'premium',
      }),
    ).toThrow('GOOGLE_PLAY_BASE_PLAN_IDS')

    const env = loadEnv({
      ...baseEnv,
      GOOGLE_PLAY_PACKAGE_NAME: 'com.example.app',
      GOOGLE_PLAY_SERVICE_ACCOUNT_JSON_BASE64: Buffer.from(JSON.stringify({ client_email: 'iap@example.com' })).toString('base64'),
      GOOGLE_PLAY_PRODUCT_IDS: 'premium',
      GOOGLE_PLAY_BASE_PLAN_IDS: 'monthly, yearly',
    })

    expect(env.GOOGLE_PLAY_PRODUCT_IDS).toEqual(['premium'])
    expect(env.GOOGLE_PLAY_BASE_PLAN_IDS).toEqual(['monthly', 'yearly'])
  })

  test('requires WEBAPP_ORIGIN to be an HTTP origin and HTTPS in production', () => {
    const baseEnv = {
      DATABASE_URL: 'postgresql://superuser:superpassword@localhost:54329/web_app_demo',
      JWT_SECRET: '12345678901234567890123456789012',
    }

    expect(() => loadEnv({ ...baseEnv, WEBAPP_ORIGIN: 'https://web.example.com/path' }))
      .toThrow('WEBAPP_ORIGIN')
    expect(() => loadEnv({ ...baseEnv, WEBAPP_ORIGIN: 'ftp://web.example.com' }))
      .toThrow('WEBAPP_ORIGIN')
    expect(() => loadEnv({ ...baseEnv, WEBAPP_ORIGIN: 'http://localhost:5173' }))
      .not.toThrow()
    expect(() =>
      loadEnv({
        ...baseEnv,
        NODE_ENV: 'production',
        JWT_SECRET: '0123456789abcdef'.repeat(4),
        COOKIE_SECURE: 'true',
        CORS_ORIGINS: 'https://web.example.com',
        WEBAPP_ORIGIN: 'http://web.example.com',
      }),
    ).toThrow('WEBAPP_ORIGIN')
  })

  test('keeps absolute session lifetime at least as long as refresh lifetime', () => {
    expect(() =>
      loadEnv({
        DATABASE_URL: 'postgresql://superuser:superpassword@localhost:54329/web_app_demo',
        JWT_SECRET: '12345678901234567890123456789012',
        REFRESH_TOKEN_TTL_DAYS: '30',
        SESSION_ABSOLUTE_TTL_DAYS: '29',
      }),
    ).toThrow('SESSION_ABSOLUTE_TTL_DAYS')
  })

  test('bounds refresh replay tolerance to a short window', () => {
    expect(() =>
      loadEnv({
        DATABASE_URL: 'postgresql://superuser:superpassword@localhost:54329/web_app_demo',
        JWT_SECRET: '12345678901234567890123456789012',
        REFRESH_REUSE_GRACE_SECONDS: '61',
      }),
    ).toThrow('REFRESH_REUSE_GRACE_SECONDS')
  })

  test('requires an explicit client IP header when a trusted proxy is enabled', () => {
    const baseEnv = {
      DATABASE_URL: 'postgresql://superuser:superpassword@localhost:54329/web_app_demo',
      JWT_SECRET: '12345678901234567890123456789012',
      TRUST_PROXY: 'true',
    }

    expect(() => loadEnv(baseEnv)).toThrow('TRUSTED_PROXY_CLIENT_IP_HEADER')
    expect(() =>
      loadEnv({
        ...baseEnv,
        TRUSTED_PROXY_CLIENT_IP_HEADER: 'do-connecting-ip',
      }),
    ).not.toThrow()
  })

  test('requires the documented trusted proxy contract for Yandex SWS ingress', () => {
    const baseEnv = {
      DATABASE_URL: 'postgresql://superuser:superpassword@localhost:54329/web_app_demo',
      JWT_SECRET: '12345678901234567890123456789012',
      INGRESS_RATE_LIMIT_PROVIDER: 'yandex-sws',
      TRUST_PROXY: 'true',
      TRUSTED_PROXY_CLIENT_IP_HEADER: 'x-forwarded-for',
      TRUSTED_PROXY_CLIENT_IP_POSITION: 'last',
    }

    expect(loadEnv(baseEnv).INGRESS_RATE_LIMIT_PROVIDER).toBe('yandex-sws')
    expect(() => loadEnv({ ...baseEnv, INGRESS_RATE_LIMIT_PROVIDER: 'unsupported' }))
      .toThrow('INGRESS_RATE_LIMIT_PROVIDER')
    expect(() => loadEnv({ ...baseEnv, TRUST_PROXY: 'false' }))
      .toThrow('INGRESS_RATE_LIMIT_PROVIDER')
    expect(() => loadEnv({
      ...baseEnv,
      TRUSTED_PROXY_CLIENT_IP_HEADER: 'do-connecting-ip',
    })).toThrow('INGRESS_RATE_LIMIT_PROVIDER')
    expect(() => loadEnv({
      ...baseEnv,
      TRUSTED_PROXY_CLIENT_IP_POSITION: 'first',
    })).toThrow('INGRESS_RATE_LIMIT_PROVIDER')
  })
})

function parseEnvExample() {
  const contents = readFileSync(new URL('../.env.example', import.meta.url), 'utf8')
  const values: Record<string, string> = {}

  for (const line of contents.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue

    const separatorIndex = trimmed.indexOf('=')
    if (separatorIndex === -1) continue

    const key = trimmed.slice(0, separatorIndex)
    const rawValue = trimmed.slice(separatorIndex + 1)
    values[key] = rawValue.replace(/^"(.*)"$/, '$1')
  }

  return values
}

describe('private storage env', () => {
  const base = {
    DATABASE_URL: 'postgresql://superuser:superpassword@localhost:54329/web_app_demo',
    JWT_SECRET: '12345678901234567890123456789012',
  }
  const productionBase = {
    ...base,
    NODE_ENV: 'production',
    JWT_SECRET: 'a'.repeat(63) + 'b',
    COOKIE_SECURE: 'true',
    CORS_ORIGINS: 'https://app.example.com',
  }
  const localS3 = {
    PRIVATE_STORAGE_DRIVER: 's3',
    PRIVATE_STORAGE_REGION: 'us-east-1',
    PRIVATE_STORAGE_BUCKET: 'local-private-storage',
    PRIVATE_STORAGE_ENDPOINT: 'http://127.0.0.1:24331',
    PRIVATE_STORAGE_ACCESS_KEY_ID: 'local-key',
    PRIVATE_STORAGE_SECRET_ACCESS_KEY: 'local-secret',
    PRIVATE_STORAGE_FORCE_PATH_STYLE: 'true',
  }

  test('defaults to the filesystem driver so a fresh checkout needs no cloud and no Docker', () => {
    expect(loadEnv(base).PRIVATE_STORAGE_DRIVER).toBe('filesystem')
  })

  test('accepts a complete loopback S3 configuration', () => {
    const env = loadEnv({ ...base, ...localS3 })

    expect(env.PRIVATE_STORAGE_DRIVER).toBe('s3')
    expect(env.PRIVATE_STORAGE_ENDPOINT).toBe('http://127.0.0.1:24331')
    expect(env.PRIVATE_STORAGE_FORCE_PATH_STYLE).toBe(true)
  })

  test('requires the whole S3 group, naming every key that is missing', () => {
    for (const omitted of [
      'PRIVATE_STORAGE_REGION',
      'PRIVATE_STORAGE_BUCKET',
      'PRIVATE_STORAGE_ENDPOINT',
      'PRIVATE_STORAGE_ACCESS_KEY_ID',
      'PRIVATE_STORAGE_SECRET_ACCESS_KEY',
    ]) {
      const partial: Record<string, string> = { ...base, ...localS3 }
      delete partial[omitted]
      expect(() => loadEnv(partial)).toThrow(omitted)
    }
  })

  test('refuses S3 credentials that the filesystem driver would silently ignore', () => {
    expect(() => loadEnv({ ...base, PRIVATE_STORAGE_BUCKET: 'uploads' })).toThrow(
      'PRIVATE_STORAGE_BUCKET',
    )
    expect(() =>
      loadEnv({ ...base, PRIVATE_STORAGE_ENDPOINT: 'https://storage.example.com' }),
    ).toThrow('PRIVATE_STORAGE_ENDPOINT')
  })

  test('rejects a remote endpoint outside production until it is opted into deliberately', () => {
    const remote = {
      ...base,
      ...localS3,
      PRIVATE_STORAGE_ENDPOINT: 'https://storage.yandexcloud.net',
      PRIVATE_STORAGE_FORCE_PATH_STYLE: 'false',
    }

    expect(() => loadEnv(remote)).toThrow('PRIVATE_STORAGE_ALLOW_REMOTE_ENDPOINT')
    expect(
      loadEnv({ ...remote, PRIVATE_STORAGE_ALLOW_REMOTE_ENDPOINT: 'true' })
        .PRIVATE_STORAGE_ENDPOINT,
    ).toBe('https://storage.yandexcloud.net')
  })

  test('keeps production fail-closed: no filesystem driver, no loopback, no plain http', () => {
    expect(() => loadEnv(productionBase)).toThrow('PRIVATE_STORAGE_DRIVER')

    expect(() => loadEnv({ ...productionBase, ...localS3 })).toThrow('PRIVATE_STORAGE_ENDPOINT')

    expect(() =>
      loadEnv({
        ...productionBase,
        ...localS3,
        PRIVATE_STORAGE_ENDPOINT: 'http://storage.example.com',
        PRIVATE_STORAGE_FORCE_PATH_STYLE: 'false',
        PRIVATE_STORAGE_ALLOW_REMOTE_ENDPOINT: 'true',
      }),
    ).toThrow('https')

    expect(() =>
      loadEnv({
        ...productionBase,
        ...localS3,
        PRIVATE_STORAGE_ENDPOINT: 'https://storage.example.com',
        PRIVATE_STORAGE_FORCE_PATH_STYLE: 'false',
        PRIVATE_STORAGE_ALLOW_REMOTE_ENDPOINT: 'true',
      }),
    ).not.toThrow()
  })

  test('keeps the remote-endpoint gate load-bearing in production too', () => {
    // A gate that exempts production is inert exactly where a wrong bucket costs the most.
    const productionRemote = {
      ...productionBase,
      ...localS3,
      PRIVATE_STORAGE_ENDPOINT: 'https://storage.example.com',
      PRIVATE_STORAGE_FORCE_PATH_STYLE: 'false',
    }

    expect(() => loadEnv(productionRemote)).toThrow('PRIVATE_STORAGE_ALLOW_REMOTE_ENDPOINT')
    expect(() =>
      loadEnv({ ...productionRemote, PRIVATE_STORAGE_ALLOW_REMOTE_ENDPOINT: 'true' }),
    ).not.toThrow()
  })

  test('requires path-style addressing for a local endpoint, which has no bucket subdomains', () => {
    expect(() =>
      loadEnv({ ...base, ...localS3, PRIVATE_STORAGE_FORCE_PATH_STYLE: 'false' }),
    ).toThrow('PRIVATE_STORAGE_FORCE_PATH_STYLE')
  })

  test('rejects an endpoint carrying a path or query instead of a bare origin', () => {
    expect(() =>
      loadEnv({ ...base, ...localS3, PRIVATE_STORAGE_ENDPOINT: 'http://127.0.0.1:24331/bucket' }),
    ).toThrow('origin only')
  })
})

describe('email env', () => {
  const base = {
    DATABASE_URL: 'postgresql://superuser:superpassword@localhost:54329/web_app_demo',
    JWT_SECRET: '12345678901234567890123456789012',
    WEBAPP_ORIGIN: 'http://localhost:5173',
  }
  const resend = {
    EMAIL_DELIVERY: 'resend',
    EMAIL_FROM: 'Example <no-reply@example.com>',
    EMAIL_RESEND_API_KEY: 're_test_key',
  }
  const postbox = {
    EMAIL_DELIVERY: 'postbox',
    EMAIL_FROM: 'no-reply@example.com',
    EMAIL_POSTBOX_ACCESS_KEY_ID: 'YCAJEtest',
    EMAIL_POSTBOX_SECRET_ACCESS_KEY: 'YCPtest',
  }

  test('sends nothing by default, so a fresh install cannot leak mail it never configured', () => {
    const env = loadEnv(base)

    expect(env.EMAIL_DELIVERY).toBe('disabled')
    expect(env.EMAIL_FROM).toBeUndefined()
  })

  test('requires the whole provider group, naming every key that is missing', () => {
    for (const [group, keys] of [
      [postbox, ['EMAIL_FROM', 'EMAIL_POSTBOX_ACCESS_KEY_ID', 'EMAIL_POSTBOX_SECRET_ACCESS_KEY']],
      [resend, ['EMAIL_FROM', 'EMAIL_RESEND_API_KEY']],
    ] as const) {
      for (const omitted of keys) {
        const partial: Record<string, string> = { ...base, ...group }
        delete partial[omitted]
        expect(() => loadEnv(partial)).toThrow(omitted)
      }
    }
  })

  test('refuses credentials the selected driver would silently ignore', () => {
    expect(() => loadEnv({ ...base, ...resend, EMAIL_POSTBOX_ACCESS_KEY_ID: 'YCAJEtest' })).toThrow(
      'EMAIL_POSTBOX_ACCESS_KEY_ID',
    )
    expect(() => loadEnv({ ...base, ...postbox, EMAIL_RESEND_API_KEY: 're_test_key' })).toThrow(
      'EMAIL_RESEND_API_KEY',
    )
    expect(() => loadEnv({ ...base, EMAIL_RESEND_API_KEY: 're_test_key' })).toThrow(
      'EMAIL_RESEND_API_KEY',
    )
  })

  test('allows the shared settings under any driver, so switching provider is a one-line edit', () => {
    // EMAIL_FROM and friends are inert without a provider. Forbidding them would only make
    // flipping EMAIL_DELIVERY between console and resend a multi-line change.
    const env = loadEnv({ ...base, EMAIL_DELIVERY: 'console', EMAIL_FROM: 'a@example.com' })

    expect(env.EMAIL_FROM).toBe('a@example.com')
  })

  test('refuses a sender that is not an address or a display-name address', () => {
    for (const from of ['not-an-address', 'a@b', 'Name <a@b@c.com>', 'a@example.com, b@example.com', 'Bob <a@x.com> <b@y.com>']) {
      expect(() => loadEnv({ ...base, ...resend, EMAIL_FROM: from })).toThrow('EMAIL_FROM')
    }

    expect(loadEnv({ ...base, ...resend, EMAIL_FROM: 'a@example.com' }).EMAIL_FROM).toBe('a@example.com')
    expect(() => loadEnv({ ...base, ...resend, EMAIL_REPLY_TO: 'nope' })).toThrow('EMAIL_REPLY_TO')
  })

  test('requires WEBAPP_ORIGIN, because the provider sends links a user has to be able to open', () => {
    // Without it the reset link is built from CORS_ORIGINS[0], which in a background runner is
    // not the browser app at all. Better to refuse at startup than to send a dead link.
    const withoutOrigin: Record<string, string> = { ...base, ...resend }
    delete withoutOrigin.WEBAPP_ORIGIN

    expect(() => loadEnv(withoutOrigin)).toThrow('WEBAPP_ORIGIN')
    // Still optional while nothing is being sent.
    expect(loadEnv({ DATABASE_URL: base.DATABASE_URL, JWT_SECRET: base.JWT_SECRET }).WEBAPP_ORIGIN).toBeUndefined()
  })

  test('a provider is allowed in production while the console sink is not', () => {
    const production = {
      ...base,
      NODE_ENV: 'production',
      JWT_SECRET: 'a'.repeat(63) + 'b',
      COOKIE_SECURE: 'true',
      CORS_ORIGINS: 'https://app.example.com',
      WEBAPP_ORIGIN: 'https://app.example.com',
      PRIVATE_STORAGE_DRIVER: 's3',
      PRIVATE_STORAGE_REGION: 'ru-central1',
      PRIVATE_STORAGE_BUCKET: 'uploads',
      PRIVATE_STORAGE_ENDPOINT: 'https://storage.yandexcloud.net',
      PRIVATE_STORAGE_ACCESS_KEY_ID: 'key',
      PRIVATE_STORAGE_SECRET_ACCESS_KEY: 'secret',
      PRIVATE_STORAGE_ALLOW_REMOTE_ENDPOINT: 'true',
    }

    expect(loadEnv({ ...production, ...postbox }).EMAIL_DELIVERY).toBe('postbox')
    expect(() => loadEnv({ ...production, EMAIL_DELIVERY: 'console' })).toThrow('EMAIL_DELIVERY')
    // Disabled stays legitimate: an install with no email is a real install.
    expect(loadEnv(production).EMAIL_DELIVERY).toBe('disabled')
  })

  test('refuses an endpoint that would crash the driver at boot instead of at the first send', () => {
    // `new URL` runs while createBackendRuntime builds the driver, so a scheme-less value - the
    // form a console copy-paste produces - would take down the API and every runner with a
    // TypeError naming no variable at all.
    for (const endpoint of ['postbox.cloud.yandex.net', 'ftp://postbox.cloud.yandex.net', 'not a url']) {
      expect(() => loadEnv({ ...base, ...postbox, EMAIL_POSTBOX_ENDPOINT: endpoint })).toThrow(
        'EMAIL_POSTBOX_ENDPOINT',
      )
    }

    expect(() =>
      loadEnv({ ...base, ...resend, EMAIL_RESEND_ENDPOINT: 'https://api.resend.com/emails' }),
    ).toThrow('EMAIL_RESEND_ENDPOINT')

    // A trailing slash is tolerated, because the driver strips it before appending its path.
    expect(
      loadEnv({ ...base, ...postbox, EMAIL_POSTBOX_ENDPOINT: 'https://postbox.example.com/' })
        .EMAIL_POSTBOX_ENDPOINT,
    ).toBe('https://postbox.example.com/')
  })

  test('the console sink survives a background runner, which reports itself as secure', () => {
    // A background process sets COOKIE_SECURE=true because it serves no browser. Gating the
    // console refusal on that instead of NODE_ENV would break local development on every branch
    // whose runners do so.
    const runner = {
      ...base,
      JWT_SECRET: 'a'.repeat(63) + 'b',
      COOKIE_SECURE: 'true',
      CORS_ORIGINS: 'https://app.example.com',
      WEBAPP_ORIGIN: 'https://app.example.com',
    }

    expect(loadEnv({ ...runner, EMAIL_DELIVERY: 'console' }).EMAIL_DELIVERY).toBe('console')
  })
})
