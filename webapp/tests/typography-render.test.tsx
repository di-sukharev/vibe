import { expect, test } from 'bun:test'
import * as React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

import { Typography } from '../src/components/typography'

test('Typography renders semantic elements and project-owned variants', () => {
  const markup = renderToStaticMarkup(
    <Typography as="h1" variant="h2" tone="muted">
      Account access
    </Typography>,
  )

  expect(markup).toContain('<h1 ')
  expect(markup).toContain('data-slot="typography"')
  expect(markup).toContain('data-variant="h2"')
})
