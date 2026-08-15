import { execFileSync, spawnSync } from 'node:child_process'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repositoryRoot = resolve(fileURLToPath(new URL('..', import.meta.url)))

/**
 * The release gate for the `mobile` line: it is publishable only when it is `master` plus the app.
 *
 * Deliberately only git state. This used to also assert that particular sentences appeared in the
 * agent files and that particular rows in `CHECKLIST.md` said particular words, which failed on
 * ordinary edits and translations while proving nothing a reader would not see. What is left is
 * the property that actually defines the branch.
 */
function git(args) {
  return execFileSync('git', args, { cwd: repositoryRoot, encoding: 'utf8' }).trim()
}

function mobileReleaseErrors({ branch, status, head, originMobile, masterIsAncestor, requirePublished }) {
  const errors = []

  if (branch !== 'mobile') errors.push('current branch must be mobile')
  if (status !== '') errors.push('worktree and index must be clean')
  if (!masterIsAncestor) errors.push('origin/master must be an ancestor of mobile HEAD')
  if (requirePublished && head !== originMobile) {
    errors.push('HEAD must equal the published origin/mobile ref')
  }

  return errors
}

if (import.meta.main) {
  const ancestor = spawnSync('git', ['merge-base', '--is-ancestor', 'origin/master', 'HEAD'], {
    cwd: repositoryRoot,
    stdio: 'ignore',
  })
  if (ancestor.error) throw ancestor.error

  const errors = mobileReleaseErrors({
    branch: git(['branch', '--show-current']),
    status: git(['status', '--porcelain=v1']),
    head: git(['rev-parse', 'HEAD']),
    originMobile: git(['rev-parse', 'origin/mobile']),
    masterIsAncestor: ancestor.status === 0,
    requirePublished: process.argv.includes('--published'),
  })

  if (errors.length > 0) {
    console.error(`Mobile template check failed:\n- ${errors.join('\n- ')}`)
    process.exit(1)
  }

  for (const args of [
    ['run', 'test:infra'],
    ['run', 'test:contracts'],
    ['run', 'test:backend:unit'],
    ['run', 'test:mobile'],
    ['run', 'typecheck:mobile'],
  ]) {
    execFileSync('bun', args, { cwd: repositoryRoot, stdio: 'inherit' })
  }
  console.log('Mobile template check passed.')
}
