import { describe, expect, test } from 'bun:test'

import {
  activeRevision,
  cloudMismatches,
  environmentArguments,
  missingConfigKeys,
  parseDeployConfig,
  pendingPhases,
} from './release-yc.mjs'

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
      { id: 'newest', status: 'ERROR', environment: { A: 'broken' } },
      { id: 'live', status: 'ACTIVE', environment: { A: 'good' } },
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
  test('skips what is already recorded as done, so a resumed release repeats nothing', () => {
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
