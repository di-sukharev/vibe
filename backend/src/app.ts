import { OpenAPIHono } from '@hono/zod-openapi'
import { cors } from 'hono/cors'
import { secureHeaders } from 'hono/secure-headers'

import type { DbClient } from './db'
import type { AppEnv } from './env'
import { errorResponse, handleError, validationErrorHook } from './http/errors'
import { createAuthModule } from './modules/auth'
import {
  createBillingModule,
  type AppStoreSubscriptionVerifier,
  type GooglePlaySubscriptionVerifier,
} from './modules/billing'
import { createNotificationsModule } from './modules/notifications'

type CreateAppOptions = {
  env: AppEnv
  appStoreIapVerifier?: AppStoreSubscriptionVerifier
  googlePlayIapVerifier?: GooglePlaySubscriptionVerifier
  prisma: DbClient
}

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
  const app = new OpenAPIHono({ defaultHook: validationErrorHook })

  app.use(secureHeaders())
  app.use(
    '*',
    cors({
      origin: (origin) => {
        if (!origin) return env.CORS_ORIGINS[0] ?? null
        return env.CORS_ORIGINS.includes(origin) ? origin : null
      },
      allowHeaders: ['Content-Type', 'Authorization'],
      allowMethods: ['GET', 'POST', 'OPTIONS'],
      credentials: true,
      maxAge: 600,
    }),
  )
  app.get('/', (c) => c.json({ name: 'web_app_demo backend', status: 'ok' }))
  app.get('/health', (c) => c.json({ status: 'ok' }))

  app.route('/api/auth', auth.routes)
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
