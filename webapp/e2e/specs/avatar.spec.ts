import type { Page } from '@playwright/test'

import { pngImage } from '../helpers/images'
import { expect, signUp, test, uniqueEmail } from '../helpers/test'

/**
 * The upload journey end to end, through a real browser and a real storage endpoint.
 *
 * `bun run e2e:webapp` runs this against the filesystem driver, so it needs no Docker beyond the
 * test database. `bun run e2e:webapp:s3` runs the identical spec against the local SeaweedFS
 * container. Both must pass: that is what proves a project can develop locally and deploy to a
 * real bucket without changing product code.
 */

function avatarImage(page: Page) {
  return page.getByTestId('avatar-preview').locator('img')
}

async function pickFile(
  page: Page,
  file: { name: string; mimeType: string; buffer: Buffer },
) {
  await page.getByTestId('avatar-file-input').setInputFiles(file)
}

test('uploads an avatar, keeps it across a reload, and removes it', async ({
  page,
}) => {
  await signUp(page, uniqueEmail('avatar-e2e'), 'Avatar E2E User')
  await expect(page).toHaveURL(/\/app$/)
  await page.getByTestId('nav-link-app-profile').click()
  await expect(page).toHaveURL(/\/app\/profile$/)
  await expect(page.getByTestId('avatar-fallback')).toBeVisible()

  await pickFile(page, pngImage)
  await expect(avatarImage(page)).toBeVisible()

  // Survives a reload, which is what distinguishes a stored object from a local preview.
  await page.reload()
  await expect(avatarImage(page)).toBeVisible()

  await page.getByTestId('avatar-remove').click()
  await expect(avatarImage(page)).toHaveCount(0)
  await expect(page.getByTestId('avatar-fallback')).toBeVisible()

  // Absence needs a settled page: wait until the avatar query and any image download are done.
  await page.reload()
  await page.waitForLoadState('networkidle')
  await expect(page.getByTestId('avatar-remove')).toHaveCount(0)
  await expect(avatarImage(page)).toHaveCount(0)
})

test('avatar query exposes loading, failure, and retry', async ({ page }) => {
  await signUp(page, uniqueEmail('avatar-query'))
  let release = () => {}
  const pending = new Promise<void>((resolve) => { release = resolve })
  let fail = true
  await page.route('**/api/uploads/avatar', async (route) => {
    if (route.request().method() !== 'GET') return route.continue()
    await pending
    if (fail) return route.fulfill({ status: 503, json: { error: { code: 'UNAVAILABLE', message: 'Unavailable' } } })
    return route.continue()
  })
  await page.getByTestId('nav-link-app-profile').click()
  await expect(page.getByTestId('avatar-loading')).toBeVisible()
  release()
  await expect(page.getByTestId('avatar-query-error')).toBeVisible()
  fail = false
  await page.getByTestId('avatar-query-retry').click()
  await expect(page.getByTestId('avatar-query-error')).toHaveCount(0)
  await expect(page.getByTestId('avatar-fallback')).toBeVisible()
})
