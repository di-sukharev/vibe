import {
  apiErrorSchema,
  pushMutationResponseSchema,
  registerPushTokenRequestSchema,
  testPushNotificationRequestSchema,
  testPushNotificationResponseSchema,
  unregisterPushTokenRequestSchema,
} from '@web-app-demo/contracts'
import { createRoute, OpenAPIHono } from '@hono/zod-openapi'
import type { Context } from 'hono'

import { AppError, errorResponse } from '../../../http/errors'
import type { AuthenticatedPrincipal } from '../../auth'
import type { NotificationService } from '../application/notification-service'

type AuthenticateAccessToken = (
  accessToken: string | undefined,
) => Promise<AuthenticatedPrincipal>

const errorResponseContent = {
  'application/json': {
    schema: apiErrorSchema,
  },
}

const mutationResponseContent = {
  'application/json': {
    schema: pushMutationResponseSchema,
  },
}

const registerPushTokenRoute = createRoute({
  method: 'post',
  path: '/push-token',
  request: {
    body: {
      content: {
        'application/json': {
          schema: registerPushTokenRequestSchema,
        },
      },
    },
  },
  responses: {
    200: {
      content: mutationResponseContent,
      description: 'Registered Expo push token for the current user',
    },
    400: {
      content: errorResponseContent,
      description: 'Invalid payload',
    },
    401: {
      content: errorResponseContent,
      description: 'Invalid access token',
    },
  },
})

const unregisterPushTokenRoute = createRoute({
  method: 'post',
  path: '/push-token/unregister',
  request: {
    body: {
      content: {
        'application/json': {
          schema: unregisterPushTokenRequestSchema,
        },
      },
    },
  },
  responses: {
    200: {
      content: mutationResponseContent,
      description: 'Unregistered one or all Expo push tokens for the current user',
    },
    400: {
      content: errorResponseContent,
      description: 'Invalid payload',
    },
    401: {
      content: errorResponseContent,
      description: 'Invalid access token',
    },
  },
})

const testPushRoute = createRoute({
  method: 'post',
  path: '/test-push',
  request: {
    body: {
      content: {
        'application/json': {
          schema: testPushNotificationRequestSchema,
        },
      },
    },
  },
  responses: {
    200: {
      content: {
        'application/json': {
          schema: testPushNotificationResponseSchema,
        },
      },
      description: 'Queued and processed a test push notification for the current user',
    },
    400: {
      content: errorResponseContent,
      description: 'Invalid payload',
    },
    401: {
      content: errorResponseContent,
      description: 'Invalid access token',
    },
    409: {
      content: errorResponseContent,
      description: 'The current user has no active push token',
    },
  },
})

export function createNotificationRoutes(input: {
  authenticateAccessToken: AuthenticateAccessToken
  service: NotificationService
}) {
  const routes = new OpenAPIHono({
    defaultHook: (result, c) => {
      if (!result.success) {
        return c.json(
          errorResponse('VALIDATION_ERROR', 'Invalid request payload', result.error.issues),
          400,
        )
      }
    },
  })

  routes.openapi(registerPushTokenRoute, async (c) => {
    const userId = await currentUserId(c, input.authenticateAccessToken)
    await input.service.registerToken(userId, c.req.valid('json'))
    return c.json({ ok: true as const }, 200)
  })

  routes.openapi(unregisterPushTokenRoute, async (c) => {
    const userId = await currentUserId(c, input.authenticateAccessToken)
    await input.service.unregisterToken(userId, c.req.valid('json'))
    return c.json({ ok: true as const }, 200)
  })

  routes.openapi(testPushRoute, async (c) => {
    const userId = await currentUserId(c, input.authenticateAccessToken)

    if (!(await input.service.hasActiveToken(userId))) {
      throw new AppError(409, 'CONFLICT', 'No active Expo push token registered for this user')
    }

    const queued = await input.service.sendTestPush(userId, c.req.valid('json'))

    return c.json({ ok: true as const, outboxId: queued.id }, 200)
  })

  return routes
}

async function currentUserId(c: Context, authenticateAccessToken: AuthenticateAccessToken) {
  return (await authenticateAccessToken(bearerToken(c))).id
}

function bearerToken(c: Context) {
  const authorization = c.req.header('authorization')
  if (!authorization?.startsWith('Bearer ')) return undefined
  return authorization.slice('Bearer '.length)
}
