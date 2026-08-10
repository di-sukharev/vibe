import { OpenAPIHono } from '@hono/zod-openapi'
import { cors } from 'hono/cors'
import { secureHeaders } from 'hono/secure-headers'

import { createBackgroundTasks, type TaskDeferrer } from './background-tasks'
import type { DbClient } from './db'
import { disabledEmailDelivery, type EmailDelivery } from './email'
import type { AppEnv } from './env'
import { errorResponse, handleError, validationErrorHook } from './http/errors'
import { createFixedWindowRateLimit, createIngressSecurity } from './http/security'
import { createAuthModule, type AuthHttpEnv } from './modules/auth'
// Subscriptions are turned off; see docs/IAP.md before uncommenting.
// import {
//   createBillingModule,
//   type AppStoreSubscriptionVerifier,
//   type GooglePlaySubscriptionVerifier,
// } from './modules/billing'
import { createNotificationsModule } from './modules/notifications'
import { createUploadsModule } from './modules/uploads'
import { createUsersModule } from './modules/users'
import {
  apiCorsAllowedHeaders,
  browserUploadExposedHeaders,
  createPrivateStorage,
  type PrivateStorageRuntime,
} from './storage'

type CreateAppOptions = {
  backgroundTasks?: TaskDeferrer
  emailDelivery?: EmailDelivery
  env: AppEnv
  // Uncomment together with the billing module:
  // appStoreIapVerifier?: AppStoreSubscriptionVerifier
  // googlePlayIapVerifier?: GooglePlaySubscriptionVerifier
  prisma: DbClient
  /**
   * Storage is never absent: the filesystem driver always works. Injectable so tests can point
   * it at a temporary directory instead of the configured root.
   */
  privateStorage?: PrivateStorageRuntime
}

// Defaults for the App Store webhook ingress; uncomment with the billing routes.
// const defaultWebhookBodyLimitBytes = 256 * 1024
// const defaultWebhookRateLimitMax = 600
// const defaultWebhookRateLimitWindowSeconds = 60

export function createApp({
  // appStoreIapVerifier,
  backgroundTasks = createBackgroundTasks(),
  emailDelivery = disabledEmailDelivery,
  env,
  // googlePlayIapVerifier,
  prisma,
  privateStorage,
}: CreateAppOptions) {
  // const billing = createBillingModule({
  //   appStoreVerifier: appStoreIapVerifier,
  //   db: prisma,
  //   env,
  //   googlePlayVerifier: googlePlayIapVerifier,
  // })
  const storage = privateStorage ?? createPrivateStorage(env)
  const notifications = createNotificationsModule({ db: prisma, env })
  const auth = createAuthModule({
    db: prisma,
    emailDelivery,
    env,
    logoutCleanup: notifications.logoutCleanup,
  })
  const adminUsersReadRateLimit = createFixedWindowRateLimit<AuthHttpEnv>({
    errorMessage: 'Too many admin user directory requests',
    key: (c) => c.var.user.id,
    max: env.ADMIN_USERS_READ_RATE_LIMIT_MAX,
    windowSeconds: env.ADMIN_USERS_READ_RATE_LIMIT_WINDOW_SECONDS,
  })
  const users = createUsersModule({
    adminUsersReadRateLimit,
    db: prisma,
    requireAdmin: auth.requireAdmin,
    requireAuth: auth.requireAuth,
  })
  const uploads = createUploadsModule({
    backgroundTasks,
    db: prisma,
    requireAuth: auth.requireAuth,
    storage: storage.storage,
  })
  const app = new OpenAPIHono<AuthHttpEnv>({ defaultHook: validationErrorHook })
  app.openAPIRegistry.registerComponent('securitySchemes', 'BearerAuth', {
    type: 'http',
    scheme: 'bearer',
    bearerFormat: 'JWT',
  })

  app.use(secureHeaders())
  app.use(
    '*',
    cors({
      origin: (origin) => {
        if (!origin) return env.CORS_ORIGINS[0] ?? null
        return env.CORS_ORIGINS.includes(origin) ? origin : null
      },
      // One global CORS layer, because hono answers a preflight in the first middleware that
      // matches: a second, route-scoped cors() registered later would never see an OPTIONS.
      // The upload headers therefore have to live here. They come from the same constant the
      // local S3 bucket's CORS rule uses, so both drivers allow exactly the same upload request.
      allowHeaders: apiCorsAllowedHeaders,
      exposeHeaders: browserUploadExposedHeaders,
      allowMethods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
      credentials: true,
      maxAge: 600,
    }),
  )
  const publicWriteSecurity = {
    bodyLimitBytes: env.AUTH_BODY_LIMIT_BYTES,
    rateLimitEnabled: env.INGRESS_RATE_LIMIT_PROVIDER === 'local',
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
    app.use('/api/uploads/*', middleware)
  }
  // Ingress budget for the subscription routes, uncomment together with them:
  // for (const middleware of createIngressSecurity({
  //   ...publicWriteSecurity,
  //   bodyLimitBytes: env.IAP_BODY_LIMIT_BYTES,
  //   rateLimitMax: env.IAP_RATE_LIMIT_MAX,
  //   rateLimitWindowSeconds: env.IAP_RATE_LIMIT_WINDOW_SECONDS,
  // })) {
  //   app.use('/api/iap/*', middleware)
  // }
  // // The only webhook producer today is the App Store, so this group goes with billing.
  // for (const middleware of createIngressSecurity({
  //   ...publicWriteSecurity,
  //   bodyLimitBytes: env.WEBHOOK_BODY_LIMIT_BYTES ?? defaultWebhookBodyLimitBytes,
  //   rateLimitMax: env.WEBHOOK_RATE_LIMIT_MAX ?? defaultWebhookRateLimitMax,
  //   rateLimitWindowSeconds:
  //     env.WEBHOOK_RATE_LIMIT_WINDOW_SECONDS ?? defaultWebhookRateLimitWindowSeconds,
  // })) {
  //   app.use('/api/webhooks/*', middleware)
  // }
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
  // app.route('/api/iap', billing.createRoutes(auth.authenticateAccessToken))
  app.route('/api/notifications', notifications.createRoutes(auth.authenticateAccessToken))
  app.route('/api/uploads', uploads.routes)
  // app.route('/api/webhooks', billing.webhookRoutes)

  // Only the filesystem driver needs the backend to serve the URLs it signs. With an S3 driver
  // the browser uploads straight to the bucket and there is nothing to mount here.
  if (storage.httpRoutes) {
    app.route('/storage', storage.httpRoutes)
  }

  app.doc('/openapi.json', {
    openapi: '3.0.0',
    info: { title: 'web_app_demo API', version: '1.0.0' },
  })
  app.notFound((c) => c.json(errorResponse('NOT_FOUND', 'Route not found'), 404))
  app.onError(handleError)
  return app
}

export type AppType = ReturnType<typeof createApp>
