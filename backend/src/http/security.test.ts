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
