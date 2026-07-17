import {
  cookieAuthResponseSchema,
  cookieLogoutRequestSchema,
  cookieRefreshRequestSchema,
  cookieRefreshResponseSchema,
  loginRequestSchema,
  meResponseSchema,
  registerRequestSchema,
  socialAuthProviderSchema,
  socialAuthRequestSchema,
  tokenAuthResponseSchema,
  tokenLogoutRequestSchema,
  tokenRefreshRequestSchema,
  tokenRefreshResponseSchema,
  type AuthSessionIdentity,
  type CookieAuthResponse,
  type CookieRefreshResponse,
  type LoginRequest,
  type MeResponse,
  type RegisterRequest,
  type SocialAuthProvider,
  type SocialAuthRequest,
  type TokenLogoutRequest,
} from '@web-app-demo/contracts';

import { ApiRequestError, type ApiTransport } from '@/platform/api';
import { SessionGenerationChangedError } from '@/platform/session';
import {
  coordinateBrowserAuthMutation,
  type BrowserAuthCoordinator,
} from './browser-auth-coordinator';
import {
  browserSessionCoordinator,
  type BrowserSessionCoordinator,
} from './browser-session-coordinator';

type AuthApiOptions = {
  browserAuthCoordinator?: BrowserAuthCoordinator;
  browserSessionCoordinator?: BrowserSessionCoordinator;
  clearRefreshToken: (generation?: number) => Promise<void>;
  getAccessToken: () => string | null;
  getGeneration: () => number;
  getRefreshToken: () => Promise<string | null>;
  isGenerationCurrent: (generation: number) => boolean;
  setRefreshToken: (refreshToken: string, generation?: number) => Promise<void>;
};

type TokenLogoutInput = Omit<TokenLogoutRequest, 'refreshToken'> & { refreshToken?: string };

export type AuthTransportKind = 'cookie' | 'token';
export type AuthSessionResponse = CookieAuthResponse & { refreshToken?: string };
export type AuthRefreshResponse = CookieRefreshResponse & { refreshToken?: string };
export type PreparedLogout = ((
  input?: TokenLogoutInput,
  signal?: AbortSignal,
) => Promise<boolean>) & {
  browserSessionEpoch?: number;
};

export class AuthApi {
  private readonly browserAuthCoordinator: BrowserAuthCoordinator;
  private readonly browserSessionCoordinator: BrowserSessionCoordinator;

  constructor(
    private readonly transport: ApiTransport,
    private readonly options: AuthApiOptions,
    private readonly kind: AuthTransportKind,
  ) {
    this.browserAuthCoordinator =
      options.browserAuthCoordinator ?? coordinateBrowserAuthMutation;
    this.browserSessionCoordinator =
      options.browserSessionCoordinator ?? browserSessionCoordinator;
  }

  register(
    input: RegisterRequest,
    generation = this.options.getGeneration(),
  ): Promise<AuthSessionResponse> {
    const payload = registerRequestSchema.parse(input);
    if (this.kind === 'cookie') {
      return this.mutateBrowserCookieSession(generation, () =>
        this.transport.request('/api/auth/register', cookieAuthResponseSchema, {
          method: 'POST',
          body: payload,
        }),
        (response) => {
          this.browserSessionCoordinator.publish('authenticated', response.user.id);
        },
      );
    }
    return this.transport.request(
      '/api/auth/token/register',
      tokenAuthResponseSchema,
      { method: 'POST', body: payload },
    );
  }

  login(
    input: LoginRequest,
    generation = this.options.getGeneration(),
  ): Promise<AuthSessionResponse> {
    const payload = loginRequestSchema.parse(input);
    if (this.kind === 'cookie') {
      return this.mutateBrowserCookieSession(generation, () =>
        this.transport.request('/api/auth/login', cookieAuthResponseSchema, {
          method: 'POST',
          body: payload,
        }),
        (response) => {
          this.browserSessionCoordinator.publish('authenticated', response.user.id);
        },
      );
    }
    return this.transport.request('/api/auth/token/login', tokenAuthResponseSchema, {
      method: 'POST',
      body: payload,
    });
  }

  socialAuth(
    provider: SocialAuthProvider,
    input: SocialAuthRequest,
    _generation = this.options.getGeneration(),
  ): Promise<AuthSessionResponse> {
    if (this.kind === 'cookie') {
      throw new ApiRequestError(
        400,
        'AUTH_SOCIAL_UNSUPPORTED',
        'Native social sign-in is unavailable in the Expo web build',
      );
    }
    const parsedProvider = socialAuthProviderSchema.parse(provider);
    return this.transport.request(
      `/api/auth/token/social/${parsedProvider}`,
      tokenAuthResponseSchema,
      { method: 'POST', body: socialAuthRequestSchema.parse(input) },
    );
  }

  async refresh(generation = this.options.getGeneration()): Promise<AuthRefreshResponse> {
    if (this.kind === 'cookie') {
      const expectedEpoch = this.browserSessionCoordinator.current().epoch;
      const expectedIdentity = accessTokenIdentity(this.options.getAccessToken());
      return this.browserAuthCoordinator(async () => {
        this.assertGeneration(generation);
        this.assertBrowserEpoch(expectedEpoch);
        const response = await this.transport.request(
          '/api/auth/refresh',
          cookieRefreshResponseSchema,
          {
          method: 'POST',
          body: cookieRefreshRequestSchema.parse({}),
          retryOnUnauthorized: false,
          },
        );
        this.assertGeneration(generation);
        this.assertBrowserEpoch(expectedEpoch);
        const responseIdentity = accessTokenIdentity(response.accessToken);
        if (
          this.options.getAccessToken() &&
          (!expectedIdentity ||
            !responseIdentity ||
            !sameSessionIdentity(expectedIdentity, responseIdentity))
        ) {
          throw new SessionGenerationChangedError();
        }
        return response;
      });
    }
    const refreshToken = await this.options.getRefreshToken();
    this.assertGeneration(generation);
    const response = await this.transport.request(
      '/api/auth/token/refresh',
      tokenRefreshResponseSchema,
      {
        method: 'POST',
        body: tokenRefreshRequestSchema.parse({ refreshToken: refreshToken ?? undefined }),
        retryOnUnauthorized: false,
      },
    );
    this.assertGeneration(generation);
    await this.options.setRefreshToken(response.refreshToken, generation);
    this.assertGeneration(generation);
    return response;
  }

  me(): Promise<MeResponse> {
    return this.transport.request('/api/auth/me', meResponseSchema, { auth: true });
  }

  prepareLogout(
    generation = this.options.getGeneration(),
  ): PreparedLogout {
    const expectedBrowserEpoch = this.kind === 'cookie'
      ? this.browserSessionCoordinator.current().epoch
      : undefined;
    return Object.assign(
      (input: TokenLogoutInput = {}, signal?: AbortSignal) =>
        this.logout(input, generation, signal, expectedBrowserEpoch),
      expectedBrowserEpoch === undefined
        ? {}
        : { browserSessionEpoch: expectedBrowserEpoch },
    );
  }

  async logout(
    input: TokenLogoutInput = {},
    generation = this.options.getGeneration(),
    signal?: AbortSignal,
    expectedBrowserEpoch = this.kind === 'cookie'
      ? this.browserSessionCoordinator.current().epoch
      : undefined,
  ) {
    if (this.kind === 'cookie') {
      return this.mutateBrowserCookieSession(generation, async () => {
        await this.transport.raw('/api/auth/logout', {
          method: 'POST',
          body: cookieLogoutRequestSchema.parse({}),
          retryOnUnauthorized: false,
          signal,
        });
        return true;
      }, () => {
        this.browserSessionCoordinator.publish('cleared');
      }, expectedBrowserEpoch);
    }
    const storedRefreshToken = await this.options.getRefreshToken();
    const payload = tokenLogoutRequestSchema.parse({
      ...input,
      refreshToken: input.refreshToken ?? storedRefreshToken ?? undefined,
    });
    const response = await this.transport.raw('/api/auth/token/logout', {
      method: 'POST',
      body: payload,
      retryOnUnauthorized: false,
      signal,
    });
    return response.headers.get('X-Auth-Session-Revoked') === 'true';
  }

  clearRefreshToken() {
    return this.options.clearRefreshToken();
  }

  async canRefresh() {
    return this.kind === 'cookie' || Boolean(await this.options.getRefreshToken());
  }

  private assertGeneration(generation: number) {
    if (!this.options.isGenerationCurrent(generation)) {
      throw new SessionGenerationChangedError();
    }
  }

  private mutateBrowserCookieSession<T>(
    generation: number,
    mutation: () => Promise<T>,
    onSuccess?: (result: T) => void,
    expectedBrowserEpoch?: number,
  ) {
    return this.browserAuthCoordinator(async () => {
      this.assertGeneration(generation);
      if (expectedBrowserEpoch !== undefined) {
        this.assertBrowserEpoch(expectedBrowserEpoch);
      }
      const result = await mutation();
      this.assertGeneration(generation);
      if (expectedBrowserEpoch !== undefined) {
        this.assertBrowserEpoch(expectedBrowserEpoch);
      }
      onSuccess?.(result);
      return result;
    });
  }

  private assertBrowserEpoch(epoch: number) {
    if (!this.browserSessionCoordinator.isCurrent(epoch)) {
      throw new SessionGenerationChangedError();
    }
  }
}

export type AuthApiPort = Pick<
  AuthApi,
  | 'canRefresh'
  | 'login'
  | 'logout'
  | 'me'
  | 'prepareLogout'
  | 'refresh'
  | 'register'
  | 'socialAuth'
>;

function sameSessionIdentity(
  left: AuthSessionIdentity,
  right: AuthSessionIdentity,
) {
  return left.userId === right.userId && left.sessionId === right.sessionId;
}

function accessTokenIdentity(accessToken: string | null): AuthSessionIdentity | null {
  const encodedPayload = accessToken?.split('.')[1];
  if (!encodedPayload) return null;

  try {
    const normalized = encodedPayload.replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
    const payload = JSON.parse(atob(padded)) as {
      sessionId?: unknown;
      sub?: unknown;
    };
    if (typeof payload.sub !== 'string' || typeof payload.sessionId !== 'string') {
      return null;
    }
    return { userId: payload.sub, sessionId: payload.sessionId };
  } catch {
    return null;
  }
}
