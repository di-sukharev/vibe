import { expect, test } from 'bun:test'
import { Hono } from 'hono'

import { createFixedWindowRateLimit } from './security'

test('fixed-window rate limits reset without sharing state between keys', async () => {
  let now = 1_000
  const app = new Hono()
  app.use('*', createFixedWindowRateLimit({
    errorMessage: 'Too many test requests',
    key: (c) => c.req.header('x-test-key') ?? 'missing',
    max: 1,
    now: () => now,
    windowSeconds: 60,
  }))
  app.get('/', (c) => c.text('ok'))
  const request = (key: string) => app.request('/', {
    headers: { 'X-Test-Key': key },
  })

  expect((await request('first')).status).toBe(200)
  const limited = await request('first')
  expect(limited.status).toBe(429)
  expect(limited.headers.get('ratelimit-limit')).toBe('1')
  expect(limited.headers.get('ratelimit-remaining')).toBe('0')
  expect(limited.headers.get('retry-after')).toBe('60')
  expect((await request('second')).status).toBe(200)

  now += 60_000

  expect((await request('first')).status).toBe(200)
})

test('a flood of new keys cannot lift the limit off an exhausted key or land on a fresh one', async () => {
  const now = 1_000
  const app = new Hono()
  app.use('*', createFixedWindowRateLimit({
    errorMessage: 'Too many test requests',
    key: (c) => c.req.header('x-test-key') ?? 'missing',
    max: 2,
    maxTrackedKeys: 4,
    now: () => now,
    windowSeconds: 60,
  }))
  app.get('/', (c) => c.text('ok'))
  const request = (key: string) => app.request('/', { headers: { 'X-Test-Key': key } })

  expect((await request('victim')).status).toBe(200)
  expect((await request('victim')).status).toBe(200)
  expect((await request('victim')).status).toBe(429)

  for (let index = 0; index < 20; index += 1) {
    expect((await request(`flood-${index}`)).status).toBe(200)
  }

  // The exhausted bucket is the one doing the limiting, so table pressure must not evict it.
  expect((await request('victim')).status).toBe(429)
  // And a client the flood has never seen still gets its own budget instead of a shared one.
  expect((await request('bystander')).status).toBe(200)
})

test('a table full of exhausted keys refuses new ones instead of forgetting a limit', async () => {
  const now = 1_000
  const app = new Hono()
  app.use('*', createFixedWindowRateLimit({
    errorMessage: 'Too many test requests',
    key: (c) => c.req.header('x-test-key') ?? 'missing',
    max: 1,
    maxTrackedKeys: 2,
    now: () => now,
    windowSeconds: 60,
  }))
  app.get('/', (c) => c.text('ok'))
  const request = (key: string) => app.request('/', { headers: { 'X-Test-Key': key } })

  expect((await request('first')).status).toBe(200)
  expect((await request('second')).status).toBe(200)

  const refused = await request('third')

  expect(refused.status).toBe(429)
  expect(refused.headers.get('retry-after')).toBe('60')
  expect((await request('first')).status).toBe(429)
})
