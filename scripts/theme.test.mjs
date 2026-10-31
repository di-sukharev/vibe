import { spawnSync } from 'node:child_process'
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, expect, test } from 'bun:test'

const font = { family: "'Inter Variable'", package: '@fontsource-variable/inter' }
const theme = {
  webapp: { brand: null, radius: 0.625, font },
  website: { brand: null, radius: 0.75, font },
}
const marker = (name) => `/* THEME_${name}_START */\n/* THEME_${name}_END */\n`
const apps = {
  webapp: {
    cssPath: 'webapp/src/index.css',
    css: marker('FONT_IMPORT') + marker('FONT') + marker('TOKENS') + marker('TOKENS'),
  },
  website: {
    cssPath: 'website/src/styles/global.css',
    css: marker('FONT_IMPORT') + marker('FONT') + marker('TOKENS'),
  },
}

const directories = []

afterEach(async () => {
  for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true })
})

// A derived project removes an application in README bootstrap step 4 and runs the generator in
// step 5. `git rm -r` keeps ignored build output, so the removed application keeps a directory.
async function projectWith(kept, removed, themeConfig) {
  const directory = await mkdtemp(path.join(tmpdir(), 'theme-'))
  directories.push(directory)
  const files = {
    'theme.json': JSON.stringify(themeConfig),
    [`${kept}/package.json`]: JSON.stringify({ dependencies: { [font.package]: '5.0.0' } }),
    [apps[kept].cssPath]: apps[kept].css,
  }
  for (const [file, contents] of Object.entries(files)) {
    await mkdir(path.dirname(path.join(directory, file)), { recursive: true })
    await writeFile(path.join(directory, file), contents)
  }
  await mkdir(path.join(directory, removed, '.react-router'), { recursive: true })
  await mkdir(path.join(directory, 'scripts'))
  await copyFile(path.join(import.meta.dirname, 'theme.mjs'), path.join(directory, 'scripts/theme.mjs'))
  return directory
}

function runTheme(directory, ...args) {
  const run = spawnSync(process.execPath, [path.join(directory, 'scripts/theme.mjs'), ...args], { encoding: 'utf8' })
  return { status: run.status, output: `${run.stdout}${run.stderr}` }
}

test.each([
  ['webapp', 'website'],
  ['website', 'webapp'],
])('the generator covers only %s after %s is removed', async (kept, removed) => {
  const directory = await projectWith(kept, removed, { [kept]: theme[kept] })
  const { cssPath } = apps[kept]

  expect(runTheme(directory)).toEqual({ status: 0, output: `Theme tokens written to: ${cssPath}.\n` })
  expect(await readFile(path.join(directory, cssPath), 'utf8')).toContain(
    "--font-sans: 'Inter Variable', sans-serif;",
  )
  expect(runTheme(directory, '--check')).toEqual({ status: 0, output: 'Theme tokens are up to date.\n' })

  // The kept application is still checked: a new brand color makes its tokens out of date.
  await writeFile(path.join(directory, 'theme.json'), JSON.stringify({ [kept]: { ...theme[kept], brand: '#4f46e5' } }))
  expect(runTheme(directory, '--check')).toEqual({
    status: 1,
    output: `[theme] Generated tokens are out of date in: ${cssPath}. Run "bun run theme".\n`,
  })
})

test('the check names a theme.json key whose application was removed', async () => {
  const directory = await projectWith('webapp', 'website', theme)

  const run = runTheme(directory, '--check')

  expect(run.status).toBe(1)
  expect(run.output).toContain('Remove the "website" key from theme.json.')
})
