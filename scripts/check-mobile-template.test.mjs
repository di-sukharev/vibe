import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import {
  runMobileValidation,
  validateMobileCapabilityContract,
} from './check-mobile-template.mjs'

const currentChecklist = readFileSync(resolve(import.meta.dir, '..', 'CHECKLIST.md'), 'utf8')

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

test('the mobile publication gate requires its three available capabilities', () => {
  const validMobileChecklist = mobileChecklist()
  expect(validateMobileCapabilityContract(validMobileChecklist)).toEqual([])

  for (const capability of [
    'Payments / subscriptions',
    'Push notifications',
    'Social sign-in (Apple / Google)',
  ]) {
    const missing = validMobileChecklist.replace(
      new RegExp(`^\\| ${escapeRegExp(capability)}\\s+\\|.*$`, 'm'),
      '',
    )
    expect(validateMobileCapabilityContract(missing)).toContain(
      `Capability ledger is missing required capability "${capability}".`,
    )

    const wrongState = validMobileChecklist.replace(
      new RegExp(`^(\\| ${escapeRegExp(capability)}\\s+\\|) available(\\s+\\|)`, 'm'),
      '$1 absent$2',
    )
    expect(validateMobileCapabilityContract(wrongState)).toContain(
      `Capability "${capability}" must be "available" for this template, found "absent".`,
    )
  }

  const fencedCapabilities = validMobileChecklist.replace(
    /^(\| Payments \/ subscriptions.*\n\| Push notifications.*\n\| Social sign-in.*)$/m,
    '```md\n$1\n```',
  )
  expect(validateMobileCapabilityContract(fencedCapabilities)).toEqual([
    'Capability ledger is missing required capability "Payments / subscriptions".',
    'Capability ledger is missing required capability "Push notifications".',
    'Capability ledger is missing required capability "Social sign-in (Apple / Google)".',
  ])

  const commentedCapabilities = validMobileChecklist.replace(
    /(## 10\. Capability ledger\n\n)([\s\S]*?)(\n\n## 11\. Environment checks)/,
    '$1<!--\n$2\n-->$3',
  )
  expect(validateMobileCapabilityContract(commentedCapabilities)).toEqual([
    'Capability ledger is missing required capability "Payments / subscriptions".',
    'Capability ledger is missing required capability "Push notifications".',
    'Capability ledger is missing required capability "Social sign-in (Apple / Google)".',
  ])

  const extraAvailable = validMobileChecklist.replace(
    /^(\| Real-time \/ WebSockets\s+\|) absent(\s+\|)/m,
    '$1 available$2',
  )
  expect(validateMobileCapabilityContract(extraAvailable)).toContain(
    'Capability "Real-time / WebSockets" must not be "available" for this template.',
  )

  const prototypeCapability = validMobileChecklist.replace(
    /^\| Real-time \/ WebSockets.*$/m,
    '$&\n| constructor | available | Prototype-shaped capability name. |',
  )
  expect(validateMobileCapabilityContract(prototypeCapability)).toContain(
    'Capability "constructor" must not be "available" for this template.',
  )
})

function mobileChecklist() {
  const checklistWithPayments = /^\| Payments \/ subscriptions\s+\|/m.test(currentChecklist)
    ? currentChecklist
    : currentChecklist.replace(
      /^(\| Browser checkout \/ payments\s+\| absent\s+\|.*)$/m,
      '$1\n| Payments / subscriptions        | available | Mobile store subscriptions are available. |',
    )

  return checklistWithPayments
    .replace(
      /^(\| Payments \/ subscriptions\s+\|)\s*(?:included|available|absent|removed)(\s+\|)/m,
      '$1 available$2',
    )
    .replace(
      /^(\| Push notifications\s+\|)\s*(?:included|available|absent|removed)(\s+\|)/m,
      '$1 available$2',
    )
    .replace(
      /^(\| Social sign-in \(Apple \/ Google\)\s+\|)\s*(?:included|available|absent|removed)(\s+\|)/m,
      '$1 available$2',
    )
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
