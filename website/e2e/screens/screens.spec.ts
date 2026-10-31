import { mkdirSync, readdirSync, rmSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { test, type Page } from '@playwright/test'

// Screenshot tour for visual self-review. Nothing here asserts UI details; a test fails only
// when a page cannot be opened. Filter with `-g`, for example `-g mobile`.

const outputDirectory = fileURLToPath(new URL('../.artifacts/screens/', import.meta.url))

const viewports = {
  mobile: { width: 375, height: 812 },
  desktop: { width: 1280, height: 800 },
} as const

// Keep the tour aligned with src/routes.ts.
const routes = ['/']

async function capture(page: Page, path: string, file: string) {
  // Drop this page's images from earlier runs, so no stale tile outlives a shorter page.
  const stem = file.replace(/\.png$/, '')
  for (const name of readdirSync(outputDirectory)) {
    if (name === file || (name.startsWith(`${stem}-part`) && name.endsWith('.png'))) {
      rmSync(`${outputDirectory}${name}`)
    }
  }

  await page.goto(path)
  await page.waitForLoadState('networkidle')
  await page.evaluate(() => document.fonts.ready)

  const openedPath = new URL(page.url()).pathname.replace(/(.)\/$/, '$1')
  if (openedPath !== path) {
    throw new Error(`${path} redirected to ${openedPath}`)
  }

  const screenshotPath = `${outputDirectory}${file}`
  await page.screenshot({ path: screenshotPath, fullPage: true, animations: 'disabled' })
  console.log(screenshotPath)

  // One image of a tall page shrinks until details are unreadable; add two-screen tiles.
  const { width, height } = page.viewportSize() ?? viewports.desktop
  const pageHeight = await page.evaluate(() => document.documentElement.scrollHeight)
  const tileHeight = height * 2
  if (pageHeight <= tileHeight * 1.5) return

  for (let top = 0, part = 1; top < pageHeight; top += tileHeight, part += 1) {
    const tilePath = screenshotPath.replace(/\.png$/, `-part${part}.png`)
    const clip = { x: 0, y: top, width, height: Math.min(tileHeight, pageHeight - top) }
    await page.screenshot({ path: tilePath, fullPage: true, clip, animations: 'disabled' })
    console.log(tilePath)
  }
}

mkdirSync(outputDirectory, { recursive: true })

// The website has one dark theme, so it is captured once per viewport.
for (const [viewportName, viewport] of Object.entries(viewports)) {
  test.describe(viewportName, () => {
    // Playwright has no `reducedMotion` test option; a bare one is silently ignored.
    test.use({ viewport, colorScheme: 'dark', contextOptions: { reducedMotion: 'reduce' } })

    for (const path of routes) {
      test(path, async ({ page }) => {
        const name = ['website', path.replace(/^\/+|\/+$/g, '').replaceAll('/', '-')].filter(Boolean).join('-')
        await capture(page, path, `${name}--${viewportName}-dark.png`)
      })
    }
  })
}
