import { describe, expect, test } from 'bun:test'

import {
  mergeLiveEnvValues,
  releaseGitProblems,
  specProblems,
  valuelessEnvKeys,
} from './deploy-do.mjs'

const liveSpec = {
  services: [
    {
      name: 'api',
      envs: [
        { key: 'JWT_SECRET', scope: 'RUN_TIME', value: 'live-secret' },
        { key: 'CORS_ORIGINS', scope: 'RUN_TIME', value: 'https://stale.example.com' },
        { key: 'EMAIL_RESEND_API_KEY', scope: 'BUILD_TIME', value: 'live-key' },
      ],
    },
  ],
}

describe('mergeLiveEnvValues', () => {
  test('fills valueless entries from the live app and leaves declared values alone', () => {
    const merged = mergeLiveEnvValues(
      {
        services: [
          {
            name: 'api',
            envs: [
              { key: 'JWT_SECRET', scope: 'RUN_TIME' },
              { key: 'CORS_ORIGINS', scope: 'RUN_TIME', value: 'https://app.example.com' },
            ],
          },
        ],
      },
      liveSpec,
    )

    expect(merged.services[0].envs).toEqual([
      { key: 'JWT_SECRET', scope: 'RUN_TIME', value: 'live-secret' },
      { key: 'CORS_ORIGINS', scope: 'RUN_TIME', value: 'https://app.example.com' },
    ])
  })

  test('falls back to the key when the scope changed, so a console edit is not dropped', () => {
    const merged = mergeLiveEnvValues(
      { services: [{ name: 'api', envs: [{ key: 'EMAIL_RESEND_API_KEY', scope: 'RUN_TIME' }] }] },
      liveSpec,
    )

    expect(merged.services[0].envs[0].value).toBe('live-key')
  })

  test('does not invent a value the live app does not have, and does not mutate the input', () => {
    const local = { services: [{ name: 'api', envs: [{ key: 'NEW_SECRET', scope: 'RUN_TIME' }] }] }
    const merged = mergeLiveEnvValues(local, liveSpec)

    expect(merged.services[0].envs[0]).toEqual({ key: 'NEW_SECRET', scope: 'RUN_TIME' })
    expect(valuelessEnvKeys(merged)).toEqual(['api.NEW_SECRET'])
    expect(local.services[0].envs[0]).toEqual({ key: 'NEW_SECRET', scope: 'RUN_TIME' })
  })

  test('ignores components the live app does not have', () => {
    const merged = mergeLiveEnvValues(
      { jobs: [{ name: 'migrate', envs: [{ key: 'DATABASE_URL', scope: 'RUN_TIME' }] }] },
      liveSpec,
    )

    expect(merged.jobs[0].envs[0]).toEqual({ key: 'DATABASE_URL', scope: 'RUN_TIME' })
  })
})

describe('specProblems', () => {
  const scheduled = (overrides) => ({
    jobs: [
      {
        name: 'drain',
        kind: 'SCHEDULED',
        run_command: 'bun run start:cron -- outbox:drain',
        schedule: { cron: '*/15 * * * *' },
        ...overrides,
      },
    ],
  })

  test('accepts a filled spec with a registered job on a permitted cadence', () => {
    expect(specProblems(scheduled(), { registeredJobs: ['outbox:drain'] })).toEqual([])
  })

  test('rejects a scheduled task that is not in the job registry', () => {
    const problems = specProblems(scheduled({ run_command: 'bun run start:cron -- typo:drain' }), {
      registeredJobs: ['outbox:drain'],
    })

    expect(problems).toHaveLength(1)
    expect(problems[0]).toContain("runs 'typo:drain'")
  })

  test('rejects a cadence below the App Platform floor', () => {
    const problems = specProblems(scheduled({ schedule: { cron: '*/5 * * * *' } }), {
      registeredJobs: ['outbox:drain'],
    })

    expect(problems).toHaveLength(1)
    expect(problems[0]).toContain('every 15 minutes')
  })

  test('rejects unfilled placeholders anywhere in the spec', () => {
    const problems = specProblems({ name: 'REPLACE_WITH_PROJECT_SLUG-api', region: 'fra' })

    expect(problems).toEqual(['unfilled placeholder REPLACE_WITH_PROJECT_SLUG'])
  })

  test('rejects wildcard, plaintext and path-bearing CORS origins', () => {
    const problems = specProblems({
      services: [
        {
          name: 'api',
          envs: [
            { key: 'CORS_ORIGINS', value: '*,http://app.example.com,https://app.example.com/app' },
          ],
        },
      ],
    })

    expect(problems).toHaveLength(3)
    expect(problems[0]).toContain('wildcard')
    expect(problems[1]).toContain('must use https')
    expect(problems[2]).toContain('origins only')
  })

  test('rejects an empty value, which reads as configured but is not', () => {
    const problems = specProblems({
      services: [{ name: 'api', envs: [{ key: 'JWT_SECRET', value: '   ' }] }],
    })

    expect(problems).toHaveLength(1)
    expect(problems[0]).toContain('api.JWT_SECRET has an empty value')
  })
})

describe('releaseGitProblems', () => {
  const clean = {
    branchLine: '## master...origin/master',
    dirtyLines: [],
    currentBranch: 'master',
    specBranch: 'master',
  }

  test('accepts a clean checkout of the branch the spec deploys', () => {
    expect(releaseGitProblems(clean)).toEqual([])
  })

  test('refuses when the checkout is not the branch that will actually be built', () => {
    const problems = releaseGitProblems({ ...clean, currentBranch: 'mobile' })

    expect(problems).toHaveLength(1)
    expect(problems[0]).toContain('current checkout is mobile, but the spec deploys master')
  })

  test('refuses an unpushed or out-of-sync branch', () => {
    expect(releaseGitProblems({ ...clean, branchLine: '## master' })[0]).toContain('pushed upstream')
    expect(
      releaseGitProblems({ ...clean, branchLine: '## master...origin/master [ahead 2]' })[0],
    ).toContain('in sync')
  })

  test('refuses a dirty worktree without offering to clean it', () => {
    const problems = releaseGitProblems({ ...clean, dirtyLines: [' M backend/src/app.ts'] })

    expect(problems).toHaveLength(1)
    expect(problems[0]).toContain('clean worktree')
    expect(problems[0]).toContain('backend/src/app.ts')
  })
})
