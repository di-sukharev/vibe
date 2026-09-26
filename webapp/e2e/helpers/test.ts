import type { Page } from '@playwright/test'

export { expect, test } from '@playwright/test'

export const e2ePassword = 'password123'

export function uniqueEmail(prefix = 'web-e2e') {
  const timestamp = new Date().toISOString().replace(/[^0-9]/g, '')
  const suffix = Math.random().toString(36).slice(2, 8)

  return `${prefix}-${timestamp}-${suffix}@example.com`
}

/** Fills the signup form the page already shows. */
export async function fillSignupForm(page: Page, email: string, displayName?: string) {
  if (displayName) await page.getByTestId('signup-display-name').fill(displayName)
  await page.getByTestId('signup-email').fill(email)
  await page.getByTestId('signup-password').fill(e2ePassword)
  await page.getByTestId('signup-confirm-password').fill(e2ePassword)
}

export async function signUp(page: Page, email: string, displayName?: string) {
  await page.goto('/signup')
  await fillSignupForm(page, email, displayName)
  await page.getByTestId('signup-submit').click()
}

/** Submits the login form the page already shows. */
export async function logIn(page: Page, email: string, password = e2ePassword) {
  await page.getByTestId('login-email').fill(email)
  await page.getByTestId('login-password').fill(password)
  await page.getByTestId('login-submit').click()
}

export async function logOut(page: Page) {
  await page.getByTestId('account-menu').click()
  await page.getByTestId('account-menu-logout').click()
}
