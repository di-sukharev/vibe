import { readdir, readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

// Everything billing owns outright. Removing the capability deletes these; nothing else
// in the repository may live here.
export const billingOwnedPaths = [
  'backend/prisma/schema/billing.prisma',
  'backend/src/modules/billing',
  'docs/IAP.md',
  'mobile/src/app/paywall.tsx',
  'mobile/src/features/billing',
  'mobile/tests/iap-deferred-surfaces.test.ts',
  'mobile/tests/iap-provider.test.tsx',
  'mobile/tests/iap.test.ts',
  'mobile/tests/offer-code-controller.test.ts',
  'mobile/tests/paywall-view-state.test.ts',
  'mobile/tests/workspace-surfaces.test.ts',
  'packages/contracts/src/iap.test.ts',
  'packages/contracts/src/iap.ts',
  // The remover is single-use: once billing is gone, it and its guard tests describe nothing.
  'scripts/remove-billing.mjs',
  'scripts/remove-billing.test.mjs',
]

// Migrations that created billing tables. They are dropped only when the project has not
// deployed yet; an already-deployed database needs a generated drop migration instead.
export const billingMigrationDirectories = [
  'backend/prisma/migrations/20260519131811_iap_paywall',
  'backend/prisma/migrations/20260605120000_google_play_iap',
  'backend/prisma/migrations/20260717001537_app_store_webhook_claim_lease',
  'backend/prisma/migrations/20260717010502_google_play_reconcile_schedule_index',
  'backend/prisma/migrations/20260717012753_google_play_reconcile_attempt_schedule',
  'backend/prisma/migrations/20260717095501_drop_obsolete_google_play_reconcile_index',
]

// Files carrying `capability:billing` seams: marked regions are deleted whole.
export const billingSeamFiles = [
  'backend/prisma/schema/base.prisma',
  'backend/scripts/test-integration.mjs',
  'backend/src/app.ts',
  'backend/src/cron.ts',
  'backend/src/modules/users/users.integration.test.ts',
  'mobile/scripts/e2e/maestro-policy-audit.mjs',
  'mobile/src/composition/AppProviders.tsx',
  'mobile/src/composition/api.ts',
  'mobile/tests/maestro-policy-audit.test.ts',
  'packages/contracts/src/index.ts',
]

// Wiring that cannot be deleted mechanically, because removing it means rewriting
// surrounding code rather than dropping a region.
export const billingManualSteps = [
  'mobile/src/composition/AppProviders.tsx: unwrap the <IapProvider> element, keeping its children.',
  'mobile/src/app/(tabs)/profile.tsx: drop the SubscriptionSummary block and its imports.',
  'mobile/tests/api.test.ts and mobile/tests/select-registration.test.tsx: drop their billing cases; these files also cover surfaces that stay.',
  'backend/src/cron.ts: remove the billing:google-play:reconcile task and its runner branch.',
  'backend/src/env.ts: remove APPLE_IAP_*, GOOGLE_PLAY_*, and IAP_* entries with their validators, then drop the same keys from the env fixtures in backend/src/modules/auth/auth-routes.test.ts, backend/src/modules/auth/auth.integration.test.ts, backend/src/modules/users/users.integration.test.ts, backend/src/modules/notifications/notifications.integration.test.ts, and backend/src/storage/service.test.ts.',
  'backend/src/app.test.ts, backend/src/cron.test.ts, backend/src/env.test.ts: drop their billing cases.',
  'backend/package.json: drop backend/src/modules/billing test files from the test:unit list.',
  'scripts/prepare-do-specs.mjs and scripts/prepare-do-specs.test.mjs: remove the store credential groups and the assertions covering them.',
  '.do/backend-app.yaml.example: remove the IAP_* envs and the REPLACE_WITH_OPTIONAL_IAP_ENVS placeholder.',
  'package.json: drop the feature:billing:remove script and the remove-billing test from test:deploy.',
  'mobile/package.json and mobile/app.config.js: drop the expo-iap dependency and its config plugin.',
  'README.md, backend/README.md, mobile/README.md: drop the links to the deleted docs/IAP.md.',
  'mobile/src/app/(tabs)/profile.tsx: the screen description still mentions an entitlement.',
  'backend/.env.example, mobile/.env.example, and mobile/src/types/env.d.ts: drop the store credential keys.',
  'packages/contracts/src/errors.ts: drop the IAP_* error codes.',
  'CHECKLIST.md: set the Payments / subscriptions ledger row to `removed`.',
]

export function stripCapabilitySeams(source, capability = 'billing') {
  const startMarker = `capability:${capability}:start`
  const endMarker = `capability:${capability}:end`
  const kept = []
  let depth = 0

  for (const line of source.split('\n')) {
    if (line.includes(startMarker)) {
      depth += 1
      continue
    }
    if (line.includes(endMarker)) {
      depth = Math.max(0, depth - 1)
      continue
    }
    if (depth === 0) kept.push(line)
  }

  if (depth !== 0) {
    throw new Error(`Unbalanced ${capability} capability markers`)
  }

  return kept.join('\n')
}

export async function findRemainingReferences(root = repositoryRoot) {
  const hits = []
  const ignored = new Set([
    '.expo',
    '.git',
    '.next',
    '.scratch',
    'build',
    'coverage',
    'dist',
    'generated',
    'node_modules',
  ])
  // Word boundaries would miss IAP_BODY_LIMIT_BYTES and subscriptionEntitlement, which are
  // exactly the leftovers that break a build after removal.
  const pattern = /(billing|iap|subscription|paywall)/i

  async function walk(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (ignored.has(entry.name)) continue
      const entryPath = path.join(directory, entry.name)
      if (entry.isDirectory()) {
        await walk(entryPath)
        continue
      }
      if (!/(?:\.(?:[cm]?[jt]sx?|prisma|json|md|ya?ml)|\.env\.example)$/.test(entry.name)) continue

      const source = await readFile(entryPath, 'utf8')
      for (const [index, line] of source.split('\n').entries()) {
        if (!pattern.test(line)) continue
        // Minified bundles would otherwise drown the report in one unreadable line.
        if (line.length > 200) {
          hits.push(`${path.relative(root, entryPath)}:${index + 1}: <long line omitted>`)
          continue
        }
        hits.push(`${path.relative(root, entryPath)}:${index + 1}: ${line.trim()}`)
      }
    }
  }

  await walk(root)
  return hits
}

export async function removeBilling({ keepMigrations = false, root = repositoryRoot, log = console.log } = {}) {
  // Read and strip every seam first. `stripCapabilitySeams` is the only step that can fail, and
  // failing after the deletions would leave the repository half-removed with nothing to undo it.
  const strippedSeams = []
  for (const seamFile of billingSeamFiles) {
    const seamPath = path.join(root, seamFile)
    strippedSeams.push([seamPath, stripCapabilitySeams(await readFile(seamPath, 'utf8'))])
  }

  if (!keepMigrations) {
    log(
      'Deleting the billing migrations. If this database is already deployed, stop and rerun with',
      '--keep-migrations, then generate a migration that drops the billing tables instead.',
    )
  }

  for (const ownedPath of billingOwnedPaths) {
    await rm(path.join(root, ownedPath), { force: true, recursive: true })
    log(`removed ${ownedPath}`)
  }

  if (keepMigrations) {
    log('kept billing migrations (--keep-migrations)')
  } else {
    for (const migration of billingMigrationDirectories) {
      await rm(path.join(root, migration), { force: true, recursive: true })
      log(`removed ${migration}`)
    }
  }

  for (const [seamPath, stripped] of strippedSeams) {
    await writeFile(seamPath, stripped)
    log(`stripped billing seams in ${path.relative(root, seamPath)}`)
  }

  // Grouped by file: a flat list of every matching line buries the manual steps below it.
  const remaining = await findRemainingReferences(root)
  if (remaining.length > 0) {
    const byFile = new Map()
    for (const hit of remaining) {
      const file = hit.slice(0, hit.indexOf(':'))
      byFile.set(file, (byFile.get(file) ?? 0) + 1)
    }
    const ranked = [...byFile].sort((left, right) => right[1] - left[1])

    log(`\nFiles still mentioning billing (${byFile.size} files, ${remaining.length} lines):`)
    for (const [file, count] of ranked.slice(0, 20)) {
      log(`  ${file} (${count})`)
    }
    if (ranked.length > 20) log(`  ... and ${ranked.length - 20} more`)
    log("  Inspect with: rg -n -i 'billing|iap|subscription|paywall' <file>")
  }

  log('\nStill to do by hand:')
  for (const step of billingManualSteps) {
    log(`- ${step}`)
  }

  log('\nThen run: bun install && bun run typecheck && bun run architecture:check && bun run test')

  return { remaining }
}

if (import.meta.main) {
  await removeBilling({ keepMigrations: process.argv.includes('--keep-migrations') })
}
