import { expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'

import { SessionLoadingSection } from '../src/components/WebRouteSections'

test('session loading exposes one document heading and a reduced-motion status', () => {
  const markup = renderToStaticMarkup(<SessionLoadingSection />)

  expect(markup.match(/<main/g)?.length).toBe(1)
  expect(markup.match(/<h1/g)?.length).toBe(1)
  expect(markup).toContain('Loading workspace')
  expect(markup).toContain('Checking session...')
  expect(markup).toContain('aria-label="Loading"')
  expect(markup).toContain('motion-reduce:animate-none')
})
