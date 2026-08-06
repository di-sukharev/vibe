import { emailSchema, passwordSchema } from '@web-app-demo/contracts'

import type { DevelopmentSeedAccounts } from '../src/modules/users/infrastructure/development-bootstrap'

type DevelopmentSeedCredentials = {
  email: string
  password: string
}

const loopbackHosts = new Set(['localhost', '127.0.0.1', '[::1]'])

export function parseDevelopmentSeedConfig(
  source: Record<string, string | undefined>,
) {
  if (source.NODE_ENV?.trim().toLowerCase() === 'production') {
    throw new Error('Development seed is disabled in production')
  }

  const databaseUrl = source.DATABASE_URL?.trim()
  if (!databaseUrl) {
    throw new Error('DATABASE_URL is required for the development seed')
  }

  let parsedDatabaseUrl: URL
  try {
    parsedDatabaseUrl = new URL(databaseUrl)
  } catch {
    throw new Error('DATABASE_URL must be a valid PostgreSQL URL')
  }
  if (
    !['postgres:', 'postgresql:'].includes(parsedDatabaseUrl.protocol) ||
    !loopbackHosts.has(parsedDatabaseUrl.hostname) ||
    parsedDatabaseUrl.searchParams.has('host')
  ) {
    throw new Error('Development seed requires a loopback PostgreSQL DATABASE_URL')
  }

  const accounts = {
    admin: parseCredentials(source, 'DEV_SEED_ADMIN'),
    user: parseCredentials(source, 'DEV_SEED_USER'),
  }
  if (accounts.admin.email === accounts.user.email) {
    throw new Error('DEV_SEED_ADMIN_EMAIL and DEV_SEED_USER_EMAIL must be different')
  }

  return { accounts, databaseUrl }
}

function parseCredentials(
  source: Record<string, string | undefined>,
  prefix: 'DEV_SEED_ADMIN' | 'DEV_SEED_USER',
): DevelopmentSeedCredentials {
  const emailKey = `${prefix}_EMAIL`
  const passwordKey = `${prefix}_PASSWORD`
  const parsedEmail = emailSchema.safeParse(source[emailKey])
  if (!parsedEmail.success) {
    throw new Error(`${emailKey} must be a valid email address`)
  }
  const parsedPassword = passwordSchema.safeParse(source[passwordKey])
  if (!parsedPassword.success) {
    throw new Error(`${passwordKey} must contain 8-128 characters`)
  }
  return {
    email: parsedEmail.data,
    password: parsedPassword.data,
  }
}
