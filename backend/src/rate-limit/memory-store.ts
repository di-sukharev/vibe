import type { RateLimitStore } from './port'

type RateLimitBucket = {
  count: number
  resetAt: number
}

type MemoryRateLimitStoreOptions = {
  /** The policy's budget. Eviction must never drop a key that reached it, so the store knows it. */
  max: number
  maxTrackedKeys?: number
}

const defaultMaxTrackedKeys = 10_000

/**
 * A bounded counter table inside the process.
 *
 * The whole truth while one API instance serves every request, and wrong as soon as there are
 * several: each process would count only what it saw. Windows start at a key's first request, so
 * two processes could not even agree on where a window begins. `database-store.ts` is the shared
 * answer; `RATE_LIMIT_STORE` selects it.
 */
export function createMemoryRateLimitStore(options: MemoryRateLimitStoreOptions): RateLimitStore {
  const buckets = new Map<string, RateLimitBucket>()
  const trackedKeyLimit = options.maxTrackedKeys ?? defaultMaxTrackedKeys

  return {
    consume: async (key, windowSeconds, now) => {
      const windowMs = windowSeconds * 1000
      let bucket = buckets.get(key)

      if (!bucket || bucket.resetAt <= now) {
        if (buckets.size >= trackedKeyLimit) {
          deleteExpiredBuckets(buckets, now)
        }
        if (buckets.size >= trackedKeyLimit && !evictOneUnexhaustedBucket(buckets, options.max)) {
          // Every tracked key already spent its budget, so the table holds nothing but the
          // counters currently doing the limiting. Refusing the new key is the honest answer:
          // evicting one would let a flood of fresh keys clear the record of whoever is being
          // limited. Reported as one over budget, exactly what a tracked and exhausted key says.
          return { count: options.max + 1, resetAt: now + windowMs }
        }
        bucket = { count: 0, resetAt: now + windowMs }
        buckets.set(key, bucket)
      }

      bucket.count += 1
      return { count: bucket.count, resetAt: bucket.resetAt }
    },
  }
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
