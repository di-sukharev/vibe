import { expect, test } from 'bun:test'

import { liveSuites, selectLiveSuites } from './test-live.mjs'

/**
 * The live runner refuses more than it runs, so the refusals are the behaviour worth pinning.
 * Without this, "configuring one provider looks like a half-configured attempt at the other" is a
 * bug you only discover by holding accounts with both.
 */

const resend = {
  EMAIL_RESEND_API_KEY: 're_test',
  EMAIL_FROM: 'no-reply@example.com',
  EMAIL_LIVE_TEST_TO: 'inbox@example.com',
}
const postbox = {
  EMAIL_POSTBOX_ACCESS_KEY_ID: 'YCAJEtest',
  EMAIL_POSTBOX_SECRET_ACCESS_KEY: 'YCPtest',
  EMAIL_FROM: 'no-reply@example.com',
  EMAIL_LIVE_TEST_TO: 'inbox@example.com',
}

function names(env) {
  const { selected, error } = selectLiveSuites(env)

  return { error, names: selected.map((suite) => suite.name) }
}

test('configuring one email provider runs that suite and does not claim the other is broken', () => {
  // The shared EMAIL_FROM / EMAIL_LIVE_TEST_TO are required by both suites. Treating them as
  // evidence of intent would make every single-provider setup fail as "half configured", which
  // is exactly what the documented commands in docs/EMAIL.md do.
  expect(names(resend)).toEqual({ error: null, names: ['email (Resend)'] })
  expect(names(postbox)).toEqual({ error: null, names: ['email (Postbox)'] })
})

test('a suite whose own credentials are incomplete is an error naming them, never a skip', () => {
  const { error } = selectLiveSuites({
    EMAIL_POSTBOX_ACCESS_KEY_ID: 'YCAJEtest',
    EMAIL_FROM: 'no-reply@example.com',
    EMAIL_LIVE_TEST_TO: 'inbox@example.com',
  })

  expect(error).toContain('EMAIL_POSTBOX_SECRET_ACCESS_KEY')
  expect(error).toContain('half configured')
})

test('a provider without the shared sender settings is an error naming them', () => {
  const { error } = selectLiveSuites({ EMAIL_RESEND_API_KEY: 're_test' })

  expect(error).toContain('EMAIL_FROM')
  expect(error).toContain('EMAIL_LIVE_TEST_TO')
})

test('nothing configured selects nothing, so the caller can refuse rather than pass quietly', () => {
  expect(names({})).toEqual({ error: null, names: [] })
})

test('several configured suites all run', () => {
  const { error, names: selected } = names({
    ...resend,
    PRIVATE_STORAGE_ENDPOINT: 'http://127.0.0.1:24331',
  })

  expect(error).toBeNull()
  // As a set: which suites were selected is the behaviour, the order they come back in is not.
  expect(new Set(selected)).toEqual(new Set(['storage (S3)', 'email (Resend)']))
})

test('every suite is identified by credentials nobody else shares', () => {
  // The property that makes the split work. A key in two suites' `identifiedBy` would resurrect
  // the bug above in a form the cases here would not catch.
  const identifiers = liveSuites.flatMap((suite) => suite.identifiedBy)

  expect(identifiers).toHaveLength(new Set(identifiers).size)
})
