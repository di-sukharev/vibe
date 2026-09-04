import { describe, expect, test } from 'bun:test'

import { UsersFailure } from './errors'
import { assertActorIsAdmin, decideRoleUpdate } from './role-update-policy'

const actorId = 'actor-1'
const otherId = 'target-1'

const failsWith = async (promise: Promise<unknown>, kind: UsersFailure['kind']) => {
  await expect(promise).rejects.toMatchObject({ kind })
}

describe('assertActorIsAdmin', () => {
  test('allows an admin actor through', () => {
    expect(() => assertActorIsAdmin({ role: 'admin' })).not.toThrow()
  })

  test('rejects a non-admin actor', () => {
    expect(() => assertActorIsAdmin({ role: 'user' })).toThrow(UsersFailure)
  })

  test('rejects a missing actor', () => {
    expect(() => assertActorIsAdmin(null)).toThrow(UsersFailure)
  })
})

describe('decideRoleUpdate', () => {
  test('is a no-op when the target already holds the requested role', async () => {
    const countAdmins = () => Promise.resolve(1)
    const outcome = await decideRoleUpdate({
      actorId,
      target: { id: otherId, role: 'user' },
      requestedRole: 'user',
      countAdmins,
    })
    expect(outcome).toBe('noop')
  })

  test('rejects an admin demoting themselves', async () => {
    await failsWith(
      decideRoleUpdate({
        actorId,
        target: { id: actorId, role: 'admin' },
        requestedRole: 'user',
        countAdmins: () => Promise.resolve(5),
      }),
      'role_conflict',
    )
  })

  test('allows an admin to reaffirm their own admin role', async () => {
    const outcome = await decideRoleUpdate({
      actorId,
      target: { id: actorId, role: 'admin' },
      requestedRole: 'admin',
      countAdmins: () => Promise.resolve(1),
    })
    expect(outcome).toBe('noop')
  })

  test('rejects demoting the last remaining admin', async () => {
    await failsWith(
      decideRoleUpdate({
        actorId,
        target: { id: otherId, role: 'admin' },
        requestedRole: 'user',
        countAdmins: () => Promise.resolve(1),
      }),
      'role_conflict',
    )
  })

  test('allows demoting an admin when another admin remains', async () => {
    const outcome = await decideRoleUpdate({
      actorId,
      target: { id: otherId, role: 'admin' },
      requestedRole: 'user',
      countAdmins: () => Promise.resolve(2),
    })
    expect(outcome).toBe('update')
  })

  test('does not count admins when demotion is not in play', async () => {
    let called = false
    const outcome = await decideRoleUpdate({
      actorId,
      target: { id: otherId, role: 'user' },
      requestedRole: 'admin',
      countAdmins: () => {
        called = true
        return Promise.resolve(0)
      },
    })
    expect(outcome).toBe('update')
    expect(called).toBe(false)
  })
})
