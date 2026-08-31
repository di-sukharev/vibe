import { expect, test } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'

const backendRoot = resolve(import.meta.dir, '..')

test('the backend composition root lazily compiles schemas without changing their output', () => {
  // Use a fresh process: the unit suite shares a module cache, which could otherwise hide an
  // import-order regression by loading Zod or the contracts before the backend composition root.
  const result = spawnSync(process.execPath, [
    '-e',
    `
      await import('./src/app.ts')
      const { registerRequestSchema } = await import('@web-app-demo/contracts')
      const schema = registerRequestSchema
      const state = {
        postProcessorInstalled:
          typeof globalThis.__zod_globalConfig?.postProcessor === 'function',
        schemaPrepared: typeof schema._zod.run.__originalRun === 'function',
        validatorBeforeParse: typeof schema._zod.bag.validator,
      }
      const parsed = schema.parse({
        email: 'USER@EXAMPLE.COM',
        password: '12345678',
        displayName: 'Ada',
      })
      console.log(JSON.stringify({
        ...state,
        validatorAfterParse: typeof schema._zod.bag.validator,
        parsed,
      }))
    `,
  ], {
    cwd: backendRoot,
    encoding: 'utf8',
  })

  expect({ status: result.status, stderr: result.stderr }).toEqual({ status: 0, stderr: '' })
  expect(JSON.parse(result.stdout)).toEqual({
    postProcessorInstalled: true,
    schemaPrepared: true,
    validatorBeforeParse: 'undefined',
    validatorAfterParse: 'function',
    parsed: {
      email: 'user@example.com',
      password: '12345678',
      displayName: 'Ada',
    },
  })
})
