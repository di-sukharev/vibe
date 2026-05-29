import { e2ePassword, expect, test, uniqueEmail } from '../helpers/test'

test('registers, restores the session, opens protected UI, and logs out', async ({ page }) => {
  const email = uniqueEmail()
  const displayName = 'Web E2E User'

  await page.goto('/')

  await expect(page.getByRole('heading', { name: /auth, validation/i })).toBeVisible()
  await page.getByRole('button', { name: 'Create account' }).click()
  await expect(page.getByText('Invalid email address')).toBeVisible()
  await expect(page.getByText('Password must be at least 8 characters')).toBeVisible()

  await page.getByLabel('Name').fill('A')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill(e2ePassword)
  await page.getByRole('tab', { name: 'Login' }).click()
  await expect(page.getByLabel('Name')).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Login' })).toBeEnabled()

  await page.getByRole('tab', { name: 'Register' }).click()
  await page.getByLabel('Name').fill(displayName)
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill(e2ePassword)
  await page.getByRole('button', { name: 'Create account' }).click()

  await expect(page.getByRole('heading', { name: 'Session is active' })).toBeVisible()
  await expect(page.getByText(email)).toBeVisible()
  await expect
    .poll(async () =>
      (await page.context().cookies()).some(
        (cookie) => cookie.name === 'web_app_demo_refresh' && cookie.httpOnly,
      ),
    )
    .toBe(true)

  const refreshAfterReload = page.waitForResponse(
    (response) =>
      response.url().endsWith('/api/auth/refresh') && response.request().method() === 'POST',
  )
  const meAfterReload = page.waitForResponse(
    (response) => response.url().endsWith('/api/auth/me') && response.request().method() === 'GET',
  )

  await page.reload()

  await expect((await refreshAfterReload).status()).toBe(200)
  await expect((await meAfterReload).status()).toBe(200)
  await expect(page.getByRole('heading', { name: 'Session is active' })).toBeVisible()

  await page.getByRole('link', { name: 'Open app' }).click()
  await expect(page.getByRole('heading', { name: displayName })).toBeVisible()
  await expect(page.getByText(email)).toBeVisible()

  await page.getByRole('button', { name: 'Logout' }).click()
  await expect(page.getByRole('heading', { name: 'Login required' })).toBeVisible()

  await page.getByRole('link', { name: 'Go to auth' }).click()
  await expect(page.getByRole('button', { name: 'Create account' })).toBeVisible()

  await page.getByRole('tab', { name: 'Login' }).click()
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill('wrong-password')
  await page.getByRole('button', { name: 'Login' }).click()
  await expect(page.getByText('Invalid email or password')).toBeVisible()

  await page.getByLabel('Password').fill(e2ePassword)
  await page.getByRole('button', { name: 'Login' }).click()
  await expect(page.getByRole('heading', { name: 'Session is active' })).toBeVisible()
})
