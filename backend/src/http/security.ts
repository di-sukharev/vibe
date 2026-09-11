import type { Context, Env, MiddlewareHandler } from 'hono'
import { getConnInfo } from 'hono/bun'
import { bodyLimit } from 'hono/body-limit'
import { isIP } from 'node:net'

import { createMemoryRateLimitStore } from '../rate-limit/memory-store'
import type { RateLimitStoreFactory } from '../rate-limit/port'
import { errorResponse } from './errors'

type AuthSecurityOptions = {
  bodyLimitBytes: number
  rateLimitMax: number
  rateLimitWindowSeconds: number
  /** Builds the counter store for the budget. Defaults to a process-local one; see rate-limit/port.ts. */
  store?: RateLimitStoreFactory
  trustProxy: boolean
  trustedProxyClientIpHeader?: string
  trustedProxyClientIpPosition?: 'first' | 'last'
}

type FixedWindowRateLimitOptions<E extends Env> = {
  errorMessage: string
  key: (c: Context<E>) => string
  max: number
  /** Bound on the default memory store's table. Ignored when `store` is given. */
  maxTrackedKeys?: number
  now?: () => number
  /** Builds the counter store for the budget. Defaults to a process-local one; see rate-limit/port.ts. */
  store?: RateLimitStoreFactory
  windowSeconds: number
}

export function createAuthSecurity(options: AuthSecurityOptions): MiddlewareHandler[] {
  return [
    bodyLimit({
      maxSize: options.bodyLimitBytes,
      onError: (c) => c.json(errorResponse('PAYLOAD_TOO_LARGE', 'Request body is too large'), 413),
    }),
    createAuthRateLimit(options),
  ]
}

function createAuthRateLimit(options: AuthSecurityOptions): MiddlewareHandler {
  const rateLimit = createFixedWindowRateLimit({
    errorMessage: 'Too many authentication requests',
    key: (c) => clientAddress(c, options),
    max: options.rateLimitMax,
    store: options.store,
    windowSeconds: options.rateLimitWindowSeconds,
  })

  return async (c, next) => {
    if (c.req.method === 'OPTIONS' || c.req.method === 'GET') {
      await next()
      return
    }

    return rateLimit(c, next)
  }
}

/**
 * Fixed-window limiting over whichever store the caller hands in. The store owns the counting
 * and the window; this owns the budget, the headers and the refusal. The default store is
 * process-local, which is the whole truth only while one process serves every request - see
 * rate-limit/port.ts for the shared one.
 */
export function createFixedWindowRateLimit<E extends Env>(
  options: FixedWindowRateLimitOptions<E>,
): MiddlewareHandler<E> {
  const store = options.store
    ? options.store({ max: options.max })
    : createMemoryRateLimitStore({ max: options.max, maxTrackedKeys: options.maxTrackedKeys })
  const now = options.now ?? Date.now

  return async (c, next) => {
    const currentTime = now()
    const { count, resetAt } = await store.consume(
      options.key(c),
      options.windowSeconds,
      currentTime,
    )

    c.header('RateLimit-Limit', String(options.max))
    c.header('RateLimit-Remaining', String(Math.max(0, options.max - count)))
    c.header('RateLimit-Reset', String(Math.ceil(resetAt / 1000)))

    if (count > options.max) {
      return rateLimited(c, options, resetAt, currentTime)
    }

    await next()
  }
}

export function clientAddress(
  c: Context,
  options: Pick<
    AuthSecurityOptions,
    'trustProxy' | 'trustedProxyClientIpHeader' | 'trustedProxyClientIpPosition'
  >,
) {
  if (options.trustProxy && options.trustedProxyClientIpHeader) {
    const addresses = c.req
      .header(options.trustedProxyClientIpHeader)
      ?.split(',')
      .map((address) => address.trim())
      .filter(Boolean)
    const forwardedAddress = options.trustedProxyClientIpPosition === 'last'
      ? addresses?.at(-1)
      : addresses?.[0]
    if (forwardedAddress && isIP(forwardedAddress)) return forwardedAddress
  }

  try {
    return getConnInfo(c).remote.address || 'unknown'
  } catch {
    return 'unknown'
  }
}

function rateLimited<E extends Env>(
  c: Context<E>,
  options: FixedWindowRateLimitOptions<E>,
  resetAt: number,
  now: number,
) {
  c.header('RateLimit-Limit', String(options.max))
  c.header('RateLimit-Remaining', '0')
  c.header('RateLimit-Reset', String(Math.ceil(resetAt / 1000)))
  c.header('Retry-After', String(Math.max(1, Math.ceil((resetAt - now) / 1000))))
  return c.json(errorResponse('RATE_LIMITED', options.errorMessage), 429)
}
