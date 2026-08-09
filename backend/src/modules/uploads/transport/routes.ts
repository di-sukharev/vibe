import {
  apiErrorSchema,
  avatarResponseSchema,
  avatarUploadParamsSchema,
  createAvatarUploadRequestSchema,
  createAvatarUploadResponseSchema,
} from '@web-app-demo/contracts'
import { createRoute, OpenAPIHono } from '@hono/zod-openapi'
import type { MiddlewareHandler } from 'hono'

import { validationErrorHook } from '../../../http/errors'
import type { AuthHttpEnv } from '../../auth'
import type { AvatarsService } from '../application/avatars-service'
import { executeUploads } from './errors'

const errorContent = {
  'application/json': {
    schema: apiErrorSchema,
  },
}

const bearerSecurity = [{ BearerAuth: [] }]

const createAvatarUploadRoute = createRoute({
  method: 'post',
  path: '/avatar',
  security: bearerSecurity,
  request: {
    body: {
      content: {
        'application/json': {
          schema: createAvatarUploadRequestSchema,
        },
      },
    },
  },
  responses: {
    201: {
      content: { 'application/json': { schema: createAvatarUploadResponseSchema } },
      description: 'Presigned upload ticket for a new avatar',
    },
    400: { content: errorContent, description: 'Invalid payload' },
    401: { content: errorContent, description: 'Authentication required' },
    413: { content: errorContent, description: 'Request body is too large' },
    429: { content: errorContent, description: 'Too many requests' },
  },
})

const finalizeAvatarUploadRoute = createRoute({
  method: 'post',
  path: '/avatar/{uploadId}/finalize',
  security: bearerSecurity,
  request: {
    params: avatarUploadParamsSchema,
  },
  responses: {
    200: {
      content: { 'application/json': { schema: avatarResponseSchema } },
      description: 'The stored avatar, now published',
    },
    400: { content: errorContent, description: 'Invalid upload id' },
    401: { content: errorContent, description: 'Authentication required' },
    404: { content: errorContent, description: 'Upload not found' },
    409: { content: errorContent, description: 'Upload incomplete or rejected' },
    410: { content: errorContent, description: 'Upload window expired' },
    429: { content: errorContent, description: 'Too many requests' },
  },
})

const getAvatarRoute = createRoute({
  method: 'get',
  path: '/avatar',
  security: bearerSecurity,
  responses: {
    200: {
      content: { 'application/json': { schema: avatarResponseSchema } },
      description: 'The current avatar, or null when there is none',
    },
    401: { content: errorContent, description: 'Authentication required' },
    429: { content: errorContent, description: 'Too many requests' },
  },
})

const deleteAvatarRoute = createRoute({
  method: 'delete',
  path: '/avatar',
  security: bearerSecurity,
  responses: {
    200: {
      content: { 'application/json': { schema: avatarResponseSchema } },
      description: 'Avatar removed; idempotent',
    },
    401: { content: errorContent, description: 'Authentication required' },
    429: { content: errorContent, description: 'Too many requests' },
  },
})

type CreateUploadsRoutesOptions = {
  requireAuth: MiddlewareHandler<AuthHttpEnv>
  service: AvatarsService
}

export function createUploadsRoutes({ requireAuth, service }: CreateUploadsRoutesOptions) {
  const routes = new OpenAPIHono<AuthHttpEnv>({ defaultHook: validationErrorHook })

  routes.use('*', requireAuth)

  routes.openapi(createAvatarUploadRoute, async (c) => {
    const result = await executeUploads(() =>
      service.createUpload(c.var.user.id, c.req.valid('json')),
    )
    return c.json(result, 201)
  })

  routes.openapi(finalizeAvatarUploadRoute, async (c) => {
    const result = await executeUploads(() =>
      service.finalizeUpload(c.var.user.id, c.req.valid('param').uploadId),
    )
    return c.json(result, 200)
  })

  routes.openapi(getAvatarRoute, async (c) => {
    return c.json(await service.getAvatar(c.var.user.id), 200)
  })

  routes.openapi(deleteAvatarRoute, async (c) => {
    return c.json(await service.removeAvatar(c.var.user.id), 200)
  })

  return routes
}
