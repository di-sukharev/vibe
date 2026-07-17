export async function consumeInitialNotificationResponse<T>({
  clear,
  get,
  handle,
  isCancelled,
}: {
  clear: () => void | Promise<void>;
  get: () => T | null | Promise<T | null>;
  handle: (response: T) => void;
  isCancelled: () => boolean;
}) {
  try {
    const response = await get();
    if (response && !isCancelled()) {
      handle(response);
    }
  } finally {
    await clear();
  }
}
