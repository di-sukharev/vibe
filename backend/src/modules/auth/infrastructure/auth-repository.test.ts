import { describe, expect, test } from 'bun:test'

import type { DbClient } from '../../../db'
import { createPrismaAuthRepository } from './auth-repository'

// These tests fake only `authSession.findFirst` / `updateMany` and `$transaction`, the way
// `db.test.ts` fakes `$transaction` for `runWithJobLock` - enough to drive the credential-state
// and CAS decisions below without a real Postgres. `createSession`, `createPasswordUserWithSession`
// and the password-reset transactions call `acquireUserAuthenticationAuthorityLock`, which issues
// a raw advisory-lock query; faking that would mean asserting the fake was called the scripted
// number of times rather than testing anything real, so those stay in `auth.integration.test.ts`
// against real Postgres.

const now = new Date('2026-01-01T00:00:00.000Z')
const createdAfter = new Date('2025-10-03T00:00:00.000Z')
const reuseGraceAfter = new Date('2025-12-31T23:59:50.000Z')

const user = {
  id: 'user-1',
  email: 'user@example.com',
  passwordHash: 'password-hash',
  displayName: null,
  role: 'user' as const,
  createdAt: now,
}

const refreshLookup = {
  refreshTokenHash: 'hash:current',
  refreshTokenFamilyHash: 'family:token',
  now,
  createdAfter,
  reuseGraceAfter,
}

type FakeSessionRow = {
  refreshTokenHash: string
  previousRefreshTokenHash: string | null
  refreshRotatedAt: Date | null
}

/**
 * Routes each `findFirst` by which lookup it is, the way the three real queries in
 * `findActiveRefreshSession` are told apart - by which unique field is in `where`. `family`
 * answers the primary family-hash lookup; `current` and `previous` answer the legacy fallback
 * lookups a pre-family-hash session still resolves through.
 */
function fakeDb(responses: {
  family?: FakeSessionRow | null
  current?: FakeSessionRow | null
  previous?: FakeSessionRow | null
}): DbClient {
  return {
    authSession: {
      findFirst: async ({ where }: { where: Record<string, unknown> }) => {
        const row =
          'refreshTokenFamilyHash' in where ? responses.family
          : 'previousRefreshTokenHash' in where ? responses.previous
          : responses.current
        return row ? { ...row, id: 'session-1', userId: user.id, user } : null
      },
    },
  } as unknown as DbClient
}

describe('findActiveRefreshSession credential state', () => {
  test('the presented hash matching the session\'s current hash is "current"', async () => {
    const repository = createPrismaAuthRepository(
      fakeDb({
        family: { refreshTokenHash: 'hash:current', previousRefreshTokenHash: null, refreshRotatedAt: null },
      }),
    )

    const session = await repository.findActiveRefreshSession(refreshLookup)

    expect(session?.credentialState).toBe('current')
  })

  test('the previous hash presented inside the reuse grace window is "previous_within_grace"', async () => {
    const repository = createPrismaAuthRepository(
      fakeDb({
        family: {
          refreshTokenHash: 'hash:next',
          previousRefreshTokenHash: 'hash:current',
          refreshRotatedAt: new Date('2025-12-31T23:59:55.000Z'),
        },
      }),
    )

    const session = await repository.findActiveRefreshSession(refreshLookup)

    expect(session?.credentialState).toBe('previous_within_grace')
  })

  test('the previous hash presented after the reuse grace window is "reused"', async () => {
    const repository = createPrismaAuthRepository(
      fakeDb({
        family: {
          refreshTokenHash: 'hash:next',
          previousRefreshTokenHash: 'hash:current',
          refreshRotatedAt: new Date('2025-12-31T23:59:45.000Z'),
        },
      }),
    )

    const session = await repository.findActiveRefreshSession(refreshLookup)

    expect(session?.credentialState).toBe('reused')
  })

  test('a hash that is neither the current nor the previous credential is "reused", not "current"', async () => {
    // A stolen refresh token whose family is still alive but whose hash matches neither slot -
    // this is the theft signal `refresh()` revokes the whole session over, so it must not be
    // mistaken for an unrotated or still-in-grace credential.
    const repository = createPrismaAuthRepository(
      fakeDb({
        family: {
          refreshTokenHash: 'hash:next',
          previousRefreshTokenHash: 'hash:some-older-credential',
          refreshRotatedAt: new Date('2025-12-31T23:59:59.000Z'),
        },
      }),
    )

    const session = await repository.findActiveRefreshSession(refreshLookup)

    expect(session?.credentialState).toBe('reused')
  })

  test('no session matching any lookup resolves to null', async () => {
    const repository = createPrismaAuthRepository(fakeDb({}))

    await expect(repository.findActiveRefreshSession(refreshLookup)).resolves.toBeNull()
  })

  describe('legacy fallback (no row carries the presented family hash)', () => {
    test('a match on the current-hash fallback lookup is "current"', async () => {
      const repository = createPrismaAuthRepository(
        fakeDb({
          current: { refreshTokenHash: 'hash:current', previousRefreshTokenHash: null, refreshRotatedAt: null },
        }),
      )

      const session = await repository.findActiveRefreshSession(refreshLookup)

      expect(session?.credentialState).toBe('current')
    })

    test('a match on the previous-hash fallback lookup within the grace window is "previous_within_grace"', async () => {
      const repository = createPrismaAuthRepository(
        fakeDb({
          previous: {
            refreshTokenHash: 'hash:next',
            previousRefreshTokenHash: 'hash:current',
            refreshRotatedAt: new Date('2025-12-31T23:59:55.000Z'),
          },
        }),
      )

      const session = await repository.findActiveRefreshSession(refreshLookup)

      expect(session?.credentialState).toBe('previous_within_grace')
    })

    test('a match on the previous-hash fallback lookup outside the grace window is "reused"', async () => {
      const repository = createPrismaAuthRepository(
        fakeDb({
          previous: {
            refreshTokenHash: 'hash:next',
            previousRefreshTokenHash: 'hash:current',
            refreshRotatedAt: new Date('2025-12-31T23:59:45.000Z'),
          },
        }),
      )

      const session = await repository.findActiveRefreshSession(refreshLookup)

      expect(session?.credentialState).toBe('reused')
    })
  })
})

describe('rotateRefreshSession compare-and-swap', () => {
  test('updates only when the row still holds the presented current hash and has not expired, and reports which', async () => {
    const wheres: unknown[] = []
    const rotate = (count: number) =>
      createPrismaAuthRepository({
        authSession: {
          updateMany: async (args: { where: unknown }) => {
            wheres.push(args.where)
            return { count }
          },
        },
      } as unknown as DbClient).rotateRefreshSession({
        currentSessionId: 'session-1',
        currentRefreshTokenHash: 'hash:current',
        now,
        nextRefreshTokenHash: 'hash:next',
        nextRefreshTokenFamilyHash: 'family:token',
        nextExpiresAt: new Date('2026-01-31T00:00:00.000Z'),
        metadata: {},
      })

    await expect(rotate(1)).resolves.toBe(true)
    // A concurrent rotation already moved the hash on: this request's presented hash no longer
    // matches, the update touches zero rows, and the caller must be told it lost the race.
    await expect(rotate(0)).resolves.toBe(false)

    for (const where of wheres) {
      expect(where).toEqual({
        id: 'session-1',
        refreshTokenHash: 'hash:current',
        revokedAt: null,
        expiresAt: { gt: now },
      })
    }
  })
})

describe('revokeSession lookup', () => {
  function repositoryWithSession(session: { id: string; userId: string } | null, updatedCount: number) {
    const wheres: unknown[] = []
    const repository = createPrismaAuthRepository({
      $transaction: async (run: (tx: unknown) => unknown) =>
        run({
          authSession: {
            findFirst: async (args: { where: unknown }) => {
              wheres.push(args.where)
              return session
            },
            updateMany: async () => ({ count: updatedCount }),
          },
        }),
    } as unknown as DbClient)

    return { repository, wheres }
  }

  test('matches on the current hash, the previous hash, or the family hash', async () => {
    const { repository, wheres } = repositoryWithSession({ id: 'session-1', userId: user.id }, 1)

    await repository.revokeSession({
      refreshTokenHash: 'hash:current',
      refreshTokenFamilyHash: 'family:token',
      now,
    })

    expect(wheres).toEqual([
      {
        OR: [
          { refreshTokenHash: 'hash:current' },
          { previousRefreshTokenHash: 'hash:current' },
          { refreshTokenFamilyHash: 'family:token' },
        ],
        revokedAt: null,
      },
    ])
  })

  test('resolves the owning user id only when a row was actually revoked', async () => {
    const found = repositoryWithSession({ id: 'session-1', userId: user.id }, 1)
    await expect(
      found.repository.revokeSession({
        refreshTokenHash: 'hash:current',
        refreshTokenFamilyHash: 'family:token',
        now,
      }),
    ).resolves.toBe(user.id)

    // Already revoked by a concurrent logout between the lookup and the update.
    const raced = repositoryWithSession({ id: 'session-1', userId: user.id }, 0)
    await expect(
      raced.repository.revokeSession({
        refreshTokenHash: 'hash:current',
        refreshTokenFamilyHash: 'family:token',
        now,
      }),
    ).resolves.toBeNull()

    const missing = repositoryWithSession(null, 1)
    await expect(
      missing.repository.revokeSession({
        refreshTokenHash: 'hash:current',
        refreshTokenFamilyHash: 'family:token',
        now,
      }),
    ).resolves.toBeNull()
  })
})
