export class PushRegistrationCoordinator {
  private readonly active = new Set<Promise<unknown>>();

  run<T>(operation: () => Promise<T>) {
    const promise = Promise.resolve().then(operation);
    this.active.add(promise);
    void promise.finally(() => {
      this.active.delete(promise);
    }).catch(() => undefined);
    return promise;
  }

  async drain(timeoutMs = 2_000) {
    const drain = async () => {
      while (this.active.size > 0) {
        await Promise.allSettled([...this.active]);
      }
    };
    await settleWithin(drain(), timeoutMs);
  }
}

function settleWithin(operation: Promise<void>, timeoutMs: number) {
  return new Promise<void>((resolve) => {
    const timeout = setTimeout(resolve, timeoutMs);
    void operation.then(
      () => {
        clearTimeout(timeout);
        resolve();
      },
      () => {
        clearTimeout(timeout);
        resolve();
      },
    );
  });
}
