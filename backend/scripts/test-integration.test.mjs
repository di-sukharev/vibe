import { describe, expect, test } from 'bun:test'

import { composeProjectName, postgresTestDataVolume } from '../../scripts/repo-env.mjs'
import { integrationTestTimeoutMs, runBackendIntegration } from './test-integration.mjs'

const integrationFile = 'src/example.integration.test.ts'
const testDatabaseUrl =
  'postgresql://superuser:superpassword@localhost:54330/web_app_demo_test?schema=public'

describe('backend integration Docker lifecycle', () => {
  test('cleans only its own postgres_test service and volume and never runs `down`', async () => {
    // Every run owns a fresh Compose project, so two runs from one checkout never remove each
    // other's database, and `down` would reach beyond the test service.
    const calls = []
    const otherRunCalls = []

    await runBackendIntegration({
      environment: { TEST_DATABASE_URL: testDatabaseUrl },
      integrationTestFiles: [integrationFile],
      spawn: successfulSpawn(calls),
    })
    await runBackendIntegration({
      environment: { TEST_DATABASE_URL: testDatabaseUrl },
      integrationTestFiles: [integrationFile],
      spawn: successfulSpawn(otherRunCalls),
    })

    const projectName = integrationProjectName(calls)
    expect(projectName).toStartWith(`${composeProjectName}-integration-`)
    expect(integrationProjectName(otherRunCalls)).not.toBe(projectName)
    expect(commandArgs(calls)).toContainEqual([
      'compose',
      '-p',
      projectName,
      'rm',
      '--stop',
      '--force',
      '--volumes',
      'postgres_test',
    ])
    expect(commandArgs(calls)).toContainEqual([
      'volume',
      'rm',
      '--force',
      `${projectName}_${postgresTestDataVolume}`,
    ])
    expect(commandArgs(calls)).toContainEqual([
      'network',
      'rm',
      `${projectName}_default`,
    ])
    expect(commandArgs(calls).flat()).not.toContain('down')
  })

  test('cleans up on any failure and keeps the first error', async () => {
    const failingSteps = [
      {
        name: 'startup',
        integrationTestFiles: [integrationFile],
        shouldFail: (command, args) => command === 'docker' && args.includes('up'),
      },
      {
        name: 'migration',
        integrationTestFiles: [integrationFile],
        shouldFail: (command, args) => command === 'bun' && args.includes('prisma:deploy'),
      },
      {
        name: 'discovery',
        integrationTestFiles: [],
        shouldFail: () => false,
      },
      {
        name: 'tests',
        integrationTestFiles: [integrationFile],
        shouldFail: (command, args) => command === 'bun' && args[0] === 'test',
      },
    ]

    for (const step of failingSteps) {
      const calls = []

      await expect(
        runBackendIntegration({
          environment: { TEST_DATABASE_URL: testDatabaseUrl },
          integrationTestFiles: step.integrationTestFiles,
          spawn: successfulSpawn(calls, step.shouldFail),
        }),
        step.name,
      ).rejects.toThrow()

      const projectName = integrationProjectName(calls)
      expect(commandArgs(calls), step.name).toContainEqual([
        'volume',
        'rm',
        '--force',
        `${projectName}_${postgresTestDataVolume}`,
      ])
    }

    // A cleanup that fails too is reported beside the test failure, not in its place.
    const messages = []
    await expect(
      runBackendIntegration({
        environment: { TEST_DATABASE_URL: testDatabaseUrl },
        integrationTestFiles: [integrationFile],
        spawn: successfulSpawn(
          [],
          (command, args) =>
            (command === 'bun' && args[0] === 'test') ||
            (command === 'docker' && args.includes('rm') && args.includes('postgres_test')),
        ),
        writeError: (message) => messages.push(message),
      }),
    ).rejects.toThrow(`bun test ${integrationFile} --timeout=${integrationTestTimeoutMs} failed with exit code 7`)
    expect(messages).toHaveLength(1)
  })

  test('TEST_SKIP_DOCKER requires an explicit external test database URL', async () => {
    const calls = []

    await expect(
      runBackendIntegration({
        environment: { TEST_SKIP_DOCKER: '1' },
        integrationTestFiles: [integrationFile],
        spawn: successfulSpawn(calls),
      }),
    ).rejects.toThrow('TEST_SKIP_DOCKER=1 requires TEST_DATABASE_URL')

    expect(calls).toHaveLength(0)
  })
})

function successfulSpawn(calls, shouldFail = () => false) {
  return (command, args) => {
    calls.push({ args, command })
    return { status: shouldFail(command, args) ? 7 : 0 }
  }
}

function commandArgs(calls) {
  return calls.filter(({ command }) => command === 'docker').map(({ args }) => args)
}

function integrationProjectName(calls) {
  const composeCall = calls.find(
    ({ command, args }) => command === 'docker' && args[0] === 'compose' && args[1] === '-p',
  )
  expect(composeCall).toBeDefined()
  return composeCall.args[2]
}
