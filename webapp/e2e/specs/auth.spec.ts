import type { Page } from '@playwright/test'
import { e2ePassword, expect, test, uniqueEmail } from '../helpers/test'

test('registers, restores the session, opens protected UI, and logs out', async ({ page }) => {
  const email = uniqueEmail()
  const displayName = 'Web E2E User'

  await page.goto('/signup')

  await expect(page.getByRole('heading', { level: 1, name: 'Create your account' })).toBeVisible()
  const signupPassword = page.getByLabel('Password', { exact: true })
  const signupPasswordDescriptions = await signupPassword.getAttribute('aria-describedby')
  expect(signupPasswordDescriptions).toBeTruthy()
  const [signupPasswordRequirementId] = signupPasswordDescriptions!.split(/\s+/)
  await expect(page.locator(`[id="${signupPasswordRequirementId}"]`)).toHaveText(
    'Must be at least 8 characters long.',
  )
  await page.getByRole('button', { name: 'Create Account' }).click()
  await expect(page.getByText('Invalid email address')).toBeVisible()
  await expect(page.getByText('Password must be at least 8 characters')).toBeVisible()

  await page.getByLabel('Full Name').fill('A')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password', { exact: true }).fill(e2ePassword)
  await expect(signupPassword).toHaveAttribute('type', 'password')
  await page.getByRole('button', { name: 'Show entered password' }).click()
  await expect(signupPassword).toHaveAttribute('type', 'text')
  await expect(signupPassword).toHaveValue(e2ePassword)
  await page.getByRole('button', { name: 'Hide entered password' }).click()
  await expect(signupPassword).toHaveAttribute('type', 'password')
  await page.getByLabel('Confirm Password').fill(e2ePassword)
  await page.getByRole('link', { name: 'Sign in' }).click()
  await expect(page.getByLabel('Full Name')).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Login' })).toBeEnabled()

  await page.getByRole('link', { name: 'Sign up' }).click()
  await page.getByLabel('Full Name').fill(displayName)
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password', { exact: true }).fill(e2ePassword)
  await page.getByLabel('Confirm Password').fill(e2ePassword)
  await page.getByRole('button', { name: 'Create Account' }).click()

  await expect(page).toHaveURL(/\/app$/)
  await expect(page.getByRole('navigation', { name: 'Primary navigation' })).toBeVisible()
  await expect(page.getByRole('heading', { level: 1, name: `Welcome, ${displayName}` })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Dashboard' })).toHaveCount(0)
  await expect(page.getByRole('link', { name: 'Users' })).toHaveCount(0)
  await expect(page.getByRole('main').getByText(email, { exact: true })).toBeVisible()
  await expect(page.getByRole('main').getByText('Member since', { exact: true })).toBeVisible()
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
  await expect(page.getByLabel('Email')).toHaveAttribute('readonly', '')
  await page.getByLabel('Display name').fill(' A ')
  await expect(page.getByText('Display name must be at least 2 characters.')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Save profile' })).toBeDisabled()
  await page.getByLabel('Display name').fill('  Updated Web User  ')
  await page.getByRole('button', { name: 'Save profile' }).click()
  await expect(page.getByText('Profile saved')).toBeVisible()
  await expect(page.getByLabel('Display name')).toHaveValue('Updated Web User')
  await page.reload()
  await expect(page.getByLabel('Display name')).toHaveValue('Updated Web User')

  await page.getByRole('link', { name: 'Settings' }).click()

  await page.route('**/api/auth/logout', async (route) => {
    await route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({
        error: { code: 'UNAVAILABLE', message: 'Temporary logout failure' },
      }),
    })
  })
  await page.getByRole('button', { name: 'Logout' }).click()
  await expect(page.getByRole('alert')).toContainText('Your session is still active')
  await expect(page.getByRole('button', { name: 'Logout' })).toBeEnabled()
  await page.unroute('**/api/auth/logout')

  await page.getByRole('button', { name: 'Logout' }).click()
  await expect(page.getByRole('button', { name: 'Login' })).toBeVisible()
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password', { exact: true }).fill(e2ePassword)
  await page.getByRole('button', { name: 'Login' }).click()
  await expect(page).toHaveURL(/\/app\/settings$/)

  await page.getByRole('link', { name: 'Profile' }).click()

  await logoutFromAccountMenu(page)
  await expect(page.getByRole('button', { name: 'Login' })).toBeVisible()
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password', { exact: true }).fill('wrong-password')
  await page.getByRole('button', { name: 'Login' }).click()
  await expect(page.getByText('Invalid email or password')).toBeVisible()

  await page.getByLabel('Password', { exact: true }).fill(e2ePassword)
  await page.getByRole('button', { name: 'Login' }).click()
  await expect(page).toHaveURL(/\/app\/profile$/)
  await expect(page.getByLabel('Display name')).toHaveValue('Updated Web User')
})

test('shows generic forgot-password success and handles an invalid reset link', async ({ page }) => {
  await page.goto('/login')
  await page.getByRole('link', { name: 'Forgot your password?' }).click()
  await expect(page).toHaveURL(/\/forgot-password$/)

  await page.getByRole('button', { name: 'Send reset instructions' }).click()
  await expect(page.getByText('Invalid email address')).toBeVisible()
  await page.getByLabel('Email').fill(uniqueEmail('unknown-reset'))
  await page.getByRole('button', { name: 'Send reset instructions' }).click()
  await expect(page.getByRole('alert')).toContainText(
    'If an account exists for that address, reset instructions are on the way.',
  )

  await page.goto('/reset-password#token=truncated')
  await expect(page.getByRole('alert')).toContainText(
    'This password reset link is invalid or incomplete.',
  )
  await expect(page.getByRole('button', { name: 'Update password' })).toBeDisabled()

  await page.goto(`/reset-password#token=${'t'.repeat(43)}`)
  await expect(page).toHaveURL(/\/reset-password$/)
  const resetPassword = page.getByLabel('New Password')
  const resetPasswordDescriptions = await resetPassword.getAttribute('aria-describedby')
  expect(resetPasswordDescriptions).toBeTruthy()
  const [resetPasswordRequirementId] = resetPasswordDescriptions!.split(/\s+/)
  await expect(page.locator(`[id="${resetPasswordRequirementId}"]`)).toHaveText(
    'Must be at least 8 characters long.',
  )
  await expect(page.getByRole('button', { name: 'Show replacement password' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Show password confirmation' })).toBeVisible()
  await page.getByLabel('New Password').fill('new-password-123')
  await page.getByLabel('Confirm Password').fill('different-password-123')
  await page.getByRole('button', { name: 'Update password' }).click()
  await expect(page.getByText('Passwords do not match')).toBeVisible()

  await page.route('**/api/auth/password-reset/confirm', async (route) => {
    await route.fulfill({
      status: 400,
      contentType: 'application/json',
      body: JSON.stringify({
        error: {
          code: 'AUTH_PASSWORD_RESET_INVALID',
          message: 'Password reset link is invalid or expired',
        },
      }),
    })
  })
  await page.getByLabel('Confirm Password').fill('new-password-123')
  await page.getByRole('button', { name: 'Update password' }).click()
  await expect(page.getByRole('alert')).toContainText(
    'Password reset link is invalid or expired',
  )
})

test('allows an authenticated browser to complete a password reset and clears local auth', async ({ page }) => {
  const email = uniqueEmail('authenticated-reset')
  await page.goto('/signup')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password', { exact: true }).fill(e2ePassword)
  await page.getByLabel('Confirm Password').fill(e2ePassword)
  await page.getByRole('button', { name: 'Create Account' }).click()
  await expect(page).toHaveURL(/\/app$/)

  await page.route('**/api/auth/password-reset/confirm', async (route) => {
    await route.fulfill({ status: 204 })
  })
  await page.goto(`/reset-password#token=${'t'.repeat(43)}`)

  await expect(page).toHaveURL(/\/reset-password$/)
  await expect(page.getByRole('heading', { name: 'Choose a new password' })).toBeVisible()
  await page.getByLabel('New Password').fill('new-password-123')
  await page.getByLabel('Confirm Password').fill('new-password-123')
  await page.getByRole('button', { name: 'Update password' }).click()
  await expect(page.getByRole('alert')).toContainText('Password updated')

  await page.getByRole('link', { name: 'Back to login' }).click()
  await expect(page).toHaveURL(/\/login$/)
  await expect(page.getByRole('button', { name: 'Login' })).toBeVisible()
})

test('keeps one logical browser session active across concurrent tabs', async ({ page }) => {
  const email = uniqueEmail('web-e2e-tabs')

  await page.goto('/signup')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password', { exact: true }).fill(e2ePassword)
  await page.getByLabel('Confirm Password').fill(e2ePassword)
  await page.getByRole('button', { name: 'Create Account' }).click()
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
  await logoutFromAccountMenu(page)
  await expect(page.getByRole('alert')).toContainText('Logout failed')

  await logoutFromAccountMenu(secondPage)
  await expect(secondPage.getByRole('button', { name: 'Login' })).toBeVisible()
  await expect(page.getByRole('alert')).toHaveCount(0)
})

test('remote logout recovers a tab from a transient bootstrap error', async ({ page }) => {
  const email = uniqueEmail('web-e2e-bootstrap-logout')

  await page.goto('/signup')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password', { exact: true }).fill(e2ePassword)
  await page.getByLabel('Confirm Password').fill(e2ePassword)
  await page.getByRole('button', { name: 'Create Account' }).click()
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

  await logoutFromAccountMenu(healthyPage)
  await expect(page.getByRole('button', { name: 'Login' })).toBeVisible()
})

test('unknown routes wait for session recovery before choosing their return destination', async ({
  page,
}) => {
  const email = uniqueEmail('web-e2e-not-found')
  await page.goto('/signup')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password', { exact: true }).fill(e2ePassword)
  await page.getByLabel('Confirm Password').fill(e2ePassword)
  await page.getByRole('button', { name: 'Create Account' }).click()
  await expect(page).toHaveURL(/\/app$/)

  let failRefresh = true
  await page.route('**/api/auth/refresh', async (route) => {
    if (!failRefresh) {
      await route.continue()
      return
    }
    failRefresh = false
    await route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({
        error: { code: 'UNAVAILABLE', message: 'Temporary bootstrap failure' },
      }),
    })
  })

  await page.goto('/missing-page')
  await expect(page.getByText('Session check is temporarily unavailable')).toBeVisible()
  await page.getByRole('button', { name: 'Try again' }).click()

  await expect(page.getByRole('heading', { level: 1, name: 'Page not found' })).toBeVisible()
  await page.getByRole('link', { name: 'Return to workspace' }).click()
  await expect(page).toHaveURL(/\/app$/)
})

test('concurrent account changes converge every tab on the winning cookie session', async ({ page }) => {
  const firstEmail = uniqueEmail('web-e2e-account-a')
  const secondEmail = uniqueEmail('web-e2e-account-b')
  const secondPage = await page.context().newPage()

  await Promise.all([page.goto('/signup'), secondPage.goto('/signup')])
  await page.getByLabel('Email').fill(firstEmail)
  await page.getByLabel('Password', { exact: true }).fill(e2ePassword)
  await page.getByLabel('Confirm Password').fill(e2ePassword)
  await secondPage.getByLabel('Email').fill(secondEmail)
  await secondPage.getByLabel('Password', { exact: true }).fill(e2ePassword)
  await secondPage.getByLabel('Confirm Password').fill(e2ePassword)

  await Promise.all([
    page.getByRole('button', { name: 'Create Account' }).click(),
    secondPage.getByRole('button', { name: 'Create Account' }).click(),
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

async function logoutFromAccountMenu(page: Page) {
  await page.getByRole('button', { name: 'Open account menu' }).click()
  await page.getByRole('menuitem', { name: 'Log out' }).click()
}
