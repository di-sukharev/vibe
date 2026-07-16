import { spawnSync } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, test } from 'bun:test';

const repoRoot = resolve(import.meta.dirname, '..');
const backendSpecPath = resolve(repoRoot, '.scratch/deploy/backend-app.yaml');

describe('prepare-do-specs', () => {
  test('rejects placeholder and obviously weak production JWT secrets', () => {
    for (const jwtSecret of [
      'replace-with-at-least-32-random-characters',
      'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    ]) {
      const result = runPrepareSpecs({ JWT_SECRET: jwtSecret });

      expect(result.status).not.toBe(0);
      expect(`${result.stdout}\n${result.stderr}`).toContain('JWT_SECRET');
    }
  });

  test('rejects the placeholder backend worker command', () => {
    const result = runPrepareSpecs({
      DO_BACKEND_WORKER_ENABLED: 'true',
      DO_BACKEND_WORKER_RUN_COMMAND: 'bun run start:worker',
    });

    expect(result.status).not.toBe(0);
    expect(`${result.stdout}\n${result.stderr}`).toContain(
      'must point at a real long-running worker command',
    );
  });

  test('rejects component names that collide after normalization', () => {
    const serviceCollision = runPrepareSpecs({
      DO_BACKEND_WORKER_ENABLED: 'true',
      DO_BACKEND_WORKER_NAME: 'API',
      DO_BACKEND_WORKER_RUN_COMMAND: 'bun run start:worker:notifications',
    });
    expect(serviceCollision.status).not.toBe(0);
    expect(`${serviceCollision.stdout}\n${serviceCollision.stderr}`).toContain(
      'component name "api" conflicts with API service',
    );

    const optionalCollision = runPrepareSpecs({
      DO_BACKEND_WORKER_ENABLED: 'true',
      DO_BACKEND_WORKER_NAME: 'maintenance',
      DO_BACKEND_WORKER_RUN_COMMAND: 'bun run start:worker:notifications',
      DO_BACKEND_CRON_NAME: 'maintenance',
      DO_BACKEND_CRON_TASK: 'db:ping',
      DO_BACKEND_CRON_SCHEDULE: '0 3 * * *',
    });
    expect(optionalCollision.status).not.toBe(0);
    expect(`${optionalCollision.stdout}\n${optionalCollision.stderr}`).toContain(
      'component name "maintenance" conflicts with backend worker',
    );
  });

  test('rejects App Platform component names shorter than two characters', () => {
    const result = runPrepareSpecs({ DO_DB_COMPONENT_NAME: 'x' });

    expect(result.status).not.toBe(0);
    expect(`${result.stdout}\n${result.stderr}`).toContain(
      'DO_DB_COMPONENT_NAME must normalize to an App Platform component name with 2 to 32 characters',
    );
  });

  test('rejects invalid backend cron schedules before writing deploy specs', () => {
    const result = runPrepareSpecs({
      DO_BACKEND_CRON_NAME: 'daily-maintenance',
      DO_BACKEND_CRON_TASK: 'db:ping',
      DO_BACKEND_CRON_SCHEDULE: '0 3 nope * *',
    });

    expect(result.status).not.toBe(0);
    expect(`${result.stdout}\n${result.stderr}`).toContain('day-of-month field');
  });

  test('rejects unsupported App Platform instance size slugs', () => {
    const result = runPrepareSpecs({
      DO_API_INSTANCE_SIZE_SLUG: 'expensive-surprise',
    });

    expect(result.status).not.toBe(0);
    expect(`${result.stdout}\n${result.stderr}`).toContain(
      'DO_API_INSTANCE_SIZE_SLUG must be one of:',
    );
  });

  test('rejects deployment spec generation from a different checkout branch', () => {
    const result = runPrepareSpecs(
      {
        DO_GIT_BRANCH: 'codex-deploy-branch-mismatch-test',
      },
      { skipReleaseGitCheck: false },
    );

    expect(result.status).not.toBe(0);
    expect(`${result.stdout}\n${result.stderr}`).toContain('Deployment branch mismatch');
  });

  test('generates explicit backend worker and cron job blocks', () => {
    const result = runPrepareSpecs({
      DO_BACKEND_WORKER_ENABLED: 'true',
      DO_BACKEND_WORKER_NAME: 'notifications',
      DO_BACKEND_WORKER_RUN_COMMAND: 'bun run start:worker:notifications',
      DO_BACKEND_CRON_NAME: 'daily-maintenance',
      DO_BACKEND_CRON_TASK: 'db:ping',
      DO_BACKEND_CRON_SCHEDULE: '0 3 * * *',
      DO_BACKEND_CRON_TIME_ZONE: 'Europe/Moscow',
    });

    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);

    const spec = readFileSync(backendSpecPath, 'utf8');
    expect(spec).toContain('workers:');
    expect(spec).toContain('  - name: notifications');
    expect(spec).toContain('run_command: "bun run start:worker:notifications"');
    expect(spec).toContain('kind: SCHEDULED');
    expect(spec).toContain('run_command: "bun run start:cron -- db:ping"');
    expect(spec).toContain('time_zone: "Europe/Moscow"');
    expect(spec).toContain(`    http_port: 8080
    instance_size_slug: apps-s-1vcpu-1gb
    instance_count: 1`);
    expect(spec).toContain(`      - key: TRUSTED_PROXY_CLIENT_IP_HEADER
        value: "do-connecting-ip"`);
    expect(spec).toContain('    version: "18"');
    expect(spec).not.toContain('REPLACE_WITH_');
  });

  test('propagates Expo Push access token to backend API, worker, and cron env', () => {
    const result = runPrepareSpecs({
      EXPO_PUSH_ACCESS_TOKEN: 'expo-push-secret',
      DO_BACKEND_WORKER_ENABLED: 'true',
      DO_BACKEND_WORKER_NAME: 'notifications',
      DO_BACKEND_WORKER_RUN_COMMAND: 'bun run start:worker:notifications',
      DO_BACKEND_CRON_NAME: 'notifications-process',
      DO_BACKEND_CRON_TASK: 'notifications:process',
      DO_BACKEND_CRON_SCHEDULE: '*/15 * * * *',
    });

    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);

    const spec = readFileSync(backendSpecPath, 'utf8');
    expect(spec.match(/key: EXPO_PUSH_ACCESS_TOKEN/g)).toHaveLength(3);
    expect(spec.match(/value: "expo-push-secret"/g)).toHaveLength(3);
  });

  test('generates explicit backend API instance sizing overrides', () => {
    const result = runPrepareSpecs({
      DO_API_INSTANCE_SIZE_SLUG: 'apps-s-1vcpu-2gb',
      DO_API_INSTANCE_COUNT: '2',
    });

    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);

    const spec = readFileSync(backendSpecPath, 'utf8');
    expect(spec).toContain(`    http_port: 8080
    instance_size_slug: apps-s-1vcpu-2gb
    instance_count: 2`);
    expect(spec).not.toContain('REPLACE_WITH_');
  });

  test('adds explicitly configured browser origins to backend CORS', () => {
    const result = runPrepareSpecs({
      DO_ADDITIONAL_CORS_ORIGINS: 'https://website.example.com,https://admin.example.com',
    });

    expect(result.status).toBe(0);
    const spec = readFileSync(backendSpecPath, 'utf8');
    expect(spec).toContain(
      'value: "https://webapp.example.com,https://website.example.com,https://admin.example.com"',
    );
  });

  test('rejects independent App Platform default domains for production browser auth', () => {
    const result = runPrepareSpecs({
      DO_AUTH_SITE_DOMAIN: 'ondigitalocean.app',
      DO_BACKEND_URL: 'https://api-abc.ondigitalocean.app',
      DO_WEBAPP_URL: 'https://webapp-xyz.ondigitalocean.app',
    });

    expect(result.status).not.toBe(0);
    expect(`${result.stdout}\n${result.stderr}`).toContain(
      'Independent *.ondigitalocean.app domains are not supported for browser auth',
    );
  });

  test('requires backend and webapp custom domains to share the declared auth site', () => {
    const result = runPrepareSpecs({
      DO_AUTH_SITE_DOMAIN: 'example.com',
      DO_BACKEND_URL: 'https://api.example.com',
      DO_WEBAPP_URL: 'https://webapp.other.example',
    });

    expect(result.status).not.toBe(0);
    expect(`${result.stdout}\n${result.stderr}`).toContain('DO_WEBAPP_URL hostname must belong to DO_AUTH_SITE_DOMAIN');
  });

  test('rejects ICANN and private public suffixes as the declared auth site', () => {
    for (const publicSuffix of ['co.uk', 'pages.dev']) {
      const result = runPrepareSpecs({
        DO_AUTH_SITE_DOMAIN: publicSuffix,
        DO_BACKEND_URL: `https://api.${publicSuffix}`,
        DO_WEBAPP_URL: `https://webapp.${publicSuffix}`,
      });

      expect(result.status).not.toBe(0);
      expect(`${result.stdout}\n${result.stderr}`).toContain(
        'DO_AUTH_SITE_DOMAIN must be a registrable domain, not a public suffix',
      );
    }
  });

  test('rejects credentialed additional browser origins outside the declared auth site', () => {
    const result = runPrepareSpecs({
      DO_ADDITIONAL_CORS_ORIGINS: 'https://admin.other.example',
    });

    expect(result.status).not.toBe(0);
    expect(`${result.stdout}\n${result.stderr}`).toContain(
      'DO_ADDITIONAL_CORS_ORIGINS hostname must belong to DO_AUTH_SITE_DOMAIN',
    );
  });

  test('writes secret-bearing backend specs with owner-only permissions', () => {
    const result = runPrepareSpecs();

    expect(result.status).toBe(0);
    expect(statSync(backendSpecPath).mode & 0o777).toBe(0o600);
  });

  test('rejects project slugs that overflow suffixed App Platform names', () => {
    const result = runPrepareSpecs({
      DO_PROJECT_SLUG: 'a-project-name-that-is-too-long',
    });

    expect(result.status).not.toBe(0);
    expect(`${result.stdout}\n${result.stderr}`).toContain('DO_PROJECT_SLUG');
  });

  test('rejects invalid plain-scalar deployment identifiers before writing YAML', () => {
    const invalidBranch = runPrepareSpecs({ DO_GIT_BRANCH: 'main\nservices: []' });
    expect(invalidBranch.status).not.toBe(0);
    expect(`${invalidBranch.stdout}\n${invalidBranch.stderr}`).toContain('DO_GIT_BRANCH');

    const invalidDatabase = runPrepareSpecs({ DO_DB_NAME: 'defaultdb\nenvs: []' });
    expect(invalidDatabase.status).not.toBe(0);
    expect(`${invalidDatabase.stdout}\n${invalidDatabase.stderr}`).toContain('DO_DB_NAME');
  });

  test('generates a standalone website without requiring a webapp URL', () => {
    const result = runPrepareSpecs(
      { DO_WEBAPP_URL: undefined },
      { target: 'website' },
    );

    expect(result.status).toBe(0);
    const spec = readFileSync(resolve(repoRoot, '.scratch/deploy/website-static-app.yaml'), 'utf8');
    expect(spec).not.toContain('PUBLIC_WEBAPP_URL');
  });

  test('requires complete storage settings and marks credentials as secrets', () => {
    const incomplete = runPrepareSpecs({ SPACES_BUCKET: 'uploads' });
    expect(incomplete.status).not.toBe(0);
    expect(`${incomplete.stdout}\n${incomplete.stderr}`).toContain('SPACES_REGION');

    const complete = runPrepareSpecs({
      SPACES_REGION: 'nyc3',
      SPACES_BUCKET: 'uploads',
      SPACES_ENDPOINT: 'https://nyc3.digitaloceanspaces.com',
      SPACES_ACCESS_KEY_ID: 'access-key',
      SPACES_SECRET_ACCESS_KEY: 'secret-key',
    });
    expect(complete.status).toBe(0);
    const spec = readFileSync(backendSpecPath, 'utf8');
    expect(spec).toContain('key: SPACES_ACCESS_KEY_ID');
    expect(spec).toContain('key: SPACES_SECRET_ACCESS_KEY');
    expect(spec.match(/type: SECRET/g)?.length).toBeGreaterThanOrEqual(3);
  });
});

function runPrepareSpecs(extraEnv = {}, { skipReleaseGitCheck = true, target = 'backend-final' } = {}) {
  const testOnlyEnv = skipReleaseGitCheck
    ? {
        NODE_ENV: 'test',
        DO_SKIP_RELEASE_GIT_CHECK_FOR_TESTS: '1',
      }
    : {};

  return spawnSync(process.execPath, ['scripts/prepare-do-specs.mjs', target], {
    cwd: repoRoot,
    encoding: 'utf8',
    env: {
      PATH: process.env.PATH ?? '',
      HOME: process.env.HOME ?? '',
      ...testOnlyEnv,
      DO_PROJECT_SLUG: 'vibecoding-template-test',
      DO_GITHUB_REPO: 'owner/repo',
      DO_GIT_BRANCH: 'main',
      JWT_SECRET: '0123456789abcdef'.repeat(4),
      DO_AUTH_SITE_DOMAIN: 'example.com',
      DO_BACKEND_URL: 'https://api.example.com',
      DO_WEBAPP_URL: 'https://webapp.example.com',
      ...extraEnv,
    },
  });
}
