import { expect, test } from 'bun:test';

import {
  isSamePushInstallationMutation,
  nextPushInstallationRegistration,
  parsePushInstallationRegistration,
} from '../src/features/notifications/push-installation-state';

const installationId = '018fd4f2-1f3a-7c88-bc49-333333333333';
const installationSecret = '118fd4f2-1f3a-4c88-bc49-333333333333';

test('missing legacy installation state starts one persistent monotonic identity', () => {
  const first = nextPushInstallationRegistration(
    null,
    () => installationId,
    () => installationSecret,
  );
  const restored = parsePushInstallationRegistration(JSON.stringify(first));
  const afterRestart = nextPushInstallationRegistration(
    restored,
    () => {
      throw new Error('must reuse the persisted installation id');
    },
    () => {
      throw new Error('must reuse the persisted installation secret');
    },
  );

  expect(first).toEqual({
    generation: 1,
    installationId,
    installationSecret,
    registeredUserId: null,
  });
  expect(afterRestart).toEqual({
    generation: 2,
    installationId,
    installationSecret,
    registeredUserId: null,
  });
});

test('invalid or exhausted installation state fails closed', () => {
  expect(parsePushInstallationRegistration('not-json')).toBeNull();
  expect(parsePushInstallationRegistration(JSON.stringify({
    generation: 0,
    installationId,
    installationSecret,
    registeredUserId: null,
  }))).toBeNull();
  expect(() => nextPushInstallationRegistration({
    generation: 2_147_483_647,
    installationId,
    installationSecret,
    registeredUserId: 'account-a',
  }, () => installationId, () => installationSecret)).toThrow('generation is exhausted');
});

test('local completion is accepted only for the exact persisted mutation', () => {
  const current = {
    generation: 2,
    installationId,
    installationSecret,
    registeredUserId: 'account-b',
  };

  expect(isSamePushInstallationMutation(current, {
    generation: 1,
    installationId,
    installationSecret,
  })).toBe(false);
  expect(isSamePushInstallationMutation(current, {
    generation: 2,
    installationId,
    installationSecret,
  })).toBe(true);
});
