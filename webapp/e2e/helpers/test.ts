export { expect, test } from '@playwright/test'

export const e2ePassword = 'password123'

export function uniqueEmail(prefix = 'web-e2e') {
  const timestamp = new Date().toISOString().replace(/[^0-9]/g, '')
  const suffix = Math.random().toString(36).slice(2, 8)

  return `${prefix}-${timestamp}-${suffix}@example.com`
}
