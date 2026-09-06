import assert from 'node:assert/strict'
import test from 'node:test'

import {
  watchHeroSceneEnhancement,
  watchHeroSceneEligibility,
  type HeroSceneMediaQuery,
} from '../src/components/landing/hero-scene-loading'

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
