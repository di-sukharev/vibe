import { e2eAdminEmail, e2eAdminPassword } from '../env'
import { e2ePassword, expect, test, uniqueEmail } from '../helpers/test'

test('keeps user and administrator workspaces separate', async ({ browser, page }) => {
  const userEmail = uniqueEmail('web-e2e-rbac-user')

  await page.goto('/admin/users')
  await expect(page).toHaveURL(/\/login\?returnTo=%2Fadmin%2Fusers$/)
  await page.getByRole('link', { name: 'Sign up' }).click()
  // /login and /signup share the Email and Password labels, so filling before React swaps the
  // form sends the input to the page being unmounted. Confirm Password only exists on /signup.
  await expect(page.getByLabel('Confirm Password')).toBeVisible()
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
  const dialog = adminPage.getByRole('alertdialog')
  await expect(dialog).toContainText(userEmail)

  const roleEndpoint = '**/api/admin/users/*/role'
  await adminPage.route(roleEndpoint, async (route) => {
    if (!['PATCH', 'POST'].includes(route.request().method())) {
      await route.continue()
      return
    }

    await route.fulfill({
      status: 409,
      contentType: 'application/json',
      body: JSON.stringify({
        error: { code: 'CONFLICT', message: 'Role update was rejected' },
      }),
    })
  })
  await dialog.getByRole('button', { name: 'Change role' }).click()
  await expect(dialog.getByRole('alert')).toContainText(/\S/)
  await adminPage.unroute(roleEndpoint)

  await dialog.getByRole('button', { name: 'Change role' }).click()
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
