import { expect, fillSignupForm, signUp, test, uniqueEmail } from '../helpers/test'

test('keeps a protected return path and its query through signup without adding a redirect history entry', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.goto('/app/profile?tab=security')
  await expect(page).toHaveURL(/\/login\?returnTo=%2Fapp%2Fprofile%3Ftab%3Dsecurity$/)
  await page.getByTestId('signup-link').click()
  await fillSignupForm(page, uniqueEmail('web-e2e-return-path'))
  const historyLength = await page.evaluate(() => window.history.length)
  await page.getByTestId('signup-submit').click()
  await expect(page).toHaveURL(/\/app\/profile\?tab=security$/)
  expect(await page.evaluate(() => window.history.length)).toBe(historyLength)
  await page.reload()
  await expect(page.getByTestId('nav-link-app-profile')).toBeVisible()
  await expect(page).toHaveURL(/\/app\/profile\?tab=security$/)
  expect(errors).toEqual([])
})

test('restores the existing session after a failed session check is retried', async ({ page }) => {
  await signUp(page, uniqueEmail('web-e2e-session-retry'))
  await expect(page).toHaveURL(/\/app$/)
  let failRefresh = true
  await page.route('**/api/auth/refresh', async (route) => {
    if (!failRefresh) return route.continue()
    return route.fulfill({ status: 503, json: { error: { code: 'UNAVAILABLE', message: 'Unavailable' } } })
  })
  await page.goto('/app/profile')
  await expect(page.getByRole('alert')).toBeVisible()
  await expect(page.getByTestId('login-form')).toHaveCount(0)
  failRefresh = false
  await page.getByRole('button', { name: 'Try again', exact: true }).click()
  await expect(page.getByTestId('nav-link-app-profile')).toBeVisible()
  await expect(page).toHaveURL(/\/app\/profile$/)
})
