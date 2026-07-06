import {
  apiErrorSchema,
  authResponseSchema,
  loginRequestSchema,
  logoutRequestSchema,
  meResponseSchema,
  refreshRequestSchema,
  refreshResponseSchema,
  registerRequestSchema,
  socialAuthProviderParamsSchema,
  socialAuthRequestSchema,
} from '@web-app-demo/contracts'
import { createRoute, OpenAPIHono } from '@hono/zod-openapi'
import type { Context } from 'hono'
import { deleteCookie, getCookie, setCookie } from 'hono/cookie'

import type { AppEnv } from '../env'
import type { AppHonoEnv, AuthenticatedHonoEnv } from '../http/context'
import { userDtoFromAuthenticatedUser } from '../http/context'
import { AppError, validationErrorHook } from '../http/errors'
import { requireAuth } from './middleware'

const refreshCookieName = 'web_app_demo_refresh'

const authResponseContent = {
  'application/json': {
    schema: authResponseSchema,
  },
}

const refreshResponseContent = {
  'application/json': {
    schema: refreshResponseSchema,
  },
}

const meResponseContent = {
  'application/json': {
    schema: meResponseSchema,
  },
}

const errorResponseContent = {
  'application/json': {
    schema: apiErrorSchema,
  },
}

const registerRoute = createRoute({
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
    201: {
      content: authResponseContent,
      description: 'Created user and session',
    },
    400: {
      content: errorResponseContent,
      description: 'Invalid payload',
    },
    409: {
      content: errorResponseContent,
      description: 'Email already exists',
    },
  },
})

const loginRoute = createRoute({
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
    200: {
      content: authResponseContent,
      description: 'Created session',
    },
    400: {
      content: errorResponseContent,
      description: 'Invalid payload',
    },
    401: {
      content: errorResponseContent,
      description: 'Invalid credentials',
    },
  },
})

const socialAuthRoute = createRoute({
  method: 'post',
  path: '/social/{provider}',
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
    200: {
      content: authResponseContent,
      description: 'Created session for an existing social auth user',
    },
    201: {
      content: authResponseContent,
      description: 'Created social auth user and session',
    },
    400: {
      content: errorResponseContent,
      description: 'Invalid payload',
    },
    401: {
      content: errorResponseContent,
      description: 'Invalid provider token',
    },
    409: {
      content: errorResponseContent,
      description: 'Email or provider account already exists',
    },
    503: {
      content: errorResponseContent,
      description: 'Social auth provider is unavailable or not configured',
    },
  },
})

const refreshRoute = createRoute({
  method: 'post',
  path: '/refresh',
  request: {
    body: {
      content: {
        'application/json': {
          schema: refreshRequestSchema,
        },
      },
    },
  },
  responses: {
    200: {
      content: refreshResponseContent,
      description: 'Rotated refresh session and returned a new access token',
    },
    400: {
      content: errorResponseContent,
      description: 'Invalid payload',
    },
    401: {
      content: errorResponseContent,
      description: 'Invalid refresh token',
    },
    403: {
      content: errorResponseContent,
      description: 'Cookie auth request came from an untrusted browser origin',
    },
  },
})

const meRoute = createRoute({
  method: 'get',
  path: '/me',
  responses: {
    200: {
      content: meResponseContent,
      description: 'Current user',
    },
    401: {
      content: errorResponseContent,
      description: 'Invalid access token',
    },
  },
})

const logoutRoute = createRoute({
  method: 'post',
  path: '/logout',
  request: {
    body: {
      content: {
        'application/json': {
          schema: logoutRequestSchema,
        },
      },
    },
  },
  responses: {
    204: {
      description: 'Session revoked',
    },
    400: {
      content: errorResponseContent,
      description: 'Invalid payload',
    },
    403: {
      content: errorResponseContent,
      description: 'Cookie auth request came from an untrusted browser origin',
    },
  },
})

export function createAuthRoutes() {
  const routes = new OpenAPIHono<AppHonoEnv>({
    defaultHook: validationErrorHook,
  })
  const protectedRoutes = new OpenAPIHono<AuthenticatedHonoEnv>({
    defaultHook: validationErrorHook,
  })

  routes.openapi(registerRoute, async (c) => {
    const auth = c.get('authService')
    const env = c.get('env')
    const result = await auth.register(c.req.valid('json'), requestMetadata(c))
    setRefreshCookie(c, result.refreshToken, env)

    return c.json(responseForClient(c, result), 201)
  })

  routes.openapi(loginRoute, async (c) => {
    const auth = c.get('authService')
    const env = c.get('env')
    const result = await auth.login(c.req.valid('json'), requestMetadata(c))
    setRefreshCookie(c, result.refreshToken, env)

    return c.json(responseForClient(c, result), 200)
  })

  routes.openapi(socialAuthRoute, async (c) => {
    const auth = c.get('authService')
    const env = c.get('env')
    const result = await auth.socialAuth(
      c.req.valid('param').provider,
      c.req.valid('json'),
      requestMetadata(c),
    )
    const { created, ...session } = result
    setRefreshCookie(c, session.refreshToken, env)

    return c.json(responseForClient(c, session), created ? 201 : 200)
  })

  routes.openapi(refreshRoute, async (c) => {
    const auth = c.get('authService')
    const env = c.get('env')
    const body = c.req.valid('json')
    const cookieRefreshToken = getRefreshCookie(c)
    assertTrustedCookieRequest(c, env, body.refreshToken, cookieRefreshToken)
    const result = await auth.refresh(body.refreshToken ?? cookieRefreshToken, requestMetadata(c))
    setRefreshCookie(c, result.refreshToken, env)

    return c.json(responseForClient(c, result), 200)
  })

  protectedRoutes.use('/me', requireAuth)
  protectedRoutes.openapi(meRoute, async (c) => {
    return c.json({ user: userDtoFromAuthenticatedUser(c.var.user) }, 200)
  })
  routes.route('/', protectedRoutes)

  routes.openapi(logoutRoute, async (c) => {
    const auth = c.get('authService')
    const env = c.get('env')
    const body = c.req.valid('json')
    const cookieRefreshToken = getRefreshCookie(c)
    assertTrustedCookieRequest(c, env, body.refreshToken, cookieRefreshToken)
    const sessionRevoked = await auth.logout({
      expoPushToken: body.expoPushToken,
      expoPushTokens: body.expoPushTokens,
      refreshToken: body.refreshToken ?? cookieRefreshToken,
    })
    deleteCookie(c, refreshCookieName, {
      path: '/api/auth',
      secure: env.COOKIE_SECURE,
      sameSite: refreshCookieSameSite(env),
    })
    c.header('X-Auth-Session-Revoked', sessionRevoked ? 'true' : 'false')

    return c.body(null, 204)
  })

  return routes
}

function requestMetadata(c: Context): { userAgent?: string; ipAddress?: string } {
  const forwardedFor = c.req.header('x-forwarded-for')
  return {
    userAgent: c.req.header('user-agent'),
    ipAddress: forwardedFor?.split(',')[0]?.trim(),
  }
}

function getRefreshCookie(c: Context) {
  return getCookie(c, refreshCookieName)
}

function assertTrustedCookieRequest(
  c: Context,
  env: AppEnv,
  bodyRefreshToken: string | undefined,
  cookieRefreshToken: string | undefined,
) {
  if (!env.COOKIE_SECURE || bodyRefreshToken !== undefined || !cookieRefreshToken) {
    return
  }

  const origin = c.req.header('origin')
  if (origin && env.CORS_ORIGINS.includes(origin)) {
    return
  }

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

function refreshCookieSameSite(env: AppEnv) {
  return env.COOKIE_SECURE ? 'None' : 'Lax'
}

function responseForClient<T extends { refreshToken: string }>(c: Context, response: T) {
  if (c.req.header('x-client-platform') === 'mobile') {
    return response
  }

  const { refreshToken: _refreshToken, ...webResponse } = response
  return webResponse
}
