import {
  apiErrorSchema,
  cookieAuthResponseSchema,
  cookieLogoutRequestSchema,
  cookieRefreshRequestSchema,
  cookieRefreshResponseSchema,
  loginRequestSchema,
  meResponseSchema,
  passwordResetConfirmRequestSchema,
  passwordResetRequestResponseSchema,
  passwordResetRequestSchema,
  registerRequestSchema,
  socialAuthProviderParamsSchema,
  socialAuthRequestSchema,
  tokenAuthResponseSchema,
  tokenLogoutRequestSchema,
  tokenRefreshRequestSchema,
  tokenRefreshResponseSchema,
} from '@web-app-demo/contracts'
import { createRoute, OpenAPIHono } from '@hono/zod-openapi'
import type { Context, MiddlewareHandler } from 'hono'
import { deleteCookie, getCookie, setCookie } from 'hono/cookie'

import type { AppEnv } from '../../../env'
import { AppError, validationErrorHook } from '../../../http/errors'
import { ingressErrorResponses } from '../../../http/openapi'
import { clientAddress } from '../../../http/security'
import type { AuthService } from '../application/auth-service'
import { userDtoFromPrincipal } from '../domain/user'
import { executeAuth } from './errors'
import type { AuthHttpEnv } from './middleware'

const refreshCookieName = 'web_app_demo_refresh'
const bearerSecurity = [{ BearerAuth: [] }]

const cookieAuthResponseContent = {
  'application/json': {
    schema: cookieAuthResponseSchema,
  },
}

const tokenAuthResponseContent = {
  'application/json': {
    schema: tokenAuthResponseSchema,
  },
}

const cookieRefreshResponseContent = {
  'application/json': {
    schema: cookieRefreshResponseSchema,
  },
}

const tokenRefreshResponseContent = {
  'application/json': {
    schema: tokenRefreshResponseSchema,
  },
}

const meResponseContent = {
  'application/json': {
    schema: meResponseSchema,
  },
}

const passwordResetRequestResponseContent = {
  'application/json': {
    schema: passwordResetRequestResponseSchema,
  },
}

const errorResponseContent = {
  'application/json': {
    schema: apiErrorSchema,
  },
}

const cookieRegisterRoute = createRoute({
  method: 'post',
  path: '/register',
  request: {
    body: {
      content: {
        'application/json': {
          schema: registerRequestSchema,
        },
      },
    },
  },
  responses: {
    ...ingressErrorResponses,
    201: {
      content: cookieAuthResponseContent,
      description: 'Created user and browser session',
    },
    400: { content: errorResponseContent, description: 'Invalid payload' },
    403: {
      content: errorResponseContent,
      description: 'Cookie auth request came from an untrusted browser origin',
    },
    409: { content: errorResponseContent, description: 'Email already exists' },
  },
})

const tokenRegisterRoute = createRoute({
  method: 'post',
  path: '/token/register',
  request: {
    body: {
      content: {
        'application/json': {
          schema: registerRequestSchema,
        },
      },
    },
  },
  responses: {
    ...ingressErrorResponses,
    201: {
      content: tokenAuthResponseContent,
      description: 'Created user and explicit token session',
    },
    400: { content: errorResponseContent, description: 'Invalid payload' },
    409: { content: errorResponseContent, description: 'Email already exists' },
  },
})

const cookieLoginRoute = createRoute({
  method: 'post',
  path: '/login',
  request: {
    body: {
      content: {
        'application/json': {
          schema: loginRequestSchema,
        },
      },
    },
  },
  responses: {
    ...ingressErrorResponses,
    200: {
      content: cookieAuthResponseContent,
      description: 'Created browser session',
    },
    400: { content: errorResponseContent, description: 'Invalid payload' },
    401: { content: errorResponseContent, description: 'Invalid credentials' },
    403: {
      content: errorResponseContent,
      description: 'Cookie auth request came from an untrusted browser origin',
    },
  },
})

const tokenLoginRoute = createRoute({
  method: 'post',
  path: '/token/login',
  request: {
    body: {
      content: {
        'application/json': {
          schema: loginRequestSchema,
        },
      },
    },
  },
  responses: {
    ...ingressErrorResponses,
    200: {
      content: tokenAuthResponseContent,
      description: 'Created explicit token session',
    },
    400: { content: errorResponseContent, description: 'Invalid payload' },
    401: { content: errorResponseContent, description: 'Invalid credentials' },
  },
})

const tokenSocialAuthRoute = createRoute({
  method: 'post',
  path: '/token/social/{provider}',
  request: {
    params: socialAuthProviderParamsSchema,
    body: {
      content: {
        'application/json': {
          schema: socialAuthRequestSchema,
        },
      },
    },
  },
  responses: {
    ...ingressErrorResponses,
    200: { content: tokenAuthResponseContent, description: 'Created social session' },
    201: { content: tokenAuthResponseContent, description: 'Created social user and session' },
    400: { content: errorResponseContent, description: 'Invalid payload' },
    401: { content: errorResponseContent, description: 'Invalid provider token' },
    409: { content: errorResponseContent, description: 'Email or provider account already exists' },
    503: { content: errorResponseContent, description: 'Social auth provider unavailable' },
  },
})

const cookieRefreshRoute = createRoute({
  method: 'post',
  path: '/refresh',
  request: {
    body: {
      content: {
        'application/json': {
          schema: cookieRefreshRequestSchema,
        },
      },
    },
  },
  responses: {
    ...ingressErrorResponses,
    200: {
      content: cookieRefreshResponseContent,
      description: 'Rotated browser session and returned a new access token',
    },
    400: { content: errorResponseContent, description: 'Invalid payload' },
    401: { content: errorResponseContent, description: 'Invalid refresh token' },
    403: {
      content: errorResponseContent,
      description: 'Cookie auth request came from an untrusted browser origin',
    },
  },
})

const tokenRefreshRoute = createRoute({
  method: 'post',
  path: '/token/refresh',
  request: {
    body: {
      content: {
        'application/json': {
          schema: tokenRefreshRequestSchema,
        },
      },
    },
  },
  responses: {
    ...ingressErrorResponses,
    200: {
      content: tokenRefreshResponseContent,
      description: 'Rotated explicit token session',
    },
    400: { content: errorResponseContent, description: 'Invalid payload' },
    401: { content: errorResponseContent, description: 'Invalid refresh token' },
  },
})

const meRoute = createRoute({
  method: 'get',
  path: '/me',
  security: bearerSecurity,
  responses: {
    200: { content: meResponseContent, description: 'Current user' },
    401: { content: errorResponseContent, description: 'Invalid access token' },
  },
})

const cookieLogoutRoute = createRoute({
  method: 'post',
  path: '/logout',
  request: {
    body: {
      content: {
        'application/json': {
          schema: cookieLogoutRequestSchema,
        },
      },
    },
  },
  responses: {
    ...ingressErrorResponses,
    204: { description: 'Browser session revoked' },
    400: { content: errorResponseContent, description: 'Invalid payload' },
    403: {
      content: errorResponseContent,
      description: 'Cookie auth request came from an untrusted browser origin',
    },
  },
})

const tokenLogoutRoute = createRoute({
  method: 'post',
  path: '/token/logout',
  request: {
    body: {
      content: {
        'application/json': {
          schema: tokenLogoutRequestSchema,
        },
      },
    },
  },
  responses: {
    ...ingressErrorResponses,
    204: { description: 'Explicit token session revoked' },
    400: { content: errorResponseContent, description: 'Invalid payload' },
  },
})

const passwordResetRequestRoute = createRoute({
  method: 'post',
  path: '/password-reset/request',
  request: {
    body: {
      content: {
        'application/json': {
          schema: passwordResetRequestSchema,
        },
      },
    },
  },
  responses: {
    ...ingressErrorResponses,
    202: {
      content: passwordResetRequestResponseContent,
      description: 'Password reset request accepted',
    },
    400: { content: errorResponseContent, description: 'Invalid payload' },
  },
})

const passwordResetConfirmRoute = createRoute({
  method: 'post',
  path: '/password-reset/confirm',
  request: {
    body: {
      content: {
        'application/json': {
          schema: passwordResetConfirmRequestSchema,
        },
      },
    },
  },
  responses: {
    ...ingressErrorResponses,
    204: { description: 'Password changed and existing sessions revoked' },
    400: {
      content: errorResponseContent,
      description: 'Invalid payload or reset link',
    },
  },
})

type CreateAuthRoutesOptions = {
  env: AppEnv
  requireAuth: MiddlewareHandler<AuthHttpEnv>
  service: AuthService
}

export function createAuthRoutes({ env, requireAuth, service }: CreateAuthRoutesOptions) {
  const routes = new OpenAPIHono<AuthHttpEnv>({ defaultHook: validationErrorHook })
  const protectedRoutes = new OpenAPIHono<AuthHttpEnv>({
    defaultHook: validationErrorHook,
  })

  routes.openapi(cookieRegisterRoute, async (c) => {
    assertTrustedCookieOrigin(c, env)
    const result = await executeAuth(() => service.register(c.req.valid('json'), requestMetadata(c, env)))
    setRefreshCookie(c, result.refreshToken, env)
    return c.json(withoutRefreshToken(result), 201)
  })

  routes.openapi(tokenRegisterRoute, async (c) => {
    const result = await executeAuth(() => service.register(c.req.valid('json'), requestMetadata(c, env)))
    return c.json(result, 201)
  })

  routes.openapi(cookieLoginRoute, async (c) => {
    assertTrustedCookieOrigin(c, env)
    const result = await executeAuth(() => service.login(c.req.valid('json'), requestMetadata(c, env)))
    setRefreshCookie(c, result.refreshToken, env)
    return c.json(withoutRefreshToken(result), 200)
  })

  routes.openapi(tokenLoginRoute, async (c) => {
    const result = await executeAuth(() => service.login(c.req.valid('json'), requestMetadata(c, env)))
    return c.json(result, 200)
  })

  // Sign in with Apple / Google is turned off: the route is defined but not mounted.
  // Uncomment this block and the buttons in the mobile AuthScreen to enable it, then follow
  // docs/SOCIAL_AUTH.md for the provider credentials.
  // routes.openapi(tokenSocialAuthRoute, async (c) => {
  //   const result = await executeAuth(() =>
  //     service.socialAuth(
  //       c.req.valid('param').provider,
  //       c.req.valid('json'),
  //       requestMetadata(c, env),
  //     ),
  //   )
  //   const { created, ...session } = result
  //   return c.json(session, created ? 201 : 200)
  // })

  routes.openapi(cookieRefreshRoute, async (c) => {
    const cookieRefreshToken = getRefreshCookie(c)
    assertTrustedCookieOrigin(c, env)
    const result = await executeAuth(() => service.refresh(cookieRefreshToken, requestMetadata(c, env)))
    setRefreshCookie(c, result.refreshToken, env)
    return c.json(withoutRefreshToken(result), 200)
  })

  routes.openapi(tokenRefreshRoute, async (c) => {
    const result = await executeAuth(() =>
      service.refresh(c.req.valid('json').refreshToken, requestMetadata(c, env)),
    )
    return c.json(result, 200)
  })

  protectedRoutes.use('/me', requireAuth)
  protectedRoutes.openapi(meRoute, async (c) => {
    return c.json({ user: userDtoFromPrincipal(c.var.user) }, 200)
  })
  routes.route('/', protectedRoutes)

  routes.openapi(cookieLogoutRoute, async (c) => {
    const cookieRefreshToken = getRefreshCookie(c)
    assertTrustedCookieOrigin(c, env)
    await executeAuth(() => service.logout(cookieRefreshToken))
    deleteRefreshCookie(c, env)
    return c.body(null, 204)
  })

  routes.openapi(tokenLogoutRoute, async (c) => {
    const body = c.req.valid('json')
    const sessionRevoked = await executeAuth(() =>
      service.logout(body.refreshToken, logoutExpoPushTokens(body)),
    )
    c.header('X-Auth-Session-Revoked', sessionRevoked ? 'true' : 'false')
    return c.body(null, 204)
  })

  routes.openapi(passwordResetRequestRoute, async (c) => {
    const result = await executeAuth(() =>
      service.requestPasswordReset(c.req.valid('json')),
    )
    return c.json(result, 202)
  })

  routes.openapi(passwordResetConfirmRoute, async (c) => {
    await executeAuth(() => service.confirmPasswordReset(c.req.valid('json')))
    deleteRefreshCookie(c, env)
    return c.body(null, 204)
  })

  return routes
}

function logoutExpoPushTokens(input: {
  expoPushToken?: string
  expoPushTokens?: string[]
}) {
  return [
    ...new Set(
      [input.expoPushToken, ...(input.expoPushTokens ?? [])].filter(
        (token): token is string => Boolean(token),
      ),
    ),
  ]
}

function requestMetadata(c: Context, env: AppEnv): { userAgent?: string; ipAddress?: string } {
  const ipAddress = clientAddress(c, {
    trustProxy: env.TRUST_PROXY,
    trustedProxyClientIpHeader: env.TRUSTED_PROXY_CLIENT_IP_HEADER,
    trustedProxyClientIpPosition: env.TRUSTED_PROXY_CLIENT_IP_POSITION,
  })
  return {
    userAgent: c.req.header('user-agent'),
    ipAddress: ipAddress === 'unknown' ? undefined : ipAddress,
  }
}

function getRefreshCookie(c: Context) {
  return getCookie(c, refreshCookieName)
}

function assertTrustedCookieOrigin(c: Context, env: AppEnv) {
  if (!env.COOKIE_SECURE) return

  const origin = c.req.header('origin')
  if (origin && env.CORS_ORIGINS.includes(origin)) return

  throw new AppError(403, 'FORBIDDEN', 'Cookie auth requests require a trusted Origin')
}

function setRefreshCookie(c: Context, refreshToken: string, env: AppEnv) {
  setCookie(c, refreshCookieName, refreshToken, {
    httpOnly: true,
    secure: env.COOKIE_SECURE,
    sameSite: refreshCookieSameSite(env),
    path: '/api/auth',
    maxAge: env.REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60,
  })
}

function deleteRefreshCookie(c: Context, env: AppEnv) {
  deleteCookie(c, refreshCookieName, {
    path: '/api/auth',
    secure: env.COOKIE_SECURE,
    sameSite: refreshCookieSameSite(env),
  })
}

function refreshCookieSameSite(env: AppEnv) {
  return env.COOKIE_SECURE ? 'None' : 'Lax'
}

function withoutRefreshToken<T extends { refreshToken: string }>(response: T): Omit<T, 'refreshToken'> {
  const { refreshToken: _refreshToken, ...cookieResponse } = response
  return cookieResponse
}
