import { afterEach, expect, test } from 'bun:test'
import { access, readFile, readdir } from 'node:fs/promises'
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

test('the background job registry can be read without a database', async () => {
  // Tooling outside the backend imports backend/src/jobs.ts for the list of job names, and may
  // run before `prisma:generate` has. A runtime import in that file would pull the Prisma client
  // and the env schema into a process that must not need either.
  const runtimeImports = (await readFile(resolve(repositoryRoot, 'backend/src/jobs.ts'), 'utf8'))
    .split('\n')
    .filter((line) => /^import\s/.test(line) && !/^import type\s/.test(line))

  expect(runtimeImports).toEqual([])
})

test('the task handler registry does not drag a product module into every process', async () => {
  // A different rule from the one above, for a different reason: the API imports this registry to
  // validate a task type at enqueue time, so a top-level `../modules/...` import would load that
  // module's SDKs into every process that can enqueue. Handlers use `await import()` inside `run`,
  // which also keeps a module out of the runs that never touch it. Type imports are erased and
  // therefore fine.
  const heavyImports = (await readFile(resolve(repositoryRoot, 'backend/src/outbox/handlers.ts'), 'utf8'))
    .split('\n')
    .filter(
      (line) =>
        /^import\s/.test(line) &&
        !/^import type\s/.test(line) &&
        /['"]\.\.\/(modules|generated)\//.test(line),
    )

  expect(heavyImports).toEqual([])
})

test('task validation stays local and has no GitHub workflow or CI-only Playwright behavior', async () => {
  const workflowDirectory = resolve(repositoryRoot, '.github/workflows')
  const workflows = await readdir(workflowDirectory).catch((error) => {
    if (error.code === 'ENOENT') return []
    throw error
  })
  const playwright = await readFile(resolve(repositoryRoot, 'webapp/playwright.config.ts'), 'utf8')

  expect(workflows).toEqual([])
  expect(playwright).not.toContain('process.env.CI')
  expect(playwright).toMatch(/forbidOnly:\s*true/)
  expect(playwright).toMatch(/retries:\s*0/)
  expect(playwright).toMatch(/trace:\s*'retain-on-failure'/)
})

test('hosting tooling and the command that drives it are removed together', async () => {
  // A project keeps one hosting path and deletes the others during setup. The failure that hurts
  // is a half-removal: a script entry that points at a deleted generator, or a generator with no
  // way to run it.
  const [hasGenerator, hasSpecTemplates, rootPackageJson] = await Promise.all([
    exists('scripts/prepare-do-specs.mjs'),
    exists('.do'),
    readFile(resolve(repositoryRoot, 'package.json'), 'utf8'),
  ])
  const hasCommand = JSON.parse(rootPackageJson).scripts['deploy:do:specs'] !== undefined

  const digitalOceanTooling = {
    'the deploy:do:specs script': hasCommand,
    'scripts/prepare-do-specs.mjs': hasGenerator,
    '.do/': hasSpecTemplates,
  }
  const kept = Object.keys(digitalOceanTooling).filter((part) => digitalOceanTooling[part])
  const removed = Object.keys(digitalOceanTooling).filter((part) => !digitalOceanTooling[part])

  // All three or none. A mixed result names exactly what the half-removal left behind.
  expect(kept.length > 0 && removed.length > 0 ? { kept, removed } : null).toBeNull()

  // Both provider documents are on each other's removal lists, so a setup that followed both
  // would leave the project with nowhere documented to deploy. (docs/BACKGROUND_JOBS.md is
  // deliberately not counted here: it is provider-neutral and no list deletes it, so including
  // it would make this assertion impossible to fail.)
  const providerDocs = await Promise.all([
    exists('docs/DEPLOYMENT.md'),
    exists('docs/YANDEX_CLOUD.md'),
  ])

  expect(providerDocs.some(Boolean)).toBe(true)
})

async function exists(relativePath) {
  try {
    await access(resolve(repositoryRoot, relativePath))
    return true
  } catch {
    return false
  }
}

test('intake documentation keeps pointing at the install checklist it delegates to', async () => {
  // Installed projects delete documentation they do not use, so only the always-present
  // entry points are required; the optional runbooks are checked when they still exist.
  const optionalIntakeReferences = [
    'docs/EMAIL.md',
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

test('web surface contract stays mandatory for agent and commerce work', async () => {
  const contractPath = 'docs/WEB_SURFACES.md'
  const [
    contract,
    readme,
    checklist,
    websiteReadme,
    webappReadme,
    mobileReadme,
    agents,
    claude,
    backgroundJobs,
    packageJson,
  ] =
    await Promise.all([
      readFile(resolve(repositoryRoot, contractPath), 'utf8'),
      readFile(resolve(repositoryRoot, 'README.md'), 'utf8'),
      readFile(resolve(repositoryRoot, 'CHECKLIST.md'), 'utf8'),
      readFile(resolve(repositoryRoot, 'website/README.md'), 'utf8'),
      readFile(resolve(repositoryRoot, 'webapp/README.md'), 'utf8'),
      readFile(resolve(repositoryRoot, 'mobile/README.md'), 'utf8'),
      readFile(resolve(repositoryRoot, 'AGENTS.md'), 'utf8'),
      readFile(resolve(repositoryRoot, 'CLAUDE.md'), 'utf8'),
      readFile(resolve(repositoryRoot, 'docs/BACKGROUND_JOBS.md'), 'utf8'),
      readFile(resolve(repositoryRoot, 'package.json'), 'utf8'),
    ])
  const yandexCloud = await readFile(resolve(repositoryRoot, 'docs/YANDEX_CLOUD.md'), 'utf8').catch(
    () => null,
  )

  for (const documentation of [agents, claude]) {
    expect(documentation).toMatch(/always read `docs\/WEB_SURFACES\.md` first/)
  }

  const normalizeAgentFilename = (documentation) =>
    documentation
      .replace(/^# (?:AGENTS|CLAUDE)\.md$/m, '# AGENT_FILE.md')
      .replace(/`(?:AGENTS|CLAUDE)\.md`/g, '`AGENT_FILE.md`')
  expect(normalizeAgentFilename(agents)).toBe(normalizeAgentFilename(claude))
  for (const documentation of [agents, claude]) {
    expect(documentation).toContain(
      'Do not create or use GitHub CI/CD, GitHub Actions, or hosted validation workflows',
    )
    expect(documentation).toMatch(/validation builds[\s\S]*task checks only locally/)
    expect(documentation).toMatch(/production release or SSG rebuild[\s\S]*is not a task check/)
    expect(documentation).toMatch(
      /bug remains unclear after repository research[\s\S]*search the web for the exact error/,
    )
  }

  expect(readme).toContain(`](${contractPath})`)
  expect(readme).not.toContain('--single-branch')
  expect(readme).toContain('bun run mobile:template:check')
  expect(readme).toContain('bun run mobile:template:check -- --published')
  expect(JSON.parse(packageJson).scripts['mobile:template:check']).toBe(
    'bun scripts/check-mobile-template.mjs',
  )
  for (const documentation of [websiteReadme, webappReadme, mobileReadme]) {
    expect(documentation).toContain('](../docs/WEB_SURFACES.md)')
  }
  expect(mobileReadme).toContain('bun run mobile:template:check')
  expect(mobileReadme).toContain('bun run mobile:template:check -- --published')
  expect(mobileReadme).toMatch(
    /After first-run setup[\s\S]*do not use this template gate for product releases/,
  )

  for (const sectionName of [
    'Surface ownership',
    'Static website data and freshness',
    'Browser cart and checkout',
    'Mobile payments',
    'Implementation checklist',
  ]) {
    expect(contract).toMatch(new RegExp(`^## ${sectionName}`, 'm'))
  }

  // These are the cross-surface decisions this file exists to protect. Headings and links alone
  // would still pass if a future edit accidentally moved checkout into the website, trusted a
  // browser total, made native payments depend on browser checkout, or replaced the durable
  // single-flight rebuild controller with one long or order-dependent outbox attempt.
  for (const invariant of [
    /`website` exists for public product information and is SSG by default/,
    /Astro fetches a public,\s+contract-validated backend snapshot while building the static output/,
    /browser\s+payment starts from the authenticated `webapp`/,
    /stable product\/offer\/variant identifiers\s+and quantities/,
    /preserves the\s+imported selection across its registration\/sign-in flow/,
    /Do not put a payment SDK[\s\S]*provider webhook in `website`/,
    /the backend remains\s+authoritative when an order is created/,
    /Persist durable rebuild state with at least\s+`desiredRevision`, `publishedRevision`/,
    /at most one provider deployment may be active/,
    /public, cache-busted revision marker/,
    /correctness does not depend on reopening\s+a terminal outbox row/,
    /Mobile payments are a separate presentation and transport boundary from browser checkout/,
    /App Store and Google\s+Play subscriptions through `expo-iap`/,
    /direct card entry, a saved-card provider flow, Apple Pay, or\s+Google Pay/,
    /PCI-compliant payment provider's hosted UI or native SDK/,
    /Raw\s+PAN\/CVC must never enter custom app inputs, application APIs, logs, analytics, or storage/,
    /only the provider's opaque payment-method\/token identifiers/,
  ]) {
    expect(contract).toMatch(invariant)
  }

  for (const invariant of [
    /`desiredRevision`, `publishedRevision`/,
    /at most one provider deployment at a time/,
    /immutable revisioned\s+artifact/,
    /promotes it atomically or through an equivalent blue-green release/,
    /cache-busted public\s+marker/,
  ]) {
    expect(backgroundJobs).toMatch(invariant)
  }

  if (yandexCloud !== null) {
    expect(yandexCloud).toMatch(/^### Automatic website rebuild/m)
    expect(yandexCloud).toContain('Automatic SSG rebuild is not part of the baseline Yandex path')
    expect(yandexCloud).toMatch(/immutable revisioned prefix or release bucket/)
    expect(yandexCloud).toMatch(/atomically\/blue-green promotes that release/)
    expect(yandexCloud).toContain('never treat an in-place recursive upload as a safe automatic release')
  }

  expect(checklist).toMatch(/^## (?:\d+\. )?Website data and freshness/m)
  for (const capability of [
    'Website build-time backend data',
    'Automatic SSG rebuild',
    'Website cart handoff',
    'Browser checkout / payments',
  ]) {
    expect(checklist).toContain(`| ${capability} |`)
  }
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

test('the AWS signer stays a single copy, which is what the exact pin in backend buys', async () => {
  // `backend/src/email/postbox-delivery.ts` signs Postbox requests with `@smithy/signature-v4`,
  // pinned to the exact version the AWS SDK has already resolved for S3 storage. Any range wide
  // enough to admit a newer release makes the package manager hoist a second signer and a second
  // 5 MB `@smithy/core`, then push the SDK's copies into nineteen nested duplicates - and every
  // other check stays green while the image grows by ~95 MB. This is the only thing that notices.
  const copies = async (packageName) => {
    const found = []
    const walk = async (directory, depth) => {
      if (depth > 6) return
      const entries = await readdir(directory, { withFileTypes: true }).catch(() => [])
      for (const entry of entries) {
        if (!entry.isDirectory()) continue
        const path = resolve(directory, entry.name)
        if (entry.name === 'node_modules') {
          if (await access(resolve(path, packageName)).then(() => true, () => false)) {
            found.push(resolve(path, packageName))
          }
          await walk(path, depth + 1)
          continue
        }
        if (entry.name.startsWith('.') || entry.name === 'dist') continue
        if (depth === 0 || directory.includes('node_modules')) await walk(path, depth + 1)
      }
    }
    await walk(repositoryRoot, 0)

    return found
  }

  // `@smithy/core` is the 5 MB half and must be a single copy - that is the whole cost the pin
  // exists to avoid. The signer itself is 220 KB, and the package manager may lay several
  // identical copies out for the SDK's own subtree; what matters there is that every copy is the
  // *same version*, because a second version is the symptom that the pin has drifted from what
  // the SDK resolved and that `@smithy/core` is about to split with it.
  expect({ packageName: '@smithy/core', copies: (await copies('@smithy/core')).length }).toEqual({
    packageName: '@smithy/core',
    copies: 1,
  })

  const signerVersions = new Set()
  for (const path of await copies('@smithy/signature-v4')) {
    signerVersions.add(JSON.parse(await readFile(resolve(path, 'package.json'), 'utf8')).version)
  }

  expect([...signerVersions]).toHaveLength(1)

  // And the pin itself is exact, because a caret here is what reintroduces the duplication.
  const backendPackage = JSON.parse(
    await readFile(resolve(repositoryRoot, 'backend/package.json'), 'utf8'),
  )

  expect(backendPackage.dependencies['@smithy/signature-v4']).toMatch(/^\d+\.\d+\.\d+$/)
  // And the pin is the version actually installed, not a stale one the resolver worked around.
  // A mismatch is usually a stale `node_modules` after a branch switch - `master` and `mobile`
  // pin different versions because their AWS SDKs resolve different ones - so say so here rather
  // than leaving a bare version diff.
  expect({
    installed: [...signerVersions],
    hint: 'run `bun install` if this differs after switching branches',
  }).toEqual({
    installed: [backendPackage.dependencies['@smithy/signature-v4']],
    hint: 'run `bun install` if this differs after switching branches',
  })
})

test('the deploy generator refuses every email credential the env schema knows about', async () => {
  // Two lists of the same names: `emailProviderKeys` in backend/src/env.ts decides which keys are
  // refused under the wrong driver, and `emailEnvBlock()` in prepare-do-specs.mjs decides which
  // ones mean "you meant to configure email". A key present in the first and missing from the
  // second is silently dropped from a generated spec, which is how an install deploys with a
  // provider half-configured and sends nothing.
  const { emailProviderKeys } = await import('../backend/src/env.ts')
  const generator = await readFile(resolve(repositoryRoot, 'scripts/prepare-do-specs.mjs'), 'utf8')
  // `emailKeys` is the single table the generator refuses, requires, and emits from, so this is
  // the list that actually decides what reaches a deployed component.
  const block = /const emailKeys = \[([\s\S]*?)\n\]/.exec(generator)

  expect(block).not.toBeNull()

  const listed = new Set([...block[1].matchAll(/name: '([A-Z_]+)'/g)].map((match) => match[1]))

  for (const name of Object.values(emailProviderKeys).flat()) {
    expect({ name, listedInGenerator: listed.has(name) }).toEqual({ name, listedInGenerator: true })
  }
})

test('the E2E backend blanks every email credential the env schema would refuse', async () => {
  // webapp/playwright.config.ts pins EMAIL_DELIVERY=disabled and blanks the credentials, because
  // a value inherited from the developer's shell or backend/.env is refused at startup - and that
  // surfaces as an opaque 120-second webServer timeout with nothing pointing at email. A key added
  // to `emailProviderKeys` and not to that list reintroduces it silently.
  const { emailProviderKeys } = await import('../backend/src/env.ts')
  const config = await readFile(resolve(repositoryRoot, 'webapp/playwright.config.ts'), 'utf8')

  for (const name of Object.values(emailProviderKeys).flat()) {
    expect({ name, blankedForE2E: new RegExp(`${name}:\\s*''`).test(config) }).toEqual({
      name,
      blankedForE2E: true,
    })
  }
})
