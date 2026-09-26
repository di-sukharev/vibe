import {
  expect,
  fillSignupForm,
  logIn,
  logOut,
  signUp,
  test,
  uniqueEmail,
} from '../helpers/test'

test('registers, restores the session, opens protected UI, and logs out', async ({ page }) => {
  const email = uniqueEmail()
  const displayName = 'Web E2E User'

  await signUp(page, email, displayName)

  await expect(page).toHaveURL(/\/app$/)
  await expect(page.getByTestId('primary-navigation')).toBeVisible()
  await expect(page.getByTestId('nav-link-app')).toBeVisible()
  await expect(page.getByTestId('nav-link-admin')).toHaveCount(0)
  await expect(page.getByTestId('current-user-email')).toHaveText(email)

  // The access token lives in memory, so after a reload only the refresh cookie can sign in.
  await page.reload()
  await expect(page.getByTestId('current-user-email')).toHaveText(email)

  await page.getByTestId('nav-link-app-profile').click()
  await expect(page).toHaveURL(/\/app\/profile$/)
  await expect(page.getByTestId('profile-display-name')).toHaveValue(displayName)
  await page.getByTestId('profile-display-name').fill('  Updated Web User  ')
  await page.getByTestId('profile-save').click()
  await expect(page.getByTestId('profile-display-name')).toHaveValue('Updated Web User')
  await page.reload()
  await expect(page.getByTestId('profile-display-name')).toHaveValue('Updated Web User')

  await logOut(page)
  await expect(page.getByTestId('login-form')).toBeVisible()
  await logIn(page, email)
  await expect(page).toHaveURL(/\/app\/profile$/)
  await expect(page.getByTestId('profile-display-name')).toHaveValue('Updated Web User')
})

test('shows generic forgot-password success and handles an invalid reset link', async ({ page }) => {
  await page.goto('/login')
  await page.getByTestId('forgot-password-link').click()
  await expect(page).toHaveURL(/\/forgot-password$/)

  await page.getByTestId('forgot-password-email').fill(uniqueEmail('unknown-reset'))
  await page.getByTestId('forgot-password-submit').click()
  await expect(page.getByTestId('forgot-password-accepted')).toBeVisible()

  await page.goto('/reset-password#token=truncated')
  await expect(page).toHaveURL(/\/reset-password$/)
  await expect(page.getByTestId('reset-password-submit')).toBeDisabled()
})

test('keeps one logical browser session active across concurrent tabs', async ({ page }) => {
  const email = uniqueEmail('web-e2e-tabs')

  await signUp(page, email)
  await expect(page).toHaveURL(/\/app$/)

  const secondPage = await page.context().newPage()
  await secondPage.goto('/')
  await expect(secondPage).toHaveURL(/\/app$/)

  await Promise.all([page.reload(), secondPage.reload()])

  await expect(page.getByTestId('current-user-email')).toHaveText(email)
  await expect(secondPage.getByTestId('current-user-email')).toHaveText(email)

  await page.route('**/api/auth/logout', async (route) => {
    await route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({ error: { code: 'UNAVAILABLE', message: 'Temporary logout failure' } }),
    })
  })
  await logOut(page)
  await expect(page.getByTestId('logout-error')).toBeVisible()
  await expect(page.getByTestId('current-user-email')).toHaveText(email)

  await logOut(secondPage)
  await expect(secondPage.getByTestId('login-form')).toBeVisible()
  await expect(page.getByTestId('login-form')).toBeVisible()
})

test('concurrent account changes converge every tab on the winning cookie session', async ({ page }) => {
  const firstEmail = uniqueEmail('web-e2e-account-a')
  const secondEmail = uniqueEmail('web-e2e-account-b')
  const secondPage = await page.context().newPage()

  await Promise.all([page.goto('/signup'), secondPage.goto('/signup')])
  await fillSignupForm(page, firstEmail)
  await fillSignupForm(secondPage, secondEmail)

  await Promise.all([
    page.getByTestId('signup-submit').click(),
    secondPage.getByTestId('signup-submit').click(),
  ])

  await expect(page).toHaveURL(/\/app$/)
  await expect(secondPage).toHaveURL(/\/app$/)
  await expect
    .poll(async () => {
      const [firstTab, secondTab] = await Promise.all(
        [page, secondPage].map((tab) => tab.getByTestId('current-user-email').allTextContents()),
      )
      const signedInEmail = firstTab.length === 1 ? firstTab[0] : undefined
      return signedInEmail !== undefined &&
        secondTab.length === 1 &&
        secondTab[0] === signedInEmail &&
        [firstEmail, secondEmail].includes(signedInEmail)
    })
    .toBe(true)
})
