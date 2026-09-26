import { mkdirSync, readdirSync, rmSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { test, type APIRequestContext, type Page } from '@playwright/test'

import { workspaceRoutesByRole } from '../../src/features/navigation/model'
import { e2eAdminEmail, e2eAdminPassword } from '../env'
import { pngImage } from '../helpers/images'

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

// One extra capture beside the admin users route: a search that matches nothing, so the empty
// state (`UserDirectory`'s `DirectoryEmpty`) gets reviewed too. It cannot reuse `webappRoutes`:
// that route has no URL-driven search, so reaching the empty state needs the search box itself.
const extraWebappRoutes: ReadonlyArray<{
  audience: keyof typeof accounts
  name: string
  path: string
  searchQuery: string
}> = [
  {
    audience: 'admin',
    name: 'admin-users-empty',
    path: '/admin/users',
    searchQuery: 'zzz-no-such-user-fixture',
  },
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

async function capture(
  page: Page,
  url: string,
  expectedPath: string,
  file: string,
  beforeShot?: (page: Page) => Promise<void>,
) {
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

  await beforeShot?.(page)

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

// Seeds a real avatar for the demo user, so `/app/profile` shows an image instead of just
// initials. A hook, not a test, so a `-g` filter cannot skip it. Goes through the same three-step
// storage API the webapp itself uses (ticket, upload, finalize), so it works unchanged against the
// filesystem and S3 storage drivers.
test.beforeAll(async ({ playwright }) => {
  if (process.env.SCREENS_SEED_DEMO !== '1') return

  const request = await playwright.request.newContext()
  try {
    await seedDemoAvatar(request)
  } finally {
    await request.dispose()
  }
})

async function seedDemoAvatar(request: APIRequestContext) {
  const backendUrl = process.env.E2E_BACKEND_URL ?? ''
  const origin = process.env.E2E_WEB_URL ?? ''

  const login = await request.post(`${backendUrl}/api/auth/login`, {
    data: accounts.user,
    headers: { Origin: origin },
  })
  if (!login.ok()) throw new Error(`Demo avatar: sign-in failed with HTTP ${login.status()}`)
  const { accessToken } = await login.json()
  // Every authenticated request carries the access token as a bearer header; there is no session
  // cookie, so an unauthenticated request context (unlike `page.request`, which shares the
  // browser's own state) has to attach it explicitly. See `webapp/src/features/auth/api.ts`.
  const headers = { Authorization: `Bearer ${accessToken}`, Origin: origin }

  const current = await request.get(`${backendUrl}/api/uploads/avatar`, { headers })
  if (!current.ok()) throw new Error(`Demo avatar: fetch failed with HTTP ${current.status()}`)
  if ((await current.json()).avatar) return // Already seeded by an earlier run.

  const ticket = await request.post(`${backendUrl}/api/uploads/avatar`, {
    data: { contentType: pngImage.mimeType, byteSize: pngImage.buffer.byteLength },
    headers,
  })
  if (!ticket.ok()) throw new Error(`Demo avatar: upload ticket failed with HTTP ${ticket.status()}`)
  const { upload } = await ticket.json()

  const stored = await request.fetch(upload.url, {
    method: upload.method,
    headers: upload.headers,
    data: pngImage.buffer,
  })
  if (!stored.ok() && stored.status() !== 412) {
    throw new Error(`Demo avatar: storage rejected the upload with HTTP ${stored.status()}`)
  }

  const finalized = await request.post(
    `${backendUrl}/api/uploads/avatar/${upload.uploadId}/finalize`,
    { headers },
  )
  if (!finalized.ok()) throw new Error(`Demo avatar: finalize failed with HTTP ${finalized.status()}`)
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

      for (const route of extraWebappRoutes) {
        test(`${route.path} (${route.name})`, async ({ page }) => {
          await signIn(page, route.audience)
          await capture(
            page,
            route.path,
            route.path,
            `${route.name}--${viewportName}-${colorScheme}.png`,
            async (capturedPage) => {
              await capturedPage.getByTestId('user-search-input').fill(route.searchQuery)
              await capturedPage.getByTestId('user-search-submit').click()
              await capturedPage.getByTestId('user-directory-empty').waitFor()
            },
          )
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
