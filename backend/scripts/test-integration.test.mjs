import { describe, expect, test } from 'bun:test'

import { composeProjectName, postgresTestDataVolume } from '../../scripts/repo-env.mjs'
import { runBackendIntegration } from './test-integration.mjs'

const integrationFile = 'src/example.integration.test.ts'
const testDatabaseUrl =
  'postgresql://superuser:superpassword@localhost:54330/web_app_demo_test?schema=public'

describe('backend integration Docker lifecycle', () => {
  test('removes only postgres_test and its exact volume after a normal run', async () => {
    const calls = []

    await runBackendIntegration({
      environment: { TEST_DATABASE_URL: testDatabaseUrl },
      integrationTestFiles: [integrationFile],
      spawn: successfulSpawn(calls),
    })

    const projectName = integrationProjectName(calls)
    expect(projectName).toStartWith(`${composeProjectName}-integration-`)
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

  test('still cleans up after a failed test command and preserves that failure', async () => {
    const calls = []
    const spawn = successfulSpawn(calls, (command, args) => command === 'bun' && args[0] === 'test')

    await expect(
      runBackendIntegration({
        environment: { TEST_DATABASE_URL: testDatabaseUrl },
        integrationTestFiles: [integrationFile],
        spawn,
      }),
    ).rejects.toThrow('bun test src/example.integration.test.ts failed with exit code 7')

    const projectName = integrationProjectName(calls)
    expect(commandArgs(calls)).toContainEqual([
      'volume',
      'rm',
      '--force',
      `${projectName}_${postgresTestDataVolume}`,
    ])
  })

  test('cleans only its unique project namespace after startup fails', async () => {
    const calls = []

    await expect(
      runBackendIntegration({
        environment: { TEST_DATABASE_URL: testDatabaseUrl },
        integrationTestFiles: [integrationFile],
        spawn: successfulSpawn(
          calls,
          (command, args) => command === 'docker' && args.includes('up'),
        ),
      }),
    ).rejects.toThrow()

    const projectName = integrationProjectName(calls)
    expect(projectName).toStartWith(`${composeProjectName}-integration-`)
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
  })

  test('cleans up after migration and discovery failures once startup succeeded', async () => {
    const failingSteps = [
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
  })

  test('reports a secondary cleanup failure without replacing the test failure', async () => {
    const messages = []
    const spawn = successfulSpawn(
      [],
      (command, args) =>
        (command === 'bun' && args[0] === 'test') ||
        (command === 'docker' && args.includes('rm') && args.includes('postgres_test')),
    )

    await expect(
      runBackendIntegration({
        environment: { TEST_DATABASE_URL: testDatabaseUrl },
        integrationTestFiles: [integrationFile],
        spawn,
        writeError: (message) => messages.push(message),
      }),
    ).rejects.toThrow('bun test src/example.integration.test.ts failed with exit code 7')

    expect(messages).toHaveLength(1)
    expect(messages[0]).toContain('Docker cleanup also failed')
    expect(messages[0]).toContain('docker compose')
  })

  test('TEST_KEEP_DOCKER keeps the managed database for investigation', async () => {
    const calls = []

    await runBackendIntegration({
      environment: { TEST_DATABASE_URL: testDatabaseUrl, TEST_KEEP_DOCKER: '1' },
      integrationTestFiles: [integrationFile],
      spawn: successfulSpawn(calls),
    })

    const projectName = integrationProjectName(calls)
    expect(commandArgs(calls)).toContainEqual([
      'compose',
      '-p',
      projectName,
      'up',
      '-d',
      'postgres_test',
    ])
    expect(commandArgs(calls).some((args) => args.includes('rm'))).toBe(false)
  })

  test('each managed run owns a unique Compose project and volume namespace', async () => {
    const firstCalls = []
    const secondCalls = []

    await runBackendIntegration({
      environment: { TEST_DATABASE_URL: testDatabaseUrl },
      integrationTestFiles: [integrationFile],
      spawn: successfulSpawn(firstCalls),
    })
    await runBackendIntegration({
      environment: { TEST_DATABASE_URL: testDatabaseUrl },
      integrationTestFiles: [integrationFile],
      spawn: successfulSpawn(secondCalls),
    })

    const firstProject = integrationProjectName(firstCalls)
    const secondProject = integrationProjectName(secondCalls)
    expect(firstProject).not.toBe(secondProject)
    expect(commandArgs(firstCalls)).toContainEqual([
      'volume',
      'rm',
      '--force',
      `${firstProject}_${postgresTestDataVolume}`,
    ])
    expect(commandArgs(secondCalls)).toContainEqual([
      'volume',
      'rm',
      '--force',
      `${secondProject}_${postgresTestDataVolume}`,
    ])
    expect(commandArgs(firstCalls)).toContainEqual([
      'network',
      'rm',
      `${firstProject}_default`,
    ])
    expect(commandArgs(secondCalls)).toContainEqual([
      'network',
      'rm',
      `${secondProject}_default`,
    ])
  })

  test('TEST_SKIP_DOCKER leaves an externally managed database untouched', async () => {
    const calls = []

    await runBackendIntegration({
      environment: { TEST_DATABASE_URL: testDatabaseUrl, TEST_SKIP_DOCKER: '1' },
      integrationTestFiles: [integrationFile],
      spawn: successfulSpawn(calls),
    })

    expect(calls.some(({ command }) => command === 'docker')).toBe(false)
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

  test('TEST_DATABASE_URL port wins over an ambient POSTGRES_TEST_PORT', async () => {
    const calls = []

    await runBackendIntegration({
      environment: {
        POSTGRES_TEST_PORT: '59999',
        TEST_DATABASE_URL: testDatabaseUrl,
      },
      integrationTestFiles: [integrationFile],
      spawn: successfulSpawn(calls),
    })

    const dockerUp = calls.find(
      ({ command, args }) => command === 'docker' && args.includes('up'),
    )
    expect(dockerUp.options.env.POSTGRES_TEST_PORT).toBe('54330')
    const migration = calls.find(
      ({ command, args }) => command === 'bun' && args.includes('prisma:deploy'),
    )
    expect(migration.options.env.DATABASE_URL).toBe(testDatabaseUrl)
  })
})

function successfulSpawn(calls, shouldFail = () => false) {
  return (command, args, options) => {
    calls.push({ args, command, options })
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
