import { spawnSync } from 'node:child_process'
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, expect, test } from 'bun:test'
import { brotliDecompressSync, gunzipSync } from 'node:zlib'

import { precompressDirectory } from './precompress-static.mjs'

const directories = []

afterEach(async () => {
  for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true })
})

async function distDirectory(files) {
  const directory = await mkdtemp(path.join(tmpdir(), 'precompress-static-'))
  directories.push(directory)
  for (const [name, contents] of Object.entries(files)) {
    const target = path.join(directory, name)
    await mkdir(path.dirname(target), { recursive: true })
    await writeFile(target, contents)
  }
  return directory
}

const text = Buffer.from('export const message = "the quick brown fox"\n'.repeat(60))

test('precompressDirectory writes siblings for text assets only', async () => {
  const directory = await distDirectory({
    'app.js': text,
    'index.html': text,
    'inter.woff2': Buffer.from(crypto.getRandomValues(new Uint8Array(4096))),
    'tiny.css': Buffer.from('a{color:red}'),
  })

  const summary = await precompressDirectory(directory)
  const written = (await readdir(directory)).sort()

  expect(summary.compressed).toBe(2)
  expect(summary.skipped).toBe(2)
  expect(written).toEqual([
    'app.js',
    'app.js.br',
    'app.js.gz',
    'index.html',
    'index.html.br',
    'index.html.gz',
    'inter.woff2',
    'tiny.css',
  ])

  // Read the bytes back rather than trusting the filenames. A sibling holding its source verbatim
  // is the worst regression this script can ship: a proxy serves `app.js.gz` with
  // `Content-Encoding: gzip`, every browser fails to decode it, and the page renders blank - while
  // every filename and counter above still looks exactly right.
  const gz = await readFile(path.join(directory, 'app.js.gz'))
  const br = await readFile(path.join(directory, 'app.js.br'))
  expect(gunzipSync(gz)).toEqual(text)
  expect(brotliDecompressSync(br)).toEqual(text)
  expect(gz.length).toBeLessThan(text.length)
  expect(br.length).toBeLessThan(text.length)
})

test('precompressDirectory reaches nested directories, where every real asset lives', async () => {
  // Vite emits into `assets/` and Astro into `_astro/`, so a walk that stopped at the top level
  // would leave every hashed bundle uncompressed while still reporting success on `index.html`.
  const directory = await distDirectory({
    'index.html': text,
    'assets/app.js': text,
    'assets/nested/deep/late.css': text,
  })

  const summary = await precompressDirectory(directory)

  expect(summary.compressed).toBe(3)
  expect((await readdir(path.join(directory, 'assets/nested/deep'))).sort()).toEqual([
    'late.css',
    'late.css.br',
    'late.css.gz',
  ])
})

test('precompressDirectory removes a stale sibling whose source is gone', async () => {
  const directory = await distDirectory({
    'app.js': text,
    // A variant whose source is gone. Vite and Astro empty `dist` themselves, so this arrives the
    // other ways: a deploy directory synced without `--delete`, or a run over output the build did
    // not clean. A proxy prefers the sibling whenever it exists, so leaving it serves content
    // whose source the build already dropped.
    'index.html.gz': Buffer.from('stale'),
    'index.html.br': Buffer.from('stale'),
  })

  const summary = await precompressDirectory(directory)

  expect(summary.removed).toBe(2)
  expect((await readdir(directory)).sort()).toEqual(['app.js', 'app.js.br', 'app.js.gz'])
})

test('precompressDirectory removes a stale sibling whose source stopped being compressible', async () => {
  // The other way a variant goes stale: the file is still published, but this build shrank it
  // below the threshold. Leaving the old sibling would serve the previous, larger content.
  const directory = await distDirectory({
    'app.js': Buffer.from('export const x = 1\n'),
    'app.js.gz': Buffer.from('stale'),
    'app.js.br': Buffer.from('stale'),
  })

  const summary = await precompressDirectory(directory)

  expect(summary.compressed).toBe(0)
  expect(summary.skipped).toBe(1)
  expect(summary.removed).toBe(2)
  expect(await readdir(directory)).toEqual(['app.js'])
})

test('precompressDirectory never compresses its own output', async () => {
  const directory = await distDirectory({ 'app.js': text })

  await precompressDirectory(directory)
  const summary = await precompressDirectory(directory)

  expect(summary.compressed).toBe(1)
  expect(summary.removed).toBe(0)
  expect((await readdir(directory)).sort()).toEqual(['app.js', 'app.js.br', 'app.js.gz'])
})

function runScript(...targets) {
  return spawnSync(process.execPath, ['scripts/precompress-static.mjs', ...targets], {
    cwd: path.resolve(import.meta.dirname, '..'),
    encoding: 'utf8',
  })
}

test('the command fails when no requested target exists, rather than reporting success', async () => {
  // The exit code is what stops a deploy step from passing over an unbuilt dist and shipping
  // uncompressed assets - a green step that did nothing is the failure worth catching here.
  const missing = runScript('does-not-exist/dist')

  expect(missing.status).toBe(1)
  expect(`${missing.stdout}${missing.stderr}`).toContain('does-not-exist/dist')
})

test('the command compresses the targets it is given and skips the ones not built', async () => {
  const directory = await distDirectory({ 'app.js': text })

  const run = runScript(directory, 'does-not-exist/dist')

  // One target built and one missing is an ordinary partial build, not a failure.
  expect(run.status).toBe(0)
  expect(run.stdout).toContain('not built, skipped')
  expect((await readdir(directory)).sort()).toEqual(['app.js', 'app.js.br', 'app.js.gz'])
})
