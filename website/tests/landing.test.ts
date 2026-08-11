import assert from 'node:assert/strict'
import { test } from 'node:test'

import { getSecondaryAction } from '../src/lib/landing-actions'

/**
 * The landing page's copy, section list and link counts are deliberately untested.
 *
 * This is a template: rewriting that page is the first thing every project does, and a test
 * asserting the Russian title, nine section ids and "exactly four links to the GitHub template"
 * turned red on day one for work that was entirely correct. It also built the site four times per
 * run to do it. What is left is the one branch with a decision in it.
 */
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
})
