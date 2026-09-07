/**
 * Child process for `zod-compile.test.ts`: `bun src/zod-compile.probe.ts <composition-root|plain>`.
 *
 * `composition-root` loads `./app` first, exactly as production does, so the contract schemas are
 * constructed after `zod/compile` installed its post-processor and compile on their first parse.
 * `plain` loads the contracts alone and parses with Zod's runtime interpreter. The test compares
 * the two reports: the same inputs must be accepted, rejected, and transformed identically.
 *
 * Compilation is observed through the one effect it has outside Zod: the compiler builds the fast
 * path with the global `Function` constructor, the eval-like code generation that
 * `z.config({ jitless: true })` exists to switch off. The probe schema is a plain string schema
 * because Zod's runtime already generates code for object schemas on its own; only a non-object
 * schema tells the composition root's compilation apart from Zod's defaults.
 *
 * A separate process per mode is deliberate: the unit suite shares one module cache, which would
 * hide an import-order regression that loads Zod or the contracts before `zod/compile`.
 */

type Contracts = typeof import('@web-app-demo/contracts')

type SchemaCase = {
  name: string
  schema: { safeParse(input: unknown): { success: boolean; data?: unknown; error?: { issues: unknown[] } } }
  inputs: unknown[]
}

export type ParseOutcome =
  | { input: unknown; success: true; data: unknown }
  | { input: unknown; success: false; issues: unknown[] }

export type ProbeReport = {
  /** `Function` constructions during three consecutive parses of the probe string schema. */
  codegenPerParse: [number, number, number]
  results: Record<string, ParseOutcome[]>
}

const validUpload = {
  uploadId: '6f1f2f7e-6d2b-4a5e-9d3a-2b7c8a1e5f10',
  method: 'PUT',
  url: 'https://storage.example.com/avatars/upload',
  headers: { 'Content-Type': 'image/png', 'If-None-Match': '*' },
  contentLength: 2048,
  expiresAt: '2026-01-01T00:00:00.000Z',
}

const validUser = {
  id: 'user-1',
  email: 'Ada@Example.com',
  displayName: null,
  role: 'admin',
  createdAt: '2026-01-01T00:00:00.000Z',
}

function schemaCases(contracts: Contracts): SchemaCase[] {
  return [
    {
      name: 'emailSchema',
      schema: contracts.emailSchema,
      inputs: [' USER@EXAMPLE.COM ', 'not-an-email', `${'a'.repeat(250)}@x.io`, 42],
    },
    {
      name: 'passwordSchema',
      schema: contracts.passwordSchema,
      inputs: ['12345678', '1234567', 'x'.repeat(129), null],
    },
    {
      name: 'registerRequestSchema',
      schema: contracts.registerRequestSchema,
      inputs: [
        { email: ' USER@EXAMPLE.COM ', password: '12345678', displayName: '  Ada  ' },
        { email: 'user@example.com', password: '12345678', displayName: '' },
        { email: 'user@example.com', password: '12345678' },
        { email: 'nope', password: 'short', displayName: 'A' },
        { email: 'user@example.com', password: '12345678', displayName: 7 },
        null,
        [],
      ],
    },
    {
      name: 'loginRequestSchema',
      schema: contracts.loginRequestSchema,
      inputs: [{ email: 'User@Example.com', password: '12345678' }, { email: 'user@example.com' }, 'x'],
    },
    {
      name: 'passwordResetRequestSchema',
      schema: contracts.passwordResetRequestSchema,
      inputs: [{ email: ' Reset@Example.com ' }, { email: 'reset@' }, { email: 'reset@example.com', extra: 1 }],
    },
    {
      name: 'passwordResetConfirmRequestSchema',
      schema: contracts.passwordResetConfirmRequestSchema,
      inputs: [
        { token: ` ${'t'.repeat(43)} `, password: '12345678' },
        { token: 't'.repeat(42), password: '12345678' },
        { token: 't'.repeat(43), password: '' },
      ],
    },
    {
      name: 'cookieRefreshRequestSchema',
      schema: contracts.cookieRefreshRequestSchema,
      inputs: [undefined, {}, { extra: 1 }, 'session'],
    },
    {
      name: 'tokenRefreshRequestSchema',
      schema: contracts.tokenRefreshRequestSchema,
      inputs: [{ refreshToken: 'r'.repeat(32) }, { refreshToken: 'r'.repeat(31) }, {}],
    },
    {
      name: 'userSchema',
      schema: contracts.userSchema,
      inputs: [
        validUser,
        { ...validUser, role: 'owner' },
        { ...validUser, createdAt: 'yesterday' },
        { ...validUser, displayName: undefined },
      ],
    },
    {
      name: 'updateProfileRequestSchema',
      schema: contracts.updateProfileRequestSchema,
      inputs: [
        { displayName: '  Grace  ' },
        { displayName: null },
        { displayName: 'G' },
        { displayName: 'Grace', extra: true },
        {},
      ],
    },
    {
      name: 'adminUsersQuerySchema',
      schema: contracts.adminUsersQuerySchema,
      inputs: [
        {},
        { q: '  ', page: '3', pageSize: '50' },
        { q: ' ada ', page: 2 },
        { page: '0' },
        { page: 'abc' },
        { pageSize: '101' },
        { q: 'q'.repeat(101) },
        { sort: 'email' },
      ],
    },
    {
      name: 'adminUserParamsSchema',
      schema: contracts.adminUserParamsSchema,
      inputs: [{ userId: validUpload.uploadId }, { userId: '42' }, { userId: validUpload.uploadId, more: 1 }],
    },
    {
      name: 'avatarUploadParamsSchema',
      schema: contracts.avatarUploadParamsSchema,
      inputs: [{ uploadId: validUpload.uploadId }, { uploadId: 'latest' }, {}],
    },
    {
      name: 'updateUserRoleRequestSchema',
      schema: contracts.updateUserRoleRequestSchema,
      inputs: [{ role: 'user' }, { role: 'root' }, { role: 'admin', force: true }],
    },
    {
      name: 'createAvatarUploadRequestSchema',
      schema: contracts.createAvatarUploadRequestSchema,
      inputs: [
        { contentType: 'image/heic', byteSize: 4096 },
        { contentType: 'image/gif', byteSize: 4096 },
        { contentType: 'image/png', byteSize: 1 },
        { contentType: 'image/png', byteSize: 4096.5 },
      ],
    },
    {
      name: 'uploadTicketSchema',
      schema: contracts.uploadTicketSchema,
      inputs: [
        validUpload,
        { ...validUpload, url: ' https://storage.example.com/x ' },
        { ...validUpload, url: 'javascript:alert(1)' },
        { ...validUpload, url: 'storage.example.com/x' },
        { ...validUpload, method: 'POST' },
        { ...validUpload, headers: { 'Content-Type': 7 } },
        { ...validUpload, contentLength: 0 },
      ],
    },
  ]
}

function countFunctionConstructions(run: () => void): number {
  const NativeFunction = Function
  let constructions = 0
  const spy = function (...args: unknown[]) {
    constructions += 1
    return Reflect.construct(NativeFunction, args)
  }

  globalThis.Function = spy as unknown as FunctionConstructor
  try {
    run()
  } finally {
    globalThis.Function = NativeFunction
  }

  return constructions
}

function outcome(schema: SchemaCase['schema'], input: unknown): ParseOutcome {
  const result = schema.safeParse(input)
  return result.success
    ? { input, success: true, data: result.data }
    : { input, success: false, issues: result.error?.issues ?? [] }
}

const mode = process.argv[2]
if (mode !== 'composition-root' && mode !== 'plain') {
  console.error(`usage: bun src/zod-compile.probe.ts <composition-root|plain> (got ${String(mode)})`)
  process.exit(2)
}

if (mode === 'composition-root') await import('./app')
const contracts: Contracts = await import('@web-app-demo/contracts')

const probeSchema = contracts.emailSchema
const codegenPerParse = [1, 2, 3].map(() =>
  countFunctionConstructions(() => probeSchema.safeParse('probe@example.com')),
) as ProbeReport['codegenPerParse']

const results: ProbeReport['results'] = {}
for (const { name, schema, inputs } of schemaCases(contracts)) {
  results[name] = inputs.map((input) => outcome(schema, input))
}

const report: ProbeReport = { codegenPerParse, results }
console.log(JSON.stringify(report))
