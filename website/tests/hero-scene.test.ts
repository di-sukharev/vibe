import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import {
  watchHeroSceneEnhancement,
  watchHeroSceneEligibility,
  type HeroSceneMediaQuery,
} from '../src/components/landing/hero-scene-loading'

const websiteRoot = fileURLToPath(new URL('..', import.meta.url))

test('hero scene eligibility follows desktop width and reduced-motion preferences', () => {
  const desktop = fakeMediaQuery(false)
  const motion = fakeMediaQuery(true)
  const states: boolean[] = []
  const stop = watchHeroSceneEligibility({ desktop, motion }, (eligible) => states.push(eligible))

  desktop.setMatches(true)
  motion.setMatches(false)
  motion.setMatches(true)

  assert.deepEqual(states, [false, true, false, true])

  stop()
  desktop.setMatches(false)
  assert.deepEqual(states, [false, true, false, true])
})

test('the R3F enhancement loads once and only while desktop motion is eligible', async () => {
  const desktop = fakeMediaQuery(false)
  const motion = fakeMediaQuery(true)
  let calls = 0
  const eligibility: boolean[] = []
  const loaded: string[] = []
  const stop = watchHeroSceneEnhancement({
    media: { desktop, motion },
    load: async () => {
      calls += 1
      return 'canvas'
    },
    onEligibilityChange: (eligible) => eligibility.push(eligible),
    onLoaded: (scene) => loaded.push(scene),
  })

  assert.equal(calls, 0)
  desktop.setMatches(true)
  await Promise.resolve()
  motion.setMatches(false)
  motion.setMatches(true)
  await Promise.resolve()

  assert.equal(calls, 1)
  assert.deepEqual(loaded, ['canvas'])
  assert.deepEqual(eligibility, [false, true, false, true])

  stop()
  desktop.setMatches(false)
  assert.equal(calls, 1)
  assert.deepEqual(eligibility, [false, true, false, true])
})

test('the static build keeps the fallback eager and the R3F scene lazy', { timeout: 30_000 }, () => {
  execFileSync('bun', ['run', 'build'], {
    cwd: websiteRoot,
    env: process.env,
    stdio: 'pipe',
  })

  const dist = resolve(websiteRoot, 'dist')
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

function fakeMediaQuery(initialMatches: boolean): HeroSceneMediaQuery & {
  setMatches(matches: boolean): void
} {
  let matches = initialMatches
  const listeners = new Set<() => void>()

  return {
    get matches() {
      return matches
    },
    addEventListener(_type, listener) {
      listeners.add(listener)
    },
    removeEventListener(_type, listener) {
      listeners.delete(listener)
    },
    setMatches(nextMatches) {
      matches = nextMatches
      for (const listener of listeners) listener()
    },
  }
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
