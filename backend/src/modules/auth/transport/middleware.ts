import { createMiddleware } from 'hono/factory'

import type { AuthenticatedPrincipal } from '../domain/user'
import { executeAuth } from './errors'

export type AuthHttpEnv = {
  Variables: {
    user: AuthenticatedPrincipal
  }
}

export function createRequireAuth(
  authenticate: (accessToken: string | undefined) => Promise<AuthenticatedPrincipal>,
) {
  return createMiddleware<AuthHttpEnv>(async (c, next) => {
    const accessToken = bearerToken(c.req.header('authorization'))
    const user = await executeAuth(() => authenticate(accessToken))
    c.set('user', user)
    await next()
  })
}

function bearerToken(authorization: string | undefined) {
  if (!authorization?.startsWith('Bearer ')) return undefined
  return authorization.slice('Bearer '.length)
}
