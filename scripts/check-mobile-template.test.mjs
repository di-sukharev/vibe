import { expect, test } from 'bun:test'

import { runMobileValidation } from './check-mobile-template.mjs'

test('the mobile publication gate executes every local safety layer in order', () => {
  const calls = []
  runMobileValidation((command, args, options) => calls.push({ args, command, options }))

  expect(calls.map(({ args }) => args)).toEqual([
    ['run', 'check'],
    ['run', '--cwd', 'mobile', 'e2e:maestro:audit'],
  ])
  expect(calls.every(({ command }) => command === 'bun')).toBe(true)
})

test('the mobile publication gate stops after the first failed safety layer', () => {
  const calls = []

  expect(() =>
    runMobileValidation((_command, args) => {
      calls.push(args)
      throw new Error('canonical check failed')
    }),
  ).toThrow('canonical check failed')

  expect(calls).toEqual([
    ['run', 'check'],
  ])
})
