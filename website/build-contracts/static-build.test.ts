import assert from 'node:assert/strict'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

/**
 * Build contracts read the static `dist/` that `bun run test:build-contracts` (repository root)
 * builds right before them. They never build on their own: the unit suite in `tests/` stays
 * read-only and free of the developer's build environment, and a build-contract file run by itself
 * checks whatever `dist/` currently holds.
 */
const websiteRoot = fileURLToPath(new URL('..', import.meta.url))
const dist = resolve(websiteRoot, 'dist')

test('the static build keeps the fallback eager and the R3F scene lazy', () => {
  assert.ok(
    existsSync(dist),
    `${dist} is missing: run \`bun run test:build-contracts\` from the repository root, which builds before it checks`,
  )

  const assets = resolve(dist, '_astro')
  const html = readFileSync(resolve(dist, 'index.html'), 'utf8')
  const scripts = readdirSync(assets)
    .filter((name) => name.endsWith('.js'))
    .map((name) => ({ name, source: readFileSync(resolve(assets, name), 'utf8') }))
  const canvasChunk = scripts.find(({ source }) => source.includes('data-hero-scene-canvas'))
  const shellUrl = html.match(
    /<astro-island[^>]*component-url="([^"]+\.js)"[^>]*>[\s\S]*?data-hero-scene/,
  )?.[1]

  assert.match(html, /data-hero-scene-fallback/)
  assert.match(html, /client="idle"/)
  assert.ok(canvasChunk, 'expected a separate R3F canvas chunk')
  assert.ok(shellUrl, 'expected the lightweight HeroScene island chunk')
  assert.doesNotMatch(html, new RegExp(escapeRegExp(canvasChunk.name)))

  const shell = readFileSync(resolve(dist, shellUrl.slice(1)), 'utf8')
  assert.match(shell, new RegExp(escapeRegExp(canvasChunk.name)))
  assert.doesNotMatch(shell, /data-hero-scene-canvas/)
})

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

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
