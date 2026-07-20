import { OpenAPIHono } from '@hono/zod-openapi'
import { cors } from 'hono/cors'
import { secureHeaders } from 'hono/secure-headers'

import type { DbClient } from './db'
import type { AppEnv } from './env'
import { errorResponse, handleError, validationErrorHook } from './http/errors'
import { createIngressSecurity } from './http/security'
import { createAuthModule, type AuthHttpEnv } from './modules/auth'
import {
  createBillingModule,
  type AppStoreSubscriptionVerifier,
  type GooglePlaySubscriptionVerifier,
} from './modules/billing'
import { createNotificationsModule } from './modules/notifications'
import { createUsersModule } from './modules/users'

type CreateAppOptions = {
  env: AppEnv
  appStoreIapVerifier?: AppStoreSubscriptionVerifier
  googlePlayIapVerifier?: GooglePlaySubscriptionVerifier
  prisma: DbClient
}

const defaultWebhookBodyLimitBytes = 256 * 1024
const defaultWebhookRateLimitMax = 600
const defaultWebhookRateLimitWindowSeconds = 60

export function createApp({
  appStoreIapVerifier,
  env,
  googlePlayIapVerifier,
  prisma,
}: CreateAppOptions) {
  const billing = createBillingModule({
    appStoreVerifier: appStoreIapVerifier,
    db: prisma,
    env,
    googlePlayVerifier: googlePlayIapVerifier,
  })
  const notifications = createNotificationsModule({ db: prisma, env })
  const auth = createAuthModule({
    db: prisma,
    env,
    logoutCleanup: notifications.logoutCleanup,
    subscriptionReader: billing.getSubscription,
  })
  const users = createUsersModule({
    db: prisma,
    requireAdmin: auth.requireAdmin,
    requireAuth: auth.requireAuth,
  })
  const app = new OpenAPIHono<AuthHttpEnv>({ defaultHook: validationErrorHook })

  app.use(secureHeaders())
  app.use(
    '*',
    cors({
      origin: (origin) => {
        if (!origin) return env.CORS_ORIGINS[0] ?? null
        return env.CORS_ORIGINS.includes(origin) ? origin : null
      },
      allowHeaders: ['Content-Type', 'Authorization'],
      allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
      credentials: true,
      maxAge: 600,
    }),
  )
  const publicWriteSecurity = {
    bodyLimitBytes: env.AUTH_BODY_LIMIT_BYTES,
    rateLimitMax: env.AUTH_RATE_LIMIT_MAX,
    rateLimitWindowSeconds: env.AUTH_RATE_LIMIT_WINDOW_SECONDS,
    trustProxy: env.TRUST_PROXY,
    trustedProxyClientIpHeader: env.TRUSTED_PROXY_CLIENT_IP_HEADER,
    trustedProxyClientIpPosition: env.TRUSTED_PROXY_CLIENT_IP_POSITION,
  }
  for (const middleware of createIngressSecurity(publicWriteSecurity)) {
    app.use('/api/auth/*', middleware)
  }
  for (const middleware of createIngressSecurity(publicWriteSecurity)) {
    app.use('/api/users/*', middleware)
    app.use('/api/admin/*', middleware)
  }
  for (const middleware of createIngressSecurity({
    ...publicWriteSecurity,
    bodyLimitBytes: env.IAP_BODY_LIMIT_BYTES,
    rateLimitMax: env.IAP_RATE_LIMIT_MAX,
    rateLimitWindowSeconds: env.IAP_RATE_LIMIT_WINDOW_SECONDS,
  })) {
    app.use('/api/iap/*', middleware)
  }
  for (const middleware of createIngressSecurity({
    ...publicWriteSecurity,
    bodyLimitBytes: env.WEBHOOK_BODY_LIMIT_BYTES ?? defaultWebhookBodyLimitBytes,
    rateLimitMax: env.WEBHOOK_RATE_LIMIT_MAX ?? defaultWebhookRateLimitMax,
    rateLimitWindowSeconds:
      env.WEBHOOK_RATE_LIMIT_WINDOW_SECONDS ?? defaultWebhookRateLimitWindowSeconds,
  })) {
    app.use('/api/webhooks/*', middleware)
  }
  app.get('/', (c) => {
    return c.json({
      name: 'web_app_demo backend',
      status: 'ok',
    })
  })

  app.get('/health', (c) => {
    return c.json({
      status: 'ok',
    })
  })

  app.get('/health/live', (c) => {
    return c.json({
      status: 'ok',
    })
  })

  app.get('/health/ready', async (c) => {
    try {
      await prisma.$queryRaw`SELECT 1`
      return c.json({ status: 'ok' }, 200)
    } catch {
      return c.json({ status: 'unavailable' }, 503)
    }
  })

  app.route('/api/auth', auth.routes)
  app.route('/api/users', users.userRoutes)
  app.route('/api/admin', users.adminRoutes)
  app.route('/api/iap', billing.createRoutes(auth.authenticateAccessToken))
  app.route('/api/notifications', notifications.createRoutes(auth.authenticateAccessToken))
  app.route('/api/webhooks', billing.webhookRoutes)

  app.doc('/openapi.json', {
    openapi: '3.0.0',
    info: { title: 'web_app_demo API', version: '1.0.0' },
  })
  app.notFound((c) => c.json(errorResponse('NOT_FOUND', 'Route not found'), 404))
  app.onError(handleError)
  return app
}

export type AppType = ReturnType<typeof createApp>
