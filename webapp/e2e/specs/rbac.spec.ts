import { e2eAdminEmail, e2eAdminPassword } from '../env'
import { e2ePassword, expect, test, uniqueEmail } from '../helpers/test'

test('keeps user and administrator workspaces separate', async ({ browser, page }) => {
  const userEmail = uniqueEmail('web-e2e-rbac-user')

  await page.goto('/admin/users')
  await expect(page).toHaveURL(/\/login\?returnTo=%2Fadmin%2Fusers$/)
  await page.getByRole('link', { name: 'Sign up' }).click()
  await page.getByLabel('Email').fill(userEmail)
  await page.getByLabel('Password', { exact: true }).fill(e2ePassword)
  await page.getByLabel('Confirm Password').fill(e2ePassword)
  await page.getByRole('button', { name: 'Create Account' }).click()

  await expect(page).toHaveURL(/\/app$/)
  await expect(page.getByRole('link', { name: 'Home' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Dashboard' })).toHaveCount(0)
  await page.getByRole('link', { name: 'Profile' }).click()
  await expect(page).toHaveURL(/\/app\/profile$/)
  await page.goto('/admin/users')
  await expect(page).toHaveURL(/\/app$/)

  const adminContext = await browser.newContext()
  const adminPage = await adminContext.newPage()
  await adminPage.goto('/login')
  await adminPage.getByLabel('Email').fill(e2eAdminEmail)
  await adminPage.getByLabel('Password', { exact: true }).fill(e2eAdminPassword)
  await adminPage.getByRole('button', { name: 'Login' }).click()

  await expect(adminPage).toHaveURL(/\/admin$/)
  await expect(adminPage.getByRole('navigation', { name: 'Primary navigation' })).toBeVisible()
  await expect(adminPage.getByRole('heading', { level: 1, name: 'Dashboard' })).toBeVisible()
  await expect(adminPage.getByRole('link', { name: 'Home' })).toHaveCount(0)
  await adminPage.goto('/app/profile')
  await expect(adminPage).toHaveURL(/\/admin$/)

  await adminContext.close()
})

test('admin data surfaces recover from errors and expose safe directory states', async ({
  page,
}) => {
  let dashboardRequests = 0
  await page.route('**/api/admin/dashboard', async (route) => {
    dashboardRequests += 1
    if (dashboardRequests === 1) {
      await route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({
          error: { code: 'INTERNAL_ERROR', message: 'Dashboard temporarily unavailable' },
        }),
      })
      return
    }
    await route.continue()
  })

  await page.goto('/login')
  await page.getByLabel('Email').fill(e2eAdminEmail)
  await page.getByLabel('Password', { exact: true }).fill(e2eAdminPassword)
  await page.getByRole('button', { name: 'Login' }).click()

  await expect(page).toHaveURL(/\/admin$/)
  await expect(page.getByRole('alert')).toContainText('Dashboard temporarily unavailable')
  await page.getByRole('button', { name: 'Try again' }).click()
  await expect(page.getByText('Total users', { exact: true })).toBeVisible()
  await expect(page.getByText('Administrators', { exact: true })).toBeVisible()
  await expect(page.getByText('New in 7 days', { exact: true })).toBeVisible()

  let directoryRequests = 0
  await page.route('**/api/admin/users?*', async (route) => {
    directoryRequests += 1
    if (directoryRequests === 1) {
      await route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({
          error: { code: 'INTERNAL_ERROR', message: 'Directory temporarily unavailable' },
        }),
      })
      return
    }
    await route.continue()
  })
  await page.getByRole('link', { name: 'Users' }).click()
  await expect(page.getByRole('alert')).toContainText('Directory temporarily unavailable')
  await page.getByRole('button', { name: 'Try again' }).click()
  await expect(page.getByText(/Page 1 of \d+ · \d+ users/)).toBeVisible()

  await page.getByLabel('Search users').fill(e2eAdminEmail)
  await page.getByRole('button', { name: 'Search' }).click()
  await page.getByLabel(`Role for ${e2eAdminEmail}`).click()
  await expect(page.getByRole('option', { name: 'User' })).toBeDisabled()
  await page.keyboard.press('Escape')

  await page.getByLabel('Search users').fill(`missing-${Date.now()}@example.com`)
  await page.getByRole('button', { name: 'Search' }).click()
  await expect(page.getByText('No users found', { exact: true })).toBeVisible()
  await expect(page.getByText('Try a different name or email.')).toBeVisible()
})

test('workspace account menu keeps a failed logout visible and retryable', async ({ page }) => {
  const userEmail = uniqueEmail('web-e2e-sidebar-logout')
  await page.goto('/signup')
  await page.getByLabel('Email').fill(userEmail)
  await page.getByLabel('Password', { exact: true }).fill(e2ePassword)
  await page.getByLabel('Confirm Password').fill(e2ePassword)
  await page.getByRole('button', { name: 'Create Account' }).click()
  await expect(page).toHaveURL(/\/app$/)

  await page.route('**/api/auth/logout', async (route) => {
    await route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({
        error: { code: 'UNAVAILABLE', message: 'Temporary logout failure' },
      }),
    })
  })

  await page.getByRole('button', { name: 'Open account menu' }).click()
  await page.getByRole('menuitem', { name: 'Log out' }).click()

  await expect(page.getByRole('alert')).toHaveText('Logout failed. Please try again.')
  await expect(page).toHaveURL(/\/app$/)
  await page.getByRole('button', { name: 'Open account menu' }).click()
  await expect(page.getByRole('menuitem', { name: 'Log out' })).toBeEnabled()
})

test('role mutation failures are announced inside the confirmation dialog', async ({
  browser,
  page,
}) => {
  const userEmail = uniqueEmail('web-e2e-role-error')
  await page.goto('/signup')
  await page.getByLabel('Email').fill(userEmail)
  await page.getByLabel('Password', { exact: true }).fill(e2ePassword)
  await page.getByLabel('Confirm Password').fill(e2ePassword)
  await page.getByRole('button', { name: 'Create Account' }).click()
  await expect(page).toHaveURL(/\/app$/)

  const adminContext = await browser.newContext()
  const adminPage = await adminContext.newPage()
  await adminPage.goto('/login')
  await adminPage.getByLabel('Email').fill(e2eAdminEmail)
  await adminPage.getByLabel('Password', { exact: true }).fill(e2eAdminPassword)
  await adminPage.getByRole('button', { name: 'Login' }).click()
  await adminPage.getByRole('link', { name: 'Users' }).click()
  await adminPage.getByLabel('Search users').fill(userEmail)
  await adminPage.getByRole('button', { name: 'Search' }).click()
  await adminPage.route('**/api/admin/users/*/role', async (route) => {
    await route.fulfill({
      status: 409,
      contentType: 'application/json',
      body: JSON.stringify({
        error: {
          code: 'CONFLICT',
          message: 'The requested role change conflicts with administrator policy',
        },
      }),
    })
  })

  await adminPage.getByLabel(`Role for ${userEmail}`).click()
  await adminPage.getByRole('option', { name: 'Admin' }).click()
  const dialog = adminPage.getByRole('alertdialog')
  await adminPage.getByRole('button', { name: 'Change role' }).click()

  await expect(dialog).toContainText('Role was not changed')
  await expect(dialog).toContainText('administrator policy')
  await adminContext.close()
})

test('promoting a user revokes the old session and opens the admin workspace after login', async ({
  browser,
  page,
}) => {
  const userEmail = uniqueEmail('web-e2e-promoted-user')

  await page.goto('/signup')
  await page.getByLabel('Email').fill(userEmail)
  await page.getByLabel('Password', { exact: true }).fill(e2ePassword)
  await page.getByLabel('Confirm Password').fill(e2ePassword)
  await page.getByRole('button', { name: 'Create Account' }).click()
  await expect(page).toHaveURL(/\/app$/)

  const adminContext = await browser.newContext()
  const adminPage = await adminContext.newPage()
  await adminPage.goto('/login')
  await adminPage.getByLabel('Email').fill(e2eAdminEmail)
  await adminPage.getByLabel('Password', { exact: true }).fill(e2eAdminPassword)
  await adminPage.getByRole('button', { name: 'Login' }).click()
  await adminPage.getByRole('link', { name: 'Users' }).click()

  await adminPage.getByLabel('Search users').fill(userEmail)
  await adminPage.getByRole('button', { name: 'Search' }).click()
  const roleSelect = adminPage.getByLabel(`Role for ${userEmail}`)
  await expect(roleSelect).toBeVisible()
  await roleSelect.click()
  await adminPage.getByRole('option', { name: 'Admin' }).click()
  await expect(adminPage.getByRole('alertdialog')).toContainText(userEmail)
  await adminPage.getByRole('button', { name: 'Change role' }).click()
  await expect(adminPage.getByText('Role changed')).toBeVisible()

  await page.reload()
  await expect(page.getByRole('button', { name: 'Login' })).toBeVisible()
  await page.getByLabel('Email').fill(userEmail)
  await page.getByLabel('Password', { exact: true }).fill(e2ePassword)
  await page.getByRole('button', { name: 'Login' }).click()

  await expect(page).toHaveURL(/\/admin$/)
  await expect(page.getByRole('link', { name: 'Dashboard' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Home' })).toHaveCount(0)

  await adminContext.close()
})
