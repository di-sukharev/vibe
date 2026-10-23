import { expect, signUp, test, uniqueEmail } from '../helpers/test'

test('account menu supports keyboard navigation and logout', async ({ page }) => {
  await signUp(page, uniqueEmail('web-e2e-menu'))
  await expect(page).toHaveURL(/\/app$/)

  const accountMenu = page.getByTestId('account-menu')
  await accountMenu.focus()
  await accountMenu.press('Enter')
  const profileLink = page.getByRole('menuitem', { name: 'Profile', exact: true })
  await expect(profileLink).toBeFocused()
  await profileLink.press('Enter')
  await expect(page).toHaveURL(/\/app\/profile$/)

  await accountMenu.focus()
  await accountMenu.press('Enter')
  await page.getByRole('menuitem', { name: 'Profile', exact: true }).press('End')
  const logout = page.getByTestId('account-menu-logout')
  await expect(logout).toBeFocused()
  await logout.press('Enter')
  await expect(page.getByTestId('login-form')).toBeVisible()
})

test('mobile navigation closes its panel and keeps the destination usable', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 })
  await signUp(page, uniqueEmail('web-e2e-mobile-nav'))
  await expect(page).toHaveURL(/\/app$/)

  const toggle = page.getByRole('button', { name: 'Toggle Sidebar' })
  await toggle.click()
  const panel = page.getByRole('dialog')
  await expect(panel).toBeVisible()
  await panel.getByTestId('nav-link-app-profile').click()
  await expect(page).toHaveURL(/\/app\/profile$/)
  await expect(panel).toBeHidden()

  await toggle.click()
  await panel.getByTestId('account-menu').click()
  await page.getByRole('menuitem', { name: 'Settings', exact: true }).click()
  await expect(page).toHaveURL(/\/app\/settings$/)
  await expect(panel).toBeHidden()
  await page.getByLabel('Theme', { exact: true }).click()
  await page.getByRole('option', { name: 'Dark', exact: true }).click()
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem('web_app_demo_theme')))
    .toBe('dark')
  await page.reload()
  await page.getByLabel('Theme', { exact: true }).click()
  await expect(
    page.getByRole('option', { name: 'Dark', exact: true, selected: true }),
  ).toBeVisible()
})
