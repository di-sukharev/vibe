import { expect, test } from 'bun:test'

import type { DbClient } from '../../../db'
import { createPrismaAuthRepository } from './auth-repository'

test('creates a password user and initial session inside one database transaction', async () => {
  const operations: string[] = []
  const createdAt = new Date('2026-01-01T00:00:00.000Z')
  const transactionClient = {
    user: {
      create: async () => {
        operations.push('user')
        return {
          id: 'user-1',
          email: 'user@example.com',
          passwordHash: 'password-hash',
          displayName: null,
          createdAt,
          updatedAt: createdAt,
        }
      },
    },
    authSession: {
      create: async () => {
        operations.push('session')
        return { id: 'session-1' }
      },
    },
  }
  const db = {
    $transaction: async (run: (tx: typeof transactionClient) => unknown) => run(transactionClient),
  } as unknown as DbClient

  const result = await createPrismaAuthRepository(db).createPasswordUserWithSession({
    user: {
      email: 'user@example.com',
      password: 'password123',
      passwordHash: 'password-hash',
      displayName: undefined,
    },
    session: {
      refreshTokenHash: 'refresh-hash',
      refreshTokenFamilyHash: 'refresh-family-hash',
      expiresAt: new Date('2026-02-01T00:00:00.000Z'),
      metadata: {},
    },
  })

  expect(operations).toEqual(['user', 'session'])
  expect(result).toMatchObject({
    user: { id: 'user-1' },
    session: { id: 'session-1' },
  })
})

test('revokeSession fences push registration even when logout has no tokens to remove', async () => {
  const operations: string[] = []
  let pushTokenDeleteWhere: unknown
  const transactionClient = {
    $executeRaw: async () => {
      operations.push('push-lock')
      return 1
    },
    authSession: {
      findFirst: async () => {
        operations.push('find-session')
        return { id: 'session-1', userId: 'user-1' }
      },
      updateMany: async () => {
        operations.push('revoke-session')
        return { count: 1 }
      },
    },
    pushToken: {
      deleteMany: async (input: { where: unknown }) => {
        operations.push('delete-push-tokens')
        pushTokenDeleteWhere = input.where
        return { count: 0 }
      },
    },
  }
  const db = {
    $transaction: async (run: (tx: typeof transactionClient) => unknown) => run(transactionClient),
  } as unknown as DbClient

  const userId = await createPrismaAuthRepository(db).revokeSession(
    {
      expoPushTokens: [],
      refreshTokenHash: 'refresh-hash',
      refreshTokenFamilyHash: 'refresh-family-hash',
      now: new Date('2026-01-01T00:00:00.000Z'),
    },
    async ({ expoPushTokens, store, userId: cleanupUserId }) => {
      operations.push('cleanup')
      await store.removePushTokens(cleanupUserId, expoPushTokens)
    },
  )

  expect(userId).toBe('user-1')
  expect(operations).toEqual([
    'find-session',
    'push-lock',
    'cleanup',
    'delete-push-tokens',
    'revoke-session',
  ])
  expect(pushTokenDeleteWhere).toEqual({
    OR: [{ registrationSessionId: 'session-1' }],
    userId: 'user-1',
  })
})

test('revokeSessionById uses the push registration fence and removes session tokens', async () => {
  const operations: string[] = []
  let pushTokenDeleteWhere: unknown
  const transactionClient = {
    $executeRaw: async () => {
      operations.push('push-lock')
      return 1
    },
    authSession: {
      findUnique: async () => {
        operations.push('find-session')
        return { userId: 'user-1' }
      },
      updateMany: async () => {
        operations.push('revoke-session')
        return { count: 1 }
      },
    },
    pushToken: {
      deleteMany: async (input: { where: unknown }) => {
        operations.push('delete-push-tokens')
        pushTokenDeleteWhere = input.where
        return { count: 1 }
      },
    },
  }
  const db = {
    $transaction: async (run: (tx: typeof transactionClient) => unknown) => run(transactionClient),
  } as unknown as DbClient

  const revoked = await createPrismaAuthRepository(db).revokeSessionById({
    sessionId: 'session-1',
    now: new Date('2026-01-01T00:00:00.000Z'),
  })

  expect(revoked).toBe(true)
  expect(operations).toEqual([
    'find-session',
    'push-lock',
    'revoke-session',
    'delete-push-tokens',
  ])
  expect(pushTokenDeleteWhere).toEqual({
    registrationSessionId: 'session-1',
    userId: 'user-1',
  })
})
