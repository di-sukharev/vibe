import { describe, expect, test } from 'bun:test'
import { spawn } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  activeDeploymentCommitProblems,
  backendEnvironment,
  bootstrapStateMode,
  digitalOceanCliEnvironment,
  digitalOceanSpacesKeyProblems,
  digitalOceanTeamIdentityProblems,
  digestFromRepoDigests,
  executePromotionPipeline,
  githubRepositoryFromRemoteUrl,
  immutableReleaseBranch,
  nonImportableResourceProblem,
  importReleaseInputs,
  parseArguments,
  parseSimpleAssignments,
  planSafetyProblems,
  prepareBootstrapBackend,
  protectedYandexSecretVersionDestroyAddresses,
  finalizeStateRecovery,
  prepareStateRecoveryAccess,
  productionMutationNeedsLease,
  redactArguments,
  releaseGitProblems,
  renderBackendConfig,
  safeTerraformOutputs,
  safeYandexFoundationDestroyAddresses,
  safeYandexMigrationSeedDestroyAddresses,
  sanitizedBuildEnvironment,
  safeYandexSecretVersionDestroyAddresses,
  s3CredentialEnvironment,
  seedVariables,
  stateKeyForRoot,
  stateRecoveryOutputs,
  staticUploadSteps,
  verifyYandexStaticCommit,
  withProductionMutationLease,
  yandexDatabaseRotationProblems,
  yandexRuntimeStateProblems,
  writeYandexStaticReleaseMarkers,
  yieldToProcessEvents,
} from './infra.mjs'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')

describe('Terraform configuration helpers', () => {
  test('reads only simple top-level tfvars without evaluating interpolation', () => {
    expect(
      parseSimpleAssignments(`
        # Durable project configuration.
        cloud_id = "cloud-id"
        git_branch = 'master' # trailing comment
        enable_cdn = false
        runtime_image_digest = null
        database_blue_password = "\${NOT_EXECUTED}"
        subnets = {
          ru-central1-a = "10.20.0.0/24"
        }
      `),
    ).toEqual({
      cloud_id: 'cloud-id',
      git_branch: 'master',
      enable_cdn: false,
      runtime_image_digest: null,
      database_blue_password: '${NOT_EXECUTED}',
    })
  })

  test('renders credential-free backend configuration for both providers', () => {
    const digitalocean = renderBackendConfig('digitalocean', {
      bucket: 'product-state',
      key: 'production/terraform.tfstate',
      region: 'fra1',
    })
    const yandex = renderBackendConfig('yandex', {
      bucket: 'product-state',
      key: 'production/terraform.tfstate',
      region: 'ru-central1',
    })

    expect(digitalocean).toContain('https://fra1.digitaloceanspaces.com')
    expect(digitalocean).toContain('region = "us-east-1"')
    expect(digitalocean).toContain('skip_s3_checksum')
    expect(yandex).toContain('https://storage.yandexcloud.net')
    expect(yandex).toContain('region = "ru-central1"')
    expect(yandex).toContain('skip_s3_checksum')
    expect(digitalocean.match(/skip_credentials_validation/g)).toHaveLength(1)
    expect(yandex.match(/skip_credentials_validation/g)).toHaveLength(1)
    expect(`${digitalocean}\n${yandex}`).not.toContain('secret')
    expect(`${digitalocean}\n${yandex}`).not.toContain('access_key')
  })

  test('keeps foundation state compatible while isolating release roots', () => {
    expect(stateKeyForRoot('bootstrap')).toBe('bootstrap/terraform.tfstate')
    expect(stateKeyForRoot('foundation')).toBe('production/terraform.tfstate')
    expect(stateKeyForRoot('migration')).toBe('migration/terraform.tfstate')
    expect(stateKeyForRoot('runtime')).toBe('runtime/terraform.tfstate')
    expect(stateKeyForRoot('static')).toBe('static/terraform.tfstate')
  })

  test('protects the database credential slot used by the live Yandex runtime', () => {
    const current = {
      fingerprints: { blue: 'blue-old', green: 'green-old', jwt: 'jwt-old' },
      versions: { blue: 1, green: 1 },
    }

    expect(
      yandexDatabaseRotationProblems({
        current,
        liveSlot: 'blue',
        desired: {
          activeSlot: 'green',
          fingerprints: {
            blue: 'blue-old',
            green: 'green-new',
            jwt: 'jwt-old',
          },
          versions: { blue: 1, green: 2 },
        },
      }),
    ).toEqual([])

    expect(
      yandexDatabaseRotationProblems({
        current: {
          fingerprints: {
            blue: 'blue-old',
            green: 'green-new',
            jwt: 'jwt-old',
          },
          versions: { blue: 1, green: 2 },
        },
        liveSlot: 'green',
        desired: {
          activeSlot: 'green',
          fingerprints: {
            blue: 'blue-new',
            green: 'green-new',
            jwt: 'jwt-old',
          },
          versions: { blue: 2, green: 2 },
        },
      }),
    ).toEqual([])

    expect(
      yandexDatabaseRotationProblems({
        current,
        liveSlot: 'blue',
        desired: {
          activeSlot: 'green',
          fingerprints: { blue: 'blue-new', green: 'green-new' },
          versions: { blue: 2, green: 2 },
        },
      }),
    ).toEqual([
      'database credential slot blue is still used by the live runtime; rotate only the inactive slot before switching',
    ])

    expect(
      yandexDatabaseRotationProblems({
        current: {
          fingerprints: {
            blue: 'blue-old',
            green: 'green-new',
            jwt: 'jwt-old',
          },
          versions: { blue: 1, green: 2 },
        },
        liveSlot: 'blue',
        desired: {
          activeSlot: 'green',
          fingerprints: {
            blue: 'blue-old',
            green: 'green-new',
            jwt: 'jwt-old',
          },
          versions: { blue: 1, green: 2 },
        },
      }),
    ).toEqual([])

    expect(
      yandexDatabaseRotationProblems({
        current: null,
        liveSlot: 'blue',
        desired: {
          activeSlot: 'green',
          fingerprints: {
            blue: 'blue-old',
            green: 'green-new',
            jwt: 'jwt-old',
          },
          versions: { blue: 1, green: 2 },
        },
      }),
    ).toEqual([
      'the live runtime reports database slot blue, but foundation rotation metadata is missing; import or reconcile state before changing credentials',
    ])

    expect(
      yandexDatabaseRotationProblems({
        current,
        liveSlot: 'blue',
        desired: {
          activeSlot: 'green',
          fingerprints: {
            blue: 'blue-old',
            green: 'green-old',
            jwt: 'jwt-new',
          },
          versions: { blue: 1, green: 1 },
        },
      }),
    ).toEqual([
      'JWT_SECRET is present in both persistent runtime slot versions; rotate it only after implementing an application key-overlap flow',
    ])
  })

  test('fails closed when Yandex runtime resources exist without runtime state', () => {
    const foundationMetadata = {
      fingerprints: { blue: 'blue', green: 'green', jwt: 'jwt' },
      versions: { blue: 1, green: 1 },
    }

    expect(
      yandexRuntimeStateProblems({
        foundationMetadata: null,
        deployedContainerNames: ['example-product-prod-api'],
        projectSlug: 'example-product',
      }),
    ).toEqual([])
    expect(
      yandexRuntimeStateProblems({
        foundationMetadata,
        deployedContainerNames: ['example-product-prod-migration'],
        projectSlug: 'example-product',
      }),
    ).toEqual([])
    expect(
      yandexRuntimeStateProblems({
        foundationMetadata,
        deployedContainerNames: [
          'example-product-prod-api',
          'example-product-prod-outbox',
        ],
        projectSlug: 'example-product',
      }),
    ).toEqual([
      'Yandex runtime state has no credential slot, but deployed runtime containers still exist: example-product-prod-api, example-product-prod-outbox. Recover or import the runtime state before changing foundation credentials.',
    ])
  })

  test('allows replacement only for non-live Yandex Lockbox versions', () => {
    expect(safeYandexSecretVersionDestroyAddresses('blue')).toEqual([
      'yandex_lockbox_secret_version_hashed.runtime["green"]',
      'yandex_lockbox_secret_version_hashed.migration_database',
    ])
    expect(safeYandexSecretVersionDestroyAddresses(null)).toEqual([
      'yandex_lockbox_secret_version_hashed.runtime["blue"]',
      'yandex_lockbox_secret_version_hashed.runtime["green"]',
      'yandex_lockbox_secret_version_hashed.migration_database',
    ])
    expect(protectedYandexSecretVersionDestroyAddresses('blue')).toEqual([
      'yandex_lockbox_secret_version_hashed.runtime["blue"]',
    ])
  })

  test('allows only the known ephemeral Yandex cleanup deletes on restart', () => {
    const interruptedFoundationPlan = {
      resource_changes: [
        {
          address:
            'yandex_resourcemanager_folder_iam_member.storage_manager[0]',
          change: { actions: ['delete'] },
        },
      ],
    }
    const interruptedSeedCleanupPlan = {
      resource_changes: [
        {
          address: 'yandex_lockbox_secret.admin_seed[0]',
          change: { actions: ['delete'] },
        },
        {
          address:
            'yandex_lockbox_secret_version_hashed.admin_seed[0]',
          change: { actions: ['delete'] },
        },
        {
          address: 'yandex_lockbox_secret_iam_member.admin_seed[0]',
          change: { actions: ['delete'] },
        },
      ],
    }

    expect(
      planSafetyProblems(
        interruptedFoundationPlan,
        safeYandexFoundationDestroyAddresses(),
      ),
    ).toEqual([])
    expect(
      planSafetyProblems(
        interruptedSeedCleanupPlan,
        safeYandexMigrationSeedDestroyAddresses(),
      ),
    ).toEqual([])
    expect(safeYandexFoundationDestroyAddresses()).toEqual([
      'yandex_resourcemanager_folder_iam_member.storage_manager[0]',
    ])
    expect(safeYandexMigrationSeedDestroyAddresses()).toEqual([
      'yandex_lockbox_secret.admin_seed[0]',
      'yandex_lockbox_secret_version_hashed.admin_seed[0]',
      'yandex_lockbox_secret_iam_member.admin_seed[0]',
    ])
  })

  test('copyable production examples leave environment-injected secrets unassigned', () => {
    const digitalocean = parseSimpleAssignments(
      readFileSync(
        resolve(
          repoRoot,
          'infra/digitalocean/production/terraform.tfvars.example',
        ),
        'utf8',
      ),
    )
    const yandex = parseSimpleAssignments(
      readFileSync(
        resolve(repoRoot, 'infra/yandex/production/terraform.tfvars.example'),
        'utf8',
      ),
    )

    expect(digitalocean).not.toHaveProperty('jwt_secret')
    expect(digitalocean).not.toHaveProperty('extra_runtime_secret_env')
    expect(yandex).not.toHaveProperty('database_blue_password')
    expect(yandex).not.toHaveProperty('database_green_password')
    expect(yandex).not.toHaveProperty('database_owner_password')
    expect(yandex).not.toHaveProperty('jwt_secret')
  })

  test('resumes local-to-remote migration after an interrupted bootstrap', () => {
    expect(
      bootstrapStateMode({ hasStateEnvironment: false, hasLocalState: false }),
    ).toBe('ambiguous')
    expect(
      bootstrapStateMode({
        hasStateEnvironment: false,
        hasLocalState: false,
        newBootstrap: true,
      }),
    ).toBe('local')
    expect(
      bootstrapStateMode({ hasStateEnvironment: false, hasLocalState: true }),
    ).toBe('local')
    expect(
      bootstrapStateMode({ hasStateEnvironment: true, hasLocalState: true }),
    ).toBe('migrate')
    expect(
      bootstrapStateMode({ hasStateEnvironment: true, hasLocalState: false }),
    ).toBe('remote')
    expect(
      bootstrapStateMode({
        hasStateEnvironment: false,
        hasLocalState: false,
        recoverExisting: true,
      }),
    ).toBe('recover')
  })

  test('builds reattach configuration only from paired recovery signals', () => {
    expect(
      stateRecoveryOutputs(
        { bucket: 'existing-state', region: 'fra1' },
        {
          TF_STATE_RECOVERY_ACCESS_KEY_ID: 'temporary-id',
          TF_STATE_RECOVERY_SECRET_ACCESS_KEY: 'temporary-secret',
        },
      ),
    ).toEqual({
      state_bucket: 'existing-state',
      state_region: 'fra1',
      state_access_key_id: 'temporary-id',
      state_secret_access_key: 'temporary-secret',
    })
    expect(() =>
      stateRecoveryOutputs(
        { bucket: 'existing-state', region: 'fra1' },
        { TF_STATE_RECOVERY_ACCESS_KEY_ID: 'temporary-id' },
      ),
    ).toThrow('TF_STATE_RECOVERY_SECRET_ACCESS_KEY')
  })

  test('keeps temporary recovery credentials in memory so an interrupted reattach can retry', () => {
    const outputs = {
      state_bucket: 'existing-state',
      state_region: 'fra1',
      state_access_key_id: 'temporary-id',
      state_secret_access_key: 'temporary-secret',
    }
    const events = []
    const prepare = () =>
      prepareStateRecoveryAccess(
        {
          provider: 'digitalocean',
          outputs,
          paths: { roots: { foundation: '/foundation' } },
          baseEnvironment: { KEEP_ME: 'yes' },
        },
        {
          writeConfiguration: () => events.push('write-backend-config'),
        },
      )

    expect(prepare()).toEqual({
      KEEP_ME: 'yes',
      AWS_ACCESS_KEY_ID: 'temporary-id',
      AWS_SECRET_ACCESS_KEY: 'temporary-secret',
    })
    expect(prepare()).toEqual(prepare())
    expect(events).toEqual([
      'write-backend-config',
      'write-backend-config',
      'write-backend-config',
    ])
  })

  test('writes the managed recovery marker only after every backend accepts the managed key', () => {
    const events = []
    const input = {
      provider: 'yandex',
      paths: { bootstrapRoot: '/bootstrap', roots: { runtime: '/runtime' } },
      managedOutputs: {
        state_bucket: 'state-bucket',
        state_region: 'ru-central1',
        state_access_key_id: 'managed-id',
        state_secret_access_key: 'managed-secret',
      },
      expectedStateBucket: 'state-bucket',
      baseEnvironment: {},
    }
    const operations = {
      verifyBootstrap: () => events.push('verify-bootstrap'),
      initializeRoot: (rootName) => events.push(`init-${rootName}`),
      writeArtifacts: () => events.push('write-marker'),
    }

    finalizeStateRecovery(input, operations)
    expect(events).toEqual([
      'verify-bootstrap',
      'init-runtime',
      'write-marker',
    ])

    events.length = 0
    expect(() =>
      finalizeStateRecovery(input, {
        ...operations,
        initializeRoot: () => {
          throw new Error('runtime backend rejected managed key')
        },
      }),
    ).toThrow('runtime backend rejected managed key')
    expect(events).toEqual(['verify-bootstrap'])
  })

  test('verifies migrated state before deleting local recovery state', () => {
    const events = []
    const outputs = {
      state_bucket: 'state-bucket',
      state_region: 'fra1',
      state_access_key_id: 'scoped-id',
      state_secret_access_key: 'scoped-secret',
    }

    prepareBootstrapBackend(
      {
        provider: 'digitalocean',
        paths: { bootstrapRoot: '/bootstrap', productionRoot: '/production' },
        stateMode: 'migrate',
        dryRun: false,
        remoteEnvironment: { AWS_ACCESS_KEY_ID: 'scoped-id' },
        expectedStateBucket: 'state-bucket',
      },
      {
        initialize: (_root, _env, args) => events.push(['init', ...args]),
        readOutputs: () => {
          events.push(['verify'])
          return outputs
        },
        removeLocalState: () => events.push(['remove-local-state']),
        writeArtifacts: () => events.push(['write-artifacts']),
      },
    )

    expect(events).toEqual([
      [
        'init',
        '-migrate-state',
        '-force-copy',
        '-backend-config=backend.backend.hcl',
      ],
      ['verify'],
      ['remove-local-state'],
      ['write-artifacts'],
    ])
  })

  test('keeps local state when remote migration verification fails', () => {
    const events = []

    expect(() =>
      prepareBootstrapBackend(
        {
          provider: 'yandex',
          paths: { bootstrapRoot: '/bootstrap', productionRoot: '/production' },
          stateMode: 'migrate',
          dryRun: false,
          remoteEnvironment: {},
          expectedStateBucket: 'expected-state-bucket',
        },
        {
          initialize: () => events.push('init'),
          readOutputs: () => ({
            state_bucket: 'wrong-state-bucket',
            state_region: 'ru-central1',
            state_access_key_id: 'scoped-id',
            state_secret_access_key: 'scoped-secret',
          }),
          removeLocalState: () => events.push('remove-local-state'),
          writeArtifacts: () => events.push('write-artifacts'),
        },
      ),
    ).toThrow('different state bucket')
    expect(events).toEqual(['init'])
  })

  test('refuses to plan against an empty remote bootstrap state', () => {
    expect(() =>
      prepareBootstrapBackend(
        {
          provider: 'digitalocean',
          paths: { bootstrapRoot: '/bootstrap', productionRoot: '/production' },
          stateMode: 'remote',
          dryRun: false,
          remoteEnvironment: {},
        },
        {
          initialize: () => {},
          readOutputs: () => ({}),
        },
      ),
    ).toThrow('required state outputs')
  })

  test('maps the scoped state key only to the S3 backend environment', () => {
    expect(
      backendEnvironment(
        {
          TF_STATE_ACCESS_KEY_ID: 'scoped-id',
          TF_STATE_SECRET_ACCESS_KEY: 'scoped-secret',
        },
        {
          KEEP_ME: 'yes',
          AWS_SESSION_TOKEN: 'stale-session',
          AWS_SECURITY_TOKEN: 'stale-security-token',
        },
      ),
    ).toEqual({
      KEEP_ME: 'yes',
      AWS_ACCESS_KEY_ID: 'scoped-id',
      AWS_SECRET_ACCESS_KEY: 'scoped-secret',
    })
    expect(() =>
      backendEnvironment({ TF_STATE_ACCESS_KEY_ID: 'only-one' }),
    ).toThrow('state backend credentials')

    expect(
      s3CredentialEnvironment(
        { accessKey: 'publisher-id', secretKey: 'publisher-secret' },
        {
          AWS_SESSION_TOKEN: 'stale-session',
          AWS_SECURITY_TOKEN: 'stale-security-token',
        },
      ),
    ).toEqual({
      AWS_ACCESS_KEY_ID: 'publisher-id',
      AWS_SECRET_ACCESS_KEY: 'publisher-secret',
    })
  })
})

describe('release safety', () => {
  test('forces doctl to use the same token and default context as Terraform', () => {
    expect(
      digitalOceanCliEnvironment({
        DIGITALOCEAN_TOKEN: 'terraform-token',
        DIGITALOCEAN_ACCESS_TOKEN: 'stale-doctl-token',
        DIGITALOCEAN_CONTEXT: 'another-team',
        KEEP_ME: 'yes',
      }),
    ).toEqual({
      DIGITALOCEAN_TOKEN: 'terraform-token',
      DIGITALOCEAN_ACCESS_TOKEN: 'terraform-token',
      DIGITALOCEAN_CONTEXT: 'default',
      KEEP_ME: 'yes',
    })
    expect(() => digitalOceanCliEnvironment({})).toThrow(
      'DIGITALOCEAN_TOKEN',
    )
  })

  test('requires the account token to see the exact Spaces administration key', () => {
    expect(
      digitalOceanSpacesKeyProblems(
        JSON.stringify({ access_key: 'spaces-key-id' }),
        'spaces-key-id',
      ),
    ).toEqual([])
    expect(
      digitalOceanSpacesKeyProblems(
        JSON.stringify({ access_key: 'key-from-another-team' }),
        'spaces-key-id',
      ),
    ).toEqual(['the returned Spaces key does not match SPACES_ACCESS_KEY_ID'])
    expect(
      digitalOceanSpacesKeyProblems('{"unexpected":true}', 'spaces-key-id'),
    ).toEqual(['the DigitalOcean response contains no Spaces access key'])
  })

  test('pins DigitalOcean mutations to the immutable expected team UUID', () => {
    expect(
      digitalOceanTeamIdentityProblems(
        JSON.stringify({ team: { uuid: 'team-uuid', name: 'Production' } }),
        'team-uuid',
      ),
    ).toEqual([])
    expect(
      digitalOceanTeamIdentityProblems(
        JSON.stringify({ team: { uuid: 'other-team', name: 'Production' } }),
        'team-uuid',
      ),
    ).toEqual([
      'DigitalOcean token belongs to team UUID other-team, expected team-uuid',
    ])
  })

  test('holds one production lease until the complete mutation settles', async () => {
    const events = []
    await expect(
      withProductionMutationLease(
        async () => ({
          assertHeld: () => events.push('assert-held'),
          release: () => events.push('release'),
        }),
        async ({ assertHeld }) => {
          events.push('runtime')
          assertHeld()
          events.push('static')
          return 'complete'
        },
      ),
    ).resolves.toBe('complete')
    expect(events).toEqual([
      'assert-held',
      'runtime',
      'assert-held',
      'static',
      'assert-held',
      'release',
    ])

    events.length = 0
    await expect(
      withProductionMutationLease(
        async () => ({ release: () => events.push('release') }),
        async () => {
          throw new Error('mutation failed')
        },
      ),
    ).rejects.toThrow('mutation failed')
    expect(events).toEqual(['release'])
  })

  test('serializes competing production mutations and releases the scope for retry', async () => {
    let held = false
    const acquire = async () => {
      if (held) throw new Error('lease already held')
      held = true
      return {
        assertHeld: () => {
          if (!held) throw new Error('lease lost')
        },
        release: () => {
          held = false
        },
      }
    }
    let finishFirst
    const first = withProductionMutationLease(
      acquire,
      () => new Promise((resolve) => (finishFirst = resolve)),
    )
    await Promise.resolve()

    await expect(
      withProductionMutationLease(acquire, async () => 'second'),
    ).rejects.toThrow('lease already held')
    finishFirst('first')
    await expect(first).resolves.toBe('first')
    await expect(
      withProductionMutationLease(acquire, async () => 'retry'),
    ).resolves.toBe('retry')
  })

  test('locks only commands that mutate provider production state', () => {
    expect(
      productionMutationNeedsLease({ command: 'apply', dryRun: false }),
    ).toBe(true)
    expect(
      productionMutationNeedsLease({ command: 'release', dryRun: false }),
    ).toBe(true)
    expect(
      productionMutationNeedsLease({
        command: 'import',
        rootName: 'runtime',
        dryRun: false,
      }),
    ).toBe(true)
    expect(
      productionMutationNeedsLease({
        command: 'import',
        rootName: 'bootstrap',
        dryRun: false,
      }),
    ).toBe(false)
    expect(
      productionMutationNeedsLease({ command: 'apply', dryRun: true }),
    ).toBe(false)
    expect(
      productionMutationNeedsLease({ command: 'plan', dryRun: true }),
    ).toBe(false)
  })

  test('normalizes supported GitHub remote URLs to the App Platform repository form', () => {
    expect(
      githubRepositoryFromRemoteUrl('git@github.com:Owner/Repository.git'),
    ).toBe('owner/repository')
    expect(
      githubRepositoryFromRemoteUrl('https://github.com/Owner/Repository.git'),
    ).toBe('owner/repository')
    expect(
      githubRepositoryFromRemoteUrl(
        'ssh://git@github.com/Owner/Repository.git',
      ),
    ).toBe('owner/repository')
    expect(
      githubRepositoryFromRemoteUrl('git@gitlab.com:owner/repository.git'),
    ).toBeNull()
  })

  test('refuses a dirty, detached, unpushed, wrong-ref, or wrong-repository release source', () => {
    expect(
      releaseGitProblems({
        currentBranch: 'master',
        configuredBranch: 'production',
        upstreamRef: 'origin/other',
        headCommit: 'local-commit',
        upstreamCommit: 'remote-commit',
        configuredGithubRepo: 'owner/product',
        upstreamGithubRepo: 'someone/else',
        dirtyLines: [' M backend/src/index.ts'],
      }),
    ).toHaveLength(5)

    expect(
      releaseGitProblems({
        currentBranch: 'master',
        configuredBranch: 'master',
        upstreamRef: 'origin/master',
        headCommit: 'same-commit',
        upstreamCommit: 'same-commit',
        configuredGithubRepo: 'owner/product',
        upstreamGithubRepo: 'owner/product',
        dirtyLines: [],
      }),
    ).toEqual([])

    expect(
      releaseGitProblems({
        currentBranch: 'master',
        configuredBranch: 'master',
        upstreamRef: 'origin/master',
        headCommit: 'new-commit',
        upstreamCommit: 'new-commit',
        expectedCommit: 'captured-commit',
        configuredGithubRepo: 'owner/product',
        upstreamGithubRepo: 'owner/product',
        dirtyLines: [],
      }),
    ).toEqual([
      'release source changed after preflight: expected captured-commit, found new-commit',
    ])

    expect(
      releaseGitProblems({
        currentBranch: 'master',
        configuredBranch: 'master',
        upstreamRef: 'origin/master',
        headCommit: 'captured-commit',
        upstreamCommit: 'newer-upstream-commit',
        expectedCommit: 'captured-commit',
        configuredGithubRepo: 'owner/product',
        upstreamGithubRepo: 'owner/product',
        dirtyLines: [],
      }),
    ).toEqual([])

    expect(
      releaseGitProblems({
        currentBranch: 'feature',
        configuredBranch: undefined,
        upstreamRef: 'origin/feature',
        headCommit: 'same-commit',
        upstreamCommit: 'same-commit',
        configuredGithubRepo: undefined,
        upstreamGithubRepo: 'owner/product',
        githubRepositoryRequired: true,
        dirtyLines: [],
      }),
    ).toEqual([
      'Terraform foundation state does not identify the configured release branch; run bun run infra:apply for the selected provider',
      'Terraform foundation state does not identify the configured GitHub repository; run bun run infra:apply for digitalocean',
    ])
  })

  test('shows only explicitly safe Terraform outputs', () => {
    expect(
      safeTerraformOutputs('yandex', {
        api_url: 'https://api.example.com',
        database_credential_slot: 'green',
        required_dns_records: { api: { value: 'gateway.example' } },
        static_publisher_access_key_id: 'public-but-operationally-secret',
        static_publisher_secret_access_key: 'secret',
      }),
    ).toEqual({
      api_url: 'https://api.example.com',
      database_credential_slot: 'green',
      required_dns_records: { api: { value: 'gateway.example' } },
    })
  })

  test('allows creates and updates, but requires exact opt-in for ordinary deletes', () => {
    const plan = {
      resource_changes: [
        { address: 'digitalocean_app.api[0]', change: { actions: ['update'] } },
        {
          address: 'digitalocean_app.website[0]',
          change: { actions: ['delete'] },
        },
      ],
    }

    expect(planSafetyProblems(plan, [])).toEqual([
      'digitalocean_app.website[0] would be deleted; pass --allow-destroy=digitalocean_app.website[0] only after reviewing that exact resource',
    ])
    expect(planSafetyProblems(plan, ['digitalocean_app.website[0]'])).toEqual(
      [],
    )
  })

  test('never accepts deletion or replacement of protected stateful resources', () => {
    const plan = {
      resource_changes: [
        {
          address: 'yandex_mdb_postgresql_cluster.production',
          change: { actions: ['delete', 'create'] },
        },
        {
          address: 'yandex_storage_bucket.media',
          change: { actions: ['delete'] },
        },
        {
          address:
            'yandex_iam_service_account_static_access_key.terraform_state',
          change: { actions: ['delete', 'create'] },
        },
        {
          address: 'digitalocean_spaces_key.media',
          change: { actions: ['delete', 'create'] },
        },
        {
          address:
            'yandex_iam_service_account_static_access_key.media',
          change: { actions: ['delete', 'create'] },
        },
        {
          address:
            'yandex_iam_service_account_static_access_key.postbox[0]',
          change: { actions: ['delete', 'create'] },
        },
      ],
    }

    const problems = planSafetyProblems(plan, [
      'yandex_mdb_postgresql_cluster.production',
      'yandex_storage_bucket.media',
      'yandex_iam_service_account_static_access_key.terraform_state',
      'digitalocean_spaces_key.media',
      'yandex_iam_service_account_static_access_key.media',
      'yandex_iam_service_account_static_access_key.postbox[0]',
    ])
    expect(problems).toHaveLength(6)
    expect(problems.every((problem) => problem.includes('protected'))).toBe(
      true,
    )
  })

  test('never accepts manual deletion of the active Yandex runtime secret version', () => {
    const activeVersion =
      'yandex_lockbox_secret_version_hashed.runtime["blue"]'
    const plan = {
      resource_changes: [
        {
          address: activeVersion,
          change: { actions: ['delete', 'create'] },
        },
      ],
    }

    expect(
      planSafetyProblems(
        plan,
        [activeVersion],
        protectedYandexSecretVersionDestroyAddresses('blue'),
      ),
    ).toEqual([
      `${activeVersion} is protected and would be replaced; this release path refuses it`,
    ])
  })

  test('executes provider phases in migration-gated order', async () => {
    const digitaloceanEvents = []
    await executePromotionPipeline('digitalocean', {
      deployRuntime: async () => {
        digitaloceanEvents.push('runtime-with-pre-deploy-migration')
        return { api_app_id: 'app-id' }
      },
      tightenFoundation: async () =>
        digitaloceanEvents.push('tighten-firewall'),
      deployStatic: async () => {
        digitaloceanEvents.push('static')
        return { release_revision: 'commit' }
      },
      verify: async () => digitaloceanEvents.push('verify'),
    })
    expect(digitaloceanEvents).toEqual([
      'runtime-with-pre-deploy-migration',
      'tighten-firewall',
      'static',
      'verify',
    ])

    const yandexEvents = []
    await expect(
      executePromotionPipeline('yandex', {
        deployMigration: async () => {
          yandexEvents.push('migration-revision')
          return { url: 'migration-url' }
        },
        invokeMigration: async () => {
          yandexEvents.push('invoke-migration')
          throw new Error('migration failed')
        },
        removeMigrationSeed: async () => yandexEvents.push('remove-seed'),
        deployRuntime: async () => yandexEvents.push('runtime'),
        publishStatic: async () => yandexEvents.push('static'),
        verify: async () => yandexEvents.push('verify'),
      }),
    ).rejects.toThrow('migration failed')
    expect(yandexEvents).toEqual(['migration-revision', 'invoke-migration'])

    const successfulYandexEvents = []
    await executePromotionPipeline('yandex', {
      deployMigration: async () => {
        successfulYandexEvents.push('migration-revision')
        return { url: 'migration-url' }
      },
      invokeMigration: async () => successfulYandexEvents.push('migration-ok'),
      removeMigrationSeed: async () =>
        successfulYandexEvents.push('remove-seed'),
      deployRuntime: async () => {
        successfulYandexEvents.push('runtime')
        return { api_url: 'https://api.example.com' }
      },
      publishStatic: async () => successfulYandexEvents.push('static'),
      verify: async () => successfulYandexEvents.push('verify'),
    })
    expect(successfulYandexEvents).toEqual([
      'migration-revision',
      'migration-ok',
      'remove-seed',
      'runtime',
      'static',
      'verify',
    ])
  })

  test('stops promotion before the next phase when the production lease is lost', async () => {
    const events = []
    let held = true

    await expect(
      executePromotionPipeline(
        'digitalocean',
        {
          deployRuntime: async () => {
            events.push('runtime')
            held = false
          },
          tightenFoundation: async () => events.push('tighten'),
          deployStatic: async () => events.push('static'),
          verify: async () => events.push('verify'),
        },
        () => {
          events.push('assert-held')
          if (!held) throw new Error('production mutation lease was lost')
        },
      ),
    ).rejects.toThrow('production mutation lease was lost')
    expect(events).toEqual(['assert-held', 'runtime', 'assert-held'])
  })

  test('observes a lease process exit after a synchronous phase', async () => {
    const events = []
    let leaseChild
    let settled = false

    try {
      await expect(
        executePromotionPipeline(
          'digitalocean',
          {
            deployRuntime: async () => {
              events.push('runtime')
              leaseChild = spawn(process.execPath, ['-e', 'process.exit(7)'], {
                stdio: 'ignore',
              })
              leaseChild.once('close', () => {
                settled = true
              })
              Atomics.wait(
                new Int32Array(new SharedArrayBuffer(4)),
                0,
                0,
                150,
              )
            },
            tightenFoundation: async () => events.push('tighten'),
            deployStatic: async () => events.push('static'),
            verify: async () => events.push('verify'),
          },
          async () => {
            await yieldToProcessEvents()
            events.push('assert-held')
            if (settled) throw new Error('production mutation lease was lost')
          },
        ),
      ).rejects.toThrow('production mutation lease was lost')
    } finally {
      if (leaseChild && !settled) {
        leaseChild.kill('SIGTERM')
        await new Promise((resolveClose) =>
          leaseChild.once('close', resolveClose),
        )
      }
    }

    expect(events).toEqual(['assert-held', 'runtime', 'assert-held'])
  })

  test('pins DigitalOcean static source to one immutable commit branch', () => {
    const commit = '0123456789abcdef0123456789abcdef01234567'
    expect(immutableReleaseBranch(commit)).toBe(`infra-release/${commit}`)
    expect(() => immutableReleaseBranch('short')).toThrow('40-character')

    expect(
      activeDeploymentCommitProblems(
        [
          {
            phase: 'ACTIVE',
            static_sites: [{ name: 'webapp', source_commit_hash: commit }],
          },
        ],
        commit,
        'webapp',
      ),
    ).toEqual([])
    expect(
      activeDeploymentCommitProblems(
        {
          deployments: [
            {
              phase: 'ACTIVE',
              static_sites: [
                { name: 'website', source_commit_hash: 'wrong-commit' },
              ],
            },
          ],
        },
        commit,
        'website',
      ),
    ).toEqual([`website deployed wrong-commit, expected ${commit}`])
  })

  test('requires adoption inputs that materialize conditional release roots', () => {
    const digest = `sha256:${'a'.repeat(64)}`
    const commit = '0123456789abcdef0123456789abcdef01234567'
    expect(
      importReleaseInputs('digitalocean', 'runtime', {
        runtimeImageDigest: digest,
      }),
    ).toMatchObject({ runtime_image_digest: digest })
    expect(
      importReleaseInputs('digitalocean', 'static', {
        releaseRevision: commit,
        sourceBranch: `infra-release/${commit}`,
      }),
    ).toEqual({
      release_revision: commit,
      source_branch: `infra-release/${commit}`,
    })
    expect(() =>
      importReleaseInputs('digitalocean', 'static', {
        releaseRevision: commit,
        sourceBranch: `infra-release/${'f'.repeat(40)}`,
      }),
    ).toThrow('must identify the same commit')
    expect(
      importReleaseInputs('yandex', 'migration', {
        runtimeImageDigest: digest,
      }),
    ).toMatchObject({ migration_image_digest: digest })
    expect(() => importReleaseInputs('yandex', 'runtime', {})).toThrow(
      '--runtime-image-digest',
    )
  })

  test('rejects provider access keys that cannot be imported or recover secrets', () => {
    expect(
      nonImportableResourceProblem(
        'digitalocean',
        'digitalocean_spaces_key.media',
      ),
    ).toContain('create a new Terraform-owned key')
    expect(
      nonImportableResourceProblem(
        'yandex',
        'yandex_iam_service_account_static_access_key.static_publisher',
      ),
    ).toContain('create a new Terraform-owned key')
    expect(
      nonImportableResourceProblem(
        'yandex',
        'yandex_storage_bucket.media',
      ),
    ).toBeNull()
  })

  test('parses explicit import roots and adoption values', () => {
    const commit = '0123456789abcdef0123456789abcdef01234567'
    expect(
      parseArguments([
        'import',
        'digitalocean',
        'static',
        'digitalocean_app.webapp',
        'app-id',
        `--release-revision=${commit}`,
        `--source-branch=infra-release/${commit}`,
      ]),
    ).toMatchObject({
      provider: 'digitalocean',
      rootName: 'static',
      resourceAddress: 'digitalocean_app.webapp',
      resourceId: 'app-id',
      releaseRevision: commit,
      sourceBranch: `infra-release/${commit}`,
    })
  })

  test('requires explicit and unambiguous bootstrap creation or recovery flags', () => {
    expect(parseArguments(['bootstrap', 'yandex', '--new'])).toMatchObject({
      newBootstrap: true,
    })
    expect(
      parseArguments([
        'bootstrap',
        'digitalocean',
        '--recover-state-bucket=existing-state',
        '--recover-state-region=fra1',
      ]),
    ).toMatchObject({
      recoverStateBucket: 'existing-state',
      recoverStateRegion: 'fra1',
    })
    expect(() =>
      parseArguments([
        'bootstrap',
        'yandex',
        '--recover-state-bucket=existing-state',
      ]),
    ).toThrow('both --recover-state-bucket and --recover-state-region')
    expect(() =>
      parseArguments([
        'bootstrap',
        'yandex',
        '--new',
        '--recover-state-bucket=existing-state',
        '--recover-state-region=ru-central1',
      ]),
    ).toThrow('mutually exclusive')
  })

  test('extracts only a digest belonging to the pushed repository', () => {
    const digest = 'sha256:d'.padEnd(71, 'd')
    expect(
      digestFromRepoDigests(
        [
          'registry.example/other@sha256:eeee',
          `registry.example/product/backend@${digest}`,
        ],
        'registry.example/product/backend',
      ),
    ).toBe(digest)
    expect(() =>
      digestFromRepoDigests([], 'registry.example/product/backend'),
    ).toThrow('immutable digest')
  })

  test('redacts credential-shaped arguments before logging commands', () => {
    const rendered = redactArguments([
      'plan',
      '-var',
      'jwt_secret=super-secret',
      '--header',
      'Authorization: Bearer token-value',
      '--normal',
      'visible',
    ]).join(' ')

    expect(rendered).not.toContain('super-secret')
    expect(rendered).not.toContain('token-value')
    expect(rendered).toContain('visible')
    expect(rendered).toContain('[REDACTED]')
  })

  test('does not expose cloud or Terraform secrets to frontend build processes', () => {
    expect(
      sanitizedBuildEnvironment({
        PATH: '/tools',
        HOME: '/home/builder',
        TF_VAR_database_blue_password: 'blue-database-secret',
        TF_VAR_database_green_password: 'green-database-secret',
        DIGITALOCEAN_TOKEN: 'do-secret',
        SPACES_SECRET_ACCESS_KEY: 'spaces-secret',
        AWS_SECRET_ACCESS_KEY: 'aws-secret',
        YC_TOKEN: 'yc-secret',
        ADMIN_SEED_PASSWORD: 'seed-secret',
        DATABASE_URL: 'database-url',
        JWT_SECRET: 'jwt-secret',
      }),
    ).toEqual({ PATH: '/tools', HOME: '/home/builder' })
  })

  test('accepts an administrator bootstrap pair but refuses a partial secret', () => {
    expect(
      seedVariables({
        ADMIN_SEED_EMAIL: ' owner@example.com ',
        ADMIN_SEED_PASSWORD: 'one-time-password',
      }),
    ).toEqual({
      admin_seed_email: 'owner@example.com',
      admin_seed_password: 'one-time-password',
    })
    expect(seedVariables({})).toBeNull()
    expect(() =>
      seedVariables({ ADMIN_SEED_EMAIL: 'owner@example.com' }),
    ).toThrow('must be supplied together')
  })
})

describe('Yandex static publishing', () => {
  test('keeps old immutable assets but deletes stale mutable routes', () => {
    const steps = staticUploadSteps({
      distDirectory: '/repo/webapp/dist',
      bucket: 'app.example.com',
      immutableDirectory: 'assets',
    })

    expect(steps).toHaveLength(2)
    expect(steps[0].args.join(' ')).toContain('--include assets/*')
    expect(steps[0].args.join(' ')).toContain('immutable')
    expect(steps[0].args).not.toContain('--delete')
    expect(steps[1].args.join(' ')).toContain('--exclude assets/*')
    expect(steps[1].args).toContain('--delete')
  })

  test('publishes and verifies the captured commit instead of accepting stale content', async () => {
    const commit = '0123456789abcdef0123456789abcdef01234567'
    const artifactRoot = mkdtempSync(resolve(tmpdir(), 'infra-static-marker-'))

    try {
      writeYandexStaticReleaseMarkers(artifactRoot, commit)
      expect(
        readFileSync(
          resolve(artifactRoot, 'webapp', '.well-known', 'release-revision'),
          'utf8',
        ),
      ).toBe(`${commit}\n`)
      expect(
        readFileSync(
          resolve(artifactRoot, 'website', '.well-known', 'release-revision'),
          'utf8',
        ),
      ).toBe(`${commit}\n`)
    } finally {
      rmSync(artifactRoot, { recursive: true, force: true })
    }

    const requestedUrls = []
    await verifyYandexStaticCommit(
      {
        webapp_url: 'https://app.example.com',
        website_url: 'https://www.example.com',
      },
      commit,
      {
        fetchImpl: async (url) => {
          requestedUrls.push(String(url))
          return new Response(`${commit}\n`, { status: 200 })
        },
        sleepImpl: async () => {},
      },
    )
    expect(requestedUrls).toEqual([
      `https://app.example.com/.well-known/release-revision?revision=${commit}`,
      `https://www.example.com/.well-known/release-revision?revision=${commit}`,
    ])

    await expect(
      verifyYandexStaticCommit(
        {
          webapp_url: 'https://app.example.com',
          website_url: 'https://www.example.com',
        },
        commit,
        {
          fetchImpl: async () => new Response('stale-commit\n', { status: 200 }),
          sleepImpl: async () => {},
        },
      ),
    ).rejects.toThrow(`expected ${commit}`)
  })
})
