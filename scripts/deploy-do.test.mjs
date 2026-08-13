import { describe, expect, test } from 'bun:test'

import {
  mergeLiveEnvValues,
  releaseGitProblems,
  specProblems,
  addedComponentNames,
  droppedEnvKeys,
  liveSpecUnreadable,
  removedComponentNames,
  updateDecisions,
  usesAppLevelEnvs,
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

  test('treats a bare `value:` as valueless and fills it, instead of clearing the live secret', () => {
    // YAML parses `value:` with nothing after it to null. Submitted, that reaches DigitalOcean as
    // an empty string and wipes the running secret.
    const local = Bun.YAML.parse(
      ['services:', '  - name: api', '    envs:', '      - key: JWT_SECRET', '        value:'].join('\n'),
    )

    expect(local.services[0].envs[0]).toEqual({ key: 'JWT_SECRET', value: null })
    expect(mergeLiveEnvValues(local, liveSpec).services[0].envs[0].value).toBe('live-secret')
  })

  test('drops an unfilled null rather than submitting it as an empty value', () => {
    const merged = mergeLiveEnvValues(
      { services: [{ name: 'api', envs: [{ key: 'BRAND_NEW', value: null }] }] },
      liveSpec,
    )

    expect(merged.services[0].envs[0]).toEqual({ key: 'BRAND_NEW' })
    expect(valuelessEnvKeys(merged)).toEqual(['api.BRAND_NEW'])
  })

  test('ignores components the live app does not have', () => {
    const merged = mergeLiveEnvValues(
      { jobs: [{ name: 'migrate', envs: [{ key: 'DATABASE_URL', scope: 'RUN_TIME' }] }] },
      liveSpec,
    )

    expect(merged.jobs[0].envs[0]).toEqual({ key: 'DATABASE_URL', scope: 'RUN_TIME' })
  })
})

describe('component drift between the spec and the running app', () => {
  test('says nothing when the spec and the live app declare the same components', () => {
    expect(addedComponentNames({ services: [{ name: 'api', envs: [] }] }, liveSpec)).toEqual([])
    expect(removedComponentNames({ services: [{ name: 'api', envs: [] }] }, liveSpec)).toEqual([])
  })

  test('reports an added component, which is legitimate and starts with its secrets unset', () => {
    const withWorker = {
      services: [{ name: 'api', envs: [] }],
      workers: [{ name: 'scheduler', envs: [{ key: 'DATABASE_URL' }] }],
    }

    expect(addedComponentNames(withWorker, liveSpec)).toEqual(['workers.scheduler'])
    expect(removedComponentNames(withWorker, liveSpec)).toEqual([])
  })

  test('reports a component dropped from the spec, which applying would delete with its secrets', () => {
    expect(removedComponentNames({ services: [] }, liveSpec)).toEqual(['services.api'])
  })

  test('sees a rename as both directions at once, which is what makes it destructive', () => {
    const renamed = { services: [{ name: 'backend', envs: [{ key: 'JWT_SECRET' }] }] }

    expect(addedComponentNames(renamed, liveSpec)).toEqual(['services.backend'])
    expect(removedComponentNames(renamed, liveSpec)).toEqual(['services.api'])
  })
})

describe('liveSpecUnreadable', () => {
  const spec = {
    services: [{ name: 'api', envs: [{ key: 'JWT_SECRET' }] }],
    jobs: [{ name: 'migrate', envs: [{ key: 'ADMIN_SEED_EMAIL' }] }],
  }

  test('accepts a live spec that shares components with the one being deployed', () => {
    expect(liveSpecUnreadable(spec, liveSpec)).toBe(false)
  })

  // The shapes doctl could return if its output changed: each one makes every component look new,
  // which is indistinguishable from a first deploy except that the app id was already resolved.
  test.each([
    ['undefined', undefined],
    ['an empty object', {}],
    ['empty sections', { services: [], jobs: [] }],
    ['an unexpected wrapper', { app: { services: [{ name: 'api', envs: [] }] } }],
  ])('catches a read that returned %s, which would deploy every secret empty', (_label, live) => {
    expect(liveSpecUnreadable(spec, live)).toBe(true)
  })

  test('does not fire when one component of several is genuinely new', () => {
    const live = { services: [{ name: 'api', envs: [{ key: 'JWT_SECRET', value: 'EV[x]' }] }] }

    expect(liveSpecUnreadable(spec, live)).toBe(false)
  })

  test('says nothing about a spec that declares no env at all', () => {
    expect(liveSpecUnreadable({ static_sites: [{ name: 'website' }] }, {})).toBe(false)
  })
})

describe('usesAppLevelEnvs', () => {
  test('is false for the shipped shape, where every variable belongs to a component', () => {
    expect(usesAppLevelEnvs({ services: [{ name: 'api', envs: [] }] }, liveSpec)).toBe(false)
  })

  test('catches the block on either side, since either way a secret would vanish silently', () => {
    expect(usesAppLevelEnvs({ envs: [{ key: 'SHARED' }] }, liveSpec)).toBe(true)
    expect(usesAppLevelEnvs({ services: [] }, { envs: [{ key: 'SHARED', value: 'EV[x]' }] })).toBe(true)
  })

  test('ignores an empty block, which would otherwise ask for variables that are not there', () => {
    expect(usesAppLevelEnvs({ envs: [] }, { envs: [] })).toBe(false)
  })
})

describe('updateDecisions', () => {
  // The single-component shape of the shipped webapp and website specs, where several guards
  // recognise the same evidence and only one of them has the right message.
  const singleComponent = {
    static_sites: [{ name: 'webapp', envs: [{ key: 'VITE_API_URL', value: 'https://api.x' }] }],
  }

  // Declares exactly what the running app has, which is the steady state a routine deploy is in.
  const inSync = {
    services: [
      {
        name: 'api',
        envs: [
          { key: 'JWT_SECRET', scope: 'RUN_TIME' },
          { key: 'CORS_ORIGINS', scope: 'RUN_TIME', value: 'https://app.example.com' },
          { key: 'EMAIL_RESEND_API_KEY', scope: 'BUILD_TIME' },
        ],
      },
    ],
  }

  test('a routine deploy with nothing changed refuses nothing and reports nothing', () => {
    expect(updateDecisions(inSync, liveSpec)).toEqual({ refusals: [], reports: [] })
  })

  test('a rename refuses once, naming the removal and its escape rather than blaming doctl', () => {
    const renamed = {
      static_sites: [{ name: 'acme-webapp', envs: [{ key: 'VITE_API_URL', value: 'https://api.x' }] }],
    }
    const { refusals } = updateDecisions(renamed, singleComponent)

    expect(refusals).toHaveLength(1)
    expect(refusals[0]).toContain('--allow-remove')
    expect(refusals[0]).not.toContain('doctl apps get')
  })

  test('--allow-remove lets that rename through instead of re-arming the other guard', () => {
    const renamed = {
      static_sites: [{ name: 'acme-webapp', envs: [{ key: 'VITE_API_URL', value: 'https://api.x' }] }],
    }

    expect(updateDecisions(renamed, singleComponent, { allowRemove: true }).refusals).toEqual([])
  })

  test('still refuses a read that returned nothing usable, which produces no removal', () => {
    const { refusals } = updateDecisions(singleComponent, { app: { static_sites: [] } })

    expect(refusals).toHaveLength(1)
    expect(refusals[0]).toContain('none of the spec')
  })

  test('reports a variable set in the console that the spec does not declare', () => {
    // The natural mistake this design invites: the operator sets a key in the console, where
    // credentials are supposed to live, without adding it to the spec first.
    const withoutTheKey = {
      services: [{ name: 'api', envs: inSync.services[0].envs.slice(0, 2) }],
    }
    const { refusals, reports } = updateDecisions(withoutTheKey, liveSpec)

    expect(refusals).toEqual([])
    expect(reports.join('\n')).toContain('api.EMAIL_RESEND_API_KEY')
  })
})

describe('droppedEnvKeys', () => {
  test('names live keys the spec omits, which applying the spec deletes', () => {
    const spec = { services: [{ name: 'api', envs: [{ key: 'JWT_SECRET' }] }] }

    expect(droppedEnvKeys(spec, liveSpec)).toEqual(['api.CORS_ORIGINS', 'api.EMAIL_RESEND_API_KEY'])
  })

  test('says nothing when the spec declares everything the app has', () => {
    const spec = {
      services: [
        {
          name: 'api',
          envs: [{ key: 'JWT_SECRET' }, { key: 'CORS_ORIGINS' }, { key: 'EMAIL_RESEND_API_KEY' }],
        },
      ],
    }

    expect(droppedEnvKeys(spec, liveSpec)).toEqual([])
  })

  test('ignores a component the spec does not have, which the removal check owns', () => {
    expect(droppedEnvKeys({ services: [] }, liveSpec)).toEqual([])
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

  test('rejects a secret written into the spec, which committing would publish', () => {
    const problems = specProblems({
      services: [
        { name: 'api', envs: [{ key: 'JWT_SECRET', type: 'SECRET', value: 'a'.repeat(64) }] },
      ],
    })

    expect(problems).toHaveLength(1)
    expect(problems[0]).toContain('type SECRET with a value written in')
  })

  test('accepts the two secret spellings that are not credentials', () => {
    expect(
      specProblems({
        services: [
          {
            name: 'api',
            envs: [
              // A binding to the managed database, and DigitalOcean's own ciphertext after a round trip.
              { key: 'DATABASE_URL', type: 'SECRET', value: '${acme-db.DATABASE_URL}' },
              { key: 'JWT_SECRET', type: 'SECRET', value: 'EV[1:abc:def]' },
              { key: 'PRIVATE_STORAGE_ACCESS_KEY_ID', type: 'SECRET' },
            ],
          },
        ],
      }),
    ).toEqual([])
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
