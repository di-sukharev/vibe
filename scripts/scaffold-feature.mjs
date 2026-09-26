#!/usr/bin/env bun
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'

import { repositoryRoot } from './repo-env.mjs'

/**
 * `bun run scaffold:feature <name>` generates a full-stack "owned resource" feature (list +
 * create, scoped to the signed-in user) in the shape of the `users`/`admin` reference slices:
 * a contracts file, a three-layer backend module (no domain layer - this feature has no rules
 * beyond ownership, which the query itself enforces), a backend integration test, a webapp
 * feature, a webapp unit test for its pure model, and a Prisma model file.
 *
 * It never rewrites a file that already exists (`--dry-run` only ever lists what it would do);
 * it wires the new feature into six shared files (contracts index, `backend/src/app.ts`,
 * `backend/prisma/schema/base.prisma`, `webapp/src/routes.tsx`,
 * `webapp/src/features/navigation/model.ts`, `webapp/src/components/WorkspaceShell.tsx`'s sidebar
 * icon map) by inserting text before an explicit
 * `// scaffold:<name>` marker comment already checked into each of those files - never by
 * guessing at surrounding code. A name collision, an identifier or path those insertions would
 * declare twice, or a missing marker aborts before anything is written; any later failure,
 * `prisma generate` or a SIGINT/SIGTERM included, restores the tree it started from.
 */

export const reservedFeatureNames = new Set([
  'admin',
  'app',
  'auth',
  'avatar',
  'contracts',
  'index',
  'navigation',
  'settings',
  'uploads',
  'users',
])

export class ScaffoldError extends Error {}

const kebabWordPattern = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/

export function isKebabCase(value) {
  return kebabWordPattern.test(value)
}

export function toCamelCase(kebab) {
  return kebab
    .split('-')
    .map((segment, index) => (index === 0 ? segment : capitalize(segment)))
    .join('')
}

export function toPascalCase(kebab) {
  return kebab.split('-').map(capitalize).join('')
}

export function toSnakeCase(kebab) {
  return kebab.replaceAll('-', '_')
}

export function toWords(kebab) {
  return kebab.replaceAll('-', ' ')
}

function capitalize(segment) {
  return segment.charAt(0).toUpperCase() + segment.slice(1)
}

/**
 * English depluralization for the endings with one plausible singular. Returns `null` for
 * anything else, so the caller asks for `--singular` rather than baking a misspelled name into
 * the model, the contracts, and the UI:
 * - no plural shape at all (`data`), or a singular-looking `-us`/`-is`/`-ss` (`status`);
 * - `-uses` (bus/house), `-zzes` (quiz/buzz), and `-ses`/`-zes` after anything but the letters
 *   below (case/alias, thesis/cheese, waltz/size).
 */
export function guessSingularKebab(pluralKebab) {
  if (/[^aeiou]ies$/.test(pluralKebab)) return `${pluralKebab.slice(0, -3)}y` // categories
  if (/(?:ss|x|ch|sh)es$/.test(pluralKebab)) return pluralKebab.slice(0, -2) // addresses, boxes, watches, wishes
  if (/[rnlp]ses$/.test(pluralKebab)) return pluralKebab.slice(0, -1) // courses, responses, pulses, lapses
  if (/[aeio]zes$/.test(pluralKebab)) return pluralKebab.slice(0, -1) // sizes, mazes, breezes
  if (/(?:[sz]es|us|is|ss)$/.test(pluralKebab)) return null
  if (pluralKebab.endsWith('s')) return pluralKebab.slice(0, -1)
  return null
}

// What to pass instead, offered when `guessSingularKebab` will not choose.
function singularHint(pluralKebab) {
  if (pluralKebab.endsWith('zzes')) {
    return `--singular ${pluralKebab.slice(0, -3)} or --singular ${pluralKebab.slice(0, -2)}`
  }
  if (/[sz]es$/.test(pluralKebab)) {
    return `--singular ${pluralKebab.slice(0, -1)} or --singular ${pluralKebab.slice(0, -2)}`
  }
  if (/(?:us|is|ss)$/.test(pluralKebab)) {
    return `a plural name with --singular ${pluralKebab}`
  }
  return `--singular ${pluralKebab}-item`
}

/**
 * Every existing module/feature/contract/model name in the repository, gathered from the
 * filesystem so the collision check never drifts from what is actually there.
 */
export function collectExistingNames(root = repositoryRoot) {
  const backendModules = safeReadDirNames(path.join(root, 'backend/src/modules'))
  const webappFeatures = safeReadDirNames(path.join(root, 'webapp/src/features'))
  const contractFiles = safeReadDirNames(path.join(root, 'packages/contracts/src'))
    .filter((name) => name.endsWith('.ts') && !name.endsWith('.test.ts'))
    .map((name) => name.replace(/\.ts$/, ''))
  const schemaSources = safeReadDirNames(path.join(root, 'backend/prisma/schema'))
    .filter((name) => name.endsWith('.prisma'))
    .map((name) => readFileSync(path.join(root, 'backend/prisma/schema', name), 'utf8'))
  const contractSources = contractFiles.map((name) =>
    readFileSync(path.join(root, 'packages/contracts/src', `${name}.ts`), 'utf8'),
  )

  return {
    backendModules,
    webappFeatures,
    contractFiles,
    prismaModelNames: schemaSources.flatMap((source) => matches(source, /^(?:model|enum)\s+(\w+)/gm)),
    // Field names of `model User`, where the generator adds the feature's back-relation.
    userFields: schemaSources.flatMap((source) =>
      matches(source.match(/^model User \{([\s\S]*?)^\}/m)?.[1] ?? '', /^\s*(\w+)\s+\S/gm),
    ),
    tableNames: schemaSources.flatMap((source) => matches(source, /@@map\("([^"]+)"\)/g)),
    contractExports: contractSources.flatMap(exportedNames),
  }
}

function matches(source, pattern) {
  return [...source.matchAll(pattern)].map((match) => match[1])
}

// Top-level names a TypeScript module exports by declaration; the contracts never use `export { }`.
export function exportedNames(source) {
  return matches(source, /^export\s+(?:const|let|type|interface|enum|class|(?:async\s+)?function)\s+(\w+)/gm)
}

function safeReadDirNames(directory) {
  try {
    return readdirSync(directory, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() || entry.isFile())
      .map((entry) => entry.name)
  } catch (error) {
    if (error?.code === 'ENOENT') return []
    throw error
  }
}

/**
 * Validates the CLI input and derives every casing the templates need. Throws `ScaffoldError`
 * with a message fit to print directly to the user for anything invalid.
 */
export function deriveFeatureNames(pluralKebabInput, singularOverride, existingNames) {
  const pluralKebab = pluralKebabInput ?? ''
  if (!isKebabCase(pluralKebab)) {
    throw new ScaffoldError(
      `"${pluralKebabInput}" is not kebab-case. Use lowercase words separated by single hyphens, e.g. "projects" or "invoice-items".`,
    )
  }
  if (reservedFeatureNames.has(pluralKebab)) {
    throw new ScaffoldError(`"${pluralKebab}" is a reserved name and cannot be scaffolded.`)
  }

  let singularKebab = singularOverride
  if (singularKebab !== undefined) {
    if (!isKebabCase(singularKebab)) {
      throw new ScaffoldError(
        `--singular "${singularKebab}" is not kebab-case. Use lowercase words separated by single hyphens, e.g. "invoice-item".`,
      )
    }
  } else {
    singularKebab = guessSingularKebab(pluralKebab)
    if (singularKebab === null) {
      throw new ScaffoldError(
        `Cannot safely guess the singular of "${pluralKebab}". Pass it explicitly, e.g. ${singularHint(pluralKebab)}.`,
      )
    }
  }

  const names = {
    pluralKebab,
    singularKebab,
    pluralCamel: toCamelCase(pluralKebab),
    singularCamel: toCamelCase(singularKebab),
    pluralPascal: toPascalCase(pluralKebab),
    singularPascal: toPascalCase(singularKebab),
    pluralSnake: toSnakeCase(pluralKebab),
    singularSnake: toSnakeCase(singularKebab),
    // User-facing copy is sentence case (docs/UI.md): "invoice items", "Invoice items".
    pluralWords: toWords(pluralKebab),
    pluralTitle: capitalize(toWords(pluralKebab)),
    singularTitle: capitalize(toWords(singularKebab)),
  }

  const collisions = []
  if (existingNames.backendModules.includes(pluralKebab)) {
    collisions.push(`backend module backend/src/modules/${pluralKebab}`)
  }
  if (existingNames.webappFeatures.includes(pluralKebab)) {
    collisions.push(`webapp feature webapp/src/features/${pluralKebab}`)
  }
  if (existingNames.contractFiles.includes(pluralKebab)) {
    collisions.push(`contracts file packages/contracts/src/${pluralKebab}.ts`)
  }
  if (existingNames.prismaModelNames.includes(names.singularPascal)) {
    collisions.push(`Prisma model ${names.singularPascal}`)
  }
  if (existingNames.prismaModelNames.includes(names.pluralPascal)) {
    collisions.push(`Prisma model ${names.pluralPascal}`)
  }
  if (existingNames.userFields.includes(names.pluralCamel)) {
    collisions.push(`User field "${names.pluralCamel}" (the back-relation it would add)`)
  }
  if (existingNames.tableNames.includes(names.pluralSnake)) {
    collisions.push(`database table or type "${names.pluralSnake}"`)
  }
  const clashingExports = exportedNames(contractsFileTemplate(names)).filter((name) =>
    existingNames.contractExports.includes(name),
  )
  if (clashingExports.length > 0) {
    collisions.push(`contracts export ${clashingExports.join(', ')}`)
  }
  if (collisions.length > 0) {
    throw new ScaffoldError(
      `"${pluralKebab}" collides with the existing ${collisions.join('; ')}. Choose a more specific name, for example "<qualifier>-${pluralKebab}".`,
    )
  }

  return names
}

// ---------------------------------------------------------------------------------------------
// File templates
// ---------------------------------------------------------------------------------------------

function maxPageConstant(n) {
  return `${n.pluralSnake.toUpperCase()}_MAX_PAGE`
}

function contractsFileTemplate(n) {
  return `import { z } from 'zod'

export const ${n.singularCamel}Schema = z
  .object({
    id: z.string(),
    userId: z.string(),
    name: z.string(),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  })
  .strict()

export const create${n.singularPascal}RequestSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
  })
  .strict()

export const create${n.singularPascal}ResponseSchema = z
  .object({
    item: ${n.singularCamel}Schema,
  })
  .strict()

const positiveIntegerQuerySchema = (defaultValue: number, maximum?: number) =>
  z.coerce.number().int().positive().max(maximum ?? Number.MAX_SAFE_INTEGER).default(defaultValue)

export const ${maxPageConstant(n)} = 100

export const list${n.pluralPascal}QuerySchema = z
  .object({
    page: positiveIntegerQuerySchema(1, ${maxPageConstant(n)}),
    pageSize: positiveIntegerQuerySchema(20, 100),
  })
  .strict()

export const list${n.pluralPascal}ResponseSchema = z
  .object({
    items: z.array(${n.singularCamel}Schema),
    page: z.number().int().positive().max(${maxPageConstant(n)}),
    pageSize: z.number().int().positive().max(100),
    total: z.number().int().nonnegative(),
    hasNext: z.boolean(),
  })
  .strict()

export type ${n.singularPascal} = z.infer<typeof ${n.singularCamel}Schema>
export type Create${n.singularPascal}Request = z.infer<typeof create${n.singularPascal}RequestSchema>
export type Create${n.singularPascal}Response = z.infer<typeof create${n.singularPascal}ResponseSchema>
export type List${n.pluralPascal}Query = z.infer<typeof list${n.pluralPascal}QuerySchema>
export type List${n.pluralPascal}Response = z.infer<typeof list${n.pluralPascal}ResponseSchema>
`
}

function backendPortsTemplate(n) {
  return `export type ${n.singularPascal}Record = {
  id: string
  userId: string
  name: string
  createdAt: Date
  updatedAt: Date
}

export type ${n.pluralPascal}Reader = {
  list(input: { userId: string; page: number; pageSize: number }): Promise<{
    items: ${n.singularPascal}Record[]
    total: number
  }>
}

export type ${n.pluralPascal}Writer = {
  create(input: { userId: string; name: string }): Promise<${n.singularPascal}Record>
}
`
}

function backendServiceTemplate(n) {
  return `import type {
  ${n.singularPascal},
  Create${n.singularPascal}Request,
  List${n.pluralPascal}Query,
} from '@web-app-demo/contracts'

import type { ${n.pluralPascal}Reader, ${n.pluralPascal}Writer, ${n.singularPascal}Record } from './ports'

type ${n.pluralPascal}ServiceDependencies = {
  reader: ${n.pluralPascal}Reader
  writer: ${n.pluralPascal}Writer
}

export class ${n.pluralPascal}Service {
  constructor(private readonly dependencies: ${n.pluralPascal}ServiceDependencies) {}

  async list(userId: string, query: List${n.pluralPascal}Query) {
    const { items, total } = await this.dependencies.reader.list({
      userId,
      page: query.page,
      pageSize: query.pageSize,
    })
    return {
      items: items.map((record) => this.toDto(record)),
      page: query.page,
      pageSize: query.pageSize,
      total,
      hasNext: query.page * query.pageSize < total,
    }
  }

  async create(userId: string, input: Create${n.singularPascal}Request) {
    const item = await this.dependencies.writer.create({ userId, name: input.name })
    return { item: this.toDto(item) }
  }

  private toDto(record: ${n.singularPascal}Record): ${n.singularPascal} {
    return {
      id: record.id,
      userId: record.userId,
      name: record.name,
      createdAt: record.createdAt.toISOString(),
      updatedAt: record.updatedAt.toISOString(),
    }
  }
}
`
}

function backendRepositoryTemplate(n) {
  return `import type { DbClient } from '../../../db'
import type { ${n.pluralPascal}Reader, ${n.pluralPascal}Writer } from '../application/ports'

type ${n.pluralPascal}Repository = ${n.pluralPascal}Reader & ${n.pluralPascal}Writer

export function createPrisma${n.pluralPascal}Repository(db: DbClient): ${n.pluralPascal}Repository {
  return {
    async list({ userId, page, pageSize }) {
      const where = { userId }
      const [total, items] = await db.$transaction([
        db.${n.singularCamel}.count({ where }),
        db.${n.singularCamel}.findMany({
          where,
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          skip: (page - 1) * pageSize,
          take: pageSize,
        }),
      ])
      return { items, total }
    },

    create({ userId, name }) {
      return db.${n.singularCamel}.create({ data: { userId, name } })
    },
  }
}
`
}

function backendRoutesTemplate(n) {
  return `import {
  apiErrorSchema,
  create${n.singularPascal}RequestSchema,
  create${n.singularPascal}ResponseSchema,
  list${n.pluralPascal}QuerySchema,
  list${n.pluralPascal}ResponseSchema,
} from '@web-app-demo/contracts'
import { createRoute, OpenAPIHono } from '@hono/zod-openapi'
import type { MiddlewareHandler } from 'hono'

import { validationErrorHook } from '../../../http/errors'
import { ingressErrorResponses } from '../../../http/openapi'
import type { AuthHttpEnv } from '../../auth'
import type { ${n.pluralPascal}Service } from '../application/${n.pluralKebab}-service'

const errorContent = {
  'application/json': {
    schema: apiErrorSchema,
  },
}

const bearerSecurity = [{ BearerAuth: [] }]

const list${n.pluralPascal}Route = createRoute({
  method: 'get',
  path: '/',
  security: bearerSecurity,
  request: {
    query: list${n.pluralPascal}QuerySchema,
  },
  responses: {
    200: {
      content: { 'application/json': { schema: list${n.pluralPascal}ResponseSchema } },
      description: 'Paginated ${n.pluralWords}, scoped to the signed-in user',
    },
    400: { content: errorContent, description: 'Invalid query' },
    401: { content: errorContent, description: 'Authentication required' },
  },
})

const create${n.singularPascal}Route = createRoute({
  method: 'post',
  path: '/',
  security: bearerSecurity,
  request: {
    body: {
      content: {
        'application/json': {
          schema: create${n.singularPascal}RequestSchema,
        },
      },
    },
  },
  responses: {
    // The body limit and rate limit that app.ts mounts on this path answer 413 and 429.
    ...ingressErrorResponses,
    201: {
      content: { 'application/json': { schema: create${n.singularPascal}ResponseSchema } },
      description: 'Created ${toWords(n.singularKebab)}, owned by the signed-in user',
    },
    400: { content: errorContent, description: 'Invalid payload' },
    401: { content: errorContent, description: 'Authentication required' },
  },
})

type Create${n.pluralPascal}RoutesOptions = {
  requireAuth: MiddlewareHandler<AuthHttpEnv>
  service: ${n.pluralPascal}Service
}

export function create${n.pluralPascal}Routes({ requireAuth, service }: Create${n.pluralPascal}RoutesOptions) {
  const routes = new OpenAPIHono<AuthHttpEnv>({ defaultHook: validationErrorHook })

  routes.use('*', requireAuth)
  routes.openapi(list${n.pluralPascal}Route, async (c) => {
    return c.json(await service.list(c.var.user.id, c.req.valid('query')), 200)
  })
  routes.openapi(create${n.singularPascal}Route, async (c) => {
    return c.json(await service.create(c.var.user.id, c.req.valid('json')), 201)
  })

  return routes
}
`
}

function backendIndexTemplate(n) {
  return `import type { MiddlewareHandler } from 'hono'

import type { DbClient } from '../../db'
import type { AuthHttpEnv } from '../auth'
import { ${n.pluralPascal}Service } from './application/${n.pluralKebab}-service'
import { createPrisma${n.pluralPascal}Repository } from './infrastructure/${n.pluralKebab}-repository'
import { create${n.pluralPascal}Routes } from './transport/routes'

type Create${n.pluralPascal}ModuleOptions = {
  db: DbClient
  requireAuth: MiddlewareHandler<AuthHttpEnv>
}

export function create${n.pluralPascal}Module(options: Create${n.pluralPascal}ModuleOptions) {
  const repository = createPrisma${n.pluralPascal}Repository(options.db)
  const service = new ${n.pluralPascal}Service({ reader: repository, writer: repository })

  return {
    routes: create${n.pluralPascal}Routes({ requireAuth: options.requireAuth, service }),
  }
}
`
}

function backendIntegrationTestTemplate(n) {
  return `import { afterAll, beforeEach, describe, expect, test } from 'bun:test'

import { createApp } from '../../app'
import { createPrisma } from '../../db'
import { loadEnv } from '../../env'

const databaseUrl = process.env.TEST_DATABASE_URL
if (!databaseUrl) throw new Error('TEST_DATABASE_URL is required; run bun run test:backend:integration')

describe('${n.pluralKebab} API integration', () => {
  const env = loadEnv({
    DATABASE_URL: databaseUrl,
    JWT_SECRET: '12345678901234567890123456789012',
    CORS_ORIGINS: 'http://localhost:5173',
    ACCESS_TOKEN_TTL_SECONDS: '60',
  })
  const prisma = createPrisma(databaseUrl)
  const app = createApp({ env, prisma })

  beforeEach(async () => {
    await prisma.${n.singularCamel}.deleteMany()
    await prisma.authSession.deleteMany()
    await prisma.user.deleteMany()
  })

  afterAll(async () => {
    await prisma.$disconnect()
  })

  test('requires a session', async () => {
    const response = await app.request('/api/${n.pluralKebab}')
    expect(response.status).toBe(401)
  })

  test('rejects an empty name', async () => {
    const session = await register('creator@example.com')

    const response = await app.request('/api/${n.pluralKebab}', {
      method: 'POST',
      headers: authenticatedJsonHeaders(session.accessToken),
      body: JSON.stringify({ name: '  ' }),
    })

    expect(response.status).toBe(400)
    expect((await response.json()).error.code).toBe('VALIDATION_ERROR')
  })

  test('creates an item and lists it back for its owner', async () => {
    const session = await register('owner@example.com')

    const create = await app.request('/api/${n.pluralKebab}', {
      method: 'POST',
      headers: authenticatedJsonHeaders(session.accessToken),
      body: JSON.stringify({ name: 'First item' }),
    })
    expect(create.status).toBe(201)
    const created = (await create.json()).item
    expect(created).toMatchObject({ name: 'First item', userId: session.user.id })

    const list = await app.request('/api/${n.pluralKebab}', {
      headers: authenticatedHeaders(session.accessToken),
    })
    expect(list.status).toBe(200)
    const body = await list.json()
    expect(body.items).toEqual([created])
    expect(body.total).toBe(1)
  })

  test('keeps items private to their owner', async () => {
    const owner = await register('owner2@example.com')
    const other = await register('other@example.com')

    await app.request('/api/${n.pluralKebab}', {
      method: 'POST',
      headers: authenticatedJsonHeaders(owner.accessToken),
      body: JSON.stringify({ name: 'Owner only' }),
    })

    const list = await app.request('/api/${n.pluralKebab}', {
      headers: authenticatedHeaders(other.accessToken),
    })
    expect((await list.json()).items).toEqual([])
  })

  test('paginates results', async () => {
    const session = await register('pager@example.com')
    for (let index = 0; index < 3; index += 1) {
      const response = await app.request('/api/${n.pluralKebab}', {
        method: 'POST',
        headers: authenticatedJsonHeaders(session.accessToken),
        body: JSON.stringify({ name: \`Item \${index}\` }),
      })
      expect(response.status).toBe(201)
    }

    const firstPage = await app.request('/api/${n.pluralKebab}?page=1&pageSize=2', {
      headers: authenticatedHeaders(session.accessToken),
    })
    const firstBody = await firstPage.json()
    expect(firstBody.items).toHaveLength(2)
    expect(firstBody.total).toBe(3)
    expect(firstBody.hasNext).toBe(true)

    const secondPage = await app.request('/api/${n.pluralKebab}?page=2&pageSize=2', {
      headers: authenticatedHeaders(session.accessToken),
    })
    const secondBody = await secondPage.json()
    expect(secondBody.items).toHaveLength(1)
    expect(secondBody.hasNext).toBe(false)
  })

  async function register(email: string) {
    const response = await app.request('/api/auth/token/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password: 'password123' }),
    })
    expect(response.status).toBe(201)
    return response.json() as Promise<{ accessToken: string; user: { id: string } }>
  }
})

function authenticatedHeaders(accessToken: string) {
  return {
    Authorization: \`Bearer \${accessToken}\`,
  }
}

function authenticatedJsonHeaders(accessToken: string) {
  return {
    ...authenticatedHeaders(accessToken),
    'Content-Type': 'application/json',
  }
}
`
}

function prismaModelTemplate(n) {
  return `model ${n.singularPascal} {
  id        String   @id @default(dbgenerated("uuidv7()")) @db.Uuid
  userId    String   @map("user_id") @db.Uuid
  name      String
  createdAt DateTime @default(now()) @map("created_at")
  updatedAt DateTime @updatedAt @map("updated_at")
  user      User     @relation(fields: [userId], references: [id], onDelete: Cascade, map: "${n.pluralSnake}_user_id_fkey")

  @@index([userId, createdAt], map: "${n.pluralSnake}_user_id_created_at_idx")
  @@map("${n.pluralSnake}")
}
`
}

function webappApiTemplate(n) {
  return `import {
  create${n.singularPascal}RequestSchema,
  create${n.singularPascal}ResponseSchema,
  list${n.pluralPascal}QuerySchema,
  list${n.pluralPascal}ResponseSchema,
  type Create${n.singularPascal}Request,
  type List${n.pluralPascal}Query,
} from '@web-app-demo/contracts'

import type { AuthenticatedTransport } from '@/platform/api'

export function list${n.pluralPascal}(
  transport: AuthenticatedTransport,
  input: List${n.pluralPascal}Query,
  options: { signal?: AbortSignal } = {},
) {
  const query = list${n.pluralPascal}QuerySchema.parse(input)
  const search = new URLSearchParams({
    page: String(query.page),
    pageSize: String(query.pageSize),
  })
  return transport.request(\`/api/${n.pluralKebab}?\${search}\`, list${n.pluralPascal}ResponseSchema, options)
}

export function create${n.singularPascal}(
  transport: AuthenticatedTransport,
  input: Create${n.singularPascal}Request,
) {
  return transport.request(
    '/api/${n.pluralKebab}',
    create${n.singularPascal}ResponseSchema,
    {
      method: 'POST',
      body: create${n.singularPascal}RequestSchema.parse(input),
    },
  )
}
`
}

function webappQueriesTemplate(n) {
  return `import { queryOptions, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { List${n.pluralPascal}Query } from '@web-app-demo/contracts'

import { useAuth } from '@/features/auth'
import type { AuthenticatedTransport } from '@/platform/api'
// Fixed aliases: a feature name must never make its own API functions shadow an import above.
import { create${n.singularPascal} as createRecord, list${n.pluralPascal} as listRecords } from './api'

const ${n.pluralCamel}QueryKeys = {
  all: ['session', '${n.pluralKebab}'] as const,
  list: (query: List${n.pluralPascal}Query) => [...${n.pluralCamel}QueryKeys.all, 'list', query] as const,
}

export function ${n.pluralCamel}QueryOptions(transport: AuthenticatedTransport, query: List${n.pluralPascal}Query) {
  return queryOptions({
    queryKey: ${n.pluralCamel}QueryKeys.list(query),
    queryFn: ({ signal }) => listRecords(transport, query, { signal }),
  })
}

export function use${n.pluralPascal}Query(query: List${n.pluralPascal}Query) {
  const auth = useAuth()
  return useQuery(${n.pluralCamel}QueryOptions(auth.transport, query))
}

export function useCreate${n.singularPascal}Mutation() {
  const auth = useAuth()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (name: string) => createRecord(auth.transport, { name }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ${n.pluralCamel}QueryKeys.all })
    },
  })
}
`
}

function webappModelTemplate(n) {
  return `import {
  ${maxPageConstant(n)},
  create${n.singularPascal}RequestSchema,
  type Create${n.singularPascal}Request,
} from '@web-app-demo/contracts'

export type ${n.singularPascal}FormValidation =
  | { request: Create${n.singularPascal}Request; error: null }
  | { request: null; error: string }

/**
 * Runs the create form through the shared request contract so the client accepts exactly what
 * the server does. Kept as a pure function so it is testable without rendering anything.
 */
export function validateCreate${n.singularPascal}Form(name: string): ${n.singularPascal}FormValidation {
  const result = create${n.singularPascal}RequestSchema.safeParse({ name })
  if (result.success) return { request: result.data, error: null }
  return { request: null, error: result.error.issues[0]?.message ?? 'Invalid value' }
}

export function ${n.pluralCamel}ViewState({
  isError,
  isPending,
  itemCount,
}: {
  isError: boolean
  isPending: boolean
  itemCount?: number
}): 'loading' | 'error' | 'empty' | 'ready' {
  if (isPending) return 'loading'
  if (isError) return 'error'
  return itemCount === 0 ? 'empty' : 'ready'
}

/**
 * Whether the list can page forward: the server reports more items, and the next page is still
 * one the list query accepts (it rejects a page above ${maxPageConstant(n)}).
 */
export function ${n.pluralCamel}CanGoNext({ hasNext, page }: { hasNext: boolean; page: number }) {
  return hasNext && page < ${maxPageConstant(n)}
}
`
}

function webappListComponentTemplate(n) {
  // The contract type and the feature's own model and hooks are imported under fixed aliases: their
  // names derive from the feature name and can equal a shared import below (a feature called
  // "items" has a contract type `Item`, like `@/components/ui/item`; one called "media" has a list
  // hook `useMediaQuery`, like `@/hooks/use-media-query`). Local component names do not end in
  // "List", so none can equal the exported `<Plural>List` either.
  return `import type { ${n.singularPascal} as ListedRecord } from '@web-app-demo/contracts'
import { useId, useState, type FormEvent } from 'react'

import { DataTableFrame } from '@/components/dashboard'
import { Alert, AlertAction, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from '@/components/ui/empty'
import { Field, FieldError, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Item } from '@/components/ui/item'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Typography } from '@/components/typography'
import { errorId, hasErrors } from '@/features/auth'
import { useMediaQuery } from '@/hooks/use-media-query'
import { formatDate } from '@/platform/intl'
import {
  ${n.pluralCamel}CanGoNext as canGoNext,
  ${n.pluralCamel}ViewState as listViewState,
  validateCreate${n.singularPascal}Form as validateCreateForm,
} from './model'
import {
  useCreate${n.singularPascal}Mutation as useCreateRecordMutation,
  use${n.pluralPascal}Query as useRecordsQuery,
} from './queries'

// Tailwind's "sm" breakpoint; see webapp/src/features/admin/UserDirectory.tsx for why the table
// and the list are two different markups rather than one squeezed into a column with CSS.
const tableViewportQuery = '(min-width: 40rem)'

export function ${n.pluralPascal}List() {
  const nameErrorId = useId()
  const [page, setPage] = useState(1)
  const [draftName, setDraftName] = useState('')
  const pageSize = 20
  const fitsTable = useMediaQuery(tableViewportQuery)
  const itemsQuery = useRecordsQuery({ page, pageSize })
  const createMutation = useCreateRecordMutation()
  const viewState = listViewState({
    isError: itemsQuery.isError,
    isPending: itemsQuery.isPending,
    itemCount: itemsQuery.data?.items.length,
  })
  const validation = validateCreateForm(draftName)
  const nameErrors = draftName.length > 0 && validation.error ? [{ message: validation.error }] : undefined
  const nameInvalid = hasErrors(nameErrors)

  const submitCreate = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!validation.request) return
    createMutation.mutate(validation.request.name, {
      onSuccess: () => {
        setDraftName('')
        setPage(1)
      },
    })
  }

  const summary = itemsQuery.data
    ? \`Page \${itemsQuery.data.page} · \${itemsQuery.data.total} ${n.pluralWords}\`
    : viewState === 'error'
      ? '${n.pluralTitle} unavailable'
      : 'Loading ${n.pluralWords}'

  return (
    <div className="grid gap-6">
      <form className="grid gap-3" noValidate onSubmit={submitCreate}>
        <FieldGroup>
          <Field data-invalid={nameInvalid}>
            <FieldLabel className="sr-only" htmlFor="${n.singularKebab}-name">
              Name
            </FieldLabel>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Input
                aria-describedby={errorId(nameErrors, nameErrorId)}
                aria-invalid={nameInvalid}
                data-testid="${n.singularKebab}-name-input"
                disabled={createMutation.isPending}
                id="${n.singularKebab}-name"
                onChange={(event) => {
                  setDraftName(event.target.value)
                  createMutation.reset()
                }}
                placeholder="Name"
                value={draftName}
              />
              <Button
                data-testid="${n.singularKebab}-create-submit"
                disabled={createMutation.isPending || draftName.trim().length === 0}
                type="submit"
              >
                {createMutation.isPending ? 'Creating…' : 'Create'}
              </Button>
            </div>
            <FieldError errors={nameErrors} id={nameErrorId} />
          </Field>
        </FieldGroup>

        {createMutation.isError && (
          <Alert data-testid="${n.singularKebab}-create-error" variant="destructive">
            <AlertTitle>${n.singularTitle} was not created</AlertTitle>
            <AlertDescription>{createMutation.error.message}</AlertDescription>
          </Alert>
        )}
        {createMutation.isSuccess && (
          <Alert data-testid="${n.singularKebab}-create-success">
            <AlertTitle>${n.singularTitle} created</AlertTitle>
            <AlertDescription>{createMutation.data.item.name} was added.</AlertDescription>
          </Alert>
        )}
      </form>

      <DataTableFrame
        nextDisabled={!itemsQuery.data || !canGoNext(itemsQuery.data)}
        onNext={() => setPage((current) => current + 1)}
        onPrevious={() => setPage((current) => Math.max(1, current - 1))}
        previousDisabled={page <= 1}
        summary={summary}
        title="${n.pluralTitle}"
      >
        {viewState === 'loading' && <ListLoading />}
        {viewState === 'error' && itemsQuery.isError && (
          <ListError error={itemsQuery.error} onRetry={() => void itemsQuery.refetch()} />
        )}
        {viewState === 'empty' && <ListEmpty />}
        {viewState === 'ready' && itemsQuery.data && (
          fitsTable ? (
            <ItemTable items={itemsQuery.data.items} />
          ) : (
            <ItemCards items={itemsQuery.data.items} />
          )
        )}
      </DataTableFrame>
    </div>
  )
}

function ItemTable({ items }: { items: ReadonlyArray<ListedRecord> }) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Name</TableHead>
          <TableHead>Created</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {items.map((item) => (
          <TableRow data-testid="${n.singularKebab}-row" key={item.id}>
            <TableCell>
              <Typography variant="bodySmMedium">{item.name}</Typography>
            </TableCell>
            <TableCell>
              <Typography as="span" className="tabular-nums" variant="bodySm">
                {formatDate(item.createdAt)}
              </Typography>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}

function ItemCards({ items }: { items: ReadonlyArray<ListedRecord> }) {
  return (
    <ul aria-label="${n.pluralTitle}" className="grid gap-3" role="list">
      {items.map((item) => (
        <Item asChild key={item.id} variant="outline">
          <li data-testid="${n.singularKebab}-row">
            <dl className="flex w-full items-center justify-between gap-4">
              <div className="grid min-w-0">
                <Typography as="dt" variant="srOnly">Name</Typography>
                <dd><Typography variant="bodySmMedium">{item.name}</Typography></dd>
              </div>
              <div>
                <Typography as="dt" variant="srOnly">Created</Typography>
                <dd><Typography variant="bodySm">{formatDate(item.createdAt)}</Typography></dd>
              </div>
            </dl>
          </li>
        </Item>
      ))}
    </ul>
  )
}

function ListLoading() {
  return (
    <div aria-label="Loading ${n.pluralWords}" className="grid gap-3 py-2" role="status">
      <Skeleton className="h-12 w-full" />
      <Skeleton className="h-12 w-full" />
      <Skeleton className="h-12 w-full" />
    </div>
  )
}

function ListError({ error, onRetry }: { error: Error; onRetry: () => void }) {
  return (
    <Alert variant="destructive">
      <AlertTitle>${n.pluralTitle} are unavailable</AlertTitle>
      <AlertDescription>{error.message}</AlertDescription>
      <AlertAction>
        <Button onClick={onRetry} size="sm" type="button" variant="outline">
          Try again
        </Button>
      </AlertAction>
    </Alert>
  )
}

function ListEmpty() {
  return (
    <Empty>
      <EmptyHeader>
        <EmptyTitle>No ${n.pluralWords} yet</EmptyTitle>
        <EmptyDescription>Create the first one above.</EmptyDescription>
      </EmptyHeader>
    </Empty>
  )
}
`
}

function webappPagesTemplate(n) {
  return `import { PageContainer, PageHeader } from '@/components/PageLayout'
import { ${n.pluralPascal}List } from './${n.pluralPascal}List'

export function ${n.pluralPascal}Page() {
  return (
    <PageContainer>
      <PageHeader
        description="Your ${n.pluralWords}, created and listed here."
        title="${n.pluralTitle}"
      />
      <${n.pluralPascal}List />
    </PageContainer>
  )
}
`
}

function webappIndexTemplate(n) {
  return `export { ${n.pluralPascal}Page } from './pages'
`
}

function webappModelTestTemplate(n) {
  return `import { expect, test } from 'bun:test'
import { ${maxPageConstant(n)} } from '@web-app-demo/contracts'

import {
  ${n.pluralCamel}CanGoNext,
  ${n.pluralCamel}ViewState,
  validateCreate${n.singularPascal}Form,
} from '../src/features/${n.pluralKebab}/model'

test('rejects an empty or whitespace-only name', () => {
  expect(validateCreate${n.singularPascal}Form('').error).not.toBeNull()
  expect(validateCreate${n.singularPascal}Form('   ').error).not.toBeNull()
})

test('trims and accepts a valid name', () => {
  expect(validateCreate${n.singularPascal}Form('  Widget  ')).toEqual({
    request: { name: 'Widget' },
    error: null,
  })
})

test('view state reflects loading, error, empty, and ready', () => {
  expect(${n.pluralCamel}ViewState({ isError: false, isPending: true })).toBe('loading')
  expect(${n.pluralCamel}ViewState({ isError: true, isPending: false })).toBe('error')
  expect(${n.pluralCamel}ViewState({ isError: false, isPending: false, itemCount: 0 })).toBe('empty')
  expect(${n.pluralCamel}ViewState({ isError: false, isPending: false, itemCount: 2 })).toBe('ready')
})

test('pages forward only while the server reports more items and the next page is allowed', () => {
  expect(${n.pluralCamel}CanGoNext({ hasNext: true, page: 1 })).toBe(true)
  expect(${n.pluralCamel}CanGoNext({ hasNext: false, page: 1 })).toBe(false)
  expect(${n.pluralCamel}CanGoNext({ hasNext: true, page: ${maxPageConstant(n)} })).toBe(false)
})
`
}

// ---------------------------------------------------------------------------------------------
// Generated file list
// ---------------------------------------------------------------------------------------------

export function generatedFiles(n) {
  return [
    { path: `packages/contracts/src/${n.pluralKebab}.ts`, content: contractsFileTemplate(n) },
    {
      path: `backend/src/modules/${n.pluralKebab}/application/ports.ts`,
      content: backendPortsTemplate(n),
    },
    {
      path: `backend/src/modules/${n.pluralKebab}/application/${n.pluralKebab}-service.ts`,
      content: backendServiceTemplate(n),
    },
    {
      path: `backend/src/modules/${n.pluralKebab}/infrastructure/${n.pluralKebab}-repository.ts`,
      content: backendRepositoryTemplate(n),
    },
    {
      path: `backend/src/modules/${n.pluralKebab}/transport/routes.ts`,
      content: backendRoutesTemplate(n),
    },
    { path: `backend/src/modules/${n.pluralKebab}/index.ts`, content: backendIndexTemplate(n) },
    {
      path: `backend/src/modules/${n.pluralKebab}/${n.pluralKebab}.integration.test.ts`,
      content: backendIntegrationTestTemplate(n),
    },
    { path: `backend/prisma/schema/${n.pluralKebab}.prisma`, content: prismaModelTemplate(n) },
    { path: `webapp/src/features/${n.pluralKebab}/api.ts`, content: webappApiTemplate(n) },
    { path: `webapp/src/features/${n.pluralKebab}/queries.ts`, content: webappQueriesTemplate(n) },
    { path: `webapp/src/features/${n.pluralKebab}/model.ts`, content: webappModelTemplate(n) },
    {
      path: `webapp/src/features/${n.pluralKebab}/${n.pluralPascal}List.tsx`,
      content: webappListComponentTemplate(n),
    },
    { path: `webapp/src/features/${n.pluralKebab}/pages.tsx`, content: webappPagesTemplate(n) },
    { path: `webapp/src/features/${n.pluralKebab}/index.ts`, content: webappIndexTemplate(n) },
    { path: `webapp/tests/${n.pluralKebab}-model.test.ts`, content: webappModelTestTemplate(n) },
  ]
}

// ---------------------------------------------------------------------------------------------
// Marker-based edits to shared files
// ---------------------------------------------------------------------------------------------

// `declares`: the identifiers and quoted literals (paths, module specifiers) the inserted lines
// introduce into the edited file. Each must not already occur there, or the file would declare a
// name twice, register a route twice, or repeat an object key.
function markerEdit(filePath, marker, insertedLines, declares = []) {
  return { filePath, marker, insertedLines, declares }
}

export function markerEdits(n) {
  const appPath = `'/app/${n.pluralKebab}'`
  return [
    markerEdit(
      'packages/contracts/src/index.ts',
      '// scaffold:contracts-exports',
      [`export * from './${n.pluralKebab}'`],
      [`'./${n.pluralKebab}'`],
    ),
    markerEdit(
      'backend/src/app.ts',
      '// scaffold:import',
      [`import { create${n.pluralPascal}Module } from './modules/${n.pluralKebab}'`],
      [`create${n.pluralPascal}Module`, `'./modules/${n.pluralKebab}'`],
    ),
    markerEdit(
      'backend/src/app.ts',
      '// scaffold:module',
      [`const ${n.pluralCamel} = create${n.pluralPascal}Module({ db: prisma, requireAuth: auth.requireAuth })`],
      [n.pluralCamel],
    ),
    markerEdit(
      'backend/src/app.ts',
      '// scaffold:security',
      [`app.use('/api/${n.pluralKebab}/*', middleware)`],
      [`'/api/${n.pluralKebab}/*'`],
    ),
    markerEdit(
      'backend/src/app.ts',
      '// scaffold:route-mount',
      [`app.route('/api/${n.pluralKebab}', ${n.pluralCamel}.routes)`],
      [`'/api/${n.pluralKebab}'`],
    ),
    // The back-relation field is checked against the parsed User model in deriveFeatureNames.
    markerEdit('backend/prisma/schema/base.prisma', '// scaffold:user-relations', [
      `  ${n.pluralCamel}${' '.repeat(Math.max(1, 20 - n.pluralCamel.length))}${n.singularPascal}[]`,
    ]),
    markerEdit(
      'webapp/src/routes.tsx',
      '// scaffold:route-definitions',
      [
        `const ${n.pluralCamel}Route = createRoute({`,
        '  getParentRoute: () => userWorkspaceRoute,',
        `  path: ${appPath},`,
        `  component: lazyRouteComponent(() => import('@/features/${n.pluralKebab}'), '${n.pluralPascal}Page'),`,
        '})',
        '',
      ],
      [`${n.pluralCamel}Route`, appPath, `'@/features/${n.pluralKebab}'`],
    ),
    markerEdit('webapp/src/routes.tsx', '// scaffold:route-children', [`    ${n.pluralCamel}Route,`]),
    markerEdit('webapp/src/features/navigation/model.ts', '// scaffold:route', [`    ${appPath},`], [appPath]),
    markerEdit('webapp/src/features/navigation/model.ts', '// scaffold:nav-item', [
      `    { label: '${n.pluralTitle}', to: ${appPath} },`,
    ]),
    // WorkspaceShell's sidebar icon map is keyed by the exact same literal paths as
    // `workspaceRoutesByRole`, and TypeScript rejects an index that is not one of its keys - so
    // a new nav item needs an icon entry here too, or `webapp` fails to typecheck. Reusing an
    // icon already imported there keeps this a single-line, import-free insertion; rename it by
    // hand once the feature has a more fitting one.
    markerEdit(
      'webapp/src/components/WorkspaceShell.tsx',
      '// scaffold:nav-icon',
      [`${appPath}: DashboardSquare01Icon,`],
      [appPath],
    ),
  ]
}

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

// Drops `//` and `/* */` comments, so a word in a comment (the markers included) is not mistaken
// for a declaration. A comment must start a line or follow whitespace, which keeps `http://` and
// a route pattern such as `'/api/users/*'` intact.
function stripComments(source) {
  return source.replace(/(^|\s)\/\*[\s\S]*?\*\//g, '$1').replace(/(^|\s)\/\/.*$/gm, '$1')
}

// Empties string and template literals, so an identifier is not matched inside text such as
// `'./background-tasks'` or an error message.
function stripStrings(source) {
  return source.replace(/'(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"|`(?:[^`\\]|\\.)*`/g, "''")
}

const identifierPattern = /^[A-Za-z_$][\w$]*$/

/**
 * Every `declares` entry of `edits` that already occurs in the original contents of the file it
 * would be inserted into (`fileContents`: relative path -> current text), ignoring comments.
 * An identifier counts only where it could be a binding: outside strings, not after `.` (a
 * property access such as `auth.routes`), and not before `:` (an object key). A quoted literal
 * counts wherever it occurs.
 */
export function declarationClashes(fileContents, edits) {
  const clashes = []
  for (const edit of edits) {
    const code = stripComments(fileContents.get(edit.filePath) ?? '')
    const codeWithoutStrings = stripStrings(code)
    for (const token of edit.declares) {
      const escaped = escapeRegExp(token)
      const found = identifierPattern.test(token)
        ? new RegExp(`(?<![\\w$.])${escaped}(?![\\w$])(?!\\s*:)`).test(codeWithoutStrings)
        : new RegExp(`(?<![\\w$])${escaped}(?![\\w$])`).test(code)
      if (found) clashes.push(`${token} already occurs in ${edit.filePath}`)
    }
  }
  return clashes
}

/**
 * Applies every marker edit to file contents already read into memory (`fileContents`: absolute
 * path -> current text), returning the updated map. Throws `ScaffoldError` naming the first
 * marker it cannot find, without touching disk - callers should read, then apply, then write,
 * only once every marker in the batch has resolved.
 */
export function applyMarkerEdits(fileContents, edits) {
  const updated = new Map(fileContents)
  for (const edit of edits) {
    const current = updated.get(edit.filePath)
    if (current === undefined) {
      throw new ScaffoldError(`Cannot apply marker edit: ${edit.filePath} was not read.`)
    }
    const lines = current.split('\n')
    const index = lines.findIndex((line) => line.includes(edit.marker))
    if (index === -1) {
      throw new ScaffoldError(
        `Marker "${edit.marker}" was not found in ${edit.filePath}. Add the marker comment there before running the generator again.`,
      )
    }
    const indent = lines[index].match(/^\s*/)?.[0] ?? ''
    const inserted = edit.insertedLines.map((line) => (line.length > 0 ? indent + line : line))
    lines.splice(index, 0, ...inserted)
    updated.set(edit.filePath, lines.join('\n'))
  }
  return updated
}

// ---------------------------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------------------------

function parseArgs(argv) {
  let name
  let singular
  let dryRun = false

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--dry-run') {
      dryRun = true
    } else if (arg === '--singular') {
      singular = argv[index + 1]
      index += 1
    } else if (!arg.startsWith('-') && name === undefined) {
      name = arg
    } else {
      throw new ScaffoldError(`Unrecognized argument: ${arg}`)
    }
  }
  if (!name) {
    throw new ScaffoldError('Usage: bun run scaffold:feature <plural-kebab-name> [--singular <word>] [--dry-run]')
  }
  return { name, singular, dryRun }
}

// Runs in its own process group, so a signal handler can stop it together with whatever
// `bun run` starts underneath; `signal` (an AbortSignal) is how writeScaffold asks for that.
function prismaGenerate(root, { signal } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn('bun', ['run', '--cwd', 'backend', 'prisma:generate'], {
      cwd: root,
      detached: true,
      stdio: 'inherit',
    })
    const stop = () => {
      try {
        process.kill(-child.pid, 'SIGTERM')
      } catch {
        // Already exited.
      }
    }
    signal?.addEventListener('abort', stop, { once: true })
    child.once('error', (error) => {
      signal?.removeEventListener('abort', stop)
      reject(new ScaffoldError(`Could not start prisma:generate: ${error.message}.`))
    })
    child.once('exit', (code) => {
      signal?.removeEventListener('abort', stop)
      if (code === 0) resolve()
      else reject(new ScaffoldError('bun run --cwd backend prisma:generate failed.'))
    })
  })
}

// The directory closest to the root among `directory` and its ancestors that does not exist yet:
// removing it removes everything `mkdirSync(directory, { recursive: true })` is about to create.
function outermostMissingDirectory(root, directory) {
  let missing
  for (let current = directory; current !== root && !existsSync(current); current = path.dirname(current)) {
    missing = current
  }
  return missing
}

const signalExitCodes = { SIGINT: 130, SIGTERM: 143 }

/**
 * Writes the generated files and the marker edits, then runs `generate` (Prisma client
 * generation by default). If any step throws, it deletes every file and directory it created,
 * restores every edited file, and rethrows: the tree is left exactly as it was. A SIGINT or
 * SIGTERM in that window does the same, stops `generate`, and exits with 130 or 143. The writes
 * are synchronous, so a signal that arrives during them is handled once `generate` is awaited,
 * with everything written so far on the rollback list.
 */
async function writeScaffold(root, files, originalContents, updatedContents, generate) {
  const createdPaths = []
  let rolledBack = false
  const rollback = () => {
    if (rolledBack) return
    rolledBack = true
    for (const createdPath of createdPaths.reverse()) rmSync(createdPath, { recursive: true, force: true })
    for (const [relativePath, content] of originalContents) {
      writeFileSync(path.join(root, relativePath), content)
    }
  }
  const generation = new AbortController()
  const onSignal = (signal) => {
    generation.abort()
    rollback()
    console.error(`[scaffold:feature] Interrupted by ${signal}. Every change was rolled back; the tree is as it was before the run.`)
    process.exit(signalExitCodes[signal])
  }
  process.on('SIGINT', onSignal)
  process.on('SIGTERM', onSignal)

  try {
    for (const file of files) {
      const absolutePath = path.join(root, file.path)
      const newDirectory = outermostMissingDirectory(root, path.dirname(absolutePath))
      mkdirSync(path.dirname(absolutePath), { recursive: true })
      if (newDirectory) createdPaths.push(newDirectory)
      // `wx` refuses to replace a file that appeared since the existence check.
      writeFileSync(absolutePath, file.content, { flag: 'wx' })
      createdPaths.push(absolutePath)
    }
    for (const [relativePath, content] of updatedContents) {
      writeFileSync(path.join(root, relativePath), content)
    }
    await generate(root, { signal: generation.signal })
  } catch (error) {
    rollback()
    const reason = error instanceof Error ? error.message : String(error)
    throw new ScaffoldError(`${reason} Every change was rolled back; the tree is as it was before the run.`)
  } finally {
    process.off('SIGINT', onSignal)
    process.off('SIGTERM', onSignal)
  }
}

/**
 * The CLI, callable in-process. `generate` and `log` are injectable so a test can make the last
 * step fail and check that nothing is left behind.
 */
export async function runScaffold(argv, root = repositoryRoot, { generate = prismaGenerate, log = console.log } = {}) {
  const { name, singular, dryRun } = parseArgs(argv)
  const names = deriveFeatureNames(name, singular, collectExistingNames(root))
  const files = generatedFiles(names)
  const edits = markerEdits(names)

  for (const file of files) {
    if (existsSync(path.join(root, file.path))) {
      throw new ScaffoldError(`Refusing to overwrite existing file: ${file.path}`)
    }
  }

  const editedPaths = [...new Set(edits.map((edit) => edit.filePath))]
  const fileContents = new Map(
    editedPaths.map((relativePath) => [relativePath, readFileSync(path.join(root, relativePath), 'utf8')]),
  )
  const clashes = declarationClashes(fileContents, edits)
  if (clashes.length > 0) {
    throw new ScaffoldError(
      `"${names.pluralKebab}" would declare names or paths that already exist: ${clashes.join('; ')}. Choose a more specific name, for example "<qualifier>-${names.pluralKebab}".`,
    )
  }
  const updatedContents = applyMarkerEdits(fileContents, edits)

  log(
    `Feature "${names.pluralKebab}": singular "${names.singularKebab}" (Prisma model ${names.singularPascal}, ` +
      `table ${names.pluralSnake}, route /app/${names.pluralKebab}). If the singular is wrong, rerun with --singular <word>.`,
  )

  if (dryRun) {
    log(`Would create ${files.length} files:`)
    for (const file of files) log(`  create  ${file.path}`)
    log(`Would edit ${editedPaths.length} files:`)
    for (const editedPath of editedPaths) log(`  edit    ${editedPath}`)
    return
  }

  await writeScaffold(root, files, fileContents, updatedContents, generate)

  log(`Created ${files.length} files and updated ${editedPaths.length} files for "${names.pluralKebab}".`)
  log('')
  log('Remaining steps:')
  log(`  1. Start a development database, then run:`)
  log(`       bun run --cwd backend prisma:migrate -- --name add_${names.pluralSnake}`)
  log(`  2. bun run test:backend:integration -- src/modules/${names.pluralKebab}/${names.pluralKebab}.integration.test.ts`)
  log(`  3. bun run test:webapp`)
  log(`  4. bun run screens -- -g "/app/${names.pluralKebab}"`)
  log(`  5. Add a "${names.pluralPascal}" row to the CHECKLIST.md capability registry.`)
}

if (import.meta.main) {
  try {
    await runScaffold(process.argv.slice(2))
  } catch (error) {
    if (error instanceof ScaffoldError) {
      console.error(`[scaffold:feature] ${error.message}`)
      process.exitCode = 1
    } else {
      throw error
    }
  }
}
