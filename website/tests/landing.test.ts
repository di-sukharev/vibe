import assert from 'node:assert/strict'
import { test } from 'node:test'

import { getSecondaryAction, resolvePublicWebappUrl } from '../src/lib/landing-actions'

/**
 * The landing page's copy, section list and link counts are deliberately untested.
 *
 * This is a template: rewriting that page is the first thing every project does, and a test
 * asserting the Russian title, nine section ids and "exactly four links to the GitHub template"
 * turned red on day one for work that was entirely correct. It also built the site four times per
 * run to do it. What is left is the one branch with a decision in it, plus the environment
 * contract that survives every rewrite: `PUBLIC_WEBAPP_URL` is either unset or a real origin.
 */
test('an unset or blank PUBLIC_WEBAPP_URL means the site builds without a web app link', () => {
  assert.equal(resolvePublicWebappUrl(undefined), undefined)
  assert.equal(resolvePublicWebappUrl(''), undefined)
  assert.equal(resolvePublicWebappUrl('   '), undefined)
})

test('an absolute http(s) PUBLIC_WEBAPP_URL is kept as written, minus surrounding whitespace', () => {
  assert.equal(resolvePublicWebappUrl('  https://app.example.com  '), 'https://app.example.com')
  assert.equal(resolvePublicWebappUrl('http://localhost:5173/'), 'http://localhost:5173/')
  assert.equal(resolvePublicWebappUrl('https://example.com/app'), 'https://example.com/app')
})

test('a PUBLIC_WEBAPP_URL that is not an absolute http(s) URL fails with an error naming it', () => {
  for (const value of ['app.example.com', '/app', 'https://', 'ftp://app.example.com', 'javascript:alert(1)']) {
    assert.throws(
      () => resolvePublicWebappUrl(value),
      (error: unknown) =>
        error instanceof Error &&
        error.message.includes('PUBLIC_WEBAPP_URL') &&
        error.message.includes(value),
      `expected ${JSON.stringify(value)} to be rejected with an error that names the variable and the value`,
    )
  }
})

test('the secondary action falls back to the local next step until a webapp URL exists', () => {
  assert.deepEqual(getSecondaryAction(), {
    href: '#process',
    label: 'Как начать: 3 шага',
  })
  assert.deepEqual(getSecondaryAction('   '), {
    href: '#process',
    label: 'Как начать: 3 шага',
  })
  assert.deepEqual(getSecondaryAction('  https://app.example.com  '), {
    href: 'https://app.example.com',
    label: 'Открыть веб-приложение',
  })
  assert.throws(() => getSecondaryAction('app.example.com'), /PUBLIC_WEBAPP_URL/)
})
