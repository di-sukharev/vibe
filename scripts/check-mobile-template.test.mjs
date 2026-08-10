import { expect, test } from 'bun:test'

import { mobileContractErrors } from './check-mobile-template.mjs'

const agents = `# AGENTS.md

- Before payment work, always read \`docs/WEB_SURFACES.md\` first.
- Do not create or use GitHub CI/CD, GitHub Actions, or hosted validation workflows.
- Keep \`CLAUDE.md\` aligned.
`
const claude = agents
  .replace('# AGENTS.md', '# CLAUDE.md')
  .replace('`CLAUDE.md`', '`AGENTS.md`')
const checklist = `
| Capability | State | Note |
| --- | --- | --- |
| Payments / subscriptions | available | Store paths are switched off. |
| Push notifications | available | Needs credentials. |
| Social sign-in (Apple / Google) | available | Routes are switched off. |
`
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

function validInput() {
  return {
    branch: 'mobile',
    status: '',
    head: 'mobile-head',
    originMobile: 'mobile-head',
    requirePublished: false,
    masterIsAncestor: true,
    requiredFiles,
    presentFiles: new Set(requiredFiles),
    agents,
    claude,
    checklist,
    rootPackageJson: JSON.stringify({
      workspaces: ['webapp', 'website', 'mobile', 'backend', 'packages/*'],
      scripts: { 'test:mobile': 'mobile tests', 'typecheck:mobile': 'mobile typecheck' },
    }),
    mobilePackageJson: JSON.stringify({ dependencies: { 'expo-iap': '4.6.0' } }),
    mobileAppConfig: "const plugins = ['expo-iap']",
  }
}

test('mobile template contract accepts a clean pushed mobile line containing master', () => {
  const input = validInput()
  input.requirePublished = true
  expect(mobileContractErrors(input)).toEqual([])
})

test('mobile template contract accepts a validated maintainer candidate before push', () => {
  const input = validInput()
  input.head = 'candidate-ahead-of-origin'

  expect(mobileContractErrors(input)).toEqual([])
  input.requirePublished = true
  expect(mobileContractErrors(input)).toContain('HEAD must equal the published origin/mobile ref')
})

test('mobile template contract rejects the master branch and stale or unpublished refs', () => {
  const input = validInput()
  input.branch = 'master'
  input.status = ' M README.md'
  input.originMobile = 'older-mobile-head'
  input.requirePublished = true
  input.masterIsAncestor = false

  expect(mobileContractErrors(input)).toEqual(
    expect.arrayContaining([
      'current branch must be mobile',
      'worktree and index must be clean',
      'HEAD must equal the published origin/mobile ref',
      'origin/master must be an ancestor of mobile HEAD',
    ]),
  )
})

test('mobile template contract rejects missing runtime/docs and lost mobile capabilities', () => {
  const input = validInput()
  input.presentFiles.delete('docs/WEB_SURFACES.md')
  input.presentFiles.delete('mobile/package.json')
  input.checklist = input.checklist.replace(
    '| Payments / subscriptions | available |',
    '| Payments / subscriptions | absent |',
  )

  expect(mobileContractErrors(input)).toEqual(
    expect.arrayContaining([
      'required mobile template file is missing: docs/WEB_SURFACES.md',
      'required mobile template file is missing: mobile/package.json',
      'Payments / subscriptions must remain available on the mobile template line',
    ]),
  )
})

test('mobile template contract rejects lost native dependency and Apple or Google billing paths', () => {
  const input = validInput()
  input.mobilePackageJson = JSON.stringify({ dependencies: {} })
  input.mobileAppConfig = 'const plugins = []'
  input.presentFiles.delete('backend/src/modules/billing/infrastructure/apple-verifier.ts')
  input.presentFiles.delete('backend/src/modules/billing/infrastructure/google-play-verifier.ts')

  expect(mobileContractErrors(input)).toEqual(
    expect.arrayContaining([
      'mobile/package.json must keep the expo-iap dependency',
      'mobile/app.config.js must keep the expo-iap config plugin',
      'required mobile template file is missing: backend/src/modules/billing/infrastructure/apple-verifier.ts',
      'required mobile template file is missing: backend/src/modules/billing/infrastructure/google-play-verifier.ts',
    ]),
  )
})

test('mobile template contract rejects a root package that dropped the mobile workspace scripts', () => {
  const input = validInput()
  input.rootPackageJson = JSON.stringify({ workspaces: ['webapp'], scripts: {} })

  expect(mobileContractErrors(input)).toEqual(
    expect.arrayContaining([
      'root workspaces must include mobile',
      'root package scripts must include test:mobile',
      'root package scripts must include typecheck:mobile',
    ]),
  )
})

test('mobile template contract rejects drift between agent files and mandatory rules', () => {
  const input = validInput()
  input.claude = input.claude.replace('always read', 'optionally read')

  expect(mobileContractErrors(input)).toEqual(
    expect.arrayContaining([
      'AGENTS.md and CLAUDE.md must remain equivalent',
      'agent instructions must require docs/WEB_SURFACES.md',
    ]),
  )
})
