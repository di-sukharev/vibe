import { expect, test } from 'bun:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

import { Empty } from '../src/components/ui/empty'
import { SessionLoadingSection } from '../src/components/WebRouteSections'

function emptySlot(markup: string) {
  const tag = markup.match(/<div[^>]*data-slot="empty"[^>]*>/)?.[0]
  if (!tag) throw new Error('no data-slot="empty" element rendered')
  const classes = tag.match(/class="([^"]*)"/)?.[1]?.split(/\s+/) ?? []
  return { classes, tag }
}

test('Empty keeps its standalone padding by default', () => {
  const { classes, tag } = emptySlot(renderToStaticMarkup(createElement(Empty)))

  expect(tag).toContain('data-size="default"')
  expect(classes).toContain('p-12')
})

test('Empty size="sm" is the nested variant with its own reduced padding', () => {
  const { classes, tag } = emptySlot(
    renderToStaticMarkup(createElement(Empty, { size: 'sm' })),
  )

  expect(tag).toContain('data-size="sm"')
  expect(classes).toContain('p-4')
  expect(classes).toContain('sm:p-8')
  expect(classes).not.toContain('p-12')
})

test('route state cards compose Empty through its size prop, not class overrides', () => {
  const { classes, tag } = emptySlot(
    renderToStaticMarkup(createElement(SessionLoadingSection)),
  )

  expect(tag).toContain('data-size="sm"')
  expect(classes).not.toContain('border-0')
  expect(classes).not.toContain('p-12')
})
