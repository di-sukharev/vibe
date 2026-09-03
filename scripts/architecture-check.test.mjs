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

function check(files) {
  return checkArchitectureSources(files)
}

function file(path, source) {
  return { path, source }
}

describe('provider and framework denylist coverage', () => {
  test('rejects the raw database driver from inner layers, not only from transport', () => {
    const violations = check([
      file('backend/src/modules/auth/application/service.ts', "import { Pool } from 'pg'"),
      file('backend/src/modules/auth/domain/session.ts', "import { Pool } from 'pg'"),
    ])

    expect(violations.map((item) => item.rule)).toEqual([
      'backend-application-dependencies',
      'backend-domain-dependencies',
    ])
  })

  test('rejects scoped framework packages that share a prefix with an allowed name', () => {
    const violations = check([
      file('backend/src/modules/auth/domain/session.ts', "import { createRoute } from '@hono/zod-openapi'"),
      file('packages/contracts/src/auth.ts', "import { zValidator } from '@hono/zod-validator'"),
    ])

    expect(violations.map((item) => item.rule)).toEqual([
      'backend-domain-dependencies',
      'contracts-dependency-direction',
    ])
  })

  test('keeps the provider SDK core out of transport and inner layers', () => {
    const violations = check([
      file('backend/src/modules/uploads/domain/signing.ts', "import { SignatureV4 } from '@smithy/signature-v4'"),
      file('backend/src/modules/uploads/transport/routes.ts', "import { SignatureV4 } from '@smithy/signature-v4'"),
    ])

    expect(violations.map((item) => item.rule)).toEqual([
      'backend-domain-dependencies',
      'backend-transport-dependencies',
    ])
  })
})

describe('comments are not scanned for imports', () => {
  test('ignores a forbidden require() call commented out on a single line', () => {
    // Uses require(), not `import ... from`: the import pattern already requires the keyword to
    // start the line, so it can never match text after `//` — this fixture must use a pattern
    // that has no such anchor, or the test would pass even with comment-stripping disabled.
    expect(check([
      file('backend/src/modules/auth/domain/session.ts', "// const hono = require('hono')"),
    ])).toEqual([])
  })

  test('ignores a forbidden require() call inside a block comment', () => {
    expect(check([
      file('backend/src/modules/auth/domain/session.ts', "/* const hono = require('hono') */"),
    ])).toEqual([])
  })

  test('ignores an import sitting on its own line inside a multi-line block comment', () => {
    expect(check([
      file(
        'backend/src/modules/auth/domain/session.ts',
        "/* disable temporarily\nimport { Hono } from 'hono'\n*/",
      ),
    ])).toEqual([])
  })

  test('does not let a // inside a same-line URL string swallow a real require() call after it', () => {
    const violations = check([
      file(
        'backend/src/modules/auth/domain/session.ts',
        "const DOCS_URL = 'https://example.com'; const hono = require('hono')",
      ),
    ])
    expect(violations.map((item) => item.rule)).toEqual(['backend-domain-dependencies'])
  })

  test('keeps line numbers correct across a multi-line block comment', () => {
    const violations = check([
      file(
        'backend/src/modules/auth/domain/session.ts',
        "/* a comment\nspanning lines */\nimport { Hono } from 'hono'",
      ),
    ])
    expect(violations.map((item) => item.line)).toEqual([3])
  })
})
