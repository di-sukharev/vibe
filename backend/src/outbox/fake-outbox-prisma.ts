import type { BackendRuntime } from '../runtime'

/**
 * A small in-memory stand-in for the `task_outbox` table, for tests about drain *policy* - what
 * runs, in what order, and what gets written. It supports only the predicates `store.ts` issues.
 *
 * It deliberately proves nothing about concurrency: two callers here never race. That is what
 * `outbox.integration.test.ts` is for, against a real database.
 */
export type FakeTaskRow = {
  id: string
  type: string
  dedupeKey: string
  payload: unknown
  status: 'pending' | 'processing' | 'done' | 'skipped' | 'failed'
  scheduledFor: Date
  attempts: number
  lastError: string | null
  processingToken: string | null
  processedAt: Date | null
  redactedAt: Date | null
  createdAt: Date
  updatedAt: Date
}

export function taskRow(overrides: Partial<FakeTaskRow> & Pick<FakeTaskRow, 'id' | 'type'>): FakeTaskRow {
  const now = new Date('2026-08-09T12:00:00.000Z')

  return {
    attempts: 0,
    createdAt: now,
    dedupeKey: overrides.id,
    lastError: null,
    payload: {},
    processedAt: null,
    processingToken: null,
    redactedAt: null,
    scheduledFor: now,
    status: 'pending',
    updatedAt: now,
    ...overrides,
  }
}

export function createFakeOutboxRuntime(rows: FakeTaskRow[]) {
  const taskOutbox = {
    count: async ({ where }: { where: unknown }) => matching(rows, where).length,
    findFirst: async ({ where, orderBy }: { where: unknown; orderBy?: unknown }) =>
      sorted(matching(rows, where), orderBy)[0] ?? null,
    findMany: async ({
      where,
      orderBy,
      take,
    }: {
      where: unknown
      orderBy?: unknown
      take?: number
    }) => sorted(matching(rows, where), orderBy).slice(0, take ?? rows.length),
    updateMany: async ({ where, data }: { where: unknown; data: Record<string, unknown> }) => {
      const hits = matching(rows, where)
      for (const row of hits) {
        Object.assign(row, data)
        // Prisma bumps @updatedAt on updateMany too; the lease clock depends on it.
        row.updatedAt = new Date()
      }

      return { count: hits.length }
    },
    deleteMany: async ({ where }: { where: unknown }) => {
      const hits = matching(rows, where)
      for (const row of hits) rows.splice(rows.indexOf(row), 1)

      return { count: hits.length }
    },
  }

  return { prisma: { taskOutbox } } as unknown as BackendRuntime
}

function matching(rows: FakeTaskRow[], where: unknown) {
  const conditions = Object.entries((where ?? {}) as Record<string, unknown>)

  return rows.filter((row) =>
    conditions.every(([field, condition]) => satisfies(row[field as keyof FakeTaskRow], condition)),
  )
}

function satisfies(value: unknown, condition: unknown): boolean {
  if (condition === null || typeof condition !== 'object') return value === condition

  const test = condition as Record<string, unknown>
  if ('in' in test) return (test.in as unknown[]).includes(value)
  if ('notIn' in test) return !(test.notIn as unknown[]).includes(value)
  if ('lt' in test) return value instanceof Date && value < (test.lt as Date)
  if ('lte' in test) return value instanceof Date && value <= (test.lte as Date)
  if (condition instanceof Date) return value instanceof Date && value.getTime() === condition.getTime()

  throw new Error(`The fake outbox client does not implement ${JSON.stringify(condition)}`)
}

function sorted(rows: FakeTaskRow[], orderBy: unknown) {
  const clauses = (Array.isArray(orderBy) ? orderBy : orderBy ? [orderBy] : []) as Record<
    string,
    'asc' | 'desc'
  >[]

  return [...rows].sort((left, right) => {
    for (const clause of clauses) {
      const [field, direction] = Object.entries(clause)[0] as [keyof FakeTaskRow, 'asc' | 'desc']
      const a = left[field]
      const b = right[field]
      if (a == null || b == null || a === b) continue

      const order = a < b ? -1 : 1
      return direction === 'desc' ? -order : order
    }

    return 0
  })
}
