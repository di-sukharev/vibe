import type { Context, Env, MiddlewareHandler } from 'hono'
import { getConnInfo } from 'hono/bun'
import { bodyLimit } from 'hono/body-limit'
import { isIP } from 'node:net'

import { errorResponse } from './errors'

type AuthSecurityOptions = {
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
  maxTrackedKeys?: number
  now?: () => number
  windowSeconds: number
}

const maxTrackedKeys = 10_000

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
  const trackedKeyLimit = options.maxTrackedKeys ?? maxTrackedKeys

  return async (c, next) => {
    const currentTime = now()
    let key = options.key(c)
    let bucket = buckets.get(key)

    if (!bucket || bucket.resetAt <= currentTime) {
      if (buckets.size >= trackedKeyLimit) {
        deleteExpiredBuckets(buckets, currentTime)
      }
      if (buckets.size >= trackedKeyLimit && !evictOneUnexhaustedBucket(buckets, options.max)) {
        // Every tracked key already spent its budget, so the table holds nothing but the counters
        // currently doing the limiting. Refusing the new key is the honest answer: evicting one
        // would let a flood of fresh keys clear the record of whoever is being limited.
        return rateLimited(c, options, currentTime + windowMs, currentTime)
      }
      bucket = { count: 0, resetAt: currentTime + windowMs }
      buckets.set(key, bucket)
    }

    bucket.count += 1
    c.header('RateLimit-Limit', String(options.max))
    c.header('RateLimit-Remaining', String(Math.max(0, options.max - bucket.count)))
    c.header('RateLimit-Reset', String(Math.ceil(bucket.resetAt / 1000)))

    if (bucket.count > options.max) {
      return rateLimited(c, options, bucket.resetAt, currentTime)
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

/**
 * Frees one slot for a key the store has not seen. Buckets that already reached the budget are
 * skipped: those are the counters enforcing the limit right now, and evicting one would hand any
 * client able to mint fresh keys a way to erase its own record. Map iteration is insertion order,
 * so the oldest still-cheap key goes first.
 */
function evictOneUnexhaustedBucket(buckets: Map<string, RateLimitBucket>, max: number) {
  for (const [key, bucket] of buckets) {
    if (bucket.count >= max) continue
    buckets.delete(key)
    return true
  }

  return false
}

function deleteExpiredBuckets(buckets: Map<string, RateLimitBucket>, now: number) {
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(key)
  }
}
