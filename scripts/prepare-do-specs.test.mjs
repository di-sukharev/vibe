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

  test('rejects incomplete and invalid notification recovery cron settings', () => {
    const incomplete = runPrepareSpecs({
      DO_BACKEND_NOTIFICATION_CRON_NAME: 'notification-recovery',
    });
    expect(incomplete.status).not.toBe(0);
    expect(`${incomplete.stdout}\n${incomplete.stderr}`).toContain(
      'DO_BACKEND_NOTIFICATION_CRON_SCHEDULE is required',
    );

    const invalid = runPrepareSpecs({
      DO_BACKEND_NOTIFICATION_CRON_NAME: 'notification-recovery',
      DO_BACKEND_NOTIFICATION_CRON_SCHEDULE: '* * * * *',
    });
    expect(invalid.status).not.toBe(0);
    expect(`${invalid.stdout}\n${invalid.stderr}`).toContain(
      'must not run more often than every 15 minutes',
    );
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
    expect(spec).not.toContain('key: ENABLE_TEST_PUSH');
    expect(spec).not.toContain('REPLACE_WITH_');
  });

  test('propagates Expo Push access token only to notification consumers', () => {
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
    expect(spec.match(/key: EXPO_PUSH_ACCESS_TOKEN/g)).toHaveLength(2);
    expect(spec.match(/value: "expo-push-secret"/g)).toHaveLength(2);

    const apiBlock = serviceBlock(spec, 'api');
    const workerBlock = workerBlockByName(spec, 'notifications');
    const cronBlock = scheduledJobBlock(spec, 'notifications-process');
    expect(apiBlock).not.toContain('key: EXPO_PUSH_ACCESS_TOKEN');
    expect(workerBlock).toContain('key: EXPO_PUSH_ACCESS_TOKEN');
    expect(workerBlock).not.toContain('key: JWT_SECRET');
    expect(cronBlock).toContain('key: EXPO_PUSH_ACCESS_TOKEN');
  });

  test('generates maintenance and notification recovery as separate scheduled jobs', () => {
    const result = runPrepareSpecs({
      EXPO_PUSH_ACCESS_TOKEN: 'expo-push-secret',
      GOOGLE_PLAY_PACKAGE_NAME: 'com.example.app',
      GOOGLE_PLAY_SERVICE_ACCOUNT_JSON_BASE64: 'google-secret',
      GOOGLE_PLAY_PRODUCT_IDS: 'com.example.app.premium',
      GOOGLE_PLAY_BASE_PLAN_IDS: 'monthly,yearly',
      DO_BACKEND_CRON_NAME: 'maintenance',
      DO_BACKEND_CRON_TASK: 'maintenance:process',
      DO_BACKEND_CRON_SCHEDULE: '*/15 * * * *',
      DO_BACKEND_NOTIFICATION_CRON_NAME: 'notification-recovery',
      DO_BACKEND_NOTIFICATION_CRON_SCHEDULE: '*/15 * * * *',
      DO_BACKEND_NOTIFICATION_CRON_TIME_ZONE: 'Europe/Moscow',
    });

    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);

    const spec = readFileSync(backendSpecPath, 'utf8');
    const maintenance = scheduledJobBlock(spec, 'maintenance');
    const notificationRecovery = scheduledJobBlock(spec, 'notification-recovery');
    expect(maintenance).toContain('run_command: "bun run start:cron -- maintenance:process"');
    expect(maintenance).toContain('key: GOOGLE_PLAY_SERVICE_ACCOUNT_JSON_BASE64');
    expect(maintenance).not.toContain('key: EXPO_PUSH_ACCESS_TOKEN');
    expect(notificationRecovery).toContain(
      'run_command: "bun run start:cron -- notifications:process"',
    );
    expect(notificationRecovery).toContain('time_zone: "Europe/Moscow"');
    expect(notificationRecovery).toContain('key: EXPO_PUSH_ACCESS_TOKEN');
    expect(notificationRecovery).not.toContain('key: GOOGLE_PLAY_SERVICE_ACCOUNT_JSON_BASE64');
    expect(notificationRecovery).not.toContain('key: JWT_SECRET');
  });

  test('rejects scheduled job name and task collisions for notification recovery', () => {
    const nameCollision = runPrepareSpecs({
      DO_BACKEND_CRON_NAME: 'maintenance',
      DO_BACKEND_CRON_TASK: 'maintenance:process',
      DO_BACKEND_CRON_SCHEDULE: '*/15 * * * *',
      DO_BACKEND_NOTIFICATION_CRON_NAME: 'Maintenance',
      DO_BACKEND_NOTIFICATION_CRON_SCHEDULE: '*/15 * * * *',
    });
    expect(nameCollision.status).not.toBe(0);
    expect(`${nameCollision.stdout}\n${nameCollision.stderr}`).toContain(
      'component name "maintenance" conflicts with scheduled job',
    );

    const duplicateTask = runPrepareSpecs({
      DO_BACKEND_CRON_NAME: 'notifications-primary',
      DO_BACKEND_CRON_TASK: 'notifications:process',
      DO_BACKEND_CRON_SCHEDULE: '*/15 * * * *',
      DO_BACKEND_NOTIFICATION_CRON_NAME: 'notifications-recovery',
      DO_BACKEND_NOTIFICATION_CRON_SCHEDULE: '*/15 * * * *',
    });
    expect(duplicateTask.status).not.toBe(0);
    expect(`${duplicateTask.stdout}\n${duplicateTask.stderr}`).toContain(
      'already configures notifications:process',
    );
  });

  test('keeps optional runtime env scoped to the components that consume it', () => {
    const result = runPrepareSpecs({
      ENABLE_TEST_PUSH: 'true',
      EXPO_PUSH_ACCESS_TOKEN: 'expo-push-secret',
      SPACES_REGION: 'nyc3',
      SPACES_BUCKET: 'uploads',
      SPACES_ENDPOINT: 'https://nyc3.digitaloceanspaces.com',
      SPACES_ACCESS_KEY_ID: 'access-key',
      SPACES_SECRET_ACCESS_KEY: 'storage-secret',
      GOOGLE_PLAY_PACKAGE_NAME: 'com.example.app',
      GOOGLE_PLAY_SERVICE_ACCOUNT_JSON_BASE64: 'google-secret',
      GOOGLE_PLAY_PRODUCT_IDS: 'com.example.app.premium',
      GOOGLE_PLAY_BASE_PLAN_IDS: 'monthly,yearly',
      DO_BACKEND_WORKER_ENABLED: 'true',
      DO_BACKEND_WORKER_NAME: 'notifications',
      DO_BACKEND_WORKER_RUN_COMMAND: 'bun run start:worker:notifications',
      DO_BACKEND_CRON_NAME: 'maintenance',
      DO_BACKEND_CRON_TASK: 'maintenance:process',
      DO_BACKEND_CRON_SCHEDULE: '*/15 * * * *',
    });

    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);

    const spec = readFileSync(backendSpecPath, 'utf8');
    const apiBlock = serviceBlock(spec, 'api');
    const workerBlock = workerBlockByName(spec, 'notifications');
    const cronBlock = scheduledJobBlock(spec, 'maintenance');

    expect(apiBlock).toContain(`- key: ENABLE_TEST_PUSH
        value: "true"
        scope: RUN_TIME
        type: GENERAL`);
    expect(apiBlock).not.toContain('key: EXPO_PUSH_ACCESS_TOKEN');
    expect(apiBlock).toContain('key: SPACES_SECRET_ACCESS_KEY');
    expect(apiBlock).toContain('key: GOOGLE_PLAY_SERVICE_ACCOUNT_JSON_BASE64');

    expect(workerBlock).toContain('key: EXPO_PUSH_ACCESS_TOKEN');
    expect(workerBlock).not.toContain('key: ENABLE_TEST_PUSH');
    expect(workerBlock).not.toContain('key: SPACES_SECRET_ACCESS_KEY');
    expect(workerBlock).not.toContain('key: GOOGLE_PLAY_SERVICE_ACCOUNT_JSON_BASE64');

    expect(cronBlock).toContain('key: GOOGLE_PLAY_SERVICE_ACCOUNT_JSON_BASE64');
    expect(cronBlock).not.toContain('key: JWT_SECRET');
    expect(cronBlock).not.toContain('key: ENABLE_TEST_PUSH');
    expect(cronBlock).not.toContain('key: EXPO_PUSH_ACCESS_TOKEN');
    expect(cronBlock).not.toContain('key: SPACES_SECRET_ACCESS_KEY');

    expect(spec.match(/key: ENABLE_TEST_PUSH/g)).toHaveLength(1);
    expect(spec.match(/key: EXPO_PUSH_ACCESS_TOKEN/g)).toHaveLength(1);
    expect(spec.match(/key: SPACES_SECRET_ACCESS_KEY/g)).toHaveLength(1);
    expect(spec.match(/key: GOOGLE_PLAY_SERVICE_ACCOUNT_JSON_BASE64/g)).toHaveLength(2);
  });

  test('does not expose Expo Push access tokens to unrelated background components', () => {
    const result = runPrepareSpecs({
      EXPO_PUSH_ACCESS_TOKEN: 'expo-push-secret',
      DO_BACKEND_WORKER_ENABLED: 'true',
      DO_BACKEND_WORKER_NAME: 'exports',
      DO_BACKEND_WORKER_RUN_COMMAND: 'bun run start:worker:exports',
      DO_BACKEND_CRON_NAME: 'database-ping',
      DO_BACKEND_CRON_TASK: 'db:ping',
      DO_BACKEND_CRON_SCHEDULE: '*/15 * * * *',
    });

    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);

    const spec = readFileSync(backendSpecPath, 'utf8');
    expect(serviceBlock(spec, 'api')).not.toContain('key: EXPO_PUSH_ACCESS_TOKEN');
    expect(workerBlockByName(spec, 'exports')).not.toContain('key: EXPO_PUSH_ACCESS_TOKEN');
    expect(scheduledJobBlock(spec, 'database-ping')).not.toContain('key: EXPO_PUSH_ACCESS_TOKEN');
    expect(spec).not.toContain('key: EXPO_PUSH_ACCESS_TOKEN');
  });

  test('rejects invalid ENABLE_TEST_PUSH values before writing deploy specs', () => {
    const result = runPrepareSpecs({ ENABLE_TEST_PUSH: 'yes' });

    expect(result.status).not.toBe(0);
    expect(`${result.stdout}\n${result.stderr}`).toContain(
      'ENABLE_TEST_PUSH must be true or false',
    );
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

  test('requires complete production App Store settings and marks its private key as secret', () => {
    const incomplete = runPrepareSpecs({ APPLE_IAP_BUNDLE_ID: 'com.example.app' });
    expect(incomplete.status).not.toBe(0);
    expect(`${incomplete.stdout}\n${incomplete.stderr}`).toContain('APPLE_IAP_APP_APPLE_ID');

    const sandbox = runPrepareSpecs({
      APPLE_IAP_BUNDLE_ID: 'com.example.app',
      APPLE_IAP_APP_APPLE_ID: '1234567890',
      APPLE_IAP_ENVIRONMENT: 'Sandbox',
      APPLE_IAP_ISSUER_ID: 'issuer-id',
      APPLE_IAP_KEY_ID: 'key-id',
      APPLE_IAP_PRIVATE_KEY_BASE64: 'private-key',
      APPLE_IAP_PRODUCT_IDS: 'com.example.app.premium.monthly',
    });
    expect(sandbox.status).not.toBe(0);
    expect(`${sandbox.stdout}\n${sandbox.stderr}`).toContain(
      'APPLE_IAP_ENVIRONMENT must be Production',
    );

    const complete = runPrepareSpecs({
      APPLE_IAP_BUNDLE_ID: 'com.example.app',
      APPLE_IAP_APP_APPLE_ID: '1234567890',
      APPLE_IAP_ENVIRONMENT: 'Production',
      APPLE_IAP_ISSUER_ID: 'issuer-id',
      APPLE_IAP_KEY_ID: 'key-id',
      APPLE_IAP_PRIVATE_KEY_BASE64: 'private-key',
      APPLE_IAP_PRODUCT_IDS: 'com.example.app.premium.monthly',
    });
    expect(complete.status).toBe(0);

    const spec = readFileSync(backendSpecPath, 'utf8');
    expect(spec).toContain('key: APPLE_IAP_ENVIRONMENT');
    expect(spec).toContain('value: "Production"');
    expect(spec).toContain('key: APPLE_IAP_ROOT_CERTS_DIR');
    expect(spec).toContain('value: "/app/backend/src/modules/billing/certs/apple"');
    expect(spec).toContain(`key: APPLE_IAP_PRIVATE_KEY_BASE64
        value: "private-key"
        scope: RUN_TIME
        type: SECRET`);
  });

  test('requires complete Google Play settings and marks the service account as secret', () => {
    const incomplete = runPrepareSpecs({ GOOGLE_PLAY_PACKAGE_NAME: 'com.example.app' });
    expect(incomplete.status).not.toBe(0);
    expect(`${incomplete.stdout}\n${incomplete.stderr}`).toContain(
      'GOOGLE_PLAY_SERVICE_ACCOUNT_JSON_BASE64',
    );

    const complete = runPrepareSpecs({
      GOOGLE_PLAY_PACKAGE_NAME: 'com.example.app',
      GOOGLE_PLAY_SERVICE_ACCOUNT_JSON_BASE64: 'service-account-json',
      GOOGLE_PLAY_PRODUCT_IDS: 'com.example.app.premium',
      GOOGLE_PLAY_BASE_PLAN_IDS: 'monthly,yearly',
    });
    expect(complete.status).toBe(0);

    const spec = readFileSync(backendSpecPath, 'utf8');
    expect(spec).toContain(`key: GOOGLE_PLAY_SERVICE_ACCOUNT_JSON_BASE64
        value: "service-account-json"
        scope: RUN_TIME
        type: SECRET`);
    expect(spec).toContain('key: GOOGLE_PLAY_BASE_PLAN_IDS');
  });

  test('requires Google Play credentials for its reconcile cron and scopes them to API and cron', () => {
    const missing = runPrepareSpecs({
      DO_BACKEND_CRON_NAME: 'google-play-reconcile',
      DO_BACKEND_CRON_TASK: 'billing:google-play:reconcile',
      DO_BACKEND_CRON_SCHEDULE: '*/15 * * * *',
    });
    expect(missing.status).not.toBe(0);
    expect(`${missing.stdout}\n${missing.stderr}`).toContain(
      'Google Play IAP settings are required',
    );

    const complete = runPrepareSpecs({
      DO_BACKEND_WORKER_ENABLED: 'true',
      DO_BACKEND_WORKER_NAME: 'notifications',
      DO_BACKEND_WORKER_RUN_COMMAND: 'bun run start:worker:notifications',
      DO_BACKEND_CRON_NAME: 'google-play-reconcile',
      DO_BACKEND_CRON_TASK: 'billing:google-play:reconcile',
      DO_BACKEND_CRON_SCHEDULE: '*/15 * * * *',
      GOOGLE_PLAY_PACKAGE_NAME: 'com.example.app',
      GOOGLE_PLAY_SERVICE_ACCOUNT_JSON_BASE64: 'service-account-json',
      GOOGLE_PLAY_PRODUCT_IDS: 'com.example.app.premium',
      GOOGLE_PLAY_BASE_PLAN_IDS: 'monthly,yearly',
    });
    expect(complete.status).toBe(0);

    const spec = readFileSync(backendSpecPath, 'utf8');
    expect(spec.match(/key: GOOGLE_PLAY_PACKAGE_NAME/g)).toHaveLength(2);
    expect(spec.match(/key: GOOGLE_PLAY_SERVICE_ACCOUNT_JSON_BASE64/g)).toHaveLength(2);

    const workerBlock = spec.slice(spec.indexOf('workers:'), spec.indexOf('jobs:'));
    expect(workerBlock).not.toContain('GOOGLE_PLAY_SERVICE_ACCOUNT_JSON_BASE64');
  });

  test('keeps maintenance usable without billing and injects Google Play credentials when enabled', () => {
    const withoutBilling = runPrepareSpecs({
      DO_BACKEND_CRON_NAME: 'maintenance',
      DO_BACKEND_CRON_TASK: 'maintenance:process',
      DO_BACKEND_CRON_SCHEDULE: '*/15 * * * *',
    });
    expect(withoutBilling.status).toBe(0);
    expect(readFileSync(backendSpecPath, 'utf8')).not.toContain(
      'GOOGLE_PLAY_SERVICE_ACCOUNT_JSON_BASE64',
    );

    const withBilling = runPrepareSpecs({
      DO_BACKEND_CRON_NAME: 'maintenance',
      DO_BACKEND_CRON_TASK: 'maintenance:process',
      DO_BACKEND_CRON_SCHEDULE: '*/15 * * * *',
      GOOGLE_PLAY_PACKAGE_NAME: 'com.example.app',
      GOOGLE_PLAY_SERVICE_ACCOUNT_JSON_BASE64: 'service-account-json',
      GOOGLE_PLAY_PRODUCT_IDS: 'com.example.app.premium',
      GOOGLE_PLAY_BASE_PLAN_IDS: 'monthly,yearly',
    });
    expect(withBilling.status).toBe(0);
    expect(
      readFileSync(backendSpecPath, 'utf8').match(
        /key: GOOGLE_PLAY_SERVICE_ACCOUNT_JSON_BASE64/g,
      ),
    ).toHaveLength(2);
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

function serviceBlock(spec, name) {
  return componentBlock(spec, `  - name: ${name}\n`, ['\nworkers:', '\njobs:']);
}

function workerBlockByName(spec, name) {
  return componentBlock(spec, `  - name: ${name}\n`, ['\njobs:']);
}

function scheduledJobBlock(spec, name) {
  return componentBlock(
    spec,
    `  - name: ${name}\n    kind: SCHEDULED\n`,
    ['\n  - name: '],
  );
}

function componentBlock(spec, marker, endMarkers) {
  const start = spec.indexOf(marker);
  expect(start).toBeGreaterThanOrEqual(0);

  const ends = endMarkers
    .map((endMarker) => spec.indexOf(endMarker, start + marker.length))
    .filter((end) => end >= 0);
  const end = ends.length > 0 ? Math.min(...ends) : spec.length;
  return spec.slice(start, end);
}
