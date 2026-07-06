import { createMiddleware } from 'hono/factory'

import type { AuthenticatedHonoEnv } from '../http/context'

export const requireAuth = createMiddleware<AuthenticatedHonoEnv>(async (c, next) => {
  const accessToken = bearerToken(c.req.header('authorization'))
  const user = await c.var.authService.authenticateAccessToken(accessToken)
  c.set('user', user)

  await next()
})

function bearerToken(authorization: string | undefined) {
  if (!authorization?.startsWith('Bearer ')) return undefined
  return authorization.slice('Bearer '.length)
}
