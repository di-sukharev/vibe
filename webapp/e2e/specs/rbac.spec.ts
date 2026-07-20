import { e2eAdminEmail, e2eAdminPassword } from '../env'
import { e2ePassword, expect, test, uniqueEmail } from '../helpers/test'

test('keeps user and administrator workspaces separate', async ({ browser, page }) => {
  const userEmail = uniqueEmail('web-e2e-rbac-user')

  await page.goto('/admin/users')
  await expect(page).toHaveURL(/\?returnTo=%2Fadmin%2Fusers$/)
  await page.getByLabel('Email').fill(userEmail)
  await page.getByLabel('Password').fill(e2ePassword)
  await page.getByRole('button', { name: 'Create account' }).click()

  await expect(page).toHaveURL(/\/app$/)
  await expect(page.getByRole('link', { name: 'Home' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Dashboard' })).toHaveCount(0)
  const sidebar = page.locator('[data-slot="sidebar"][data-state]')
  await expect(sidebar).toHaveAttribute('data-state', 'expanded')
  await page.locator('[data-sidebar="trigger"]').click()
  await expect(sidebar).toHaveAttribute('data-state', 'collapsed')
  await page.getByRole('link', { name: 'Profile' }).click()
  await expect(page).toHaveURL(/\/app\/profile$/)
  await expect(sidebar).toHaveAttribute('data-state', 'collapsed')
  await page.reload()
  await expect(sidebar).toHaveAttribute('data-state', 'collapsed')
  await page.goto('/admin/users')
  await expect(page).toHaveURL(/\/app$/)

  const adminContext = await browser.newContext()
  const adminPage = await adminContext.newPage()
  await adminPage.goto('/')
  await adminPage.getByRole('tab', { name: 'Login' }).click()
  await adminPage.getByLabel('Email').fill(e2eAdminEmail)
  await adminPage.getByLabel('Password').fill(e2eAdminPassword)
  await adminPage.getByRole('button', { name: 'Login' }).click()

  await expect(adminPage).toHaveURL(/\/admin$/)
  await expect(adminPage.getByRole('main')).toHaveCount(1)
  await expect(adminPage.getByRole('navigation', { name: 'Primary navigation' })).toBeVisible()
  await expect(adminPage.getByRole('heading', { level: 1, name: 'Dashboard' })).toBeVisible()
  await expect(adminPage.getByRole('link', { name: 'Dashboard' })).toBeVisible()
  await expect(adminPage.getByRole('link', { name: 'Users' })).toBeVisible()
  await expect(adminPage.getByRole('link', { name: 'Settings' })).toBeVisible()
  await expect(adminPage.getByRole('link', { name: 'Home' })).toHaveCount(0)
  await adminPage.goto('/app/profile')
  await expect(adminPage).toHaveURL(/\/admin$/)

  await adminContext.close()
})

test('mobile workspace navigation closes the sidebar sheet', async ({ page }) => {
  const userEmail = uniqueEmail('web-e2e-mobile-sidebar')
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/')
  await page.getByLabel('Email').fill(userEmail)
  await page.getByLabel('Password').fill(e2ePassword)
  await page.getByRole('button', { name: 'Create account' }).click()
  await expect(page).toHaveURL(/\/app$/)

  await page.locator('[data-sidebar="trigger"]').click()
  const mobileSidebar = page.locator('[data-slot="sidebar"][data-mobile="true"]')
  await expect(mobileSidebar).toBeVisible()
  await page.getByRole('link', { name: 'Profile' }).click()

  await expect(page).toHaveURL(/\/app\/profile$/)
  await expect(mobileSidebar).toBeHidden()
})

test('role mutation failures are announced inside the confirmation dialog', async ({
  browser,
  page,
}) => {
  const userEmail = uniqueEmail('web-e2e-role-error')
  await page.goto('/')
  await page.getByLabel('Email').fill(userEmail)
  await page.getByLabel('Password').fill(e2ePassword)
  await page.getByRole('button', { name: 'Create account' }).click()
  await expect(page).toHaveURL(/\/app$/)

  const adminContext = await browser.newContext()
  const adminPage = await adminContext.newPage()
  await adminPage.goto('/')
  await adminPage.getByRole('tab', { name: 'Login' }).click()
  await adminPage.getByLabel('Email').fill(e2eAdminEmail)
  await adminPage.getByLabel('Password').fill(e2eAdminPassword)
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

  await page.goto('/')
  await page.getByLabel('Email').fill(userEmail)
  await page.getByLabel('Password').fill(e2ePassword)
  await page.getByRole('button', { name: 'Create account' }).click()
  await expect(page).toHaveURL(/\/app$/)

  const adminContext = await browser.newContext()
  const adminPage = await adminContext.newPage()
  await adminPage.goto('/')
  await adminPage.getByRole('tab', { name: 'Login' }).click()
  await adminPage.getByLabel('Email').fill(e2eAdminEmail)
  await adminPage.getByLabel('Password').fill(e2eAdminPassword)
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
  await expect(page.getByRole('button', { name: 'Create account' })).toBeVisible()
  await page.getByRole('tab', { name: 'Login' }).click()
  await page.getByLabel('Email').fill(userEmail)
  await page.getByLabel('Password').fill(e2ePassword)
  await page.getByRole('button', { name: 'Login' }).click()

  await expect(page).toHaveURL(/\/admin$/)
  await expect(page.getByRole('link', { name: 'Dashboard' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Home' })).toHaveCount(0)

  await adminContext.close()
})
