import type { UserRole } from '@web-app-demo/contracts'

import type { DbClient } from '../src/db'

/**
 * Fixed fixture data for the screenshot tour (`bun run screens`) and local demo seeding
 * (`DEV_SEED_DEMO=1 bun run dev:seed`). Two seeded accounts alone leave the admin dashboard and
 * user directory looking empty, so this adds a realistic, deterministic population: no randomness,
 * so the same names, roles, and relative ordering appear on every run.
 *
 * Emails live under a dedicated fake domain so they can never collide with `uniqueEmail()` in
 * `webapp/e2e/helpers/test.ts`, which mints unique addresses under `@example.com`.
 */
const demoFixtureEmailDomain = 'fixtures.example.com'

// One entry per fixture user, paired by index. Neither list needs to avoid repeats on its own;
// pairing by index already keeps every (first, last) combination distinct.
const demoFirstNames = [
  'Olivia', 'Liam', 'Emma', 'Noah', 'Ava', 'Elijah', 'Sophia', 'James', 'Isabella', 'William',
  'Mia', 'Benjamin', 'Charlotte', 'Lucas', 'Amelia', 'Henry', 'Harper', 'Alexander', 'Evelyn', 'Michael',
  'Abigail', 'Daniel', 'Emily', 'Jacob', 'Elizabeth', 'Logan', 'Sofia', 'Jackson', 'Avery', 'Sebastian',
  'Ella', 'Jack', 'Scarlett', 'Owen', 'Grace', 'Samuel', 'Chloe', 'Matthew', 'Victoria', 'David',
] as const

const demoLastNames = [
  'Nguyen', 'Kowalski', 'Okafor', 'Andersson', 'Rossi', 'Dubois', 'Martinez', 'Haddad', 'Kim', 'Petrov',
  'Larsson', 'Silva', 'Novak', 'Fischer', 'Yamamoto', 'Oyelaran', 'Costa', 'Ivanova', 'Schneider', 'Diallo',
  'Nakamura', 'Lindqvist', 'Moreau', 'Santos', 'Berg', 'Choi', 'Ferreira', 'Adeyemi', 'Kaur', 'Muller',
  'Nilsson', 'Rodrigues', 'Popescu', 'Hansen', 'Tanaka', 'Osei', 'Vasquez', 'Bergstrom', 'Suzuki', 'Mensah',
] as const

// The first row (most recently created; the admin list sorts `createdAt desc`) gets a display
// name long enough to prove truncation and wrapping hold up, in both the table and the mobile list.
const demoLongDisplayName = 'Persephone Featherington-Wintermoore-Abernathy'

// Indexes promoted to admin, spread across the name list and across ages, so the dashboard's
// "Administrators" count is more than one and the directory shows more than one admin badge.
const demoAdminIndexes = new Set([2, 15, 28])

// Days before "now" each fixture was created. The first six land inside the dashboard's rolling
// 7-day window ("several users created within the last 7 days"); the rest spread across roughly
// the last two years for a realistic, varied history. Values are relative to the seed run, not to
// a fixed calendar date, so `newUsersLast7Days` is never zero - but every run recomputes the same
// relative shape, so the row count, ages relative to each other, and the resulting order stay
// stable across runs.
const demoDayOffsets = [
  0, 1, 2, 3, 4, 5,
  ...Array.from({ length: 34 }, (_, index) => 10 + index * 20),
]

function slugify(name: string) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

export type DemoFixtureUser = {
  dayOffset: number
  displayName: string
  email: string
  role: UserRole
}

export const demoFixtureUsers: ReadonlyArray<DemoFixtureUser> = demoFirstNames.map(
  (firstName, index) => {
    const displayName = index === 0 ? demoLongDisplayName : `${firstName} ${demoLastNames[index]}`
    return {
      dayOffset: demoDayOffsets[index],
      displayName,
      email: `${slugify(displayName)}@${demoFixtureEmailDomain}`,
      role: demoAdminIndexes.has(index) ? 'admin' : 'user',
    }
  },
)

const millisecondsPerDay = 24 * 60 * 60 * 1000

/**
 * The upsert for one fixture, keyed by email, so a repeat run refreshes names, roles, and relative
 * dates instead of duplicating rows or leaving yesterday's "within 7 days" users stale.
 *
 * Fixtures have no password: login rejects a user without a hash, and password reset skips one.
 * A shared password in this public source would give anyone who can reach a seeded dev backend
 * three admin accounts. `update` clears the hash too, so a row seeded by an older run is locked.
 */
function demoFixtureUpsert(fixture: DemoFixtureUser, now: number) {
  const createdAt = new Date(now - fixture.dayOffset * millisecondsPerDay)
  return {
    where: { email: fixture.email },
    create: {
      createdAt,
      displayName: fixture.displayName,
      email: fixture.email,
      passwordHash: null,
      role: fixture.role,
    },
    update: {
      createdAt,
      displayName: fixture.displayName,
      passwordHash: null,
      role: fixture.role,
    },
  }
}

export async function seedDemoFixtures(db: DbClient) {
  const now = Date.now()

  for (const fixture of demoFixtureUsers) {
    // Clearing the hash stops new sign-ins; a session opened under an older seed must end too.
    await db.$transaction([
      db.user.upsert(demoFixtureUpsert(fixture, now)),
      db.authSession.deleteMany({ where: { user: { email: fixture.email } } }),
    ])
  }

  return { count: demoFixtureUsers.length }
}
