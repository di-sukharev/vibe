import { describe, expect, test } from 'bun:test'

import {
  activeRevision,
  cloudMismatches,
  environmentArguments,
  missingConfigKeys,
  parseDeployConfig,
  pendingPhases,
  redactArguments,
  revisionEnvironment,
  unreproducibleRevisionFields,
} from './release-yc.mjs'

/**
 * Shaped after what `yc serverless container revision list --format json` actually returns: keys
 * in snake_case, and `environment` nested inside `image` rather than at the revision root.
 *
 * That nesting is the whole point of these tests. Reading `revision.environment` looks right, is
 * always undefined, and deploys a container with no configuration at all.
 */
const liveRevision = {
  id: 'bba1revision',
  container_id: 'bba1container',
  created_at: '2026-08-01T10:00:00Z',
  status: 'ACTIVE',
  runtime: { http: {} },
  service_account_id: 'ajelive',
  concurrency: '1',
  execution_timeout: '30s',
  resources: { memory: '1073741824', cores: '1', core_fraction: '5' },
  image: {
    image_url: 'cr.yandex/crp/acme-backend:abc1234',
    image_digest: 'sha256:dead',
    environment: { DATABASE_URL: 'postgresql://live/db', JWT_SECRET: 'live-secret' },
  },
  // Yandex fills these in on every revision, configured or not. Their presence in the fixture is
  // the point: without them the refusal guard looks correct and refuses every real release.
  log_options: { folder_id: 'b1gfolder' },
  metadata_options: { gce_http_endpoint: 'ENABLED', aws_v1_http_endpoint: 'DISABLED' },
}

describe('parseDeployConfig', () => {
  test('reads keys, ignores comments and blanks, and strips surrounding quotes', () => {
    const config = parseDeployConfig(
      [
        '# the cloud this project deploys to',
        'YC_EXPECTED_CLOUD_ID=b1gxxxxxxxxx',
        '',
        "YC_IMAGE_NAME='acme-backend'",
        'YC_API_MEMORY="1GB"',
        'not a pair',
      ].join('\n'),
    )

    expect(config).toEqual({
      YC_EXPECTED_CLOUD_ID: 'b1gxxxxxxxxx',
      YC_IMAGE_NAME: 'acme-backend',
      YC_API_MEMORY: '1GB',
    })
  })

  test('keeps everything after the first equals sign, so a connection string survives', () => {
    const config = parseDeployConfig('YC_HEALTH_URL=https://api.example.com/health/ready?deep=1')

    expect(config.YC_HEALTH_URL).toBe('https://api.example.com/health/ready?deep=1')
  })

  test('reports every missing required key at once', () => {
    expect(missingConfigKeys({ YC_REGISTRY_ID: 'crp', YC_IMAGE_NAME: '   ' })).toEqual([
      'YC_EXPECTED_CLOUD_ID',
      'YC_EXPECTED_FOLDER_ID',
      'YC_IMAGE_NAME',
      'YC_API_CONTAINER',
      'YC_SERVICE_ACCOUNT_ID',
    ])
  })
})

describe('activeRevision', () => {
  test('prefers the ACTIVE revision over a newer failed one', () => {
    const revisions = [
      { id: 'newest', status: 'ERROR', image: { environment: { A: 'broken' } } },
      { id: 'live', status: 'ACTIVE', image: { environment: { A: 'good' } } },
    ]

    expect(activeRevision(revisions).id).toBe('live')
  })

  test('falls back to the newest when nothing is marked active', () => {
    expect(activeRevision([{ id: 'newest' }, { id: 'older' }]).id).toBe('newest')
  })

  test('returns undefined for a container with no revisions yet', () => {
    expect(activeRevision([])).toBeUndefined()
    expect(activeRevision(undefined)).toBeUndefined()
  })
})

describe('revisionEnvironment', () => {
  test('reads the environment from inside image, where the provider actually puts it', () => {
    expect(revisionEnvironment(liveRevision)).toEqual({
      DATABASE_URL: 'postgresql://live/db',
      JWT_SECRET: 'live-secret',
    })
  })

  test('reads it through the camelCase spelling the API reference uses', () => {
    expect(revisionEnvironment({ image: { imageUrl: 'x', environment: { A: '1' } } })).toEqual({
      A: '1',
    })
  })

  test('is empty for a container with no revision, rather than throwing', () => {
    expect(revisionEnvironment(undefined)).toEqual({})
    expect(revisionEnvironment({})).toEqual({})
  })
})

describe('unreproducibleRevisionFields', () => {
  test('accepts a revision built only from settings the release re-passes', () => {
    expect(unreproducibleRevisionFields(liveRevision)).toEqual([])
  })

  test('refuses Lockbox secrets and a VPC attachment, which a new revision would drop', () => {
    expect(
      unreproducibleRevisionFields({
        ...liveRevision,
        secrets: [{ id: 'e6q', environment_variable: 'API_KEY' }],
        connectivity: { network_id: 'enp' },
      }),
    ).toEqual(['connectivity', 'secrets'])
  })

  test('refuses logging the operator configured, which a new revision would reset', () => {
    expect(
      unreproducibleRevisionFields({
        ...liveRevision,
        log_options: { folder_id: 'b1gfolder', min_level: 'WARN' },
      }),
    ).toEqual(['log_options'])
    expect(
      unreproducibleRevisionFields({ ...liveRevision, log_options: { disabled: true } }),
    ).toEqual(['log_options'])
  })

  // The provider documents the enum's unspecified member as the default, and the CLI has been seen
  // returning resolved values instead. Both spellings mean "nobody chose this", and accepting only
  // one would refuse every release rather than protect anything.
  test('accepts an untouched revision in either spelling the provider may use', () => {
    expect(
      unreproducibleRevisionFields({
        ...liveRevision,
        log_options: { folder_id: 'b1gfolder', min_level: 'LOG_LEVEL_UNSPECIFIED' },
        metadata_options: {
          gce_http_endpoint: 'METADATA_OPTION_UNSPECIFIED',
          aws_v1_http_endpoint: 'METADATA_OPTION_UNSPECIFIED',
        },
      }),
    ).toEqual([])
  })

  test('refuses a task-runtime container, which would otherwise be rebuilt as http', () => {
    expect(unreproducibleRevisionFields({ ...liveRevision, runtime: { task: {} } })).toEqual([
      'runtime',
    ])
  })

  test('refuses a metadata endpoint someone closed, which defaults back to open', () => {
    expect(
      unreproducibleRevisionFields({
        ...liveRevision,
        metadata_options: { gce_http_endpoint: 'DISABLED', aws_v1_http_endpoint: 'DISABLED' },
      }),
    ).toEqual(['metadata_options'])
  })

  test('refuses a field the provider adds later, instead of silently discarding it', () => {
    expect(
      unreproducibleRevisionFields({ ...liveRevision, some_future_setting: { enabled: true } }),
    ).toEqual(['some_future_setting'])
  })

  test('matches camelCase too, so the guard cannot pass everything by reading the wrong spelling', () => {
    expect(unreproducibleRevisionFields({ ...liveRevision, storageMounts: [{ bucket: 'b' }] })).toEqual(
      ['storage_mounts'],
    )
  })

  test('ignores empty collections, which carry nothing to lose', () => {
    expect(
      unreproducibleRevisionFields({ ...liveRevision, secrets: [], connectivity: {}, mounts: null }),
    ).toEqual([])
  })

  test('refuses a custom entrypoint, which lives under image and is not re-passed', () => {
    expect(
      unreproducibleRevisionFields({
        ...liveRevision,
        image: { ...liveRevision.image, command: { command: ['bun'] } },
      }),
    ).toEqual(['image.command'])
  })

  test('has nothing to refuse when there is no revision yet', () => {
    expect(unreproducibleRevisionFields(undefined)).toEqual([])
  })
})

describe('redactArguments', () => {
  test('hides environment values while keeping the keys readable', () => {
    expect(
      redactArguments([
        'revision', 'deploy',
        '--environment', 'JWT_SECRET=live-secret',
        '--environment', 'CORS_ORIGINS=https://app.example.com',
        '--image', 'cr.yandex/crp/acme-backend:abc1234',
      ]),
    ).toEqual([
      'revision', 'deploy',
      '--environment', 'JWT_SECRET=<hidden>',
      '--environment', 'CORS_ORIGINS=<hidden>',
      '--image', 'cr.yandex/crp/acme-backend:abc1234',
    ])
  })

  test('leaves a value that merely contains an equals sign elsewhere alone', () => {
    expect(redactArguments(['--args', 'run,db:deploy'])).toEqual(['--args', 'run,db:deploy'])
  })
})

describe('environmentArguments', () => {
  test('emits one flag per variable so a multi-origin value is not split on its commas', () => {
    expect(
      environmentArguments({
        CORS_ORIGINS: 'https://app.example.com,https://www.example.com',
        COOKIE_SECURE: 'true',
      }),
    ).toEqual([
      '--environment',
      'CORS_ORIGINS=https://app.example.com,https://www.example.com',
      '--environment',
      'COOKIE_SECURE=true',
    ])
  })

  test('passes a connection string with query parameters through unchanged', () => {
    expect(
      environmentArguments({ DATABASE_URL: 'postgresql://h/db?sslmode=require&x=1' }),
    ).toEqual(['--environment', 'DATABASE_URL=postgresql://h/db?sslmode=require&x=1'])
  })

  test('refuses a value yc would parse as CSV, rather than deploying a mangled one', () => {
    expect(() => environmentArguments({ ODD: 'a=1,b=2' })).toThrow(/parses as CSV/)
  })

  test('refuses a quote in that branch, which yc rejects by echoing the value itself', () => {
    expect(() =>
      environmentArguments({ DATABASE_URL: 'postgresql://u:pa"ss@h/db?sslmode=require' }),
    ).toThrow(/parses as CSV/)
  })

  test('refuses a line break, which cannot survive the command line', () => {
    expect(() => environmentArguments({ KEY: 'line\nbreak' })).toThrow(/line break/)
  })

  test('treats an empty environment as no arguments', () => {
    expect(environmentArguments(undefined)).toEqual([])
  })
})

describe('cloudMismatches', () => {
  const expected = { YC_EXPECTED_CLOUD_ID: 'cloud-a', YC_EXPECTED_FOLDER_ID: 'folder-a' }

  test('accepts a profile pointing at the recorded cloud and folder', () => {
    expect(cloudMismatches({ 'cloud-id': 'cloud-a', 'folder-id': 'folder-a' }, expected)).toEqual([])
  })

  test('names the wrong folder, the expensive mistake, without printing anything else', () => {
    expect(cloudMismatches({ 'cloud-id': 'cloud-a', 'folder-id': 'folder-b' }, expected)).toEqual([
      'folder-id is folder-b, expected folder-a',
    ])
  })

  test('reports an unset profile value rather than treating it as a match', () => {
    expect(cloudMismatches({}, expected)).toEqual([
      'cloud-id is unset, expected cloud-a',
      'folder-id is unset, expected folder-a',
    ])
  })
})

describe('pendingPhases', () => {
  // `migrate` was a phase before migrations moved to the runbook. Leaving it in the input covers
  // both properties at once: completed phases are skipped, and a phase left in an older state file
  // is ignored rather than needing a migration.
  test('skips what is recorded as done, including a phase that no longer exists', () => {
    expect(pendingPhases({ completed: ['build-push', 'migrate'] })).toEqual([
      'deploy',
      'publish-web',
      'verify',
    ])
  })

  test('runs one named phase on its own even when it already completed', () => {
    expect(pendingPhases({ completed: ['deploy'] }, { only: 'deploy' })).toEqual(['deploy'])
  })

  test('starts from an explicit phase, still skipping completed ones after it', () => {
    expect(
      pendingPhases({ completed: ['publish-web'] }, { from: 'deploy' }),
    ).toEqual(['deploy', 'verify'])
  })

  test('reports nothing pending for a finished release', () => {
    const completed = ['build-push', 'migrate', 'deploy', 'publish-web', 'verify']

    expect(pendingPhases({ completed })).toEqual([])
  })
})
