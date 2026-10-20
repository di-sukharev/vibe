import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

/**
 * Build contracts read the static `dist/` that `bun run test:build-contracts` (repository root)
 * builds right before them. Running this file alone checks the existing build.
 */
const websiteRoot = fileURLToPath(new URL('..', import.meta.url))
const dist = resolve(websiteRoot, 'dist')

test('the landing page ships its title, description, and heading in the initial HTML', () => {
  // Crawlers and link previews read the static HTML; an island must never be the only source.
  const html = readFileSync(resolve(dist, 'index.html'), 'utf8')
  const text = (pattern: RegExp) => (pattern.exec(html)?.[1] ?? '').replace(/<[^>]+>/g, '').trim()
  const seo = {
    title: text(/<title>([^<]*)<\/title>/),
    description: text(/<meta name="description" content="([^"]*)"/),
    openGraphTitle: text(/<meta property="og:title" content="([^"]*)"/),
    heading: text(/<h1\b[^>]*>([\s\S]*?)<\/h1>/),
  }

  assert.deepEqual(Object.entries(seo).filter(([, value]) => !value).map(([name]) => name), [])
})
