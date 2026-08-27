import assert from 'node:assert/strict'
import { readdir } from 'node:fs/promises'
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
