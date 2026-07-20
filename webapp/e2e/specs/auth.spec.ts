import { e2ePassword, expect, test, uniqueEmail } from '../helpers/test'

test('registers, restores the session, opens protected UI, and logs out', async ({ page }) => {
  const email = uniqueEmail()
  const displayName = 'Web E2E User'

  await page.goto('/')

  await expect(page.getByRole('main')).toHaveCount(1)
  await expect(page.getByRole('heading', { level: 1, name: /auth, validation/i })).toBeVisible()
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

  await expect(page).toHaveURL(/\/app$/)
  await expect(page.getByRole('main')).toHaveCount(1)
  await expect(page.getByRole('navigation', { name: 'Primary navigation' })).toBeVisible()
  await expect(page.getByRole('heading', { level: 1, name: `Welcome, ${displayName}` })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Home' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Profile' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Settings' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Dashboard' })).toHaveCount(0)
  await expect(page.getByRole('link', { name: 'Users' })).toHaveCount(0)
  await expect(page.getByRole('main').getByText(email, { exact: true })).toBeVisible()
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
  await expect(page.getByRole('heading', { name: `Welcome, ${displayName}` })).toBeVisible()

  await page.getByRole('link', { name: 'Profile' }).click()
  await page.getByLabel('Display name').fill('Updated Web User')
  await page.getByRole('button', { name: 'Save profile' }).click()
  await expect(page.getByText('Profile saved')).toBeVisible()
  await page.reload()
  await expect(page.getByLabel('Display name')).toHaveValue('Updated Web User')

  await page.getByRole('button', { name: 'Logout' }).click()
  await expect(page.getByRole('button', { name: 'Create account' })).toBeVisible()

  await page.getByRole('tab', { name: 'Login' }).click()
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill('wrong-password')
  await page.getByRole('button', { name: 'Login' }).click()
  await expect(page.getByText('Invalid email or password')).toBeVisible()

  await page.getByLabel('Password').fill(e2ePassword)
  await page.getByRole('button', { name: 'Login' }).click()
  await expect(page).toHaveURL(/\/app\/profile$/)
  await expect(page.getByLabel('Display name')).toHaveValue('Updated Web User')
})

test('keeps one logical browser session active across concurrent tabs', async ({ page }) => {
  const email = uniqueEmail('web-e2e-tabs')

  await page.goto('/')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill(e2ePassword)
  await page.getByRole('button', { name: 'Create account' }).click()
  await expect(page).toHaveURL(/\/app$/)

  const secondPage = await page.context().newPage()
  await secondPage.goto('/')
  await expect(secondPage).toHaveURL(/\/app$/)

  await Promise.all([page.reload(), secondPage.reload()])

  await expect(page).toHaveURL(/\/app$/)
  await expect(secondPage).toHaveURL(/\/app$/)
  await expect(page.getByRole('heading', { name: `Welcome, ${email}` })).toBeVisible()
  await expect(secondPage.getByRole('heading', { name: `Welcome, ${email}` })).toBeVisible()

  await page.route('**/api/auth/logout', async (route) => {
    await route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({ error: { code: 'UNAVAILABLE', message: 'Temporary logout failure' } }),
    })
  })
  await page.getByRole('button', { name: 'Logout' }).click()
  await expect(page.getByRole('alert')).toContainText('Logout failed')

  await secondPage.getByRole('button', { name: 'Logout' }).click()
  await expect(secondPage.getByRole('button', { name: 'Create account' })).toBeVisible()
  await expect(page.getByRole('alert')).toHaveCount(0)
})

test('remote logout recovers a tab from a transient bootstrap error', async ({ page }) => {
  const email = uniqueEmail('web-e2e-bootstrap-logout')

  await page.goto('/')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill(e2ePassword)
  await page.getByRole('button', { name: 'Create account' }).click()
  await expect(page).toHaveURL(/\/app$/)

  const healthyPage = await page.context().newPage()
  await healthyPage.goto('/')
  await expect(healthyPage).toHaveURL(/\/app$/)

  await page.route('**/api/auth/refresh', async (route) => {
    await route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({
        error: { code: 'UNAVAILABLE', message: 'Temporary bootstrap failure' },
      }),
    })
  })
  await page.reload()
  await expect(page.getByText('Session check is temporarily unavailable')).toBeVisible()

  await healthyPage.getByRole('button', { name: 'Logout' }).click()
  await expect(page.getByRole('button', { name: 'Create account' })).toBeVisible()
})

test('concurrent account changes converge every tab on the winning cookie session', async ({ page }) => {
  const firstEmail = uniqueEmail('web-e2e-account-a')
  const secondEmail = uniqueEmail('web-e2e-account-b')
  const secondPage = await page.context().newPage()

  await Promise.all([page.goto('/'), secondPage.goto('/')])
  await page.getByLabel('Email').fill(firstEmail)
  await page.getByLabel('Password').fill(e2ePassword)
  await secondPage.getByLabel('Email').fill(secondEmail)
  await secondPage.getByLabel('Password').fill(e2ePassword)

  await Promise.all([
    page.getByRole('button', { name: 'Create account' }).click(),
    secondPage.getByRole('button', { name: 'Create account' }).click(),
  ])

  await expect(page).toHaveURL(/\/app$/)
  await expect(secondPage).toHaveURL(/\/app$/)
  let winningEmail = ''
  await expect
    .poll(async () => {
      const [firstTabText, secondTabText] = await Promise.all([
        page.locator('body').innerText(),
        secondPage.locator('body').innerText(),
      ])
      winningEmail = [firstEmail, secondEmail].find(
        (candidate) => firstTabText.includes(candidate) && secondTabText.includes(candidate),
      ) ?? ''
      return winningEmail
    })
    .not.toBe('')
})
