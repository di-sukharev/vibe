import type { Context, Env, MiddlewareHandler } from 'hono'
import { getConnInfo } from 'hono/bun'
import { bodyLimit } from 'hono/body-limit'
import { isIP } from 'node:net'

import { errorResponse } from './errors'

type IngressSecurityOptions = {
  bodyLimitBytes: number
  rateLimitMax: number
  rateLimitWindowSeconds: number
  trustProxy: boolean
  trustedProxyClientIpHeader?: string
  trustedProxyClientIpPosition?: 'first' | 'last'
}

type RateLimitBucket = {
  count: number
  resetAt: number
}

type FixedWindowRateLimitOptions<E extends Env> = {
  errorMessage: string
  key: (c: Context<E>) => string
  max: number
  now?: () => number
  windowSeconds: number
}

const maxTrackedKeys = 10_000

export function createIngressSecurity(options: IngressSecurityOptions): MiddlewareHandler[] {
  return [
    bodyLimit({
      maxSize: options.bodyLimitBytes,
      onError: (c) => c.json(errorResponse('PAYLOAD_TOO_LARGE', 'Request body is too large'), 413),
    }),
    createIngressRateLimit(options),
  ]
}

function createIngressRateLimit(options: IngressSecurityOptions): MiddlewareHandler {
  const rateLimit = createFixedWindowRateLimit({
    errorMessage: 'Too many requests',
    key: (c) => clientAddress(c, options),
    max: options.rateLimitMax,
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

export function createFixedWindowRateLimit<E extends Env>(
  options: FixedWindowRateLimitOptions<E>,
): MiddlewareHandler<E> {
  // This bounded store is intentionally process-local. Replace it with shared state when
  // requests for one rate-limit policy can be served by multiple backend processes.
  const buckets = new Map<string, RateLimitBucket>()
  const now = options.now ?? Date.now
  const windowMs = options.windowSeconds * 1000

  return async (c, next) => {
    const currentTime = now()
    let key = options.key(c)
    let bucket = buckets.get(key)

    if (!bucket || bucket.resetAt <= currentTime) {
      if (buckets.size >= maxTrackedKeys - 1) {
        deleteExpiredBuckets(buckets, currentTime)
      }
      if (buckets.size >= maxTrackedKeys - 1) {
        key = 'overflow'
        bucket = buckets.get(key)
      }
    }

    if (!bucket || bucket.resetAt <= currentTime) {
      bucket = { count: 0, resetAt: currentTime + windowMs }
      buckets.set(key, bucket)
    }

    bucket.count += 1
    c.header('RateLimit-Limit', String(options.max))
    c.header('RateLimit-Remaining', String(Math.max(0, options.max - bucket.count)))
    c.header('RateLimit-Reset', String(Math.ceil(bucket.resetAt / 1000)))

    if (bucket.count > options.max) {
      c.header('Retry-After', String(Math.max(1, Math.ceil((bucket.resetAt - currentTime) / 1000))))
      return c.json(errorResponse('RATE_LIMITED', options.errorMessage), 429)
    }

    await next()
  }
}

export function clientAddress(
  c: Context,
  options: Pick<
    IngressSecurityOptions,
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

function deleteExpiredBuckets(buckets: Map<string, RateLimitBucket>, now: number) {
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(key)
  }
}
