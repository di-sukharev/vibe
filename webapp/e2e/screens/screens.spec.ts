import { mkdirSync, readdirSync, rmSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { test, type Page } from '@playwright/test'

import { workspaceRoutesByRole } from '../../src/features/navigation/model'
import { e2eAdminEmail, e2eAdminPassword } from '../env'

// Screenshot tour for visual self-review. Nothing here asserts UI details; a test fails only
// when a page cannot be opened. Filter with `-g`, for example `-g "/admin/users"` or `-g website`.

const outputDirectory = fileURLToPath(new URL('../.artifacts/screens/', import.meta.url))
const websitePagesDirectory = fileURLToPath(new URL('../../../website/src/pages/', import.meta.url))

const viewports = {
  mobile: { width: 375, height: 812 },
  desktop: { width: 1280, height: 800 },
} as const

const colorSchemes = ['light', 'dark'] as const

// Dev-only overlays that the production build does not ship.
const hideDevOverlays = 'astro-dev-toolbar { display: none !important; }'

// global-setup seeds both accounts with the same password.
const accounts = {
  user: { email: 'user@example.com', password: e2eAdminPassword },
  admin: { email: e2eAdminEmail, password: e2eAdminPassword },
} as const

type Audience = 'guest' | keyof typeof accounts

const guestRoutes = ['/login', '/signup', '/forgot-password']

const webappRoutes: ReadonlyArray<{ path: string; audience: Audience }> = [
  ...guestRoutes.map((path) => ({ path, audience: 'guest' as const })),
  ...(['user', 'admin'] as const).flatMap((audience) =>
    workspaceRoutesByRole[audience]
      // A `$param` route needs a concrete record; capture it from its parent page instead.
      .filter((path) => !path.includes('$'))
      .map((path) => ({ path, audience })),
  ),
]

// Static website pages, read from the Astro pages directory. Dynamic `[param]` pages are skipped.
const websiteRoutes = readdirSync(websitePagesDirectory, { recursive: true, encoding: 'utf8' })
  .filter((file) => /\.(astro|md|mdx)$/.test(file) && !file.includes('['))
  .map((file) => `/${file.replace(/\.(astro|md|mdx)$/, '').replace(/(^|\/)index$/, '')}`.replace(/\/$/, '') || '/')

async function signIn(page: Page, audience: keyof typeof accounts) {
  const response = await page.request.post(`${process.env.E2E_BACKEND_URL}/api/auth/login`, {
    data: accounts[audience],
    headers: { Origin: process.env.E2E_WEB_URL ?? '' },
  })
  if (!response.ok()) {
    throw new Error(`Sign-in as ${audience} failed with HTTP ${response.status()}`)
  }
}

function slug(path: string) {
  return path.replace(/^\/+|\/+$/g, '').replaceAll('/', '-')
}

async function capture(page: Page, url: string, expectedPath: string, file: string) {
  // Drop this page's images from earlier runs, so no stale tile outlives a shorter page.
  const stem = file.replace(/\.png$/, '')
  for (const name of readdirSync(outputDirectory)) {
    if (name === file || (name.startsWith(`${stem}-part`) && name.endsWith('.png'))) {
      rmSync(`${outputDirectory}${name}`)
    }
  }

  await page.goto(url)
  await page.waitForLoadState('networkidle')
  await page.evaluate(() => document.fonts.ready)

  const openedPath = new URL(page.url()).pathname.replace(/(.)\/$/, '$1')
  if (openedPath !== expectedPath) {
    throw new Error(`${expectedPath} redirected to ${openedPath}`)
  }

  const path = `${outputDirectory}${file}`
  await page.screenshot({ path, fullPage: true, animations: 'disabled', style: hideDevOverlays })
  console.log(path)

  // One image of a tall page shrinks until details are unreadable; add two-screen tiles.
  const { width, height } = page.viewportSize() ?? viewports.desktop
  const pageHeight = await page.evaluate(() => document.documentElement.scrollHeight)
  const tileHeight = height * 2
  if (pageHeight <= tileHeight * 1.5) return

  for (let top = 0, part = 1; top < pageHeight; top += tileHeight, part += 1) {
    const tilePath = path.replace(/\.png$/, `-part${part}.png`)
    const clip = { x: 0, y: top, width, height: Math.min(tileHeight, pageHeight - top) }
    await page.screenshot({ path: tilePath, fullPage: true, clip, animations: 'disabled', style: hideDevOverlays })
    console.log(tilePath)
  }
}

mkdirSync(outputDirectory, { recursive: true })

for (const [viewportName, viewport] of Object.entries(viewports)) {
  for (const colorScheme of colorSchemes) {
    test.describe(`${viewportName} ${colorScheme}`, () => {
      // Playwright has no `reducedMotion` test option; a bare one is silently ignored.
      test.use({ viewport, colorScheme, contextOptions: { reducedMotion: 'reduce' } })

      for (const route of webappRoutes) {
        test(route.path, async ({ page }) => {
          if (route.audience !== 'guest') await signIn(page, route.audience)
          await capture(page, route.path, route.path, `${slug(route.path)}--${viewportName}-${colorScheme}.png`)
        })
      }

      // The website has one dark theme, so it is captured once per viewport.
      if (colorScheme !== 'dark') return

      for (const path of websiteRoutes) {
        test(`website ${path}`, async ({ page }) => {
          const name = ['website', slug(path)].filter(Boolean).join('-')
          await capture(page, `${process.env.SCREENS_WEBSITE_URL}${path}`, path, `${name}--${viewportName}-dark.png`)
        })
      }
    })
  }
}
