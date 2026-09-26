import type { BackendRuntime } from '../runtime'

/**
 * A small in-memory stand-in for the `task_outbox` table, for drain tests about handler outcomes,
 * deadlines, and faults. It only filters rows with the predicates `store.ts` issues: it does not
 * order them, bump `@updatedAt`, or race two callers. What those decide is tested against a real
 * database in `outbox.integration.test.ts`.
 */
export type FakeTaskRow = {
  id: string
  type: string
  payload: unknown
  status: 'pending' | 'processing' | 'done' | 'skipped' | 'failed'
  scheduledFor: Date
  attempts: number
  lastError: string | null
  processingToken: string | null
  processedAt: Date | null
}

export function taskRow(overrides: Partial<FakeTaskRow> & Pick<FakeTaskRow, 'id' | 'type'>): FakeTaskRow {
  return {
    attempts: 0,
    lastError: null,
    payload: {},
    processedAt: null,
    processingToken: null,
    scheduledFor: new Date('2026-08-09T12:00:00.000Z'),
    status: 'pending',
    ...overrides,
  }
}

export function createFakeOutboxRuntime(rows: FakeTaskRow[]) {
  const taskOutbox = {
    count: async ({ where }: { where: unknown }) => matching(rows, where).length,
    findFirst: async ({ where }: { where: unknown }) => matching(rows, where)[0] ?? null,
    findMany: async ({ where }: { where: unknown }) => matching(rows, where),
    updateMany: async ({ where, data }: { where: unknown; data: Record<string, unknown> }) => {
      const hits = matching(rows, where)
      for (const row of hits) Object.assign(row, data)

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

  throw new Error(`The fake outbox client does not implement ${JSON.stringify(condition)}`)
}
