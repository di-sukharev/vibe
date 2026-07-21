import { expect, test } from 'bun:test'
import * as React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

import { Typography } from '../src/components/typography'
import { Button } from '../src/components/ui/button'
import { Input } from '../src/components/ui/input'

test('Typography renders semantic elements and project-owned variants', () => {
  const markup = renderToStaticMarkup(
    <Typography as="h1" variant="h2" tone="muted">
      Account access
    </Typography>,
  )

  expect(markup).toContain('<h1 ')
  expect(markup).toContain('data-slot="typography"')
  expect(markup).toContain('data-variant="h2"')
  expect(markup).toContain('text-muted-foreground')
})

test('official shadcn controls render without project Typography wrappers', () => {
  const markup = renderToStaticMarkup(
    <>
      <Input aria-label="Email" />
      <Button>Continue</Button>
    </>,
  )

  expect(markup).toContain('data-slot="input"')
  expect(markup).toContain('rounded-md')
  expect(markup).toContain('data-slot="button"')
  expect(markup).not.toContain('data-slot="typography"')
})
