import { emailSchema, passwordSchema } from '@web-app-demo/contracts'

const knownBootstrapPasswordPlaceholders = new Set([
  'change-me',
  'change-me-admin-password',
  'password',
  'password123',
  'replace-me',
])

export type AdminSeedConfig = {
  email: string
  password: string | null
}

export function parseAdminSeedConfig(
  source: Record<string, string | undefined>,
  options: { requirePassword: boolean },
): AdminSeedConfig {
  const configuredEmail = source.ADMIN_SEED_EMAIL?.trim()
  if (options.requirePassword && !configuredEmail) {
    throw new Error('ADMIN_SEED_EMAIL is required for the initial production deployment')
  }
  const parsedEmail = emailSchema.safeParse(configuredEmail || 'admin@example.com')
  if (!parsedEmail.success) {
    throw new Error(`ADMIN_SEED_EMAIL must be valid: ${parsedEmail.error.issues[0]?.message}`)
  }
  const password = source.ADMIN_SEED_PASSWORD || null

  if (options.requirePassword && !password) {
    throw new Error('ADMIN_SEED_PASSWORD is required for the initial production deployment')
  }
  if (password !== null) {
    const parsedPassword = passwordSchema.safeParse(password)
    if (!parsedPassword.success) {
      throw new Error(`ADMIN_SEED_PASSWORD is invalid: ${parsedPassword.error.issues[0]?.message}`)
    }
    if (options.requirePassword && password.trim().length < 12) {
      throw new Error('ADMIN_SEED_PASSWORD must be at least 12 characters')
    }
    if (knownBootstrapPasswordPlaceholders.has(password.trim().toLowerCase())) {
      throw new Error('ADMIN_SEED_PASSWORD must not use a known template placeholder')
    }
    if (options.requirePassword && isRepeatedPasswordPattern(password.trim())) {
      throw new Error('ADMIN_SEED_PASSWORD must not be a repeated pattern')
    }
  }

  return { email: parsedEmail.data, password }
}

function isRepeatedPasswordPattern(password: string) {
  return /^(.+)\1+$/u.test(password.toLowerCase())
}
