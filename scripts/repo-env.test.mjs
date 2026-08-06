import { afterEach, expect, test } from 'bun:test'
import { readFile, readdir } from 'node:fs/promises'
import { resolve } from 'node:path'

import {
  assertTestDatabaseUrl,
  defaultTestDatabaseUrl,
  postgresPortFromDatabaseUrl,
  repositoryRoot,
} from './repo-env.mjs'

const envKeys = ['TEST_ALLOW_NON_TEST_DATABASE']
const originalEnv = Object.fromEntries(envKeys.map((key) => [key, process.env[key]]))

afterEach(() => {
  for (const key of envKeys) {
    const value = originalEnv[key]
    if (value === undefined) {
      delete process.env[key]
    } else {
      process.env[key] = value
    }
  }
})

test('environment files live under their owning apps instead of the repository root', async () => {
  const rootEnvironmentFiles = (await readdir(repositoryRoot))
    .filter((name) => name.startsWith('.env'))
    .sort()

  expect(rootEnvironmentFiles).toEqual([])
})

test('backend env example owns the local Docker Compose ports', async () => {
  const backendEnvExample = await readFile(resolve(repositoryRoot, 'backend/.env.example'), 'utf8')

  expect(backendEnvExample).toMatch(/^POSTGRES_PORT=54329$/m)
  expect(backendEnvExample).toMatch(/^POSTGRES_TEST_PORT=54330$/m)
})

test('documented manual Compose commands load the backend-owned env file', async () => {
  const documentationPaths = [
    'README.md',
    'backend/README.md',
    'docs/LOCAL_DATABASE.md',
    'docs/TESTING.md',
    'mobile/README.md',
    'webapp/README.md',
    'website/README.md',
  ]
  const commandsMissingBackendEnv = []

  for (const documentationPath of documentationPaths) {
    const documentation = await readFile(resolve(repositoryRoot, documentationPath), 'utf8')

    for (const [lineIndex, line] of documentation.split('\n').entries()) {
      if (
        line.startsWith('docker compose ') &&
        line !== 'docker compose version' &&
        !line.startsWith('docker compose --env-file backend/.env ')
      ) {
        commandsMissingBackendEnv.push(`${documentationPath}:${lineIndex + 1}: ${line}`)
      }
    }
  }

  expect(commandsMissingBackendEnv).toEqual([])
})

// This documentation contract lives here rather than in its own file because `test:deploy`
// enumerates its test files explicitly, so a new file would silently never run.
test('intake documentation keeps pointing at the install checklist it delegates to', async () => {
  // Installed projects delete documentation they do not use, so only the always-present
  // entry points are required; the optional runbooks are checked when they still exist.
  const optionalIntakeReferences = [
    'docs/STORAGE.md',
    'docs/DEPLOYMENT.md',
    'docs/YANDEX_CLOUD.md',
  ]

  // Projects rewrite and translate their own README prose, so this asserts structure rather
  // than wording: README keeps a real link, the agent files keep naming the file.
  const readme = await readFile(resolve(repositoryRoot, 'README.md'), 'utf8')

  expect(readme).toMatch(/\]\(\.?\/?CHECKLIST\.md\)/)

  for (const documentationPath of ['AGENTS.md', 'CLAUDE.md']) {
    const documentation = await readFile(resolve(repositoryRoot, documentationPath), 'utf8')

    expect(documentation).toContain('CHECKLIST.md')
  }

  for (const documentationPath of optionalIntakeReferences) {
    const documentation = await readFile(resolve(repositoryRoot, documentationPath), 'utf8').catch(
      () => null,
    )
    if (documentation === null) continue

    expect(documentation).toContain('CHECKLIST.md')
  }

  const checklist = await readFile(resolve(repositoryRoot, 'CHECKLIST.md'), 'utf8')

  // These section names are cited from other documents or from the checklist's own
  // cross-references, so renaming or dropping one turns those pointers dead while every
  // other check stays green. Numbering is optional: only the names are load-bearing.
  for (const sectionName of [
    'Active surfaces',
    'First-version capabilities',
    'Files, images, and media',
    'Payments',
    'Deployment',
    'Decided by the agent',
    'Capability ledger',
  ]) {
    expect(checklist).toMatch(new RegExp(`^## (?:\\d+\\. )?${sectionName}`, 'm'))
  }

  // `AGENTS.md` and `CLAUDE.md` instruct agents by these literal ledger states; a renamed
  // state would leave the rule referring to a value the checklist can no longer hold.
  const ledgerStates = ['included', 'available', 'absent', 'removed']
  for (const ledgerState of ledgerStates) {
    expect(checklist).toMatch(new RegExp(`^- \`${ledgerState}\``, 'm'))
  }

  // The ledger rows are what agents act on, so they must stay present and stay inside the
  // documented vocabulary; an invented state has no defined behaviour anywhere.
  const ledger = capabilityLedger(checklist)

  expect(ledger.hasStateColumn).toBe(true)

  const ledgerRowStates = ledger.states

  expect(ledgerRowStates.length).toBeGreaterThan(0)
  expect(ledgerRowStates.filter((state) => !ledgerStates.includes(state))).toEqual([])

  expect(checklist).toMatch(/^\*\*Install status:\*\*/m)
})

// Reads the State column of the capability ledger table. Tolerates the table formatting a
// project may end up with - alignment markers, padding, extra or reordered columns - but the
// column must still be called State, which is reported separately so the failure is readable.
function capabilityLedger(checklist) {
  // Matches the heading as loosely as the section-name assertion above, so a suffixed or
  // padded heading is reported there rather than resurfacing as a missing State column.
  const ledgerSection = checklist.split(/^## (?:\d+\. )?Capability ledger.*$/m)[1] ?? ''
  const tableRows = ledgerSection
    .split(/^## /m)[0]
    .split('\n')
    .filter((row) => row.trim().startsWith('|'))
    .map((row) =>
      row
        .trim()
        .replace(/^\||\|$/g, '')
        .split('|')
        // Cells may carry inline markdown; the checklist itself writes the states in backticks.
        .map((cell) => cell.replace(/[`*_]/g, '').trim()),
    )
    .filter((cells) => !cells.every((cell) => /^:?-+:?$/.test(cell)))

  const [header, ...dataRows] = tableRows
  const stateColumn = header?.findIndex((cell) => cell.toLowerCase() === 'state') ?? -1
  if (stateColumn === -1) return { hasStateColumn: false, states: [] }

  return {
    hasStateColumn: true,
    states: dataRows.map((cells) => cells[stateColumn] ?? ''),
  }
}

test('defaultTestDatabaseUrl builds the documented postgres test URL', () => {
  expect(defaultTestDatabaseUrl('55432')).toBe(
    'postgresql://superuser:superpassword@localhost:55432/web_app_demo_test?schema=public',
  )
})

test('postgresPortFromDatabaseUrl returns explicit ports and postgres defaults', () => {
  expect(
    postgresPortFromDatabaseUrl(
      'postgresql://superuser:superpassword@localhost:55432/web_app_demo_test?schema=public',
    ),
  ).toBe('55432')
  expect(
    postgresPortFromDatabaseUrl(
      'postgresql://superuser:superpassword@localhost/web_app_demo_test?schema=public',
    ),
  ).toBe('5432')
})

test('assertTestDatabaseUrl accepts test databases and rejects development databases', () => {
  expect(() =>
    assertTestDatabaseUrl(
      'postgresql://superuser:superpassword@localhost:55432/web_app_demo_test?schema=public',
    ),
  ).not.toThrow()

  expect(() =>
    assertTestDatabaseUrl(
      'postgresql://superuser:superpassword@localhost:54329/web_app_demo?schema=public',
    ),
  ).toThrow(/Refusing to run tests against non-test database "web_app_demo"/)
})

test('assertTestDatabaseUrl accepts non-test databases with an intentional override', () => {
  process.env.TEST_ALLOW_NON_TEST_DATABASE = '1'

  expect(() =>
    assertTestDatabaseUrl(
      'postgresql://superuser:superpassword@localhost:54329/web_app_demo?schema=public',
    ),
  ).not.toThrow()
})
