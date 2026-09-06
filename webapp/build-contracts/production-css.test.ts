import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { readFile, readdir } from 'node:fs/promises'
import path from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

/**
 * Build contracts read the production `dist/` that `bun run test:build-contracts` (repository
 * root) builds right before them. They never build on their own: the unit suite in `tests/` stays
 * read-only and free of the developer's build environment, and a build-contract file run by itself
 * checks whatever `dist/` currently holds.
 */
const workspaceRoot = fileURLToPath(new URL('..', import.meta.url))
const distDirectory = path.join(workspaceRoot, 'dist')

test('production CSS excludes utilities used only by stories', async () => {
  assert.ok(
    existsSync(distDirectory),
    `${distDirectory} is missing: run \`bun run test:build-contracts\` from the repository root, which builds before it checks`,
  )

  const storySource = await readFile(
    path.join(workspaceRoot, 'src/stories/ui/demos.tsx'),
    'utf8',
  )
  assert.match(storySource, /h-\[34rem\]/)

  const assetsDirectory = path.join(distDirectory, 'assets')
  const cssFiles = (await readdir(assetsDirectory)).filter((fileName) => fileName.endsWith('.css'))
  assert.ok(cssFiles.length > 0, `expected at least one CSS asset in ${assetsDirectory}`)
  const css = (
    await Promise.all(
      cssFiles.map((fileName) => readFile(path.join(assetsDirectory, fileName), 'utf8')),
    )
  ).join('\n')

  assert.ok(!css.includes('.h-\\[34rem\\]{'))
})
