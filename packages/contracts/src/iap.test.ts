import { describe, expect, test } from 'bun:test'

import {
  appStoreReconcileRequestSchema,
  googlePlayReconcileRequestSchema,
} from './index'

/**
 * Only the two rules that are ours. The rest of this file used to parse a valid fixture and assert
 * the same object came back, which is zod returning its input - guaranteed by the library and by
 * TypeScript at every call site.
 *
 * Store subscriptions ship switched off (docs/IAP.md); their backend suites are parked and the
 * mobile ones live in mobile/tests/parked. These two stay here because they cost nothing and the
 * schemas are exported either way.
 */
describe('iap contracts', () => {
  test('an App Store reconcile must name what to reconcile', () => {
    expect(() => appStoreReconcileRequestSchema.parse({})).toThrow()
  })

  test('a Google Play reconcile defaults to the whole backlog', () => {
    // A cron caller sends no body at all, and that has to mean "everything due", not a 400.
    expect(googlePlayReconcileRequestSchema.parse({})).toEqual({})
    expect(googlePlayReconcileRequestSchema.parse(undefined)).toEqual({})
  })
})
