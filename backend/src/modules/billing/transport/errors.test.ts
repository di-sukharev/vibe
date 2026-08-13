// @parked-test
//
// Subscriptions ship switched off: the tables are commented out in prisma/schema/billing.prisma,
// the routes are not mounted in src/app.ts, and this module is typed through hand-written
// stand-ins. Until docs/IAP.md is followed and billing is turned on, these suites assert a
// feature nobody runs, so they are parked rather than deleted - remove the marker above and they
// come back with the capability.

import { expect, test } from 'bun:test'

import { BillingFailure } from '../domain/errors'
import { toBillingAppError } from './errors'

test('billing transport maps feature failures to stable HTTP errors', () => {
  expect(
    toBillingAppError(
      new BillingFailure('IAP_INVALID_TRANSACTION', 'Invalid transaction', { field: 'token' }),
    ),
  ).toMatchObject({
    code: 'IAP_INVALID_TRANSACTION',
    details: { field: 'token' },
    status: 400,
  })
  expect(
    toBillingAppError(new BillingFailure('IAP_OWNERSHIP_MISMATCH', 'Wrong owner')),
  ).toMatchObject({ code: 'IAP_OWNERSHIP_MISMATCH', status: 403 })
  expect(
    toBillingAppError(new BillingFailure('IAP_NOT_CONFIGURED', 'Missing configuration')),
  ).toMatchObject({ code: 'IAP_NOT_CONFIGURED', status: 503 })
  expect(
    toBillingAppError(new BillingFailure('IAP_WEBHOOK_IN_PROGRESS', 'Retry notification')),
  ).toMatchObject({ code: 'IAP_WEBHOOK_IN_PROGRESS', status: 503 })
})

test('billing transport preserves unknown errors for the global error handler', () => {
  const error = new Error('database unavailable')
  expect(toBillingAppError(error)).toBe(error)
})
