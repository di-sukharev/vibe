import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { composeProjectName, localPrivateStorageService, repositoryRoot } from './repo-env.mjs'
import { start, status, stop, storageE2ePlaywrightArgs } from './storage-local.mjs'

const composeServices = Object.keys(
  Bun.YAML.parse(readFileSync(resolve(repositoryRoot, 'docker-compose.yml'), 'utf8')).services,
)

describe('local S3 container lifecycle', () => {
  test('every docker command is scoped to this checkout and names only the storage service', async () => {
    const calls = []
    const io = { spawn: recordingSpawn(calls), createS3Client: reachableBucket }

    await start({ quiet: true, ...io })
    await status(io)
    stop(io)

    const dockerCalls = calls.filter(({ command }) => command === 'docker')
    expect(dockerCalls.map(({ args }) => args[3])).toEqual(['up', 'ps', 'stop'])
    for (const { args, options } of dockerCalls) {
      expect(args.slice(0, 3)).toEqual(['compose', '-p', composeProjectName])
      expect(args.filter((argument) => composeServices.includes(argument))).toEqual([
        localPrivateStorageService,
      ])
      expect(options.cwd).toBe(repositoryRoot)
    }
  })

  test('stop stops the one service; down would take the databases and the uploads volume with it', () => {
    const calls = []

    stop({ spawn: recordingSpawn(calls) })

    expect(dockerArgs(calls)).toEqual([
      ['compose', '-p', composeProjectName, 'stop', localPrivateStorageService],
    ])
    expect(dockerArgs(calls).flat()).not.toContain('down')
    expect(dockerArgs(calls).flat()).not.toContain('--volumes')
  })
})

test('local S3 browser validation keeps the avatar scope while forwarding options', () => {
  expect(storageE2ePlaywrightArgs([])).toEqual(['e2e/specs/avatar.spec.ts'])
  expect(storageE2ePlaywrightArgs(['--', '--list', '-g', 'uploads an avatar'])).toEqual([
    'e2e/specs/avatar.spec.ts',
    '--list',
    '-g',
    'uploads an avatar',
  ])
  expect(() => storageE2ePlaywrightArgs(['auth.spec.ts'])).toThrow(
    'keeps its file scope on avatar.spec.ts',
  )
})

function recordingSpawn(calls) {
  return (command, args, options) => {
    calls.push({ args, command, options })
    return { status: 0 }
  }
}

function dockerArgs(calls) {
  return calls.filter(({ command }) => command === 'docker').map(({ args }) => args)
}

// An S3 client whose every request succeeds: the bucket is reachable at once and CORS applies.
async function reachableBucket() {
  return { client: { send: async () => ({}), destroy() {} } }
}
