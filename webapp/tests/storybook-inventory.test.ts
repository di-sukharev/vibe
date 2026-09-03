import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFile, readdir } from 'node:fs/promises'
import path from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

const workspaceRoot = fileURLToPath(new URL('..', import.meta.url))

async function moduleNames(directory: string, suffix: string) {
  return (await readdir(path.join(workspaceRoot, directory)))
    .filter((fileName) => fileName.endsWith(suffix))
    .map((fileName) => fileName.slice(0, -suffix.length))
    .sort()
}

test('Storybook keeps one story for every UI module', async () => {
  const [components, stories] = await Promise.all([
    moduleNames('src/components/ui', '.tsx'),
    moduleNames('src/stories/ui', '.stories.tsx'),
  ])

  assert.deepEqual(stories, components)
})

test('production CSS excludes utilities used only by stories', { timeout: 30_000 }, async () => {
  const storySource = await readFile(
    path.join(workspaceRoot, 'src/stories/ui/demos.tsx'),
    'utf8',
  )
  assert.match(storySource, /h-\[34rem\]/)

  // `vite build` alone reproduces the production CSS/Tailwind purge this test checks;
  // `tsc -b` (the rest of the `build` script) is a separate, already-covered concern
  // (`bun run typecheck`) and roughly 8x'd this test's runtime for no extra signal here.
  execFileSync('bun', ['run', 'vite', 'build'], {
    cwd: workspaceRoot,
    env: process.env,
    stdio: 'pipe',
  })

  const assetsDirectory = path.join(workspaceRoot, 'dist/assets')
  const css = (
    await Promise.all(
      (await readdir(assetsDirectory))
        .filter((fileName) => fileName.endsWith('.css'))
        .map((fileName) => readFile(path.join(assetsDirectory, fileName), 'utf8')),
    )
  ).join('\n')

  assert.ok(!css.includes('.h-\\[34rem\\]{'))
})
