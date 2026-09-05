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

  test('rejects reverse imports between backend layers', () => {
    const violations = check([
      file('backend/src/modules/auth/domain/session.ts', "import { route } from '../transport/routes'"),
      file('backend/src/modules/auth/transport/routes.ts', "import { repo } from '../infrastructure/repository'"),
      file('backend/src/modules/auth/infrastructure/repository.ts', "import { route } from '../transport/routes'"),
    ])

    expect(violations.map((item) => item.rule)).toEqual([
      'backend-domain-dependencies',
      'backend-infrastructure-dependencies',
      'backend-transport-dependencies',
    ])
  })

  test('keeps provider SDKs out of transport', () => {
    const violation = check([
      file('backend/src/modules/auth/transport/routes.ts', "import { S3Client } from '@aws-sdk/client-s3'"),
    ])[0]

    expect(violation?.rule).toBe('backend-transport-dependencies')
  })
})

describe('public module and feature indexes', () => {
  test('accepts public indexes and rejects deep cross-context imports', () => {
    expect(check([file('backend/src/modules/auth/application/service.ts', "import { read } from '../../billing'")])).toEqual([])
    expect(check([file('backend/src/modules/auth/application/service.ts', "import { read } from '../../billing/application/read'")])[0]?.rule).toBe('backend-module-public-api')

    expect(check([file('webapp/src/features/auth/provider.tsx', "import { usePlan } from '../billing'")])).toEqual([])
    expect(check([file('webapp/src/features/auth/provider.tsx', "import { usePlan } from '../billing/provider'")])[0]?.rule).toBe('client-feature-public-api')

    expect(check([file('backend/src/app.ts', "import { auth } from './modules/auth'")])).toEqual([])
    const compositionViolation = check([
      file('backend/src/app.ts', "import { auth } from './modules/auth/infrastructure/repository'"),
    ])[0]
    expect(compositionViolation?.rule).toBe('backend-module-public-api')
    expect(compositionViolation?.message).toContain(
      'code outside module auth must import it through its public index',
    )
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

  test('requires composition code to use feature public indexes', () => {
    expect(check([file('webapp/src/pages.tsx', "import { AuthProvider } from '@/features/auth'")])).toEqual([])
    expect(check([file('webapp/src/pages.tsx', "import { AuthProvider } from '@/features/auth/provider'")])[0]?.rule)
      .toBe('client-feature-public-api')
  })

  test('keeps contracts framework- and product-independent', () => {
    expect(check([file('packages/contracts/src/auth.ts', "import { z } from 'zod'")])).toEqual([])
    expect(check([file('packages/contracts/src/auth.ts', "import { Hono } from 'hono'")])[0]?.rule).toBe('contracts-dependency-direction')
    expect(check([file('packages/contracts/src/auth.ts', "import { jwtVerify } from 'jose'")])[0]?.rule).toBe('contracts-dependency-direction')
  })

  test('checks dynamic imports and CommonJS require calls', () => {
    const violations = check([
      file('webapp/src/platform/lazy.ts', "const auth = import('@/features/auth/provider')"),
      file('packages/contracts/src/auth.ts', "const hono = require('hono')"),
    ])
    expect(violations.map((item) => item.rule)).toEqual([
      'contracts-dependency-direction',
      'client-dependency-direction',
      'client-feature-public-api',
    ])
  })
})

describe('module root placement', () => {
  test('keeps product code out of the module root, where no layer rule reaches it', () => {
    const violation = check([
      file('backend/src/modules/auth/session-helpers.ts', "import { Prisma } from '../../generated/prisma/client'"),
    ])[0]

    expect(violation?.rule).toBe('backend-module-layer-placement')
  })

  test('accepts the public index and the module integration tests at that root', () => {
    expect(check([
      file('backend/src/modules/auth/index.ts', "import { PrismaClient } from '@prisma/client'"),
      file('backend/src/modules/auth/auth.integration.test.ts', "import { createApp } from '../../app'"),
    ])).toEqual([])
  })

  test('reports placement even for a file that imports nothing', () => {
    expect(check([file('backend/src/modules/auth/constants.ts', 'export const retries = 3')])
      .map((item) => item.rule)).toEqual(['backend-module-layer-placement'])
  })
})

describe('website client boundary', () => {
  test('holds the website to the same feature and layer direction as the webapp', () => {
    const violations = check([
      file('website/src/components/ui/button.tsx', "import { useAuth } from '@/features/auth'"),
      file('website/src/pages/landing.tsx', "import { model } from '@/features/pricing/model'"),
    ])

    expect(violations.map((item) => item.rule)).toEqual([
      'client-dependency-direction',
      'client-feature-public-api',
    ])
  })
})

function check(files) {
  return checkArchitectureSources(files)
}

function file(path, source) {
  return { path, source }
}
