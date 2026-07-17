import { expect, mock, test } from 'bun:test';

import { consumeInitialNotificationResponse } from '../src/features/notifications/notification-response';

test('consumes and clears the initial notification response exactly once', async () => {
  const response = { id: 'notification-1' };
  const clear = mock(async () => undefined);
  const handle = mock(() => undefined);

  await consumeInitialNotificationResponse({
    clear,
    get: async () => response,
    handle,
    isCancelled: () => false,
  });

  expect(handle).toHaveBeenCalledWith(response);
  expect(clear).toHaveBeenCalledTimes(1);
});

test('clears initial notification state when handling fails or the listener is cancelled', async () => {
  const failedClear = mock(async () => undefined);
  await expect(
    consumeInitialNotificationResponse({
      clear: failedClear,
      get: async () => ({ id: 'notification-2' }),
      handle: () => {
        throw new Error('navigation failed');
      },
      isCancelled: () => false,
    }),
  ).rejects.toThrow('navigation failed');
  expect(failedClear).toHaveBeenCalledTimes(1);

  const cancelledClear = mock(async () => undefined);
  const cancelledHandle = mock(() => undefined);
  await consumeInitialNotificationResponse({
    clear: cancelledClear,
    get: async () => ({ id: 'notification-3' }),
    handle: cancelledHandle,
    isCancelled: () => true,
  });
  expect(cancelledHandle).not.toHaveBeenCalled();
  expect(cancelledClear).toHaveBeenCalledTimes(1);
});

test('attempts to clear stale native state even when reading the initial response fails', async () => {
  const clear = mock(async () => undefined);

  await expect(
    consumeInitialNotificationResponse({
      clear,
      get: async () => {
        throw new Error('native read failed');
      },
      handle: () => undefined,
      isCancelled: () => false,
    }),
  ).rejects.toThrow('native read failed');
  expect(clear).toHaveBeenCalledTimes(1);
});
