import { describe, expect, test } from 'bun:test'

import { checkArchitectureSources } from './architecture-check.mjs'

describe('backend layers', () => {
  test('accepts pure domain and application ports', () => {
    expect(check([file('backend/src/modules/auth/domain/session.ts', "import type { UserDto } from '@web-app-demo/contracts'")])).toEqual([])
  })

  test('rejects framework, persistence, env, and infrastructure from inner layers', () => {
    const violations = check([
      file('backend/src/modules/auth/domain/session.ts', "import { Hono } from 'hono'"),
      file('backend/src/modules/auth/application/service.ts', "import { db } from '../../../env'"),
      file('backend/src/modules/auth/application/service.ts', "import { repo } from '../infrastructure/repository'"),
    ])
    expect(violations.map((item) => item.rule)).toEqual([
      'backend-application-dependencies',
      'backend-application-dependencies',
      'backend-domain-dependencies',
    ])
  })

  test('rejects Prisma from transport while accepting application ports', () => {
    expect(check([file('backend/src/modules/auth/transport/routes.ts', "import type { AuthService } from '../application/auth-service'")])).toEqual([])
    expect(check([file('backend/src/modules/auth/transport/routes.ts', "import { Prisma } from '../../../generated/prisma/client'")])[0]?.rule).toBe('backend-transport-dependencies')
  })
})

describe('public module and feature indexes', () => {
  test('accepts public indexes and rejects deep cross-context imports', () => {
    expect(check([file('backend/src/modules/auth/application/service.ts', "import { read } from '../../billing'")])).toEqual([])
    expect(check([file('backend/src/modules/auth/application/service.ts', "import { read } from '../../billing/application/read'")])[0]?.rule).toBe('backend-module-public-api')

    expect(check([file('webapp/src/features/auth/provider.tsx', "import { usePlan } from '../billing'")])).toEqual([])
    expect(check([file('webapp/src/features/auth/provider.tsx', "import { usePlan } from '../billing/provider'")])[0]?.rule).toBe('client-feature-public-api')
  })
})

describe('dependency direction', () => {
  test('accepts feature imports from composition and rejects features from platform and UI', () => {
    expect(check([file('webapp/src/main.tsx', "import { AuthProvider } from '@/features/auth'")])).toEqual([])
    const violations = check([
      file('webapp/src/platform/api/http-client.ts', "import { AuthApi } from '@/features/auth'"),
      file('webapp/src/components/ui/button.tsx', "import { useAuth } from '@/features/auth'"),
    ])
    expect(violations.every((item) => item.rule === 'client-dependency-direction')).toBe(true)
  })

  test('keeps contracts framework- and product-independent', () => {
    expect(check([file('packages/contracts/src/auth.ts', "import { z } from 'zod'")])).toEqual([])
    expect(check([file('packages/contracts/src/auth.ts', "import { Hono } from 'hono'")])[0]?.rule).toBe('contracts-dependency-direction')
  })
})

function check(files) {
  return checkArchitectureSources(files)
}

function file(path, source) {
  return { path, source }
}
