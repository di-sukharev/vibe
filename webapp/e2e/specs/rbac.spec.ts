import { e2eAdminEmail, e2eAdminPassword } from '../env'
import { expect, fillSignupForm, logIn, signUp, test, uniqueEmail } from '../helpers/test'

test('keeps user and administrator workspaces separate', async ({ browser, page }) => {
  await page.goto('/admin/users')
  await expect(page).toHaveURL(/\/login\?returnTo=%2Fadmin%2Fusers$/)
  await page.getByTestId('signup-link').click()
  await fillSignupForm(page, uniqueEmail('web-e2e-rbac-user'))
  await page.getByTestId('signup-submit').click()

  await expect(page).toHaveURL(/\/app$/)
  await expect(page.getByTestId('nav-link-app')).toBeVisible()
  await expect(page.getByTestId('nav-link-admin')).toHaveCount(0)
  await page.getByTestId('nav-link-app-profile').click()
  await expect(page).toHaveURL(/\/app\/profile$/)
  await page.goto('/admin/users')
  await expect(page).toHaveURL(/\/app$/)

  const adminContext = await browser.newContext()
  const adminPage = await adminContext.newPage()
  await adminPage.goto('/login')
  await logIn(adminPage, e2eAdminEmail, e2eAdminPassword)

  await expect(adminPage).toHaveURL(/\/admin$/)
  await expect(adminPage.getByTestId('primary-navigation')).toBeVisible()
  await expect(adminPage.getByTestId('nav-link-admin')).toBeVisible()
  await expect(adminPage.getByTestId('nav-link-app')).toHaveCount(0)
  await adminPage.goto('/app/profile')
  await expect(adminPage).toHaveURL(/\/admin$/)

  await adminContext.close()
})

test('promoting a user revokes the old session and opens the admin workspace after login', async ({
  browser,
  page,
}) => {
  const userEmail = uniqueEmail('web-e2e-promoted-user')

  await signUp(page, userEmail)
  await expect(page).toHaveURL(/\/app$/)

  const adminContext = await browser.newContext()
  const adminPage = await adminContext.newPage()
  await adminPage.goto('/login')
  await logIn(adminPage, e2eAdminEmail, e2eAdminPassword)
  await adminPage.getByTestId('nav-link-admin-users').click()
  await expect(adminPage).toHaveURL(/\/admin\/users$/)

  await adminPage.getByTestId('user-search-input').fill(userEmail)
  await adminPage.getByTestId('user-search-submit').click()
  const userRow = adminPage.getByTestId('user-row').filter({ hasText: userEmail })
  // The unfiltered page always lists the administrator too, so one row means the search applied.
  await expect(adminPage.getByTestId('user-row')).toHaveCount(1)
  await userRow.getByTestId('role-select').click()
  await adminPage.getByTestId('role-option-admin').click()
  await adminPage.getByTestId('role-change-confirm').click()
  await expect(adminPage.getByTestId('role-change-success')).toBeVisible()

  // The role change revoked the user's sessions, so a reload has nothing to restore.
  await page.reload()
  await expect(page.getByTestId('login-form')).toBeVisible()
  await logIn(page, userEmail)

  await expect(page).toHaveURL(/\/admin$/)
  await expect(page.getByTestId('nav-link-admin')).toBeVisible()
  await expect(page.getByTestId('nav-link-app')).toHaveCount(0)

  await adminContext.close()
})
