import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const repositoryRoot = resolve(fileURLToPath(new URL('..', import.meta.url)))

function git(args) {
  return execFileSync('git', args, { cwd: repositoryRoot, encoding: 'utf8' }).trim()
}

export function normalizedAgentInstructions(documentation) {
  return documentation
    .replace(/^# (?:AGENTS|CLAUDE)\.md$/m, '# AGENT_FILE.md')
    .replace(/`(?:AGENTS|CLAUDE)\.md`/g, '`AGENT_FILE.md`')
}

export function capabilityState(checklist, capability) {
  const escaped = capability.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return checklist.match(new RegExp(`^\\|\\s*${escaped}\\s*\\|\\s*([^|]+?)\\s*\\|`, 'm'))?.[1]
}

function dependencyVersion(packageJson, dependency) {
  try {
    return JSON.parse(packageJson).dependencies?.[dependency]
  } catch {
    return undefined
  }
}

function parsedPackage(packageJson) {
  try {
    return JSON.parse(packageJson)
  } catch {
    return {}
  }
}

export function mobileContractErrors(input) {
  const errors = []
  const require = (condition, message) => {
    if (!condition) errors.push(message)
  }

  require(input.branch === 'mobile', 'current branch must be mobile')
  require(input.status === '', 'worktree and index must be clean')
  if (input.requirePublished) {
    require(input.head === input.originMobile, 'HEAD must equal the published origin/mobile ref')
  }
  require(input.masterIsAncestor, 'origin/master must be an ancestor of mobile HEAD')
  for (const path of input.requiredFiles) {
    require(input.presentFiles.has(path), `required mobile template file is missing: ${path}`)
  }
  require(
    Boolean(dependencyVersion(input.mobilePackageJson, 'expo-iap')),
    'mobile/package.json must keep the expo-iap dependency',
  )
  require(
    /['"]expo-iap['"]/.test(input.mobileAppConfig),
    'mobile/app.config.js must keep the expo-iap config plugin',
  )
  const rootPackage = parsedPackage(input.rootPackageJson)
  require(rootPackage.workspaces?.includes('mobile'), 'root workspaces must include mobile')
  for (const script of ['test:mobile', 'typecheck:mobile']) {
    require(Boolean(rootPackage.scripts?.[script]), `root package scripts must include ${script}`)
  }
  require(
    normalizedAgentInstructions(input.agents) === normalizedAgentInstructions(input.claude),
    'AGENTS.md and CLAUDE.md must remain equivalent',
  )
  for (const documentation of [input.agents, input.claude]) {
    require(
      documentation.includes('always read `docs/WEB_SURFACES.md` first'),
      'agent instructions must require docs/WEB_SURFACES.md',
    )
    require(
      documentation.includes('Do not create or use GitHub CI/CD, GitHub Actions'),
      'agent instructions must forbid GitHub CI/CD and Actions',
    )
  }
  for (const capability of [
    'Payments / subscriptions',
    'Push notifications',
    'Social sign-in (Apple / Google)',
  ]) {
    require(
      capabilityState(input.checklist, capability) === 'available',
      `${capability} must remain available on the mobile template line`,
    )
  }

  return errors
}

function currentReleaseInput() {
  const requiredFiles = [
    'docs/WEB_SURFACES.md',
    'docs/IAP.md',
    'mobile/package.json',
    'mobile/app.config.js',
    'mobile/src/features/billing/provider.tsx',
    'mobile/src/features/billing/purchase-controller.ts',
    'backend/src/modules/billing/index.ts',
    'backend/src/modules/billing/infrastructure/apple-verifier.ts',
    'backend/src/modules/billing/infrastructure/google-play-verifier.ts',
    'packages/contracts/src/iap.ts',
  ]
  const ancestor = spawnSync('git', ['merge-base', '--is-ancestor', 'origin/master', 'HEAD'], {
    cwd: repositoryRoot,
    stdio: 'ignore',
  })
  if (ancestor.error) throw ancestor.error

  return {
    branch: git(['branch', '--show-current']),
    status: git(['status', '--porcelain=v1']),
    head: git(['rev-parse', 'HEAD']),
    originMobile: git(['rev-parse', 'origin/mobile']),
    requirePublished: process.argv.includes('--published'),
    masterIsAncestor: ancestor.status === 0,
    requiredFiles,
    presentFiles: new Set(requiredFiles.filter((path) => existsSync(resolve(repositoryRoot, path)))),
    agents: readFileSync(resolve(repositoryRoot, 'AGENTS.md'), 'utf8'),
    claude: readFileSync(resolve(repositoryRoot, 'CLAUDE.md'), 'utf8'),
    checklist: readFileSync(resolve(repositoryRoot, 'CHECKLIST.md'), 'utf8'),
    rootPackageJson: readFileSync(resolve(repositoryRoot, 'package.json'), 'utf8'),
    mobilePackageJson: existsSync(resolve(repositoryRoot, 'mobile/package.json'))
      ? readFileSync(resolve(repositoryRoot, 'mobile/package.json'), 'utf8')
      : '',
    mobileAppConfig: existsSync(resolve(repositoryRoot, 'mobile/app.config.js'))
      ? readFileSync(resolve(repositoryRoot, 'mobile/app.config.js'), 'utf8')
      : '',
  }
}

if (import.meta.main) {
  const errors = mobileContractErrors(currentReleaseInput())
  if (errors.length > 0) {
    console.error(`Mobile template check failed:\n- ${errors.join('\n- ')}`)
    process.exit(1)
  }

  for (const args of [
    ['run', 'test:deploy'],
    ['run', 'test:contracts'],
    ['run', 'test:backend:unit'],
    ['run', 'test:mobile'],
    ['run', 'typecheck:mobile'],
  ]) {
    execFileSync('bun', args, { cwd: repositoryRoot, stdio: 'inherit' })
  }
  console.log('Mobile template check passed.')
}
