import { expect, test } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'

import type { ParseOutcome, ProbeReport } from './zod-compile.probe'

const backendRoot = resolve(import.meta.dir, '..')
const reports = new Map<ProbeMode, ProbeReport>()

type ProbeMode = 'composition-root' | 'plain'

/**
 * Runs `zod-compile.probe.ts` in a fresh process (see its header for why) and caches the report.
 */
function probe(mode: ProbeMode): ProbeReport {
  const cached = reports.get(mode)
  if (cached) return cached

  const result = spawnSync(process.execPath, ['src/zod-compile.probe.ts', mode], {
    cwd: backendRoot,
    encoding: 'utf8',
  })
  if (result.status !== 0) {
    throw new Error(
      `zod-compile probe (${mode}) exited with ${String(result.status)}\n${result.stderr}`,
    )
  }

  const report = JSON.parse(result.stdout) as ProbeReport
  reports.set(mode, report)
  return report
}

test('the composition root compiles contract schemas once, on their first parse', () => {
  const [firstParse, ...laterParses] = probe('composition-root').codegenPerParse

  // Generated code on the first parse, none afterwards: the schema was compiled exactly once.
  expect(firstParse).toBeGreaterThan(0)
  expect(laterParses).toEqual([0, 0])
  // The same string schema loaded without the composition root never generates code, so the
  // probe measures the compilation the backend turns on and not something Zod does by default.
  expect(probe('plain').codegenPerParse).toEqual([0, 0, 0])
})

test('compiled contract schemas accept, reject, and transform exactly like the runtime parser', () => {
  const compiled = probe('composition-root').results
  const runtime = probe('plain').results

  expect(compiled).toEqual(runtime)

  // The corpus must exercise both directions for every schema, or the equality above is vacuous.
  for (const [name, outcomes] of Object.entries(compiled)) {
    expect({ name, accepted: outcomes.some(accepted), rejected: outcomes.some(rejected) }).toEqual({
      name,
      accepted: true,
      rejected: true,
    })
  }

  const registration = compiled.registerRequestSchema?.[0]
  expect(registration).toEqual({
    input: { email: ' USER@EXAMPLE.COM ', password: '12345678', displayName: '  Ada  ' },
    success: true,
    data: { email: 'user@example.com', password: '12345678', displayName: 'Ada' },
  })
  const invalidRegistration = compiled.registerRequestSchema?.[3]
  expect(invalidRegistration?.success).toBe(false)
  expect(
    invalidRegistration && !invalidRegistration.success
      ? invalidRegistration.issues.map((issue) => (issue as { path: unknown[] }).path.join('.'))
      : [],
  ).toEqual(['email', 'password', 'displayName'])
})

function accepted(outcome: ParseOutcome) {
  return outcome.success
}

function rejected(outcome: ParseOutcome) {
  return !outcome.success
}
