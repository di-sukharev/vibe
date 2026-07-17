import { expect, test } from 'bun:test';

import { PushRegistrationCoordinator } from '../src/features/notifications/registration-coordinator';

test('PushRegistrationCoordinator drain waits for registrations that logout must include', async () => {
  const coordinator = new PushRegistrationCoordinator();
  let resolveRegistration: (() => void) | null = null;
  let drained = false;

  const registration = coordinator.run(
    () => new Promise<void>((resolve) => {
      resolveRegistration = resolve;
    }),
  );
  const drain = coordinator.drain().then(() => {
    drained = true;
  });

  await Promise.resolve();
  expect(drained).toBe(false);
  resolveRegistration?.();
  await Promise.all([registration, drain]);
  expect(drained).toBe(true);
});

test('PushRegistrationCoordinator drain is bounded when a native registration hangs', async () => {
  const coordinator = new PushRegistrationCoordinator();
  void coordinator.run(() => new Promise<void>(() => undefined));

  const startedAt = Date.now();
  await coordinator.drain(5);

  expect(Date.now() - startedAt).toBeLessThan(100);
});
