import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { execFileSync, spawn, spawnSync } from 'node:child_process'
import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  symlinkSync,
} from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { defaultTestDatabaseUrl, postgresTestService, repositoryRoot } from './repo-env.mjs'

/**
 * The anti-drift check for the feature generator: it copies this repository's tracked source
 * (never node_modules) into a scratch directory, mirrors installed dependencies into it by
 * symlink instead of reinstalling, generates a sample feature there with the real CLI, and runs
 * what a person would run after scaffolding - typecheck, the full webapp lint, the webapp unit
 * tests (the generated model test and the navigation drift guard among them), the architecture
 * check, and the generated backend integration test against the copy's own test database.
 *
 * Two samples, generated into the same copy: "items", whose contract type `Item` has the same
 * name as a UI primitive the generated list imports, so the check proves the templates cannot
 * shadow one; and "invoice-items", whose kebab, camel, Pascal, and snake forms all differ, so a
 * template that uses the wrong casing somewhere fails to compile or migrate. Names that would
 * clash with an identifier in an edited file, or with a shared import, are covered by the unit
 * tests in scaffold-feature.test.mjs: the generator refuses the first before writing, and the
 * second cannot occur because the templates import feature code under fixed aliases.
 *
 * The database is a Docker Compose project of its own, on a free port, created here and removed
 * in `afterAll` - and on SIGINT or SIGTERM - so it never touches the main checkout's test
 * database. This is the one expensive thing in this file, so it is opt-in: `bun run
 * test:scaffold` (which sets `SCAFFOLD_E2E=1`) runs it; a bare `bun test ./scripts/` - what
 * `bun run test:infra` runs - skips it. It has no `.integration.test.` or `.live.test.` suffix,
 * so `backend/scripts/test-files.mjs` (which only splits *backend* tests) never sees it.
 */
const runE2E = process.env.SCAFFOLD_E2E === '1'
const sampleFeatures = ['items', 'invoice-items']

// Variables that would point the copy at another checkout's database or Compose project.
const inheritedDatabaseVariables = [
  'COMPOSE_PROJECT_NAME',
  'DATABASE_URL',
  'POSTGRES_PORT',
  'POSTGRES_TEST_PORT',
  'TEST_DATABASE_URL',
  'TEST_KEEP_DOCKER',
  'TEST_SKIP_DOCKER',
]

describe.skipIf(!runE2E)('scaffold:feature generated code passes real checks', () => {
  const scratchDirectories = []
  let tempRoot
  let schemaBefore
  let composeProject
  let composeEnv
  let databaseStarted = false
  let currentChild
  let cleanedUp = false

  const cleanup = () => {
    if (cleanedUp) return
    cleanedUp = true
    // Each step runs in its own process group, so this also stops what the step itself spawned.
    if (currentChild) {
      try {
        process.kill(-currentChild.pid, 'SIGTERM')
      } catch {
        // The step already exited.
      }
    }
    if (databaseStarted) {
      spawnSync(
        'docker',
        ['compose', '-p', composeProject, 'down', '--volumes', '--remove-orphans', '--timeout', '5'],
        { cwd: tempRoot, env: composeEnv, stdio: 'inherit' },
      )
    }
    for (const directory of scratchDirectories) rmSync(directory, { recursive: true, force: true })
  }
  const onSignal = (signal) => {
    cleanup()
    process.exit(signal === 'SIGINT' ? 130 : 143)
  }

  async function run(command, cwd, env = composeEnv) {
    const child = spawn(command[0], command.slice(1), { cwd, env, stdio: 'inherit', detached: true })
    currentChild = child
    const exitCode = await new Promise((resolve, reject) => {
      child.once('error', reject)
      child.once('exit', (code, signal) => resolve(code ?? signal))
    })
    currentChild = undefined
    if (exitCode !== 0) {
      throw new Error(`${command.join(' ')} (cwd: ${cwd}) exited with ${exitCode}`)
    }
  }

  beforeAll(async () => {
    process.once('SIGINT', onSignal)
    process.once('SIGTERM', onSignal)

    tempRoot = mkdtempSync(path.join(tmpdir(), 'scaffold-feature-e2e-'))
    schemaBefore = mkdtempSync(path.join(tmpdir(), 'scaffold-feature-e2e-schema-'))
    scratchDirectories.push(tempRoot, schemaBefore)

    copyTrackedFiles(repositoryRoot, tempRoot)
    mirrorNodeModules(path.join(repositoryRoot, 'node_modules'), path.join(tempRoot, 'node_modules'), tempRoot)
    // `mobile` exists only on the mobile branch; root `lint` runs its ESLint too. A missing
    // workspace is skipped.
    for (const workspace of ['webapp', 'backend', 'packages/contracts', 'mobile']) {
      mirrorNodeModules(
        path.join(repositoryRoot, workspace, 'node_modules'),
        path.join(tempRoot, workspace, 'node_modules'),
        tempRoot,
      )
    }
    // The schema as it was before scaffolding, the "from" side of the migration below.
    cpSync(path.join(tempRoot, 'backend/prisma/schema'), schemaBefore, { recursive: true })

    const port = await freePort()
    composeProject = `scaffold-e2e-${path.basename(tempRoot).replace(/[^a-z0-9]/gi, '').toLowerCase()}`
    const inherited = { ...process.env }
    for (const name of inheritedDatabaseVariables) delete inherited[name]
    composeEnv = { ...inherited, COMPOSE_PROJECT_NAME: composeProject, POSTGRES_TEST_PORT: String(port) }
  }, 60_000)

  afterAll(() => {
    cleanup()
    process.off('SIGINT', onSignal)
    process.off('SIGTERM', onSignal)
  })

  test(
    `generating ${sampleFeatures.join(' and ')} keeps typecheck, lint, unit, architecture, and integration checks green`,
    async () => {
      // The real CLI, run exactly as a person would: it writes the files and then runs
      // `prisma:generate` itself.
      for (const feature of sampleFeatures) {
        await run(['bun', 'scripts/scaffold-feature.mjs', feature], tempRoot)
        expect(existsSync(path.join(tempRoot, `webapp/src/features/${feature}/index.ts`))).toBe(true)
      }

      await run(['bun', 'run', '--cwd', 'packages/contracts', 'typecheck'], tempRoot)
      await run(['bun', 'run', '--cwd', 'backend', 'typecheck'], tempRoot)
      await run(['bun', 'run', '--cwd', 'webapp', 'typecheck'], tempRoot)
      await run(['bun', 'run', 'lint'], tempRoot)
      await run(['bun', 'test', 'tests'], path.join(tempRoot, 'webapp'))
      await run(['bun', 'scripts/architecture-check.mjs'], tempRoot)

      // The migration a person would create with `prisma:migrate`, derived without a database.
      const migrationDirectory = `prisma/migrations/${migrationTimestamp()}_add_scaffold_samples`
      mkdirSync(path.join(tempRoot, 'backend', migrationDirectory), { recursive: true })
      await run(
        [
          'bun', 'x', 'prisma', 'migrate', 'diff',
          '--from-schema', schemaBefore,
          '--to-schema', 'prisma/schema',
          '--script',
          '--output', `${migrationDirectory}/migration.sql`,
        ],
        path.join(tempRoot, 'backend'),
      )

      databaseStarted = true
      await run(['docker', 'compose', 'up', '--detach', '--wait', postgresTestService], tempRoot)
      await run(
        [
          'bun', 'run', 'test:integration', '--',
          ...sampleFeatures.map((feature) => `src/modules/${feature}/${feature}.integration.test.ts`),
        ],
        path.join(tempRoot, 'backend'),
        {
          ...composeEnv,
          TEST_SKIP_DOCKER: '1',
          TEST_DATABASE_URL: defaultTestDatabaseUrl(composeEnv.POSTGRES_TEST_PORT),
        },
      )
    },
    600_000,
  )
})

function freePort() {
  return new Promise((resolve, reject) => {
    const server = createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address()
      server.close(() => resolve(port))
    })
  })
}

function migrationTimestamp() {
  return new Date().toISOString().replace(/\D/g, '').slice(0, 14)
}

/** Everything git would track or add, minus whatever .gitignore already excludes - never node_modules or build output. */
function copyTrackedFiles(sourceRoot, destinationRoot) {
  const output = execFileSync(
    'git',
    ['ls-files', '-z', '--cached', '--others', '--exclude-standard'],
    { cwd: sourceRoot, maxBuffer: 1024 * 1024 * 64 },
  )
  for (const relativePath of output.toString('utf8').split('\0').filter(Boolean)) {
    const source = path.join(sourceRoot, relativePath)
    // `git ls-files --cached` lists what the index tracks, which can include a path a working
    // copy has since deleted but not yet staged as removed (a normal thing to see mid-session in
    // a shared checkout) - nothing to copy for that path, so skip it rather than fail the whole run.
    if (!existsSync(source) || !lstatSync(source).isFile()) continue
    const destination = path.join(destinationRoot, relativePath)
    mkdirSync(path.dirname(destination), { recursive: true })
    cpSync(source, destination)
  }
}

/**
 * Recreates one `node_modules` directory as symlinks into the real, already-installed one, so
 * the temp copy never runs its own `bun install`. Every entry is linked as-is except tool caches
 * (left out, see below) and the
 * `@web-app-demo` workspace scope, which is relinked to point at the *temp copy* of each
 * workspace: those packages are the code under test, and their real siblings would otherwise
 * shadow it, since `@web-app-demo/contracts` etc. are relative symlinks that resolve to wherever
 * the entry physically sits on disk.
 */
const writableCacheEntries = new Set(['.cache', '.tmp'])

function mirrorNodeModules(realDir, tempDir, tempRoot) {
  if (!existsSync(realDir)) return
  mkdirSync(tempDir, { recursive: true })

  for (const entry of readdirSync(realDir)) {
    // Tool caches (tsc -b build info in `.tmp`, jiti in `.cache`) are written, not only read:
    // linked, the copy would write them into the real checkout. The copy creates its own.
    if (entry === '@web-app-demo' || writableCacheEntries.has(entry)) continue
    symlinkSync(path.join(realDir, entry), path.join(tempDir, entry))
  }

  const realScopeDir = path.join(realDir, '@web-app-demo')
  if (!existsSync(realScopeDir)) return

  const tempScopeDir = path.join(tempDir, '@web-app-demo')
  mkdirSync(tempScopeDir, { recursive: true })
  for (const entry of readdirSync(realScopeDir)) {
    const workspaceDir = entry === 'contracts' ? path.join(tempRoot, 'packages/contracts') : path.join(tempRoot, entry)
    symlinkSync(workspaceDir, path.join(tempScopeDir, entry))
  }
}
