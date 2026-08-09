import type { Page } from '@playwright/test'

import {
  disguisedTextFile,
  jpegImage,
  pngImage,
  storageUploadUrlPatterns,
} from '../helpers/images'
import { e2ePassword, expect, test, uniqueEmail } from '../helpers/test'

/**
 * The upload journey end to end, through a real browser and a real storage endpoint.
 *
 * `bun run e2e:webapp` runs this against the filesystem driver, so it needs no Docker beyond the
 * test database. `bun run e2e:webapp:s3` runs the identical spec against the local SeaweedFS
 * container. Both must pass: that is what proves a project can develop locally and deploy to a
 * real bucket without changing product code.
 */

async function registerAndOpenProfile(page: Page) {
  const email = uniqueEmail('avatar-e2e')

  await page.goto('/signup')
  await page.getByLabel('Full Name').fill('Avatar E2E User')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password', { exact: true }).fill(e2ePassword)
  await page.getByLabel('Confirm Password').fill(e2ePassword)
  await page.getByRole('button', { name: 'Create Account' }).click()
  await expect(page).toHaveURL(/\/app$/)

  await page.getByRole('link', { name: 'Profile' }).click()
  await expect(page).toHaveURL(/\/app\/profile$/)
  await expect(page.getByRole('heading', { level: 1, name: 'Profile' })).toBeVisible()
  await expect(page.getByTestId('avatar-fallback')).toBeVisible()

  return email
}

function avatarImage(page: Page) {
  return page.getByTestId('avatar-preview').locator('img')
}

async function pickFile(
  page: Page,
  file: { name: string; mimeType: string; buffer: Buffer },
) {
  await page.getByTestId('avatar-file-input').setInputFiles(file)
}

test('uploads an avatar, keeps it across a reload, replaces it, and removes it', async ({
  page,
}) => {
  await registerAndOpenProfile(page)

  await pickFile(page, pngImage)
  await expect(page.getByTestId('avatar-notice')).toContainText('Photo updated.')
  await expect(avatarImage(page)).toBeVisible()

  // Survives a reload, which is what distinguishes a stored object from a local preview.
  await page.reload()
  await expect(page.getByRole('heading', { level: 1, name: 'Profile' })).toBeVisible()
  await expect(avatarImage(page)).toBeVisible()

  await pickFile(page, jpegImage)
  await expect(page.getByTestId('avatar-notice')).toContainText('Photo updated.')
  await expect(avatarImage(page)).toBeVisible()

  await page.getByRole('button', { name: 'Remove' }).click()
  await expect(page.getByTestId('avatar-notice')).toContainText('Photo removed.')
  await expect(avatarImage(page)).toHaveCount(0)
  await expect(page.getByTestId('avatar-fallback')).toBeVisible()

  await page.reload()
  await expect(page.getByRole('heading', { level: 1, name: 'Profile' })).toBeVisible()
  await expect(avatarImage(page)).toHaveCount(0)
})

test('recovers from an interrupted upload when the user tries again', async ({ page }) => {
  await registerAndOpenProfile(page)

  // Kill the direct transfer, leaving a pending upload with nothing stored behind it.
  for (const pattern of storageUploadUrlPatterns) {
    await page.route(pattern, (route) =>
      route.request().method() === 'PUT' ? route.abort('failed') : route.continue(),
    )
  }

  await pickFile(page, pngImage)
  await expect(page.getByTestId('avatar-error')).toBeVisible()
  await expect(avatarImage(page)).toHaveCount(0)

  for (const pattern of storageUploadUrlPatterns) {
    await page.unroute(pattern)
  }

  // The retry gets a fresh write-once key, so it succeeds rather than colliding with the
  // abandoned one.
  await pickFile(page, pngImage)
  await expect(page.getByTestId('avatar-notice')).toContainText('Photo updated.')
  await expect(avatarImage(page)).toBeVisible()

  await page.reload()
  await expect(avatarImage(page)).toBeVisible()
})

test('refuses a file that is not the image it claims to be', async ({ page }) => {
  await registerAndOpenProfile(page)

  await pickFile(page, disguisedTextFile)

  await expect(page.getByTestId('avatar-error')).toBeVisible()
  await expect(avatarImage(page)).toHaveCount(0)
  await expect(page.getByTestId('avatar-fallback')).toBeVisible()
})

test('keeps one user’s avatar invisible to another', async ({ browser }) => {
  const ownerContext = await browser.newContext()
  const ownerPage = await ownerContext.newPage()
  await registerAndOpenProfile(ownerPage)
  await pickFile(ownerPage, pngImage)
  await expect(ownerPage.getByTestId('avatar-notice')).toContainText('Photo updated.')

  const otherContext = await browser.newContext()
  const otherPage = await otherContext.newPage()
  await registerAndOpenProfile(otherPage)

  await expect(avatarImage(otherPage)).toHaveCount(0)
  await expect(otherPage.getByTestId('avatar-fallback')).toBeVisible()

  await ownerContext.close()
  await otherContext.close()
})
