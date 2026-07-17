export type RefreshCredentialStorage = {
  clearLogoutIntent: (browserSessionEpoch?: number) => Promise<void>;
  clearRefreshToken: () => Promise<void>;
  getLogoutIntent: () => Promise<boolean>;
  getRefreshToken: () => Promise<string | null>;
  setLogoutIntent: (browserSessionEpoch?: number) => Promise<void>;
  setRefreshToken: (refreshToken: string) => Promise<void>;
};

export class SessionGenerationChangedError extends Error {
  readonly code = 'AUTH_SESSION_CHANGED';
  readonly status = 409;

  constructor() {
    super('The authenticated session changed while the request was in flight');
  }
}

export class SessionController {
  private accessToken: string | null = null;
  private credentialQueue: Promise<void> = Promise.resolve();
  private expiredHandler: (generation: number) => void | Promise<void> = () => undefined;
  private generation = 0;

  constructor(private readonly storage: RefreshCredentialStorage) {}

  beginTransition = () => {
    this.generation += 1;
    return this.generation;
  };

  getAccessToken = () => this.accessToken;
  getGeneration = () => this.generation;
  getPendingLogout = async () => {
    await this.credentialQueue;
    return this.storage.getLogoutIntent();
  };
  getRefreshToken = () => this.storage.getRefreshToken();
  isGenerationCurrent = (generation: number) => generation === this.generation;

  setAccessToken = (accessToken: string | null, generation = this.generation) => {
    if (!this.isGenerationCurrent(generation)) return false;
    this.accessToken = accessToken;
    return true;
  };

  setRefreshToken = (refreshToken: string, generation = this.generation) =>
    this.enqueueCredentialWrite(generation, () => this.storage.setRefreshToken(refreshToken));

  clearRefreshToken = (generation = this.generation) =>
    this.enqueueCredentialWrite(generation, this.storage.clearRefreshToken);

  markPendingLogout = (
    generation = this.generation,
    browserSessionEpoch?: number,
  ) => this.enqueueCredentialWrite(
    generation,
    () => this.storage.setLogoutIntent(browserSessionEpoch),
  );

  completePendingLogout = (
    generation = this.generation,
    browserSessionEpoch?: number,
  ) =>
    this.enqueueCredentialWrite(generation, async () => {
      await this.storage.clearRefreshToken();
      await this.storage.clearLogoutIntent(browserSessionEpoch);
    });

  expire = async (generation = this.generation) => {
    if (!this.isGenerationCurrent(generation)) return;
    await this.expiredHandler(generation);
  };

  setExpiredHandler(handler: (generation: number) => void | Promise<void>) {
    this.expiredHandler = handler;
  }

  private enqueueCredentialWrite(generation: number, operation: () => Promise<void>) {
    const run = this.credentialQueue.then(async () => {
      if (!this.isGenerationCurrent(generation)) {
        throw new SessionGenerationChangedError();
      }
      await operation();
      if (!this.isGenerationCurrent(generation)) {
        throw new SessionGenerationChangedError();
      }
    });

    this.credentialQueue = run.catch(() => undefined);
    return run;
  }
}
