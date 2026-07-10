import { OpenAPIHono } from '@hono/zod-openapi'
import { cors } from 'hono/cors'
import { secureHeaders } from 'hono/secure-headers'

import type { DbClient } from './db'
import type { AppEnv } from './env'
import type { AppHonoEnv } from './http/context'
import { errorResponse, handleError, validationErrorHook } from './http/errors'
import {
  createAppStoreSubscriptionVerifier,
  type AppStoreSubscriptionVerifier,
} from './iap/apple-verifier'
import {
  createGooglePlaySubscriptionVerifier,
  type GooglePlaySubscriptionVerifier,
} from './iap/google-play-verifier'
import { createAppStoreWebhookRoutes, createIapRoutes } from './iap/routes'
import { getSubscriptionSnapshot } from './iap/service'
import { createAuthModule } from './modules/auth'
import { createNotificationRoutes } from './notifications/routes'
import { createStorageServiceFromEnv } from './storage/service'

export type AppBindings = AppHonoEnv

type CreateAppOptions = {
  env: AppEnv
  appStoreIapVerifier?: AppStoreSubscriptionVerifier
  googlePlayIapVerifier?: GooglePlaySubscriptionVerifier
  iapVerifier?: AppStoreSubscriptionVerifier
  prisma: DbClient
}

export function createApp({
  appStoreIapVerifier,
  env,
  googlePlayIapVerifier,
  iapVerifier,
  prisma,
}: CreateAppOptions) {
  const appStoreSubscriptionVerifier =
    appStoreIapVerifier ?? iapVerifier ?? createAppStoreSubscriptionVerifier(env)
  const googlePlaySubscriptionVerifier =
    googlePlayIapVerifier ?? createGooglePlaySubscriptionVerifier(env)
  const storageService = createStorageServiceFromEnv(env)
  const auth = createAuthModule({
    db: prisma,
    env,
    logoutCleanup: async ({ expoPushTokens, userId }) => {
      if (expoPushTokens.length === 0) return
      await prisma.pushToken.deleteMany({
        where: { expoPushToken: { in: expoPushTokens }, userId },
      })
    },
    subscriptionReader: (userId) => getSubscriptionSnapshot(prisma, userId),
  })
  const app = new OpenAPIHono<AppHonoEnv>({ defaultHook: validationErrorHook })

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
  app.use('*', async (c, next) => {
    c.set('appStoreIapVerifier', appStoreSubscriptionVerifier)
    c.set('authenticateAccessToken', auth.authenticateAccessToken)
    c.set('env', env)
    c.set('googlePlayIapVerifier', googlePlaySubscriptionVerifier)
    c.set('prisma', prisma)
    c.set('storageService', storageService)
    await next()
  })

  app.get('/', (c) => c.json({ name: 'web_app_demo backend', status: 'ok' }))
  app.get('/health', (c) => c.json({ status: 'ok' }))

  app.route('/api/auth', auth.routes)
  app.route('/api/iap', createIapRoutes())
  app.route('/api/notifications', createNotificationRoutes())
  app.route('/api/webhooks', createAppStoreWebhookRoutes())

  app.doc('/openapi.json', {
    openapi: '3.0.0',
    info: { title: 'web_app_demo API', version: '1.0.0' },
  })
  app.notFound((c) => c.json(errorResponse('NOT_FOUND', 'Route not found'), 404))
  app.onError(handleError)
  return app
}

export type AppType = ReturnType<typeof createApp>
